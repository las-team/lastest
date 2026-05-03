import { createHmac, timingSafeEqual } from 'crypto';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

// Tokens older than this are rejected. 90 days lets a recipient act on a
// month-old newsletter without re-issuing, but bounds replay if a token leaks.
const UNSUBSCRIBE_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;

function getSecret(): string {
  const secret = process.env.EMAIL_UNSUBSCRIBE_SECRET || process.env.BETTER_AUTH_SECRET;
  if (secret) return secret;
  // In dev/test we fall back to a known string for convenience. In production
  // a hard fail beats silently issuing forgeable tokens — anyone who reads the
  // source could otherwise unsubscribe arbitrary recipients.
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Email unsubscribe secret missing: set EMAIL_UNSUBSCRIBE_SECRET or BETTER_AUTH_SECRET',
    );
  }
  return 'lastest-unsubscribe-fallback-secret';
}

function base64UrlEncode(buf: Buffer | string): string {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(input: string): Buffer {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function sign(payload: string): string {
  return base64UrlEncode(createHmac('sha256', getSecret()).update(payload).digest());
}

export interface UnsubscribePayload {
  email: string;
  issuedAt: number;
}

export function createUnsubscribeToken(email: string): string {
  const payload: UnsubscribePayload = { email: email.toLowerCase(), issuedAt: Date.now() };
  const encoded = base64UrlEncode(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

export function verifyUnsubscribeToken(token: string): UnsubscribePayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts;

  const expected = sign(encoded);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const json = base64UrlDecode(encoded).toString('utf8');
    const payload = JSON.parse(json) as UnsubscribePayload;
    if (typeof payload.email !== 'string' || typeof payload.issuedAt !== 'number') return null;
    if (Date.now() - payload.issuedAt > UNSUBSCRIBE_TOKEN_TTL_MS) return null;
    return payload;
  } catch {
    return null;
  }
}

export function buildUnsubscribeUrl(email: string): string {
  const token = createUnsubscribeToken(email);
  return `${APP_URL}/unsubscribe?token=${encodeURIComponent(token)}`;
}

export function buildUnsubscribePostUrl(email: string): string {
  const token = createUnsubscribeToken(email);
  return `${APP_URL}/api/unsubscribe?token=${encodeURIComponent(token)}`;
}
