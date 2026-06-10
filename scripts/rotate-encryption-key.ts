/**
 * Key rotation: re-encrypts all token fields from OLD_ENCRYPTION_KEY to
 * ENCRYPTION_KEY. Run this whenever the encryption key needs to be rotated
 * (e.g. suspected key compromise, periodic rotation policy).
 *
 * Process:
 *   1. Set ENCRYPTION_KEY to the new key in your environment
 *   2. Set OLD_ENCRYPTION_KEY to the previous key
 *   3. Run this script (dry-run first)
 *   4. Once complete, remove OLD_ENCRYPTION_KEY from your environment
 *
 * The script is idempotent: rows already encrypted with the new key are
 * detected by attempting decryption with the old key — if that fails, the
 * value is skipped as already rotated.
 *
 * Usage:
 *   OLD_ENCRYPTION_KEY=<old> pnpm tsx --env-file=.env scripts/rotate-encryption-key.ts
 *   OLD_ENCRYPTION_KEY=<old> pnpm tsx --env-file=.env scripts/rotate-encryption-key.ts --dry-run
 */

import { db } from "../src/lib/db";
import {
  githubAccounts,
  gitlabAccounts,
  oauthAccounts,
  googleSheetsAccounts,
  aiSettings,
} from "../src/lib/db/schema";
import { encrypt, decryptWithKey, ENC_PREFIX } from "../src/lib/crypto";
import { eq } from "drizzle-orm";

const dryRun = process.argv.includes("--dry-run");

function getOldKey(): Buffer {
  const hex = process.env.OLD_ENCRYPTION_KEY;
  if (!hex) throw new Error("OLD_ENCRYPTION_KEY env var is not set");
  const key = Buffer.from(hex, "hex");
  if (key.length !== 32)
    throw new Error("OLD_ENCRYPTION_KEY must be 32 bytes (64 hex chars)");
  return key;
}

let rotated = 0;
let skipped = 0;

function reEncryptField(
  value: string | null | undefined,
  oldKey: Buffer,
): string | null | undefined {
  if (value == null || !value.startsWith(ENC_PREFIX)) return value;
  try {
    const plaintext = decryptWithKey(value, oldKey);
    return encrypt(plaintext);
  } catch {
    // Already encrypted with the new key — skip
    return null;
  }
}

async function rotateRow(
  label: string,
  id: string,
  fields: Record<string, string | null | undefined>,
  oldKey: Buffer,
  updater: (id: string, values: Record<string, string>) => Promise<void>,
) {
  const updates: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields)) {
    const reEncrypted = reEncryptField(value, oldKey);
    if (reEncrypted != null) updates[key] = reEncrypted;
  }
  if (Object.keys(updates).length === 0) {
    skipped++;
    return;
  }
  console.log(`  ${label} ${id}: rotating ${Object.keys(updates).join(", ")}`);
  if (!dryRun) await updater(id, updates);
  rotated++;
}

async function rotateGithubAccounts(oldKey: Buffer) {
  console.log("\n[githubAccounts]");
  const rows = await db.select().from(githubAccounts);
  for (const row of rows) {
    await rotateRow(
      "githubAccount",
      row.id,
      { accessToken: row.accessToken, refreshToken: row.refreshToken },
      oldKey,
      async (id, updates) => {
        await db
          .update(githubAccounts)
          .set(updates)
          .where(eq(githubAccounts.id, id));
      },
    );
  }
}

async function rotateGitlabAccounts(oldKey: Buffer) {
  console.log("\n[gitlabAccounts]");
  const rows = await db.select().from(gitlabAccounts);
  for (const row of rows) {
    await rotateRow(
      "gitlabAccount",
      row.id,
      {
        accessToken: row.accessToken,
        refreshToken: row.refreshToken,
        oauthClientSecret: row.oauthClientSecret,
      },
      oldKey,
      async (id, updates) => {
        await db
          .update(gitlabAccounts)
          .set(updates)
          .where(eq(gitlabAccounts.id, id));
      },
    );
  }
}

async function rotateOAuthAccounts(oldKey: Buffer) {
  console.log("\n[oauthAccounts]");
  const rows = await db.select().from(oauthAccounts);
  for (const row of rows) {
    await rotateRow(
      "oauthAccount",
      row.id,
      {
        accessToken: row.accessToken,
        refreshToken: row.refreshToken,
        idToken: row.idToken,
      },
      oldKey,
      async (id, updates) => {
        await db
          .update(oauthAccounts)
          .set(updates)
          .where(eq(oauthAccounts.id, id));
      },
    );
  }
}

async function rotateGoogleSheetsAccounts(oldKey: Buffer) {
  console.log("\n[googleSheetsAccounts]");
  const rows = await db.select().from(googleSheetsAccounts);
  for (const row of rows) {
    await rotateRow(
      "googleSheetsAccount",
      row.id,
      { accessToken: row.accessToken, refreshToken: row.refreshToken },
      oldKey,
      async (id, updates) => {
        await db
          .update(googleSheetsAccounts)
          .set(updates)
          .where(eq(googleSheetsAccounts.id, id));
      },
    );
  }
}

async function rotateAISettings(oldKey: Buffer) {
  console.log("\n[aiSettings]");
  const rows = await db.select().from(aiSettings);
  for (const row of rows) {
    await rotateRow(
      "aiSettings",
      row.id,
      {
        openrouterApiKey: row.openrouterApiKey,
        anthropicApiKey: row.anthropicApiKey,
        openaiApiKey: row.openaiApiKey,
        aiDiffingApiKey: row.aiDiffingApiKey,
      },
      oldKey,
      async (id, updates) => {
        await db.update(aiSettings).set(updates).where(eq(aiSettings.id, id));
      },
    );
  }
}

async function main() {
  const oldKey = getOldKey();
  if (dryRun) console.log("DRY RUN — no changes will be written\n");

  await rotateGithubAccounts(oldKey);
  await rotateGitlabAccounts(oldKey);
  await rotateOAuthAccounts(oldKey);
  await rotateGoogleSheetsAccounts(oldKey);
  await rotateAISettings(oldKey);

  console.log(
    `\nDone. ${rotated} row(s) re-encrypted, ${skipped} skipped (already rotated or plaintext).`,
  );
  if (dryRun) console.log("Re-run without --dry-run to apply.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
