/**
 * One-shot backfill: encrypts all plaintext OAuth tokens and AI API keys that
 * were stored before application-level AES-256-GCM encryption was introduced.
 *
 * Safe to run on a live production database — it processes rows one at a time
 * and skips any that are already encrypted (idempotent).
 *
 * Usage (ENCRYPTION_KEY + DATABASE_URL must be set):
 *   pnpm tsx --env-file=.env.local scripts/backfill-encrypt-tokens.ts
 *   pnpm tsx --env-file=.env.local scripts/backfill-encrypt-tokens.ts --dry-run
 */

import { db } from "../src/lib/db";
import {
  githubAccounts,
  gitlabAccounts,
  oauthAccounts,
  googleSheetsAccounts,
  aiSettings,
} from "../src/lib/db/schema";
import { encrypt, ENC_PREFIX } from "../src/lib/crypto";
import { eq } from "drizzle-orm";

const dryRun = process.argv.includes("--dry-run");

function needsEncryption(value: string | null | undefined): value is string {
  return typeof value === "string" && !value.startsWith(ENC_PREFIX);
}

let encrypted = 0;
let skipped = 0;

async function encryptRow(
  label: string,
  id: string,
  fields: Record<string, string | null | undefined>,
  updater: (id: string, values: Record<string, string>) => Promise<void>,
) {
  const updates: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (needsEncryption(value)) updates[key] = encrypt(value);
  }
  if (Object.keys(updates).length === 0) {
    skipped++;
    return;
  }
  console.log(
    `  ${label} ${id}: encrypting ${Object.keys(updates).join(", ")}`,
  );
  if (!dryRun) await updater(id, updates);
  encrypted++;
}

async function backfillGithubAccounts() {
  console.log("\n[githubAccounts]");
  const rows = await db.select().from(githubAccounts);
  for (const row of rows) {
    await encryptRow(
      "githubAccount",
      row.id,
      { accessToken: row.accessToken, refreshToken: row.refreshToken },
      async (id, updates) => {
        await db
          .update(githubAccounts)
          .set(updates)
          .where(eq(githubAccounts.id, id));
      },
    );
  }
}

async function backfillGitlabAccounts() {
  console.log("\n[gitlabAccounts]");
  const rows = await db.select().from(gitlabAccounts);
  for (const row of rows) {
    await encryptRow(
      "gitlabAccount",
      row.id,
      {
        accessToken: row.accessToken,
        refreshToken: row.refreshToken,
        oauthClientSecret: row.oauthClientSecret,
      },
      async (id, updates) => {
        await db
          .update(gitlabAccounts)
          .set(updates)
          .where(eq(gitlabAccounts.id, id));
      },
    );
  }
}

async function backfillOAuthAccounts() {
  console.log("\n[oauthAccounts]");
  const rows = await db.select().from(oauthAccounts);
  for (const row of rows) {
    await encryptRow(
      "oauthAccount",
      row.id,
      {
        accessToken: row.accessToken,
        refreshToken: row.refreshToken,
        idToken: row.idToken,
      },
      async (id, updates) => {
        await db
          .update(oauthAccounts)
          .set(updates)
          .where(eq(oauthAccounts.id, id));
      },
    );
  }
}

async function backfillGoogleSheetsAccounts() {
  console.log("\n[googleSheetsAccounts]");
  const rows = await db.select().from(googleSheetsAccounts);
  for (const row of rows) {
    await encryptRow(
      "googleSheetsAccount",
      row.id,
      { accessToken: row.accessToken, refreshToken: row.refreshToken },
      async (id, updates) => {
        await db
          .update(googleSheetsAccounts)
          .set(updates)
          .where(eq(googleSheetsAccounts.id, id));
      },
    );
  }
}

async function backfillAISettings() {
  console.log("\n[aiSettings]");
  const rows = await db.select().from(aiSettings);
  for (const row of rows) {
    await encryptRow(
      "aiSettings",
      row.id,
      {
        openrouterApiKey: row.openrouterApiKey,
        anthropicApiKey: row.anthropicApiKey,
        openaiApiKey: row.openaiApiKey,
        aiDiffingApiKey: row.aiDiffingApiKey,
      },
      async (id, updates) => {
        await db.update(aiSettings).set(updates).where(eq(aiSettings.id, id));
      },
    );
  }
}

async function main() {
  if (dryRun) console.log("DRY RUN — no changes will be written\n");

  await backfillGithubAccounts();
  await backfillGitlabAccounts();
  await backfillOAuthAccounts();
  await backfillGoogleSheetsAccounts();
  await backfillAISettings();

  console.log(
    `\nDone. ${encrypted} field(s) encrypted, ${skipped} already encrypted (skipped).`,
  );
  if (dryRun) console.log("Re-run without --dry-run to apply.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
