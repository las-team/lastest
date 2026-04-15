/**
 * Activity Feed WebSocket Server
 *
 * Standalone WS server on port 9400 that broadcasts activity events.
 * Proxied by ws-proxy-preload.js from /api/activity-feed/ws.
 *
 * Auth: parses session cookie from upgrade request, validates via DB lookup.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { subscribeToActivityFeed, type ActivityFeedEvent } from './activity-events';
import { verifyBearerToken } from '@/lib/auth/api-key';
import type { IncomingMessage } from 'http';

const ACTIVITY_FEED_PORT = parseInt(process.env.ACTIVITY_FEED_WS_PORT || '9400', 10);
const KEEPALIVE_MS = 25_000;

interface AuthenticatedSocket extends WebSocket {
  _teamId: string;
  _repoFilter?: string;
  _sourceFilter?: string;
  _isAlive: boolean;
}

const globalState = globalThis as typeof globalThis & {
  __activityFeedStarted?: boolean;
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
  const raw = cookies['__Secure-better-auth.session_token']
    || cookies['better-auth.session_token']
    || null;
  if (!raw) return null;
  // better-auth cookie format is "token.hmac_signature" — DB stores just the token
  return raw.includes('.') ? raw.split('.')[0] : raw;
}

export function startActivityFeedServer(): void {
  if (globalState.__activityFeedStarted) return;
  globalState.__activityFeedStarted = true;

  const wss = new WebSocketServer({
    port: ACTIVITY_FEED_PORT,
    verifyClient: (info, cb) => {
      const token = extractSessionToken(info.req);
      if (!token) {
        cb(false, 401, 'Unauthorized');
        return;
      }
      verifyBearerToken(token).then((session) => {
        if (!session?.team?.id) {
          cb(false, 403, 'Forbidden');
          return;
        }
        // Stash auth result on the request for the connection handler
        (info.req as IncomingMessage & { _teamId?: string })._teamId = session.team.id;
        cb(true);
      }).catch(() => {
        cb(false, 401, 'Unauthorized');
      });
    },
  });

  console.log(`[ActivityFeed WS] Listening on port ${ACTIVITY_FEED_PORT}`);

  // Broadcast activity events to all authenticated clients
  subscribeToActivityFeed((event: ActivityFeedEvent) => {
    const payload = JSON.stringify(event);
    for (const client of wss.clients) {
      const ws = client as AuthenticatedSocket;
      if (ws.readyState !== WebSocket.OPEN) continue;
      if (ws._teamId !== event.teamId) continue;
      if (ws._repoFilter && event.repositoryId !== ws._repoFilter) continue;
      if (ws._sourceFilter && event.sourceType !== ws._sourceFilter) continue;
      ws.send(payload);
    }
  });

  // Keepalive
  const interval = setInterval(() => {
    for (const client of wss.clients) {
      const ws = client as AuthenticatedSocket;
      if (!ws._isAlive) { ws.terminate(); continue; }
      ws._isAlive = false;
      ws.ping();
    }
  }, KEEPALIVE_MS);
  if (interval.unref) interval.unref();

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const authWs = ws as AuthenticatedSocket;
    authWs._teamId = (req as IncomingMessage & { _teamId?: string })._teamId || '';
    authWs._isAlive = true;

    // Parse filters from query string
    const url = new URL(req.url || '/', 'http://localhost');
    authWs._repoFilter = url.searchParams.get('repo') || undefined;
    authWs._sourceFilter = url.searchParams.get('source') || undefined;

    ws.on('pong', () => { authWs._isAlive = true; });
    ws.send(JSON.stringify({ type: 'connected', timestamp: Date.now() }));
  });
}
