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
  storageStates,
  setupConfigs,
  agentSessions,
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

// ── User-provided app credentials (added later) ──────────────────────────────

// storage_states.storageStateJson — flat text column.
async function rotateStorageStates(oldKey: Buffer) {
  console.log("\n[storageStates]");
  const rows = await db.select().from(storageStates);
  for (const row of rows) {
    await rotateRow(
      "storageState",
      row.id,
      { storageStateJson: row.storageStateJson },
      oldKey,
      async (id, updates) => {
        await db
          .update(storageStates)
          .set(updates)
          .where(eq(storageStates.id, id));
      },
    );
  }
}

// setup_configs.authConfig — JSONB; re-encrypt token / password / header values.
async function rotateSetupConfigs(oldKey: Buffer) {
  console.log("\n[setupConfigs]");
  const rows = await db.select().from(setupConfigs);
  for (const row of rows) {
    const cfg = row.authConfig;
    if (!cfg) {
      skipped++;
      continue;
    }
    const next = { ...cfg };
    let changed = false;
    const token = reEncryptField(next.token, oldKey);
    if (token != null) {
      next.token = token;
      changed = true;
    }
    const password = reEncryptField(next.password, oldKey);
    if (password != null) {
      next.password = password;
      changed = true;
    }
    if (next.headers) {
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(next.headers)) {
        const re = reEncryptField(v, oldKey);
        if (re != null) {
          headers[k] = re;
          changed = true;
        } else {
          headers[k] = v;
        }
      }
      next.headers = headers;
    }
    if (!changed) {
      skipped++;
      continue;
    }
    console.log(`  setupConfig ${row.id}: rotating authConfig secrets`);
    if (!dryRun)
      await db
        .update(setupConfigs)
        .set({ authConfig: next })
        .where(eq(setupConfigs.id, row.id));
    rotated++;
  }
}

// agent_sessions.metadata.quickstartPassword — JSONB.
async function rotateAgentSessions(oldKey: Buffer) {
  console.log("\n[agentSessions]");
  const rows = await db.select().from(agentSessions);
  for (const row of rows) {
    const meta = row.metadata;
    const re = reEncryptField(meta?.quickstartPassword, oldKey);
    if (!meta || re == null) {
      skipped++;
      continue;
    }
    const next = { ...meta, quickstartPassword: re };
    console.log(
      `  agentSession ${row.id}: rotating metadata.quickstartPassword`,
    );
    if (!dryRun)
      await db
        .update(agentSessions)
        .set({ metadata: next })
        .where(eq(agentSessions.id, row.id));
    rotated++;
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
  await rotateStorageStates(oldKey);
  await rotateSetupConfigs(oldKey);
  await rotateAgentSessions(oldKey);

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
