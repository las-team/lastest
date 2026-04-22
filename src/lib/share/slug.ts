import { randomBytes } from 'crypto';

export const SLUG_LENGTH = 22;

export function generateShareSlug(): string {
  return randomBytes(16).toString('base64url').slice(0, SLUG_LENGTH);
}

export function isValidShareSlug(slug: string): boolean {
  return /^[A-Za-z0-9_-]{22}$/.test(slug);
}

export function buildShareUrl(slug: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  return `${base.replace(/\/+$/, '')}/r/${slug}`;
}
