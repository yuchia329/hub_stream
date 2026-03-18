import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WsMessage {
  type: string;
  id?: string;
  data?: Record<string, unknown>;
}

interface P2PPeer {
  id: string;
  displayName: string;
  ws: WebSocket;
}

// ─── In-memory rooms ──────────────────────────────────────────────────────────
// roomId → Map<peerId, P2PPeer>
const p2pRooms = new Map<string, Map<string, P2PPeer>>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function reply(ws: WebSocket, type: string, data: unknown, id?: string): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type, id, data }));
}

function broadcastToRoom(
  room: Map<string, P2PPeer>,
  type: string,
  data: unknown,
  excludePeerId: string
): void {
  room.forEach((peer) => {
    if (peer.id === excludePeerId) return;
    if (peer.ws.readyState === WebSocket.OPEN) {
      peer.ws.send(JSON.stringify({ type, data }));
    }
  });
}

function sendToPeer(
  room: Map<string, P2PPeer>,
  targetPeerId: string,
  type: string,
  data: unknown
): void {
  const target = room.get(targetPeerId);
  if (target && target.ws.readyState === WebSocket.OPEN) {
    target.ws.send(JSON.stringify({ type, data }));
  }
}

// ─── Connection Handler ───────────────────────────────────────────────────────

export function handleP2PConnection(ws: WebSocket): void {
  let peerId = '';
  let roomId = '';

  ws.on('message', (raw: Buffer) => {
    let msg: WsMessage;
    try {
      msg = JSON.parse(raw.toString()) as WsMessage;
    } catch {
      return;
    }

    const { type, id, data = {} } = msg;

    try {
      switch (type) {
        // ──────────────────────────────────────────────────────────── join
        case 'join': {
          peerId = uuidv4();
          roomId = data.roomId as string;
          const displayName = (data.displayName as string) || 'Anonymous';

          if (!p2pRooms.has(roomId)) {
            p2pRooms.set(roomId, new Map());
          }
          const room = p2pRooms.get(roomId)!;

          // Send the joining peer the list of already-present peers
          const existingPeers = [...room.values()].map((p) => ({
            peerId: p.id,
            displayName: p.displayName,
          }));

          room.set(peerId, { id: peerId, displayName, ws });

          reply(ws, 'joined', { peerId, existingPeers }, id);

          // Notify others
          broadcastToRoom(room, 'peerJoined', { peerId, displayName }, peerId);

          console.log(`🟩 [P2P] Peer [${displayName}] joined room [${roomId}] (${room.size} total)`);
          break;
        }

        // ───────────────────────────────────────────── WebRTC offer relay
        case 'offer': {
          const room = p2pRooms.get(roomId);
          if (!room) break;
          const targetPeerId = data.targetPeerId as string;
          sendToPeer(room, targetPeerId, 'offer', {
            fromPeerId: peerId,
            sdp: data.sdp,
          });
          break;
        }

        // ──────────────────────────────────────────── WebRTC answer relay
        case 'answer': {
          const room = p2pRooms.get(roomId);
          if (!room) break;
          const targetPeerId = data.targetPeerId as string;
          sendToPeer(room, targetPeerId, 'answer', {
            fromPeerId: peerId,
            sdp: data.sdp,
          });
          break;
        }

        // ────────────────────────────────────────── ICE candidate relay
        case 'iceCandidate': {
          const room = p2pRooms.get(roomId);
          if (!room) break;
          const targetPeerId = data.targetPeerId as string;
          sendToPeer(room, targetPeerId, 'iceCandidate', {
            fromPeerId: peerId,
            candidate: data.candidate,
          });
          break;
        }

        // ────────────────────────────────────────────────────────── chat
        case 'chat': {
          const room = p2pRooms.get(roomId);
          if (!room || !peerId) break;
          const peer = room.get(peerId);
          if (!peer) break;

          const text = data.text as string;
          if (!text || text.trim() === '') break;

          broadcastToRoom(room, 'chatMsg', {
            id: uuidv4(),
            peerId,
            displayName: peer.displayName,
            text,
            timestamp: Date.now(),
          }, peerId);

          reply(ws, 'chatSent', { ok: true }, id);
          break;
        }

        // ───────────────────────────────────────────────────────── leave
        case 'leave': {
          cleanup();
          break;
        }

        default:
          console.warn(`[P2P WS] Unknown message type: ${type}`);
      }
    } catch (err) {
      console.error(`[P2P WS] Error handling "${type}":`, err);
      reply(ws, 'error', { message: String(err) }, id);
    }
  });

  // ── Cleanup on disconnect ───────────────────────────────────────────────────

  function cleanup(): void {
    if (!peerId) return;

    const room = p2pRooms.get(roomId);
    if (room) {
      broadcastToRoom(room, 'peerLeft', { peerId }, peerId);
      room.delete(peerId);

      if (room.size === 0) {
        p2pRooms.delete(roomId);
        console.log(`🧹 [P2P] Room [${roomId}] removed (empty)`);
      } else {
        console.log(`👋 [P2P] Peer [${peerId}] left room [${roomId}] (${room.size} remaining)`);
      }
    }

    peerId = '';
    roomId = '';
  }

  ws.on('close', cleanup);
  ws.on('error', (err) => {
    console.error('[P2P WS] Socket error:', err);
    cleanup();
  });
}
