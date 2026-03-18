import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { config } from './config';
import { getWorker } from './sfu/worker';
import { handleConnection } from './signaling/wsHandler';
import { handleP2PConnection } from './signaling/p2pHandler';

async function main(): Promise<void> {
  // Pre-warm the mediasoup Worker
  await getWorker();

  const app = express();
  app.use(cors({ origin: config.clientOrigin }));
  app.use(express.json());

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  const server = http.createServer(app);

  // Use noServer mode for both WSS instances, then manually route upgrades by path.
  // This avoids the issue where the first WSS rejects upgrades for paths it doesn't own.
  const wss = new WebSocketServer({ noServer: true });
  const wssP2P = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws: any, req) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    const ip = req.socket.remoteAddress;
    console.log(`🟢 New SFU WebSocket connection from [${ip}]`);
    handleConnection(ws);
  });

  wssP2P.on('connection', (ws: any, req) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    const ip = req.socket.remoteAddress;
    console.log(`🟩 New P2P WebSocket connection from [${ip}]`);
    handleP2PConnection(ws);
  });

  // Route WebSocket upgrades by path
  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url ?? '/', `http://${req.headers.host}`);
    if (pathname === '/ws') {
      wss.handleUpgrade(req, socket as any, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } else if (pathname === '/ws-p2p') {
      wssP2P.handleUpgrade(req, socket as any, head, (ws) => {
        wssP2P.emit('connection', ws, req);
      });
    } else {
      socket.destroy();
    }
  });

  // Heartbeat to keep connections alive through NATs/proxies and detect ghost drops
  const interval = setInterval(() => {
    [wss, wssP2P].forEach((server) => {
      server.clients.forEach((ws: any) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
      });
    });
  }, 30_000);

  wss.on('close', () => {
    clearInterval(interval);
  });

  server.listen(config.listenPort, () => {
    console.log(`🚀 Server listening on http://0.0.0.0:${config.listenPort}`);
    console.log(`   WebSocket endpoint: ws://0.0.0.0:${config.listenPort}/ws`);
    console.log(`   Health check:       http://0.0.0.0:${config.listenPort}/api/health`);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('SIGTERM received — shutting down gracefully');
    server.close(() => process.exit(0));
  });
}

main().catch((err) => {
  console.error('Fatal error during startup:', err);
  process.exit(1);
});
