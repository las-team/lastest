import net from 'node:net';

/**
 * Convert a direct ws:// streamUrl to a proxy path so the browser connects
 * through the main app's WS proxy (ws-proxy-preload.js) instead of directly
 * to the container IP — which is unreachable from the browser on both HTTPS
 * (blocked by mixed-content) and in k3s local dev (pod IPs aren't routable
 * from the host).
 */
export function toProxyStreamUrl(streamUrl: string | null): string | null {
  if (!streamUrl) return null;
  try {
    const url = new URL(streamUrl);
    if (url.protocol === 'ws:' || url.protocol === 'wss:') {
      const target = `${url.hostname}:${url.port || '9223'}`;
      return `/api/embedded/stream/ws?target=${encodeURIComponent(target)}`;
    }
  } catch {
    // not a valid URL — return as-is
  }
  return streamUrl;
}

/**
 * Fast TCP probe to confirm the EB stream port is actually accepting connections
 * before we hand its streamUrl out to the browser. Addresses the silent
 * "Browser disconnected" failure mode where the DB row still carries a streamUrl
 * for an EB pod that was reaped (1-job-1-EB) or crashed before its session row
 * could be cleaned up — handing that URL back lets the BrowserViewer latch onto
 * a dead pod IP, fail its 5 reconnect attempts, and flip to Disconnected with
 * no diagnosable signal.
 *
 * Returns `true` for non-ws URLs (we have no probe target — trust the caller),
 * `false` on connect refused / timeout / DNS failure. Default timeout is short
 * so the recording-client's 500 ms poll loop doesn't bloat noticeably.
 */
export async function probeStreamUrlAlive(rawStreamUrl: string | null, timeoutMs = 250): Promise<boolean> {
  if (!rawStreamUrl) return false;
  let host: string;
  let port: number;
  try {
    const url = new URL(rawStreamUrl);
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') return true;
    host = url.hostname;
    port = parseInt(url.port || '9223', 10);
  } catch {
    return false;
  }

  return new Promise<boolean>((resolve) => {
    let done = false;
    const socket = net.connect({ host, port });
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      try { socket.destroy(); } catch { /* ignore */ }
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}
