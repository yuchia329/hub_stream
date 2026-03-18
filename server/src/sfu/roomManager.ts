import { types as mediasoupTypes } from 'mediasoup';
import { deleteRouter } from './worker';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Peer {
  id: string;
  displayName: string;
  transports: Map<string, mediasoupTypes.WebRtcTransport>;
  producers: Map<string, mediasoupTypes.Producer>;
  consumers: Map<string, mediasoupTypes.Consumer>;
}

export interface Room {
  id: string;
  router: mediasoupTypes.Router;
  audioLevelObserver: mediasoupTypes.AudioLevelObserver;
  peers: Map<string, Peer>;
}

// ─── In-memory store ──────────────────────────────────────────────────────────

const rooms = new Map<string, Room>();

// ─── Room CRUD ────────────────────────────────────────────────────────────────

export async function getOrCreateRoom(
  roomId: string,
  router: mediasoupTypes.Router,
  broadcastFn: (room: Room, type: string, data: unknown, excludePeerId: string) => void
): Promise<Room> {
  if (!rooms.has(roomId)) {
    const audioLevelObserver = await router.createAudioLevelObserver({
      maxEntries: 100, // Track all possible speakers instead of just the loudest 1
      threshold: -60,
      interval: 1000,
    });

    const room: Room = { id: roomId, router, audioLevelObserver, peers: new Map() };
    
    audioLevelObserver.on('volumes', (volumes) => {
      // 'volumes' is pre-sorted from highest to lowest volume by mediasoup
      const activeSpeakers: { peerId: string; volume: number }[] = [];
      for (const { producer, volume } of volumes) {
        let speakerPeerId = '';
        for (const [pid, peer] of room.peers) {
          if (peer.producers.has(producer.id)) {
            speakerPeerId = pid;
            break;
          }
        }
        if (speakerPeerId) {
          activeSpeakers.push({ peerId: speakerPeerId, volume });
        }
      }
      
      if (activeSpeakers.length > 0) {
        broadcastFn(room, 'activeSpeakers', activeSpeakers, '');
      }
    });

    audioLevelObserver.on('silence', () => {
      broadcastFn(room, 'activeSpeakers', [], '');
    });

    rooms.set(roomId, room);
    console.log(`🚪 Room created [${roomId}]`);
  }
  return rooms.get(roomId)!;
}

export function getRoom(roomId: string): Room | undefined {
  return rooms.get(roomId);
}

// ─── Peer CRUD ────────────────────────────────────────────────────────────────

export function createPeer(id: string, displayName: string): Peer {
  return {
    id,
    displayName,
    transports: new Map(),
    producers: new Map(),
    consumers: new Map(),
  };
}

export function addPeer(room: Room, peer: Peer): void {
  room.peers.set(peer.id, peer);
  console.log(`👤 Peer [${peer.displayName}] joined room [${room.id}] (${room.peers.size} total)`);
}

export function removePeer(room: Room, peerId: string): void {
  const peer = room.peers.get(peerId);
  if (!peer) return;

  // Close all transports (which closes producers/consumers)
  peer.transports.forEach((transport) => {
    try { transport.close(); } catch (_) {}
  });

  room.peers.delete(peerId);
  console.log(`👋 Peer [${peer.displayName}] left room [${room.id}] (${room.peers.size} remaining)`);

  // Clean up empty rooms
  if (room.peers.size === 0) {
    rooms.delete(room.id);
    deleteRouter(room.id);
    console.log(`🧹 Room [${room.id}] removed (empty)`);
  }
}

export function getExistingProducers(
  room: Room,
  excludePeerId: string
): Array<{ producerId: string; peerId: string; displayName: string; kind: string }> {
  const result: Array<{ producerId: string; peerId: string; displayName: string; kind: string }> = [];

  room.peers.forEach((peer, pid) => {
    if (pid === excludePeerId) return;
    peer.producers.forEach((producer) => {
      result.push({
        producerId: producer.id,
        peerId: pid,
        displayName: peer.displayName,
        kind: producer.kind,
      });
    });
  });

  return result;
}
