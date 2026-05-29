/* eslint-disable no-console */
// Set a dev password for a local account so tooling can sign in via the
// better-auth API.

import fs from 'node:fs';
const envText = fs.readFileSync('.env.local', 'utf8');
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

import { hash } from '@node-rs/argon2';
import { db } from '@/lib/db';
import { users, oauthAccounts } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

async function main() {
  const email = process.argv[2];
  const password = process.argv[3];
  if (!email || !password) {
    console.error('Usage: dev-set-password.ts <email> <password>');
    process.exit(2);
  }
  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (!user) throw new Error(`No user with ${email}`);

  const hashed = await hash(password);
  const credential = await db.query.oauthAccounts.findFirst({
    where: and(eq(oauthAccounts.userId, user.id), eq(oauthAccounts.provider, 'credential')),
  });
  if (credential) {
    await db.update(oauthAccounts).set({ password: hashed }).where(eq(oauthAccounts.id, credential.id));
    console.log('Updated credential row id=' + credential.id);
  } else {
    const crypto = await import('node:crypto');
    await db.insert(oauthAccounts).values({
      id: crypto.randomBytes(16).toString('hex'),
      userId: user.id,
      provider: 'credential',
      providerAccountId: user.id,
      password: hashed,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    console.log('Inserted credential row for user=' + user.id);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
