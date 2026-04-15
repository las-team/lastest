/**
 * Activity Feed WebSocket Server
 *
 * Runs a lightweight WS server that broadcasts activity events to authenticated clients.
 * Clients connect via /api/activity-feed/ws (proxied by ws-proxy-preload.js).
 *
 * Auth: clients send a cookie-based session token on upgrade; validated via verifyBearerToken.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { subscribeToActivityFeed, type ActivityFeedEvent } from './activity-events';
import { verifyBearerToken } from '@/lib/auth/api-key';
import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';

const ACTIVITY_FEED_PORT = parseInt(process.env.ACTIVITY_FEED_WS_PORT || '9400', 10);
const KEEPALIVE_INTERVAL = 25_000;

interface AuthenticatedSocket extends WebSocket {
  teamId: string;
  repoFilter?: string;
  sourceFilter?: string;
  isAlive: boolean;
}

const globalWss = globalThis as typeof globalThis & {
  __activityFeedWss?: WebSocketServer;
};

function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key) cookies[key] = decodeURIComponent(rest.join('='));
  }
  return cookies;
}

function extractSessionToken(req: IncomingMessage): string | null {
  const cookies = parseCookies(req.headers.cookie || '');
  // better-auth uses this cookie name (with or without __Secure- prefix)
  return cookies['__Secure-better-auth.session_token']
    || cookies['better-auth.session_token']
    || null;
}

function extractFilters(req: IncomingMessage): { repo?: string; source?: string } {
  const url = new URL(req.url || '/', `http://localhost`);
  return {
    repo: url.searchParams.get('repo') || undefined,
    source: url.searchParams.get('source') || undefined,
  };
}

export function startActivityFeedServer(): WebSocketServer {
  if (globalWss.__activityFeedWss) return globalWss.__activityFeedWss;

  const wss = new WebSocketServer({ port: ACTIVITY_FEED_PORT });
  globalWss.__activityFeedWss = wss;

  console.log(`[ActivityFeed WS] Listening on port ${ACTIVITY_FEED_PORT}`);

  // Subscribe to the in-memory activity event bus and broadcast to all connected clients
  subscribeToActivityFeed((event: ActivityFeedEvent) => {
    const payload = JSON.stringify(event);
    for (const client of wss.clients) {
      const ws = client as AuthenticatedSocket;
      if (ws.readyState !== WebSocket.OPEN) continue;
      if (ws.teamId !== event.teamId) continue;
      if (ws.repoFilter && event.repositoryId !== ws.repoFilter) continue;
      if (ws.sourceFilter && event.sourceType !== ws.sourceFilter) continue;
      ws.send(payload);
    }
  });

  // Keepalive ping/pong
  const interval = setInterval(() => {
    for (const client of wss.clients) {
      const ws = client as AuthenticatedSocket;
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, KEEPALIVE_INTERVAL);

  wss.on('close', () => clearInterval(interval));

  wss.on('connection', (ws: AuthenticatedSocket) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    // Send connected message
    ws.send(JSON.stringify({ type: 'connected', timestamp: Date.now() }));
  });

  return wss;
}

/**
 * Handle an HTTP upgrade for activity feed WS.
 * Called from ws-proxy-preload or a custom upgrade handler.
 */
export async function handleActivityFeedUpgrade(
  wss: WebSocketServer,
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): Promise<void> {
  const token = extractSessionToken(req);
  if (!token) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  let session;
  try {
    session = await verifyBearerToken(token);
  } catch {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  if (!session?.team?.id) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }

  const filters = extractFilters(req);

  wss.handleUpgrade(req, socket, head, (ws) => {
    const authWs = ws as AuthenticatedSocket;
    authWs.teamId = session.team!.id;
    authWs.repoFilter = filters.repo;
    authWs.sourceFilter = filters.source;
    authWs.isAlive = true;
    wss.emit('connection', authWs, req);
  });
}
