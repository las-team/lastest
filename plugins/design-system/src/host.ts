import type { DesignSystemConfig } from "@lastest/eb-protocol";

/**
 * The core surface design-system needs and does not own.
 *
 * Unlike explorer, this plugin has no owned table — `tests.designSystemOverrides`
 * and `playwrightSettings.designSystem` are core-owned JSONB columns shared
 * with other domains on those rows (RFC §9 phase 3: port pattern, not a
 * column migration). `docs/architecture/core-scope.md` §6: "To learn
 * anything about a core entity it calls a core function" — this host is
 * that function, the same shape `plugins/explorer/src/host.ts` uses and for
 * the same reason: injecting the primitive keeps this package free of
 * `@/…` imports.
 *
 * Auth lives here rather than in `actions.ts`: a plugin cannot import
 * `@/lib/auth` (`requireTestOwnership`/`requireRepoAccess`), so the
 * composition root's implementation (`src/lib/core/design-system-host.ts`)
 * enforces it before touching either table — same authorization the
 * original `src/server/actions/design-system-overrides.ts` did directly.
 */
export interface DesignSystemHost {
  /** Persist (or clear, with `null`) a test's own override on top of the
   *  repo-level config. Throws if the caller does not own the test. */
  saveTestOverrides(
    testId: string,
    overrides: Partial<DesignSystemConfig> | null,
  ): Promise<void>;

  /** Upsert the repo-level config (`playwright_settings.design_system`).
   *  Throws if the caller lacks repo access. */
  saveRepoConfig(
    repositoryId: string,
    config: DesignSystemConfig,
  ): Promise<void>;

  /** Clear the repo-level config. Throws if the caller lacks repo access. */
  clearRepoConfig(repositoryId: string): Promise<void>;
}
