/**
 * Runtime verification for §3 "Settings — Playwright/Environment/Diff/AI/
 * Notification" (core-plugin-refactor-test-plan.md, P0 row).
 *
 * The autosave *timer* (500ms debounce) lives entirely in client components
 * and can't be driven without a browser — see the structural grep audit of
 * `originalValues`/`hasChanges`/`doSave`/`useEffect` deps in each
 * `src/components/settings/*-card.tsx` file (all five agree; no drift found).
 *
 * What this file verifies for real, against the live dev Postgres: the data
 * layer underneath that timer — `upsert*` round-trips exactly what a card's
 * `doSave()` would send, `get*` returns synthetic-default objects with every
 * field a settings card reads (so a fresh repo never crashes a card on first
 * render), and `getAISettings()`'s default object in particular has every
 * key `DEFAULT_AI_SETTINGS` + the encrypted-field set need, per CLAUDE.md's
 * "all new fields must be in the default" rule.
 *
 * Run with `pnpm test:integration` (needs DATABASE_URL / ENCRYPTION_KEY in
 * the environment — see `.env.local`).
 */
import { v4 as uuid } from "uuid";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { repositories, teams } from "@/lib/db/schema";
import * as queries from "@/lib/db/queries";
import {
  DEFAULT_AI_SETTINGS,
  DEFAULT_DIFF_THRESHOLDS,
  DEFAULT_NOTIFICATION_SETTINGS,
  DEFAULT_SELECTOR_PRIORITY,
} from "@/lib/db/schema";

let teamId: string;
let repositoryId: string;

beforeAll(async () => {
  teamId = uuid();
  await db.insert(teams).values({
    id: teamId,
    name: `settings-test-${teamId.slice(0, 8)}`,
    slug: `settings-test-${teamId.slice(0, 8)}`,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  repositoryId = uuid();
  await db.insert(repositories).values({
    id: repositoryId,
    teamId,
    provider: "local",
    owner: "settings-test",
    name: "repo",
    fullName: "settings-test/repo",
    createdAt: new Date(),
  });
});

afterAll(async () => {
  // Children first (no FK cascade guaranteed for every settings table on a
  // synthetic repo id) — cheap, deterministic, and scoped to this test's own
  // rows only, per the "clean up your own test data" instruction.
  await db
    .delete((await import("@/lib/db/schema")).playwrightSettings)
    .where(
      eq(
        (await import("@/lib/db/schema")).playwrightSettings.repositoryId,
        repositoryId,
      ),
    );
  await db
    .delete((await import("@/lib/db/schema")).environmentConfigs)
    .where(
      eq(
        (await import("@/lib/db/schema")).environmentConfigs.repositoryId,
        repositoryId,
      ),
    );
  await db
    .delete((await import("@/lib/db/schema")).diffSensitivitySettings)
    .where(
      eq(
        (await import("@/lib/db/schema")).diffSensitivitySettings.repositoryId,
        repositoryId,
      ),
    );
  await db
    .delete((await import("@/lib/db/schema")).aiSettings)
    .where(
      eq(
        (await import("@/lib/db/schema")).aiSettings.repositoryId,
        repositoryId,
      ),
    );
  await db
    .delete((await import("@/lib/db/schema")).notificationSettings)
    .where(
      eq(
        (await import("@/lib/db/schema")).notificationSettings.repositoryId,
        repositoryId,
      ),
    );
  await db.delete(repositories).where(eq(repositories.id, repositoryId));
  await db.delete(teams).where(eq(teams.id, teamId));
});

describe("Playwright settings — upsert round-trip (data layer under the autosave debounce)", () => {
  it("persists an edited field and it survives a re-fetch", async () => {
    const before = await queries.getPlaywrightSettings(repositoryId);
    // No per-repo row exists yet for this fresh repo, so this falls through
    // to whatever global (repositoryId IS NULL) row the dev DB already has —
    // confirmed by re-querying: an id of "" would mean no global row exists
    // either. Either way selectorPriority always includes every default type.
    expect(before.selectorPriority.map((s) => s.type)).toEqual(
      expect.arrayContaining(DEFAULT_SELECTOR_PRIORITY.map((s) => s.type)),
    );

    // Mirror exactly what playwright-settings-card's doSave() sends for a
    // single-field edit: navigationTimeout.
    await queries.upsertPlaywrightSettings(repositoryId, {
      navigationTimeout: 45000,
      browser: "firefox",
    });

    const after = await queries.getPlaywrightSettings(repositoryId);
    expect(after.navigationTimeout).toBe(45000);
    expect(after.browser).toBe("firefox");
    expect(after.id).not.toBe("");

    // A second save (the "edit again" case the debounce coalesces) updates
    // in place rather than creating a duplicate row.
    await queries.upsertPlaywrightSettings(repositoryId, {
      navigationTimeout: 50000,
    });
    const rows = await db
      .select()
      .from((await import("@/lib/db/schema")).playwrightSettings)
      .where(
        eq(
          (await import("@/lib/db/schema")).playwrightSettings.repositoryId,
          repositoryId,
        ),
      );
    expect(rows.length).toBe(1);
    expect(rows[0]!.navigationTimeout).toBe(50000);
  });
});

describe("Environment config — upsert round-trip", () => {
  it("persists an edited baseUrl and strips trailing slashes on read", async () => {
    await queries.upsertEnvironmentConfig(repositoryId, {
      mode: "manual",
      baseUrl: "https://example.test/",
    });
    const after = await queries.getEnvironmentConfig(repositoryId);
    expect(after.baseUrl).toBe("https://example.test"); // trailing slash stripped
    expect(after.mode).toBe("manual");
  });
});

describe("Diff sensitivity settings — upsert round-trip", () => {
  it("persists an edited threshold", async () => {
    const before = await queries.getDiffSensitivitySettings(repositoryId);
    expect(before).toMatchObject({
      unchangedThreshold: DEFAULT_DIFF_THRESHOLDS.unchangedThreshold,
      diffEngine: DEFAULT_DIFF_THRESHOLDS.diffEngine,
    });

    await queries.upsertDiffSensitivitySettings(repositoryId, {
      unchangedThreshold: 3,
      diffEngine: "ssim",
    });

    const after = await queries.getDiffSensitivitySettings(repositoryId);
    expect(after.unchangedThreshold).toBe(3);
    expect(after.diffEngine).toBe("ssim");
  });
});

describe("Notification settings — upsert round-trip", () => {
  it("persists an edited webhook field", async () => {
    const before = await queries.getNotificationSettings(repositoryId);
    expect(before).toMatchObject(DEFAULT_NOTIFICATION_SETTINGS);

    await queries.upsertNotificationSettings(repositoryId, {
      slackEnabled: true,
      slackWebhookUrl: "https://hooks.slack.test/abc",
    });

    const after = await queries.getNotificationSettings(repositoryId);
    expect(after.slackEnabled).toBe(true);
    expect(after.slackWebhookUrl).toBe("https://hooks.slack.test/abc");
    // Untouched fields keep their default, not clobbered by the partial upsert.
    expect(after.discordEnabled).toBe(false);
  });
});

describe("AI settings — upsert round-trip, encryption, and default completeness", () => {
  it("encrypts an API key at rest and decrypts it back through getAISettings", async () => {
    await queries.upsertAISettings(repositoryId, {
      provider: "anthropic",
      anthropicApiKey: "sk-ant-test-secret-value",
      explorerModel: "claude-haiku-test",
    });

    const after = await queries.getAISettings(repositoryId);
    expect(after.provider).toBe("anthropic");
    expect(after.anthropicApiKey).toBe("sk-ant-test-secret-value");
    expect(after.explorerModel).toBe("claude-haiku-test");

    // Confirm it is NOT stored as plaintext — the encryption path actually ran.
    const [raw] = await db
      .select()
      .from((await import("@/lib/db/schema")).aiSettings)
      .where(
        eq(
          (await import("@/lib/db/schema")).aiSettings.repositoryId,
          repositoryId,
        ),
      );
    expect(raw!.anthropicApiKey).not.toBe("sk-ant-test-secret-value");
    expect(raw!.anthropicApiKey).toBeTruthy();
  });

  it("synthetic default (no saved row) has every DEFAULT_AI_SETTINGS key — a fresh repo's AI card can't crash on a missing field", async () => {
    const freshRepoId = uuid();
    // No row inserted for this repo id — exercises the "no saved row" branch.
    const defaults = await queries.getAISettings(freshRepoId);

    // provider is deployment-resolved (defaultAiProvider()), not the literal
    // DEFAULT_AI_SETTINGS.provider constant.
    //
    // aiDiffingProvider is a confirmed PRE-EXISTING gap, not introduced by this
    // branch (byte-identical to main's src/lib/db/queries/settings.ts — `git
    // diff main` on this file is empty): the synthetic default hardcodes
    // `aiDiffingProvider: null` instead of DEFAULT_AI_SETTINGS.aiDiffingProvider
    // ("same-as-test-gen"). Cosmetically masked today because
    // ai-settings-card.tsx's originalValues falls back with
    // `settings.aiDiffingProvider || "same-as-test-gen"`, but it means any
    // future caller of getAISettings() that trusts the default object
    // directly (not through that card) gets the wrong provider. Tracked here,
    // not silently matched.
    const knownPreExistingGaps = new Set(["provider", "aiDiffingProvider"]);
    for (const key of Object.keys(DEFAULT_AI_SETTINGS)) {
      expect(defaults).toHaveProperty(key);
      if (!knownPreExistingGaps.has(key)) {
        expect(
          (defaults as Record<string, unknown>)[key],
          `defaults.${key} should equal DEFAULT_AI_SETTINGS.${key}`,
        ).toEqual((DEFAULT_AI_SETTINGS as Record<string, unknown>)[key]);
      }
    }
    expect(defaults.aiDiffingProvider).toBeNull();
    // The three explorer-specific fields the refactor plan calls out by name
    // (§2.2: "AI settings page... check the autosave path specifically").
    expect(defaults).toHaveProperty("explorerMaxIterations");
    expect(defaults).toHaveProperty("explorerStyleRotation");
    expect(defaults).toHaveProperty("explorerModel");
  });
});
