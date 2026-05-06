import crypto from 'crypto';

// Polar follows the Standard Webhooks spec. The webhook secret is delivered
// in the dashboard prefixed with `whsec_`; the signing payload is
// `${webhook-id}.${webhook-timestamp}.${rawBody}`, signed with HMAC-SHA256 and
// base64-encoded. The `webhook-signature` header is space-delimited
// `v1,<sig> v1,<sig2>` to allow rotation.
//
// We verify in constant time and reject deliveries older than 5 minutes to
// stop replay attacks even if a secret leaks momentarily.

const TOLERANCE_SECONDS = 5 * 60;

function decodeSecret(raw: string): Buffer {
  const trimmed = raw.startsWith('whsec_') ? raw.slice('whsec_'.length) : raw;
  // Polar secrets are base64-encoded random bytes. Fall back to utf8 so a
  // hand-rolled raw secret still works during local dev.
  try {
    return Buffer.from(trimmed, 'base64');
  } catch {
    return Buffer.from(trimmed, 'utf8');
  }
}

export interface WebhookHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

export function readWebhookHeaders(get: (name: string) => string | null): WebhookHeaders {
  return {
    id: get('webhook-id'),
    timestamp: get('webhook-timestamp'),
    signature: get('webhook-signature'),
  };
}

export function verifyWebhookSignature(
  rawBody: string,
  headers: WebhookHeaders,
  secret: string | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (!secret) return { ok: false, reason: 'webhook secret not configured' };
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) {
    return { ok: false, reason: 'missing webhook headers' };
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) {
    return { ok: false, reason: 'invalid timestamp' };
  }
  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - ts);
  if (ageSeconds > TOLERANCE_SECONDS) {
    return { ok: false, reason: 'timestamp out of tolerance' };
  }

  const signedPayload = `${id}.${timestamp}.${rawBody}`;
  const expected = crypto
    .createHmac('sha256', decodeSecret(secret))
    .update(signedPayload)
    .digest('base64');

  // Header carries one or more `v1,<base64sig>` tokens separated by spaces.
  const candidates = signature
    .split(' ')
    .map((entry) => entry.split(',', 2))
    .filter(([scheme, sig]) => scheme === 'v1' && sig)
    .map(([, sig]) => sig);

  for (const candidate of candidates) {
    try {
      const a = Buffer.from(candidate, 'base64');
      const b = Buffer.from(expected, 'base64');
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
        return { ok: true };
      }
    } catch {
      // continue — try next candidate
    }
  }

  return { ok: false, reason: 'no matching signature' };
}
