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
