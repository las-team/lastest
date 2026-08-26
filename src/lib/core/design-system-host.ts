import "server-only";

import type { DesignSystemConfig } from "@lastest/eb-protocol";
import type { DesignSystemHost } from "@lastest/plugin-design-system";

import * as queries from "@/lib/db/queries";
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
    await queries.updateTest(testId, { designSystemOverrides: overrides });
  },

  async saveRepoConfig(
    repositoryId: string,
    config: DesignSystemConfig,
  ): Promise<void> {
    await requireRepoAccess(repositoryId);
    // The row may not exist yet for repos that have never opened the
    // Playwright Settings page, so this is an upsert — which is exactly what
    // `upsertPlaywrightSettings` already is. This used to be a hand-rolled
    // copy of it sitting in the composition root.
    await queries.upsertPlaywrightSettings(repositoryId, {
      designSystem: config,
    });
  },

  async clearRepoConfig(repositoryId: string): Promise<void> {
    await requireRepoAccess(repositoryId);
    // Update, *not* upsert: a repo with no settings row has nothing to clear,
    // and materialising one here would be a write the user never asked for.
    await queries.updatePlaywrightSettingsByRepo(repositoryId, {
      designSystem: null,
    });
  },
};
