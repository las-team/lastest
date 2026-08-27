/**
 * Short-lived, server-side-only credentials for the MCP loopback.
 *
 * Why this exists
 * ---------------
 * The MCP tools do their work by calling this app's own `/api/v1/*` endpoints
 * over HTTP, which keeps one implementation of every guard
 * (`requireTeamAccess`, `requireRepoAccess`, capabilities) instead of two. That
 * loopback call needs a credential `/api/v1` understands, and for an
 * API-key caller it simply reuses the caller's key.
 *
 * An OAuth caller has no key — it holds an access token issued by the `mcp`
 * plugin. Teaching `/api/v1` to accept those tokens would be the obvious move
 * and would be a security bug: the whole point of the tool policy is that a
 * `lastest:read` token cannot delete a test, and a token that authenticates
 * directly against `/api/v1` bypasses the MCP layer where that is enforced.
 * OAuth tokens are therefore deliberately *not* accepted by
 * `verifyBearerToken()`.
 *
 * So `/api/mcp` mints one of these instead: an HMAC-signed grant naming a user,
 * valid for a minute, used as the Authorization header of the loopback fetches
 * belonging to that one request. It is created on the server, spent on the
 * server, and never appears in any response — the OAuth client never sees it.
 * Same construction as the EB stream grant (`@/lib/eb/stream-grant`), same
 * fail-closed rule: no `ENCRYPTION_KEY`, no grants.
 *
 * Wire format (URL-safe base64, no padding):
 *
 *     lmcp_<base64url(JSON payload)>.<base64url(HMAC-SHA256(payload, key))>
 */
import crypto from "node:crypto";

export const LOOPBACK_GRANT_PREFIX = "lmcp_";

/** A minute is far longer than any single MCP request's fan-out needs. */
const DEFAULT_TTL_MS = 60_000;

const GRANT_KEY_INFO = "mcp-loopback-grant-v1";

/** Mirrors the validation in @/lib/crypto — 32 bytes, hex-encoded. */
const ENCRYPTION_KEY_RE = /^[0-9a-f]{64}$/i;

export interface LoopbackGrantPayload {
  /** User the loopback call acts as. */
  u: string;
  /** Issuing OAuth client id, for audit trails. */
  c: string;
  /** Expiry, epoch milliseconds. */
  e: number;
}

function grantKey(): Buffer | null {
  const hex = process.env.ENCRYPTION_KEY?.trim();
  if (!hex || !ENCRYPTION_KEY_RE.test(hex)) return null;
  return crypto
    .createHmac("sha256", Buffer.from(hex, "hex"))
    .update(GRANT_KEY_INFO)
    .digest();
}

function sign(payload: string, key: Buffer): string {
  return crypto.createHmac("sha256", key).update(payload).digest("base64url");
}

/**
 * Mint a loopback grant for `userId`. Returns null when `ENCRYPTION_KEY` is
 * missing or malformed — callers must fail closed rather than fall back to an
 * unsigned or constant-keyed token.
 */
export function mintLoopbackGrant(
  userId: string,
  clientId: string,
  ttlMs = DEFAULT_TTL_MS,
): string | null {
  const key = grantKey();
  if (!key) return null;
  const payload: LoopbackGrantPayload = {
    u: userId,
    c: clientId,
    e: Date.now() + ttlMs,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${LOOPBACK_GRANT_PREFIX}${encoded}.${sign(encoded, key)}`;
}

/** Verify a grant. Returns its payload, or null for anything not currently valid. */
export function verifyLoopbackGrant(
  token: string,
): LoopbackGrantPayload | null {
  if (!token.startsWith(LOOPBACK_GRANT_PREFIX)) return null;
  const key = grantKey();
  if (!key) return null;

  const [encoded, signature] = token
    .slice(LOOPBACK_GRANT_PREFIX.length)
    .split(".");
  if (!encoded || !signature) return null;

  const expected = sign(encoded, key);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let payload: LoopbackGrantPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (
    typeof payload?.u !== "string" ||
    !payload.u ||
    typeof payload.e !== "number" ||
    payload.e <= Date.now()
  ) {
    return null;
  }
  return payload;
}
