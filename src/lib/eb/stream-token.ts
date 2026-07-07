/**
 * Client-safe helper (no node imports — imported by client components).
 *
 * Appends the stream auth token to a stream URL with the correct separator.
 * Proxy-routed stream URLs already carry a query string
 * (`/api/embedded/stream/ws?target=host:port`), so the previous blanket
 * `${url}?token=...` produced `...?target=host:port?token=...` — the token was
 * swallowed into the `target` param and dropped by the WS proxy, so the EB
 * never saw it and rejected the stream with 401 whenever STREAM_AUTH_TOKEN
 * was configured.
 */
export function appendStreamToken(
  streamUrl: string,
  token: string | null | undefined,
): string {
  if (!token) return streamUrl;
  const sep = streamUrl.includes("?") ? "&" : "?";
  return `${streamUrl}${sep}token=${encodeURIComponent(token)}`;
}
