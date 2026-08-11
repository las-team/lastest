import "server-only";

import { eq } from "drizzle-orm";
import type { DesignSystemConfig } from "@lastest/eb-protocol";
import type { DesignSystemHost } from "@lastest/plugin-design-system";

import { db } from "@/lib/db";
import { tests, playwrightSettings } from "@/lib/db/schema";
import { requireTestOwnership } from "@/lib/auth/ownership";
import { requireRepoAccess } from "@/lib/auth";

/**
 * The app's fill for `DesignSystemHost` — the two core tables
 * (`tests.designSystemOverrides`, `playwrightSettings.designSystem`) this
 * plugin reads/writes but does not own, plus the authorization the original
 * `src/server/actions/design-system-overrides.ts` did inline before the
 * split. Read `plugins/design-system/src/host.ts` for why this is a port
 * and not `ctx.data`.
 */
export const appDesignSystemHost: DesignSystemHost = {
  async saveTestOverrides(
    testId: string,
    overrides: Partial<DesignSystemConfig> | null,
  ): Promise<void> {
    await requireTestOwnership(testId);
    await db
      .update(tests)
      .set({ designSystemOverrides: overrides, updatedAt: new Date() })
      .where(eq(tests.id, testId));
  },

  async saveRepoConfig(
    repositoryId: string,
    config: DesignSystemConfig,
  ): Promise<void> {
    await requireRepoAccess(repositoryId);
    // upsert: row may not exist yet for repos that have never opened the
    // Playwright Settings page; mirror the pattern in upsertPlaywrightSettings.
    const [existing] = await db
      .select()
      .from(playwrightSettings)
      .where(eq(playwrightSettings.repositoryId, repositoryId));
    if (existing) {
      await db
        .update(playwrightSettings)
        .set({ designSystem: config, updatedAt: new Date() })
        .where(eq(playwrightSettings.id, existing.id));
    } else {
      const { v4: uuid } = await import("uuid");
      await db.insert(playwrightSettings).values({
        id: uuid(),
        repositoryId,
        designSystem: config,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  },

  async clearRepoConfig(repositoryId: string): Promise<void> {
    await requireRepoAccess(repositoryId);
    await db
      .update(playwrightSettings)
      .set({ designSystem: null, updatedAt: new Date() })
      .where(eq(playwrightSettings.repositoryId, repositoryId));
  },
};
