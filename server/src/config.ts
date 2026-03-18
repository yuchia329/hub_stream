import os from 'os';
import { types as mediasoupTypes } from 'mediasoup';

export const config = {
  listenPort: Number(process.env.PORT) || 4000,
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:3000',

  mediasoup: {
    // Use 1 worker for dev; in prod you can use os.cpus().length
    numWorkers: 1,

    workerSettings: {
      logLevel: 'warn' as mediasoupTypes.WorkerLogLevel,
      logTags: ['info', 'ice', 'dtls', 'rtp'] as mediasoupTypes.WorkerLogTag[],
      rtcMinPort: 40000,
      rtcMaxPort: 49999,
    },

    routerOptions: {
      mediaCodecs: [
        {
          kind: 'audio' as mediasoupTypes.MediaKind,
          mimeType: 'audio/opus',
          clockRate: 48000,
          channels: 2,
        },
        {
          kind: 'video' as mediasoupTypes.MediaKind,
          mimeType: 'video/VP8',
          clockRate: 90000,
          parameters: {
            'x-google-start-bitrate': 1000,
          },
        },
        {
          kind: 'video' as mediasoupTypes.MediaKind,
          mimeType: 'video/H264',
          clockRate: 90000,
          parameters: {
            'packetization-mode': 1,
            'profile-level-id': '42e01f',
            'level-asymmetry-allowed': 1,
          },
        },
      ] as mediasoupTypes.RtpCodecCapability[],
    },

    webRtcTransportOptions: {
      listenInfos: [
        {
          protocol: 'udp' as const,
          ip: process.env.MEDIASOUP_LISTEN_IP || '0.0.0.0',
          announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP || '127.0.0.1',
        },
        {
          protocol: 'tcp' as const,
          ip: process.env.MEDIASOUP_LISTEN_IP || '0.0.0.0',
          announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP || '127.0.0.1',
        },
      ],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      initialAvailableOutgoingBitrate: 1_000_000,
    } as mediasoupTypes.WebRtcTransportOptions,
  },
};
