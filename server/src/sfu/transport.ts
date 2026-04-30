import { types as mediasoupTypes } from 'mediasoup';
import { config } from '../config';
import { webrtcIceSetupFailuresTotal } from '../metrics';
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

  transport.on('icestatechange', (iceState) => {
    if (iceState === 'disconnected') {
      webrtcIceSetupFailuresTotal.inc();
    }
  });

  console.log(`🔌 WebRtcTransport created [${transport.id}]`);
  return transport;
}
