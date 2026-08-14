import { createHash } from "crypto";

/**
 * Page-state identity for the explorer agent. A "state" is the normalized URL
 * plus the page's main headings (h1/h2) — URLs alone are insufficient because
 * SPAs show distinct views at one location, and headings alone are ambiguous
 * across list/detail pages. State hashes key agent_experience rows and drive
 * stuck-loop detection (same hash repeating = the agent is going in circles).
 */

export interface StateHeading {
  level: number;
  text: string;
}

/** Path segments that look like opaque identifiers get collapsed to ":id" so
 *  /users/123 and /users/456 share one state (same view, different record). */
const ID_SEGMENT_RE = /^(\d+|[0-9a-f]{8}-[0-9a-f-]{27,}|[0-9a-f]{16,})$/i;

/** Strip query/hash noise + trailing slash and collapse id-like segments. */
export function normalizeUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw.trim().toLowerCase();
  }
  const segments = url.pathname
    .split("/")
    .filter(Boolean)
    .map((seg) => (ID_SEGMENT_RE.test(seg) ? ":id" : seg.toLowerCase()));
  return `${url.origin.toLowerCase()}/${segments.join("/")}`;
}

/** Lowercased, deduped h1/h2 texts — the "what view is this" signal. */
export function headingsDigest(headings: StateHeading[]): string {
  const main = headings
    .filter((h) => h.level <= 2 && h.text.trim())
    .map((h) => h.text.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 80));
  return Array.from(new Set(main)).slice(0, 8).join(" | ");
}

/** Stable state hash: sha256(normalizedUrl + "\n" + headingsDigest), hex,
 *  truncated to 16 chars (enough for per-repo uniqueness, short enough to
 *  read in logs). */
export function hashState(url: string, headings: StateHeading[]): string {
  return createHash("sha256")
    .update(`${normalizeUrl(url)}\n${headingsDigest(headings)}`)
    .digest("hex")
    .slice(0, 16);
}
