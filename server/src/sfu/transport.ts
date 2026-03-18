import { types as mediasoupTypes } from 'mediasoup';
import { config } from '../config';

export async function createWebRtcTransport(
  router: mediasoupTypes.Router
): Promise<mediasoupTypes.WebRtcTransport> {
  const transport = await router.createWebRtcTransport(
    config.mediasoup.webRtcTransportOptions
  );

  transport.on('dtlsstatechange', (dtlsState) => {
    if (dtlsState === 'closed') {
      transport.close();
    }
  });

  console.log(`🔌 WebRtcTransport created [${transport.id}]`);
  return transport;
}
