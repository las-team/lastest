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

// Map from request to resolved session for passing auth data to connection handler
const pendingAuth = new WeakMap<IncomingMessage, { teamId: string }>();

export function startActivityFeedServer(): WebSocketServer {
  if (globalWss.__activityFeedWss) return globalWss.__activityFeedWss;

  const wss = new WebSocketServer({
    port: ACTIVITY_FEED_PORT,
    verifyClient: (info, cb) => {
      const token = extractSessionToken(info.req);
      if (!token) {
        console.log('[ActivityFeed WS] No session token found in cookies');
        cb(false, 401, 'Unauthorized');
        return;
      }
      verifyBearerToken(token).then((session) => {
        if (!session?.team?.id) {
          console.log('[ActivityFeed WS] No team access');
          cb(false, 403, 'Forbidden');
          return;
        }
        pendingAuth.set(info.req, { teamId: session.team.id });
        cb(true);
      }).catch((err) => {
        console.log('[ActivityFeed WS] Auth error:', err);
        cb(false, 401, 'Unauthorized');
      });
    },
  });
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

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const authWs = ws as AuthenticatedSocket;
    const auth = pendingAuth.get(req);
    if (!auth) {
      ws.close(1008, 'Auth failed');
      return;
    }
    pendingAuth.delete(req);

    const filters = extractFilters(req);
    authWs.teamId = auth.teamId;
    authWs.repoFilter = filters.repo;
    authWs.sourceFilter = filters.source;
    authWs.isAlive = true;

    ws.on('pong', () => { authWs.isAlive = true; });

    // Send connected message
    ws.send(JSON.stringify({ type: 'connected', timestamp: Date.now() }));
  });

  return wss;
}
