import client from 'prom-client';
import { getAllRooms } from './sfu/roomManager';
import { getWorker } from './sfu/worker';

// Create a Registry
export const register = new client.Registry();

// Add default metrics (e.g. process CPU, memory)
client.collectDefaultMetrics({ register });

export const clientPingHistogram = new client.Histogram({
  name: 'webrtc_client_ping_ms',
  help: 'Client WebSocket ping round trip time in ms',
  buckets: [10, 50, 100, 200, 500, 1000],
});

export const webrtcJitterHistogram = new client.Histogram({
  name: 'webrtc_jitter_ms',
  help: 'WebRTC jitter in ms',
  labelNames: ['kind'], // audio or video
  buckets: [5, 10, 20, 50, 100, 200],
});

export const webrtcRttHistogram = new client.Histogram({
  name: 'webrtc_rtt_ms',
  help: 'WebRTC Round Trip Time in ms',
  labelNames: ['kind'],
  buckets: [10, 50, 100, 200, 500, 1000],
});

export const webrtcPacketsLostTotal = new client.Counter({
  name: 'webrtc_packets_lost_total',
  help: 'Total WebRTC packets lost',
  labelNames: ['kind', 'direction'], // direction: rx or tx
});

export const webrtcBytesTotal = new client.Counter({
  name: 'webrtc_bytes_total',
  help: 'Total WebRTC bytes sent/received (used to calculate bitrate)',
  labelNames: ['kind', 'direction'], // direction: rx or tx
});

// Mediasoup Worker
export const mediasoupWorkerMemoryUsage = new client.Gauge({
  name: 'mediasoup_worker_memory_usage_bytes',
  help: 'Mediasoup worker max resident set size (ru_maxrss)',
  labelNames: ['pid'],
});

export const mediasoupWorkerCpuTime = new client.Counter({
  name: 'mediasoup_worker_cpu_time_ms',
  help: 'Mediasoup worker CPU time in milliseconds',
  labelNames: ['pid', 'type'],
});

//ICE
export const webrtcIceSetupFailuresTotal = new client.Counter({
  name: 'webrtc_ice_setup_failures_total',
  help: 'Total WebRTC ICE connection setup failures',
});

register.registerMetric(clientPingHistogram);
register.registerMetric(webrtcJitterHistogram);
register.registerMetric(webrtcRttHistogram);
register.registerMetric(webrtcPacketsLostTotal);
register.registerMetric(webrtcBytesTotal);
register.registerMetric(mediasoupWorkerMemoryUsage);
register.registerMetric(mediasoupWorkerCpuTime);
register.registerMetric(webrtcIceSetupFailuresTotal);

const lastStats = new Map<string, { packetsLost: number; byteCount: number; pliCount: number; firCount: number; nackCount: number }>();
const lastWorkerCpuTime = new Map<number, { utime: number; stime: number }>();

export function startMetricsPolling() {
  setInterval(async () => {
    const rooms = getAllRooms();
    const activeIds = new Set<string>();


    try {
      const worker = await getWorker();
      const pid = worker.pid;
      const usage = await worker.getResourceUsage();
      mediasoupWorkerMemoryUsage.labels(pid.toString()).set(usage.ru_maxrss);

      const lastCpu = lastWorkerCpuTime.get(pid) || { utime: 0, stime: 0 };
      if (usage.ru_utime >= lastCpu.utime) {
        mediasoupWorkerCpuTime.labels(pid.toString(), 'user').inc(usage.ru_utime - lastCpu.utime);
      }
      if (usage.ru_stime >= lastCpu.stime) {
        mediasoupWorkerCpuTime.labels(pid.toString(), 'system').inc(usage.ru_stime - lastCpu.stime);
      }
      lastWorkerCpuTime.set(pid, { utime: usage.ru_utime, stime: usage.ru_stime });
    } catch (err) { }

    for (const room of rooms) {
      for (const peer of room.peers.values()) {
        // Poll Producers (inbound-rtp) - Data received by server
        for (const producer of peer.producers.values()) {
          activeIds.add(producer.id);
          try {
            const stats = await producer.getStats();
            stats.forEach((stat: any) => {
              // console.log('producer stat: ', stat)
              if (stat.type === 'inbound-rtp') {
                if (stat.jitter !== undefined) {
                  webrtcJitterHistogram.labels(producer.kind).observe(stat.jitter);
                }
                const last = lastStats.get(producer.id) || { packetsLost: 0, byteCount: 0, pliCount: 0, firCount: 0, nackCount: 0 };

                if (stat.packetsLost !== undefined && stat.packetsLost >= last.packetsLost) {
                  const deltaPackets = stat.packetsLost - last.packetsLost;
                  webrtcPacketsLostTotal.labels(producer.kind, 'rx').inc(deltaPackets);
                  last.packetsLost = stat.packetsLost;
                }

                if (stat.byteCount !== undefined && stat.byteCount >= last.byteCount) {
                  const deltaBytes = stat.byteCount - last.byteCount;
                  webrtcBytesTotal.labels(producer.kind, 'rx').inc(deltaBytes);
                  last.byteCount = stat.byteCount;
                }

                lastStats.set(producer.id, last);
              }
            });
          } catch (err) { }
        }

        // Poll Consumers (outbound-rtp and remote-inbound-rtp) - Data sent by server
        for (const consumer of peer.consumers.values()) {
          activeIds.add(consumer.id);
          try {
            const stats = await consumer.getStats();
            stats.forEach((stat: any) => {
              if (stat.type === 'remote-inbound-rtp' && stat.roundTripTime !== undefined) {
                webrtcRttHistogram.labels(consumer.kind).observe(stat.roundTripTime * 1000); // RTT is in seconds, convert to ms
              }
              if (stat.type === 'outbound-rtp') {
                const last = lastStats.get(consumer.id) || { packetsLost: 0, byteCount: 0, pliCount: 0, firCount: 0, nackCount: 0 };
                if (stat.byteCount !== undefined && stat.byteCount >= last.byteCount) {
                  const deltaBytes = stat.byteCount - last.byteCount;
                  webrtcBytesTotal.labels(consumer.kind, 'tx').inc(deltaBytes);
                  last.byteCount = stat.byteCount;
                }
                lastStats.set(consumer.id, last);
              }
            });
          } catch (err) { }
        }
      }
    }

    // Cleanup old stats
    for (const id of lastStats.keys()) {
      if (!activeIds.has(id)) {
        lastStats.delete(id);
      }
    }

  }, 10000);
}
