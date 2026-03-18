import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { types as mediasoupTypes } from 'mediasoup';
import { getOrCreateRouter } from '../sfu/worker';
import { createWebRtcTransport } from '../sfu/transport';
import {
  getOrCreateRoom,
  getRoom,
  createPeer,
  addPeer,
  removePeer,
  getExistingProducers,
  Room,
} from '../sfu/roomManager';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WsMessage {
  type: string;
  id?: string;
  data?: Record<string, unknown>;
}

// Global map: peerId → WebSocket (for broadcasting)
const peerWsMap = new Map<string, WebSocket>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function reply(ws: WebSocket, type: string, data: unknown, id?: string): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type, id, data }));
}

function broadcast(
  room: Room,
  type: string,
  data: unknown,
  excludePeerId: string
): void {
  room.peers.forEach((_, pid) => {
    if (pid === excludePeerId) return;
    const pws = peerWsMap.get(pid);
    if (pws && pws.readyState === WebSocket.OPEN) {
      pws.send(JSON.stringify({ type, data }));
    }
  });
}

// ─── Connection Handler ───────────────────────────────────────────────────────

export async function handleConnection(ws: WebSocket): Promise<void> {
  let peerId = '';
  let roomId = '';

  // ── Message dispatcher ───────────────────────────────────────────────────

  ws.on('message', async (raw: Buffer) => {
    let msg: WsMessage;
    try {
      msg = JSON.parse(raw.toString()) as WsMessage;
    } catch {
      return;
    }

    const { type, id, data = {} } = msg;

    try {
      switch (type) {
        // ─────────────────────────────────────────────────────────────── join
        case 'join': {
          peerId = uuidv4();
          roomId = data.roomId as string;
          const displayName = (data.displayName as string) || 'Anonymous';

          const router = await getOrCreateRouter(roomId);
          const room = await getOrCreateRoom(roomId, router, broadcast);
          const existingProducers = getExistingProducers(room, peerId);

          const peer = createPeer(peerId, displayName);
          addPeer(room, peer);
          peerWsMap.set(peerId, ws);

          reply(ws, 'joined', {
            peerId,
            routerRtpCapabilities: router.rtpCapabilities,
            existingProducers,
          }, id);

          broadcast(room, 'peerJoined', { peerId, displayName }, peerId);
          break;
        }

        // ──────────────────────────────────────────────── createTransport
        case 'createTransport': {
          const room = getRoom(roomId);
          if (!room || !peerId) break;
          const peer = room.peers.get(peerId);
          if (!peer) break;

          const transport = await createWebRtcTransport(room.router);
          peer.transports.set(transport.id, transport);

          reply(ws, 'transportCreated', {
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters,
            sctpParameters: transport.sctpParameters,
          }, id);
          break;
        }

        // ──────────────────────────────────────────────── connectTransport
        case 'connectTransport': {
          const room = getRoom(roomId);
          if (!room || !peerId) break;
          const peer = room.peers.get(peerId);
          if (!peer) break;

          const transport = peer.transports.get(data.transportId as string);
          if (!transport) { reply(ws, 'error', { message: 'Transport not found' }, id); break; }

          await transport.connect({
            dtlsParameters: data.dtlsParameters as mediasoupTypes.DtlsParameters,
          });

          reply(ws, 'transportConnected', { ok: true }, id);
          break;
        }

        // ──────────────────────────────────────────────────────── produce
        case 'produce': {
          const room = getRoom(roomId);
          if (!room || !peerId) break;
          const peer = room.peers.get(peerId);
          if (!peer) break;

          const transport = peer.transports.get(data.transportId as string);
          if (!transport) { reply(ws, 'error', { message: 'Transport not found' }, id); break; }

          const producer = await transport.produce({
            kind: data.kind as mediasoupTypes.MediaKind,
            rtpParameters: data.rtpParameters as mediasoupTypes.RtpParameters,
            appData: (data.appData as Record<string, unknown>) ?? {},
          });

          peer.producers.set(producer.id, producer);

          producer.on('transportclose', () => {
            producer.close();
            peer.producers.delete(producer.id);
          });

          reply(ws, 'produced', { producerId: producer.id }, id);

          // Listen for audio levels
          if (producer.kind === 'audio') {
            try {
              await room.audioLevelObserver.addProducer({ producerId: producer.id });
            } catch (err) {
              console.warn('[WS] Failed to add audio producer to observer', err);
            }
          }

          // Notify other peers
          broadcast(room, 'newProducer', {
            producerId: producer.id,
            peerId,
            displayName: peer.displayName,
            kind: producer.kind,
          }, peerId);
          break;
        }

        // ──────────────────────────────────────────────────────── consume
        case 'consume': {
          const room = getRoom(roomId);
          if (!room || !peerId) break;
          const peer = room.peers.get(peerId);
          if (!peer) break;

          const transport = peer.transports.get(data.transportId as string);
          if (!transport) { reply(ws, 'error', { message: 'Recv transport not found' }, id); break; }

          const producerId = data.producerId as string;
          const rtpCapabilities = data.rtpCapabilities as mediasoupTypes.RtpCapabilities;

          // Find the producer
          let producerPeerId = '';
          let producer: mediasoupTypes.Producer | undefined;
          for (const [pid, p] of room.peers) {
            if (p.producers.has(producerId)) {
              producerPeerId = pid;
              producer = p.producers.get(producerId);
              break;
            }
          }

          if (!producer) { reply(ws, 'error', { message: 'Producer not found' }, id); break; }
          if (!room.router.canConsume({ producerId, rtpCapabilities })) {
            reply(ws, 'error', { message: 'Cannot consume (codec mismatch)' }, id);
            break;
          }

          const consumer = await transport.consume({
            producerId,
            rtpCapabilities,
            paused: true, // resume after client is ready
          });

          peer.consumers.set(consumer.id, consumer);

          consumer.on('transportclose', () => {
            consumer.close();
            peer.consumers.delete(consumer.id);
          });

          consumer.on('producerclose', () => {
            consumer.close();
            peer.consumers.delete(consumer.id);
            reply(ws, 'consumerClosed', { consumerId: consumer.id, producerId });
          });

          const producerPeer = room.peers.get(producerPeerId);

          reply(ws, 'consumed', {
            consumerId: consumer.id,
            producerId,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
            producerPeerId,
            producerDisplayName: producerPeer?.displayName ?? '',
          }, id);
          break;
        }

        // ──────────────────────────────────────────────── resumeConsumer
        case 'resumeConsumer': {
          const room = getRoom(roomId);
          if (!room || !peerId) break;
          const peer = room.peers.get(peerId);
          if (!peer) break;

          const consumer = peer.consumers.get(data.consumerId as string);
          if (consumer) await consumer.resume();

          reply(ws, 'consumerResumed', { ok: true }, id);
          break;
        }

        // ──────────────────────────────────────────────── producer state
        case 'pauseProducer': {
          const room = getRoom(roomId);
          if (!room || !peerId) break;
          const peer = room.peers.get(peerId);
          if (!peer) break;

          const producer = peer.producers.get(data.producerId as string);
          if (producer) {
            await producer.pause();
            broadcast(room, 'producerPaused', { producerId: producer.id, peerId, kind: producer.kind }, peerId);
          }
          reply(ws, 'producerPausedAck', { ok: true }, id);
          break;
        }

        case 'resumeProducer': {
          const room = getRoom(roomId);
          if (!room || !peerId) break;
          const peer = room.peers.get(peerId);
          if (!peer) break;

          const producer = peer.producers.get(data.producerId as string);
          if (producer) {
            await producer.resume();
            broadcast(room, 'producerResumed', { producerId: producer.id, peerId, kind: producer.kind }, peerId);
          }
          reply(ws, 'producerResumedAck', { ok: true }, id);
          break;
        }

        // ─────────────────────────────────────────────────────────── chat
        case 'chat': {
          const room = getRoom(roomId);
          if (!room || !peerId) break;
          const peer = room.peers.get(peerId);
          if (!peer) break;

          const text = data.text as string;
          if (!text || text.trim() === '') break;

          // Broadcast to everyone (including self for easy local optimism or just everyone else)
          // Let's broadcast to everyone else, and the sender can optimistically append locally
          broadcast(room, 'chatMsg', {
            id: uuidv4(),
            peerId,
            displayName: peer.displayName,
            text,
            timestamp: Date.now(),
          }, peerId);

          // Acknowledge sending
          reply(ws, 'chatSent', { ok: true }, id);
          break;
        }

        // ─────────────────────────────────────────────────────────── leave
        case 'leave': {
          cleanup();
          break;
        }

        default:
          console.warn(`[WS] Unknown message type: ${type}`);
      }
    } catch (err) {
      console.error(`[WS] Error handling "${type}":`, err);
      reply(ws, 'error', { message: String(err) }, id);
    }
  });

  // ── Cleanup on disconnect ─────────────────────────────────────────────────

  function cleanup(): void {
    if (!peerId) return;
    peerWsMap.delete(peerId);

    const room = getRoom(roomId);
    if (room) {
      // Notify remaining peers before removing
      broadcast(room, 'peerLeft', { peerId }, peerId);
      removePeer(room, peerId);
    }

    console.log(`🔴 WebSocket closed for peer [${peerId}]`);
    peerId = '';
    roomId = '';
  }

  ws.on('close', cleanup);
  ws.on('error', (err) => {
    console.error('[WS] Socket error:', err);
    cleanup();
  });
}
