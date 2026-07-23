import crypto from "node:crypto";

/**
 * Signed stream grants — the authorization primitive for the EB WebSocket proxy.
 *
 * Wire format (URL-safe, no padding):
 *
 *     <base64url(JSON payload)>.<base64url(HMAC-SHA256(payload, secret))>
 *
 * The verification half of this is DUPLICATED in scripts/front-proxy.js
 */

/** Matches the Job's activeDeadlineSeconds — a grant never outlives its EB. */
const DEFAULT_TTL_SECONDS = 1800;

export interface StreamGrantPayload {
  /** Upstream host — the EB pod IP the server selected. */
  h: string;
  /** Upstream port. */
  p: number;
  /** Embedded session id, for audit logging. Empty when unknown. */
  s: string;
  /** Expiry, epoch milliseconds. */
  e: number;
}

const GRANT_KEY_INFO = "eb-stream-grant-v1";

/** Mirrors the validation in @/lib/crypto — 32 bytes, hex-encoded. */
const ENCRYPTION_KEY_RE = /^[0-9a-f]{64}$/i;

/**
 * Derive the HMAC key from ENCRYPTION_KEY — the single source, no override.
 *
 * Returns null when ENCRYPTION_KEY is absent or malformed — callers MUST fail
 * closed rather than fall back to a constant, which would make grants forgeable
 * by anyone reading this source.
 */
export function getStreamGrantKey(): Buffer | null {
  const hex = process.env.ENCRYPTION_KEY?.trim();
  if (!hex || !ENCRYPTION_KEY_RE.test(hex)) return null;

  return crypto
    .createHmac("sha256", Buffer.from(hex, "hex"))
    .update(GRANT_KEY_INFO)
    .digest();
}

function grantTtlMs(): number {
  const raw = parseInt(process.env.EB_STREAM_GRANT_TTL_SECONDS || "", 10);
  const seconds = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TTL_SECONDS;
  return seconds * 1000;
}

/**
 * Mint a grant for a server-selected upstream. Returns null when no secret is
 * configured, which callers surface as "no stream available" — the proxy would
 * reject an unsigned connection anyway.
 */
export function signStreamGrant(
  host: string,
  port: number,
  sessionId = "",
): string | null {
  const key = getStreamGrantKey();
  if (!key) {
    console.error(
      "[stream-grant] no usable signing key — ENCRYPTION_KEY is unset or not 64 hex chars. EB streaming is disabled.",
    );
    return null;
  }

  const payload: StreamGrantPayload = {
    h: host,
    p: port,
    s: sessionId,
    e: Date.now() + grantTtlMs(),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto
    .createHmac("sha256", key)
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${sig}`;
}

/**
 * Verify a grant and return its payload, or null if the signature is invalid,
 * the grant expired, or the payload is malformed. Exported for tests; the
 * proxy uses its own copy (see the file header).
 */
export function verifyStreamGrant(
  grant: string | null | undefined,
): StreamGrantPayload | null {
  if (!grant) return null;
  const key = getStreamGrantKey();
  if (!key) return null;

  const dot = grant.indexOf(".");
  if (dot <= 0 || dot === grant.length - 1) return null;
  const encoded = grant.slice(0, dot);
  const sig = grant.slice(dot + 1);

  const expected = crypto
    .createHmac("sha256", key)
    .update(encoded)
    .digest("base64url");
  // Length check first: timingSafeEqual throws on a length mismatch.
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null;
  }

  let payload: StreamGrantPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  // Signature-independent sanity checks. The signature already guarantees we
  // minted this, but a malformed payload from an older/newer format shouldn't
  // reach net.connect().
  if (typeof payload?.h !== "string" || !payload.h) return null;
  if (!Number.isInteger(payload?.p) || payload.p < 1 || payload.p > 65535) {
    return null;
  }
  if (typeof payload?.e !== "number" || Date.now() > payload.e) return null;

  return payload;
}
