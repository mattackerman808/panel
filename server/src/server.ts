import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { WebSocketServer, type WebSocket } from 'ws';
import { config } from './config.js';
import { store } from './store.js';
import type { WsMessage } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function createServer() {
  const app = Fastify({ logger: false });

  app.get('/api/snapshot', async () => store.snapshot());
  app.get('/api/health', async () => ({ ok: true, ts: Date.now() }));

  const distPath = resolve(__dirname, '..', config.webDistPath);
  if (existsSync(distPath)) {
    // One build serves both kiosks. The page names its home-screen icon and
    // app title, so for energy.* hosts swap those to the energy set before
    // sending it — iOS reads them from the HTML when adding to the home
    // screen. (Apache proxies with ProxyPreserveHost, so Host is the real
    // name.)
    const indexPath = resolve(distPath, 'index.html');
    const page = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : null;
    const energyPage = page
      ?.replaceAll('icons/panel', 'icons/energy')
      .replace('name="apple-mobile-web-app-title" content="Panel"', 'name="apple-mobile-web-app-title" content="Energy"');
    if (page) {
      app.get('/', async (req, reply) => {
        const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '');
        reply.type('text/html; charset=utf-8').header('cache-control', 'no-cache');
        return host.startsWith('energy.') ? energyPage : page;
      });
    }
    await app.register(fastifyStatic, { root: distPath, prefix: '/', index: page ? false : undefined });
  } else {
    app.get('/', async (_req, reply) => {
      reply.type('text/plain');
      return `panel server running. Web dist not found at ${distPath}.\nRun the SvelteKit dev server on :5173 (npm run dev).\n`;
    });
  }

  const wss = new WebSocketServer({ noServer: true });

  app.server.on('upgrade', (req, socket, head) => {
    if (req.url === '/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', (ws: WebSocket) => {
    const send = (msg: WsMessage) => {
      if (ws.readyState !== ws.OPEN) return;
      ws.send(JSON.stringify(msg));
    };
    send({ type: 'snapshot', data: store.snapshot() });
    const unsub = store.subscribe((tick) => send({ type: 'tick', data: tick }));
    ws.on('close', unsub);
    ws.on('error', () => unsub());
  });

  return app;
}
