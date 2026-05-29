/* eslint-disable no-console */
// Mint a signed better-auth session cookie value for a user, suitable for use
// in scripts that need to drive the authed UI (e.g. axe scans). Reads the
// existing session for `fasiviktor@gmail.com` so we don't create new sessions
// every run. Dev-only.

import fs from 'node:fs';
const envText = fs.readFileSync('.env.local', 'utf8');
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

import { db } from '@/lib/db';
import { sessions, users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

async function main() {
  const email = process.argv[2] || 'fasiviktor@gmail.com';
  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (!user) throw new Error(`No user with email ${email}`);
  const sess = await db.query.sessions.findFirst({
    where: eq(sessions.userId, user.id),
  });
  if (!sess) throw new Error(`No session for ${email}`);

  const crypto = await import('node:crypto');
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error('BETTER_AUTH_SECRET not set');

  const signature = crypto.createHmac('sha256', secret).update(sess.token).digest('base64');
  const cookieValue = `${sess.token}.${signature}`;
  console.log(`better-auth.session_token=${encodeURIComponent(cookieValue)}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
