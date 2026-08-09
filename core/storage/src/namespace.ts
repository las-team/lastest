/**
 * All keys are implicitly namespaced by `(teamId, pluginId)` — the contract's
 * own words. This is the one function that makes that true: every host method
 * receives an already-namespaced key, so a plugin cannot construct one that
 * reaches another plugin's or another team's objects even if the host
 * implementation forgot to check.
 */

const SAFE_KEY_SEGMENT = /^[A-Za-z0-9._-]+$/;

export class UnsafeStorageKeyError extends Error {
  constructor(key: string) {
    super(
      `Storage key "${key}" contains a path segment outside [A-Za-z0-9._-] — ` +
        `no "/../" or absolute paths, so a namespaced key can never escape its prefix`,
    );
    this.name = "UnsafeStorageKeyError";
  }
}

/**
 * Reject anything that could traverse out of the namespace prefix once
 * concatenated onto a filesystem or bucket path. `key` may contain `/` as a
 * plugin's own sub-organization (`"reports/2026-01.json"`), and `list()`'s
 * argument is a prefix that may legitimately end in `/` — everything else
 * must be a plain safe token: no `..`, no leading `/`, no empty segments.
 *
 * `SAFE_KEY_SEGMENT` alone is not enough — `.` and `..` are made entirely of
 * characters the charset allows, so they are checked explicitly. Getting this
 * wrong here is not a style nit: it is the one function every other guarantee
 * in this package assumes holds.
 */
export function assertSafeKey(key: string): void {
  if (key.length === 0) throw new UnsafeStorageKeyError(key);

  // A trailing slash denotes a listing prefix, not an object key — strip
  // exactly one before segment-validating, so "reports/" is a valid prefix
  // but "reports//" and "/" (nothing before the slash) still are not.
  const withoutTrailingSlash =
    key.endsWith("/") && key.length > 1 ? key.slice(0, -1) : key;

  const segments = withoutTrailingSlash.split("/");
  for (const segment of segments) {
    if (
      !SAFE_KEY_SEGMENT.test(segment) ||
      segment === "." ||
      segment === ".."
    ) {
      throw new UnsafeStorageKeyError(key);
    }
  }
}

export function namespacedKey(
  teamId: string,
  pluginId: string,
  key: string,
): string {
  assertSafeKey(key);
  return `${teamId}/${pluginId}/${key}`;
}

export function namespacedPrefix(teamId: string, pluginId: string): string {
  return `${teamId}/${pluginId}/`;
}

/** Strip the `(teamId, pluginId)` prefix back off before handing a key to the plugin. */
export function stripNamespace(namespaced: string, prefix: string): string {
  return namespaced.startsWith(prefix)
    ? namespaced.slice(prefix.length)
    : namespaced;
}
