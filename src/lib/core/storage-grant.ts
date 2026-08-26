import crypto from "node:crypto";

/**
 * Signed grants for `core/storage`'s `signedUrl`.
 *
 * Same wire format and the same reasoning as `@/lib/eb/stream-grant.ts`:
 * `<base64url(JSON payload)>.<base64url(HMAC-SHA256(payload, secret))>`, keyed
 * off `ENCRYPTION_KEY` with a distinct HKDF-style info string so a leaked
 * storage grant can never be replayed as a stream grant or vice versa.
 *
 * Unlike a stream grant this one names an already-namespaced storage key
 * rather than a pod address — the isolation guarantee is different (tenancy on
 * a byte range, not on a live process), but "unforgeable, expiring, no secret
 * in the URL" is the same shape, so the same primitive is reused rather than
 * reinvented.
 */

const GRANT_KEY_INFO = "plugin-storage-grant-v1";
const DEFAULT_TTL_SECONDS = 300;
const ENCRYPTION_KEY_RE = /^[0-9a-f]{64}$/i;

export interface StorageGrantPayload {
  /** The fully namespaced key, e.g. `"t1/explorer/report.json"`. */
  k: string;
  /** Suggested download filename, or empty. */
  f: string;
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

function b64url(input: Buffer): string {
  return input.toString("base64url");
}

/** Returns `null` when no signing secret is configured — callers fail closed. */
export function signStorageGrant(
  key: string,
  opts: { expiresInSeconds?: number; filename?: string } = {},
): string | null {
  const secret = grantKey();
  if (!secret) return null;

  const payload: StorageGrantPayload = {
    k: key,
    f: opts.filename ?? "",
    e: Date.now() + (opts.expiresInSeconds ?? DEFAULT_TTL_SECONDS) * 1000,
  };
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(crypto.createHmac("sha256", secret).update(body).digest());
  return `${body}.${sig}`;
}

/** Returns `null` for a malformed, unsigned, expired, or forged grant. */
export function verifyStorageGrant(grant: string): StorageGrantPayload | null {
  const secret = grantKey();
  if (!secret) return null;

  const [body, sig] = grant.split(".");
  if (!body || !sig) return null;

  const expectedSig = b64url(
    crypto.createHmac("sha256", secret).update(body).digest(),
  );
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (
    sigBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(sigBuf, expectedBuf)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as StorageGrantPayload;
    if (typeof payload.k !== "string" || typeof payload.e !== "number") {
      return null;
    }
    if (Date.now() > payload.e) return null;
    return payload;
  } catch {
    return null;
  }
}
