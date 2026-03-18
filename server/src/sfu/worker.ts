import * as mediasoup from 'mediasoup';
import { types as mediasoupTypes } from 'mediasoup';
import { config } from '../config';

let worker: mediasoupTypes.Worker | null = null;

// Room ID → Router map for reuse within the same room
const routers = new Map<string, mediasoupTypes.Router>();

export async function getWorker(): Promise<mediasoupTypes.Worker> {
  if (worker) return worker;

  worker = await mediasoup.createWorker({
    logLevel: config.mediasoup.workerSettings.logLevel,
    logTags: config.mediasoup.workerSettings.logTags,
    rtcMinPort: config.mediasoup.workerSettings.rtcMinPort,
    rtcMaxPort: config.mediasoup.workerSettings.rtcMaxPort,
  });

  worker.on('died', (error) => {
    console.error('💀 mediasoup worker died:', error);
    process.exit(1);
  });

  console.log(`✅ mediasoup worker created [pid:${worker.pid}]`);
  return worker;
}

export async function getOrCreateRouter(
  roomId: string
): Promise<mediasoupTypes.Router> {
  if (routers.has(roomId)) {
    return routers.get(roomId)!;
  }

  const w = await getWorker();
  const router = await w.createRouter({
    mediaCodecs: config.mediasoup.routerOptions.mediaCodecs,
  });

  routers.set(roomId, router);
  console.log(`📡 Router created for room [${roomId}]`);

  router.on('workerclose', () => {
    console.warn(`⚠️  Router for room [${roomId}] closed (worker died)`);
    routers.delete(roomId);
  });

  return router;
}

export function deleteRouter(roomId: string): void {
  const router = routers.get(roomId);
  if (router) {
    router.close();
    routers.delete(roomId);
    console.log(`🗑️  Router deleted for room [${roomId}]`);
  }
}
