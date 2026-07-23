/**
 * Global `playwright_settings` helpers needed by BOTH the app and the pool
 * service (pool caps + the idempotent boot seeder). The full settings query
 * module stays app-side (`src/lib/db/queries/settings.ts`) and re-exports
 * these two.
 */

import crypto from "node:crypto";
import { isNull } from "drizzle-orm";
import { db } from "./index";
import { playwrightSettings, DEFAULT_SELECTOR_PRIORITY } from "./schema";

// Cluster-wide EB pool limits — read from the global (repositoryId IS NULL) row.
// Per-repo overrides are ignored on purpose: the pool is a shared cluster resource.
export async function getGlobalPoolLimits(): Promise<{
  ebPoolMax: number;
  ebIdleTTLSeconds: number;
} | null> {
  const [row] = await db
    .select({
      ebPoolMax: playwrightSettings.ebPoolMax,
      ebIdleTTLSeconds: playwrightSettings.ebIdleTTLSeconds,
    })
    .from(playwrightSettings)
    .where(isNull(playwrightSettings.repositoryId));
  if (!row) return null;
  return {
    ebPoolMax: row.ebPoolMax ?? 30,
    ebIdleTTLSeconds: row.ebIdleTTLSeconds ?? 90,
  };
}

// Idempotent seeder — inserts the global playwright_settings row with schema
// defaults if missing. Callers (app + pool-service boot) rely on this so
// poolMax() / ebIdleTTLMs() always find a row and never fall back to env vars.
// Mirrors the app's `createPlaywrightSettings({ repositoryId: null })`.
export async function ensureGlobalPlaywrightSettings(): Promise<void> {
  const [existing] = await db
    .select({ id: playwrightSettings.id })
    .from(playwrightSettings)
    .where(isNull(playwrightSettings.repositoryId));
  if (existing) return;
  const now = new Date();
  await db.insert(playwrightSettings).values({
    id: crypto.randomUUID(),
    repositoryId: null,
    selectorPriority: DEFAULT_SELECTOR_PRIORITY,
    createdAt: now,
    updatedAt: now,
  });
}
