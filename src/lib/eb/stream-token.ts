export function appendStreamToken(
  streamUrl: string,
  token: string | null | undefined,
): string {
  if (!token) return streamUrl;
  const sep = streamUrl.includes("?") ? "&" : "?";
  return `${streamUrl}${sep}token=${encodeURIComponent(token)}`;
}
