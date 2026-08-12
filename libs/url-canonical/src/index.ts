/**
 * Canonical-path normalization for App Map node ids (and anything else that
 * wants to collapse `/orders/123`, `/orders/[id]`, `/orders/:id` to one id).
 *
 * Promoted out of `plugins/app-map` (RFC §9 phase 4) rather than left there:
 * `src/lib/qa-agent/explore.ts` needs it too, and qa-agent is itself destined
 * to become a plugin — a plugin importing another plugin's internals is
 * exactly the cross-plugin coupling `pnpm arch` forbids. The file was already
 * dependency-free (client components need it alongside server code, so it
 * could never afford to pull in the DB query layer), which is what makes the
 * promotion a pure move: nothing here changed shape, only address.
 */

const ASSET_RE =
  /\.(png|jpe?g|gif|svg|webp|avif|ico|bmp|css|js|mjs|cjs|map|woff2?|ttf|otf|eot|pdf|zip|gz|mp4|webm|mp3|wav|txt|json|xml|rss|csv)$/i;
const NON_PAGE_PREFIX_RE =
  /^\/(_next|api|static|assets|_static|cdn-cgi)(\/|$)/i;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reduce a raw href/path to a canonical path used as the node id.
 * Mirrors the segment rules of `normalizeTrajectoryUrl` (digits → :id, long
 * hex → :hash) and additionally folds framework dynamic-route syntax
 * (`[id]`, `{id}`, `:id`). Returns null for external / asset / non-page URLs.
 *
 * @param base           URL/origin to resolve relative hrefs against ("" = none)
 * @param restrictOrigins if set, drop absolute URLs whose origin is not a known
 *                        app origin (used to filter external links out of edges)
 */
export function canonicalPath(
  raw: string,
  base: string,
  restrictOrigins: Set<string> | null,
): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("#")) return null;
  // Reject any explicit scheme that isn't http(s): mailto:, tel:, javascript:,
  // data:, blob:, and non-navigable browser URLs (about:blank,
  // chrome-error://…, chrome://…) that show up in trajectories of failed runs.
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
    return null;
  }

  const isAbsolute = /^https?:\/\//i.test(trimmed);
  const isRelativeUrlish =
    trimmed.startsWith("/") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../");

  let pathname: string;
  if (isAbsolute || (base && isRelativeUrlish)) {
    let u: URL;
    try {
      u = new URL(trimmed, base || undefined);
    } catch {
      return null;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (restrictOrigins && isAbsolute && !restrictOrigins.has(u.origin)) {
      return null; // external link
    }
    pathname = u.pathname;
  } else {
    // Path-only route ("/orders/[id]") or a relative href with no base.
    pathname = trimmed.split("#")[0]!.split("?")[0]!;
    if (!pathname.startsWith("/")) pathname = "/" + pathname;
  }

  if (ASSET_RE.test(pathname) || NON_PAGE_PREFIX_RE.test(pathname)) return null;

  const normalized = pathname
    .split("/")
    .map((seg) => {
      if (!seg) return seg;
      if (/^\[.+\]$/.test(seg)) return ":id"; // Next [id] / [...slug]
      if (/^\{.+\}$/.test(seg)) return ":id"; // {id}
      if (/^:.+/.test(seg)) return ":id"; // :id
      if (/^\d+$/.test(seg)) return ":id"; // 123
      if (UUID_RE.test(seg)) return ":id"; // uuid
      if (/^[0-9a-f]{24,}$/i.test(seg)) return ":hash"; // long hex
      return seg;
    })
    .join("/");

  const cleaned =
    normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
  return cleaned || "/";
}
