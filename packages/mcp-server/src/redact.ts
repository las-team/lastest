/**
 * Strip secret-shaped keys from arbitrary objects before they reach activity
 * logs. Match is case-insensitive and partial — `bearerToken`, `BEARER_TOKEN`,
 * `someApiKey`, etc. all match.
 *
 * Mirrors `src/lib/security/redact.ts` in the host app; kept inline because
 * the mcp-server package is built independently (tsup) and shouldn't reach
 * back into Next.js source.
 */

const SECRET_KEY_PATTERNS = [
  'authorization',
  'auth_header',
  'authheader',
  'bearer',
  'token',
  'api_key',
  'apikey',
  'password',
  'passwd',
  'secret',
  'private_key',
  'privatekey',
  'cookie',
  'set-cookie',
];

function isSecretKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SECRET_KEY_PATTERNS.some((pat) => lower.includes(pat));
}

const REDACTED = '[REDACTED]';

export function redactSecrets<T>(value: T, depth = 0): T {
  if (depth > 8) return value;
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((v) => redactSecrets(v, depth + 1)) as unknown as T;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isSecretKey(k)) {
        out[k] = REDACTED;
      } else {
        out[k] = redactSecrets(v, depth + 1);
      }
    }
    return out as unknown as T;
  }
  return value;
}
