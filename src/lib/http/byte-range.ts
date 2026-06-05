/**
 * Single-range `Range: bytes=start-end` parser. Returns the inclusive byte
 * range to serve, or `null` if the header is malformed, requests multiple
 * ranges (unsupported), or asks for bytes past EOF.
 *
 * Accepts the three RFC 7233 forms:
 *   bytes=0-499      first 500 bytes
 *   bytes=500-       byte 500 through EOF
 *   bytes=-500       last 500 bytes
 *
 * Shared by `/api/media/[...path]` and `/share/[slug]/[...path]` so the two
 * media routes can't drift on what they accept.
 */
export function parseByteRange(
  header: string,
  size: number,
): { start: number; end: number } | null {
  if (size <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, startStr, endStr] = match;
  // Reject multi-range requests — we'd have to emit multipart/byteranges
  // and no current caller (HTML video element) needs it.
  if (header.includes(",")) return null;

  let start: number;
  let end: number;
  if (startStr === "" && endStr === "") return null;
  if (startStr === "") {
    // Suffix range: last N bytes.
    const suffix = parseInt(endStr, 10);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = parseInt(startStr, 10);
    end = endStr === "" ? size - 1 : parseInt(endStr, 10);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    if (start < 0 || end < start) return null;
    if (start >= size) return null;
    // Clamp end so a `bytes=0-99999999` on a 10kB file still works.
    if (end >= size) end = size - 1;
  }
  return { start, end };
}
