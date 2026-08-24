/**
 * §4 golden path, steps 12–14 — the Settings surfaces, in a real browser.
 *
 * `docs/architecture/core-plugin-refactor-test-plan.md` §2.18 closed §1–§3 but
 * recorded one honest gap: "No browser-automation tool was available in this
 * environment, so nothing requiring an actual rendered/interactive UI was
 * exercised end to end." These three steps are the part of that gap that
 * genuinely cannot be closed any other way:
 *
 *  - step 12 (§2.13) — `plugins/scheduling/src/ui/schedule-manager.tsx`
 *    imports `PRESET_SCHEDULES` straight from `@lastest/cron` and renders it
 *    into a Radix Select. §2.18 diffed the (now-retired) app-side shim and
 *    exercised dispatch, but a broken import in the client bundle is
 *    invisible to a server-side test and fatal in the browser.
 *  - step 13 (§2.9) — `hasQaAgentAccess(plan, billingEnabled)` is called from
 *    both a server component (`/qa-agent/page.tsx`) and a client component
 *    (`sidebar.tsx`, which receives `billingEnabled` as a prop precisely
 *    because `STRIPE_SECRET_KEY` is server-only). §2.18 verified the server
 *    side over HTTP; only a rendered page can prove the two agree.
 *  - step 14 (§2.2) — settings autosave is a 500ms debounce whose
 *    `originalValues`/`hasChanges`/`doSave`/`useEffect` deps must all agree
 *    (`CLAUDE.md`). §3 could only check that structurally by grep: the timer
 *    needs a real event loop, and "it persisted" needs a real reload.
 *
 * Deliberately one sequential journey in one browser context, for the same
 * reason as `golden-path.integration.test.ts`: state carries between steps
 * (the sandbox repo created in setup is the repo the schedules and the
 * per-repo AI/notification settings hang off).
 *
 * Prerequisites: `pnpm dev` (app on :3000), `pnpm dev:pool`, host postgres.
 * Run with `pnpm test:integration`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Locator, Page } from "playwright";

import { db } from "@/lib/db";
import { repositories, teams, users } from "@/lib/db/schema";
import * as queries from "@/lib/db/queries";
import { schedulingBuildSchedules } from "@lastest/plugin-scheduling/schema";
import { hasQaAgentAccess } from "@/lib/billing/feature-access";

import {
  BASE_URL,
  destroyTeam,
  launchSession,
  onboardWithSandbox,
  registerViaUi,
  startTargetApp,
  teamIdForEmail,
  type Session,
  type TargetApp,
} from "./harness";

const PROJECT = "Settings UI Project";

/**
 * Same input `isBillingEnabled()` reads on the server (`src/lib/billing/
 * enabled.ts`). `.env.local` is loaded into this process by
 * `vitest.integration.config.ts`, so this matches whatever the dev server the
 * browser is driving was started with.
 */
const BILLING_ENABLED = Boolean(process.env.STRIPE_SECRET_KEY);

/** The card's debounce is 500ms; a save round-trip is a server action. */
const DEBOUNCE_MS = 500;
const AUTOSAVE_SETTLE_MS = 3_000;

let s: Session;
let target: TargetApp;
let teamId: string | undefined;
let repoId: string;

/**
 * `consoleErrors` only records the browser's generic "Failed to load resource"
 * line, which names no URL. Recording the responses themselves is what makes a
 * failure here actionable instead of a dead end.
 */
const serverErrors: string[] = [];

/**
 * A server action that throws surfaces as a 500 on the action POST (and a
 * generic "Failed to load resource" console line). The invalid-cron case below
 * *wants* that, so it is counted rather than blanket-ignored — anything beyond
 * this count is a real error.
 */
let expectedActionRejections = 0;

// ── Local helpers (not in harness.ts — three agents share that file) ──────

/**
 * Open a Settings tab by its `?tab=` key. `settings-tabs.tsx` resolves the
 * active tab from the URL *after* hydration, then rewrites it to a hash, so
 * waiting on the tab's own content (rather than on load) is the only reliable
 * signal that the switch happened.
 */
async function openSettingsTab(
  page: Page,
  tab: "general" | "integrations" | "testing" | "ai" | "account",
  expectContent: RegExp,
): Promise<void> {
  await page.goto(`${BASE_URL}/settings?tab=${tab}`, {
    waitUntil: "domcontentloaded",
  });
  await page
    .getByText(expectContent)
    .first()
    .waitFor({ state: "visible", timeout: 60_000 });
}

/** Pick an option out of a Radix Select (a button, not a native <select>). */
async function chooseFromSelect(
  page: Page,
  trigger: Locator,
  optionName: RegExp,
): Promise<void> {
  await trigger.click();
  await page
    .getByRole("option", { name: optionName })
    .first()
    .click({ timeout: 15_000 });
}

/** Reveal the AI card — it lives behind the "Advanced" collapsible. */
async function openAiAdvanced(page: Page): Promise<void> {
  const explorerModel = page.locator("input#explorerModel");
  if (await explorerModel.isVisible().catch(() => false)) return;
  await page
    .getByRole("button", { name: /advanced: run ai inside lastest/i })
    .click();
  await explorerModel.waitFor({ state: "visible", timeout: 30_000 });
}

/**
 * Teardown that actually tears down.
 *
 * The harness's `destroyTeam` calls `queries.deleteTeam`, which is a bare
 * `delete from teams` — `users.team_id` carries no ON DELETE action, so that
 * statement raises `users_team_id_teams_id_fk` for any team that still has a
 * member (i.e. every team a UI registration created). `destroyTeam` swallows
 * the error, so the team silently survives. The product's own path
 * (`deleteAccount` in `src/server/actions/account.ts`) deletes the user first
 * and only then the team; this mirrors that ordering.
 *
 * Repositories are removed explicitly for a second reason: `repositories`
 * carries no foreign key to `teams` at all (the column is a bare
 * `text("team_id")` — see `packages/db/src/schema/repos.ts:29`), so deleting
 * the team leaves them, and everything hanging off them, behind.
 */
async function destroyTeamDeep(id: string | undefined): Promise<void> {
  if (!id) return;
  for (const repo of await db
    .select({ id: repositories.id })
    .from(repositories)
    .where(eq(repositories.teamId, id))) {
    await queries.deleteRepository(repo.id).catch(() => {});
  }
  for (const member of await queries.getTeamMembers(id)) {
    await queries.deleteUser(member.id).catch(async () => {
      // A member the FK graph won't let us delete still must not pin the team.
      await db
        .update(users)
        .set({ teamId: null })
        .where(eq(users.id, member.id));
    });
  }
  await destroyTeam(id);
}

/** Text of every sonner toast currently on screen. */
async function toastTexts(page: Page): Promise<string[]> {
  return page.locator("[data-sonner-toast]").allTextContents();
}

beforeAll(async () => {
  target = await startTargetApp();
  s = await launchSession();
  s.page.on("response", (r) => {
    if (r.status() >= 500) {
      serverErrors.push(`${r.status()} ${r.request().method()} ${r.url()}`);
    }
  });
  await registerViaUi(s, "Settings UI");
  teamId = await teamIdForEmail(s.email);
  await onboardWithSandbox(s, target.origin, PROJECT);

  const [repo] = await db
    .select()
    .from(repositories)
    .where(eq(repositories.teamId, teamId));
  if (!repo) throw new Error("onboarding did not create a repository");
  repoId = repo.id;
}, 300_000);

afterAll(async () => {
  await s?.close();
  await target?.close();
  await destroyTeamDeep(teamId);
});

// ── Step 12 — scheduled runs (§2.13) ─────────────────────────────────────

describe("§4 step 12 — scheduled runs, preset + custom cron", () => {
  it("creates a preset schedule through the real Frequency select", async () => {
    const page = s.page;
    await openSettingsTab(page, "integrations", /Scheduled Runs/);

    // Baseline: a fresh repo has no schedules, so the empty state is the
    // control for the assertions below.
    await expect
      .poll(() => page.locator("#schedules").textContent(), { timeout: 30_000 })
      .toMatch(/No scheduled runs configured/i);

    await page.getByRole("button", { name: /add schedule/i }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ state: "visible", timeout: 30_000 });

    await dialog
      .getByPlaceholder("e.g., Nightly Regression")
      .fill("Preset Run");
    // The options in this Select come straight from `PRESET_SCHEDULES`,
    // imported through the `libs/cron` shim by a client component — if the
    // re-export did not resolve in the browser bundle, the list would be
    // empty and this click would time out.
    await chooseFromSelect(
      page,
      dialog.getByRole("combobox").first(),
      /^Every 6 hours$/,
    );
    await dialog.getByRole("button", { name: /create schedule/i }).click();

    await expect
      .poll(() => page.locator("#schedules").textContent(), { timeout: 30_000 })
      .toMatch(/Preset Run/);

    const [row] = await db
      .select()
      .from(schedulingBuildSchedules)
      .where(eq(schedulingBuildSchedules.repositoryId, repoId));
    expect(row?.cronExpression).toBe("0 */6 * * *");
    // `getNextRunTime` ran server-side through the same shim.
    expect(row?.nextRunAt).toBeInstanceOf(Date);
    expect(row!.nextRunAt!.getTime()).toBeGreaterThan(Date.now() - 60_000);
    // The list renders the description `describeCron` produced.
    expect(await page.locator("#schedules").textContent()).toMatch(
      /Every 6 hours/,
    );
  }, 120_000);

  it("rejects an invalid custom cron and accepts a valid one", async () => {
    const page = s.page;
    await page.getByRole("button", { name: /add schedule/i }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ state: "visible", timeout: 30_000 });

    await dialog
      .getByPlaceholder("e.g., Nightly Regression")
      .fill("Custom Run");
    await chooseFromSelect(
      page,
      dialog.getByRole("combobox").first(),
      /^Custom cron expression$/,
    );
    const cronInput = dialog.getByPlaceholder("0 3 * * *");
    await cronInput.waitFor({ state: "visible", timeout: 15_000 });

    // 99 is out of range for the minute field — `isValidCron` (shim) must
    // reject it in the server action before anything is written.
    await cronInput.fill("99 * * * *");
    await dialog.getByRole("button", { name: /create schedule/i }).click();
    expectedActionRejections += 1;
    await expect
      .poll(() => toastTexts(page), { timeout: 30_000 })
      .toEqual(
        expect.arrayContaining([expect.stringMatching(/invalid cron/i)]),
      );
    // Rejected means rejected: the dialog stays open and nothing was stored.
    await expect.poll(() => dialog.isVisible(), { timeout: 5_000 }).toBe(true);
    expect(
      await db
        .select()
        .from(schedulingBuildSchedules)
        .where(eq(schedulingBuildSchedules.repositoryId, repoId)),
    ).toHaveLength(1);

    // Now a valid custom expression — one `describeCron` has no preset for.
    await cronInput.fill("37 4 * * 2");
    await dialog.getByRole("button", { name: /create schedule/i }).click();

    await expect
      .poll(() => page.locator("#schedules").textContent(), { timeout: 30_000 })
      .toMatch(/Custom Run/);
    expect(await page.locator("#schedules").textContent()).toMatch(
      /Tuesday at 04:37/,
    );
  }, 120_000);

  it("shows both schedules in the list after a full reload", async () => {
    const page = s.page;
    await openSettingsTab(page, "integrations", /Scheduled Runs/);
    const list = page.locator("#schedules");
    await expect
      .poll(() => list.textContent(), { timeout: 30_000 })
      .toMatch(/Preset Run/);
    const text = await list.textContent();
    expect(text).toMatch(/Custom Run/);
    expect(text).toMatch(/Every 6 hours/);
    expect(text).toMatch(/Tuesday at 04:37/);

    const rows = await db
      .select()
      .from(schedulingBuildSchedules)
      .where(eq(schedulingBuildSchedules.repositoryId, repoId));
    expect(rows.map((r) => r.cronExpression).sort()).toEqual([
      "0 */6 * * *",
      "37 4 * * 2",
    ]);
    expect(rows.every((r) => r.enabled)).toBe(true);
  }, 120_000);
});

// ── Step 13 — QA Agent gating vs. plan + billing state (§2.9) ────────────

describe("§4 step 13 — billing page and QA Agent gating agree", () => {
  it("billing page agrees with the server's billing configuration, team on Free", async () => {
    const page = s.page;
    await page.goto(`${BASE_URL}/settings/billing`, {
      waitUntil: "domcontentloaded",
    });
    const card = page.locator("#billing");
    await card.waitFor({ state: "visible", timeout: 60_000 });
    await expect
      .poll(() => card.textContent(), { timeout: 30_000 })
      .toMatch(/Current plan:\s*Free/);
    // The rendered client component agrees with the server's
    // `isStripeConfigured()`. Which branch that is depends on the env this
    // suite runs against, so read the same input the server reads rather than
    // hard-coding the self-hosted case — a dev box with STRIPE_SECRET_KEY in
    // `.env.local` is a perfectly normal place to run this.
    expect(await card.textContent()).toMatch(
      BILLING_ENABLED ? /Upgrade to Lastest/i : /Billing is not configured/i,
    );
  }, 120_000);

  it("free plan: the sidebar lock and the /qa-agent gate agree with hasQaAgentAccess", async () => {
    const page = s.page;
    await page.goto(`${BASE_URL}/qa-agent`, { waitUntil: "domcontentloaded" });

    const qaLink = page.locator("nav a[href='/qa-agent']").first();
    await qaLink.waitFor({ state: "visible", timeout: 60_000 });

    // §2.9 is about *drift*: `sidebar.tsx`'s client-side "Pro" lock badge
    // (aria-label="Pro feature") and `/qa-agent/page.tsx`'s server-side
    // upgrade screen must reach the same verdict as `hasQaAgentAccess`. With
    // billing configured a free team is gated on both; with billing off
    // (self-hosted) plan gates are lifted on both.
    const gated = !hasQaAgentAccess("free", BILLING_ENABLED);
    expect(await qaLink.locator("[aria-label='Pro feature']").count()).toBe(
      gated ? 1 : 0,
    );
    const body = await page.locator("body").textContent();
    if (gated) {
      expect(body).toMatch(/Unlock the QA Agent with/i);
    } else {
      expect(body).not.toMatch(/Unlock the QA Agent with/i);
    }

    // …and the server function backing it agrees for this team's real plan.
    const team = await queries.getTeam(teamId!);
    expect(team?.plan).toBe("free");
  }, 120_000);

  it("flipping the team to pro is reflected in the UI on reload, still unlocked", async () => {
    // Only ever mutate the disposable team this file created.
    await db.update(teams).set({ plan: "pro" }).where(eq(teams.id, teamId!));

    const page = s.page;
    await page.goto(`${BASE_URL}/settings/billing`, {
      waitUntil: "domcontentloaded",
    });
    await expect
      .poll(() => page.locator("#billing").textContent(), { timeout: 60_000 })
      .toMatch(/Current plan:\s*Pro/);

    await page.goto(`${BASE_URL}/qa-agent`, { waitUntil: "domcontentloaded" });
    const qaLink = page.locator("nav a[href='/qa-agent']").first();
    await qaLink.waitFor({ state: "visible", timeout: 60_000 });
    expect(await qaLink.locator("[aria-label='Pro feature']").count()).toBe(0);
    expect(await page.locator("body").textContent()).not.toMatch(
      /Unlock the QA Agent with/i,
    );
  }, 120_000);
});

// ── Step 14 — debounced autosave survives a reload (§2.2) ────────────────

describe("§4 step 14 — AI + Notification settings autosave and persist", () => {
  const explorerModel = `e2e-explorer-${Date.now()}`;
  const customInstructions = `e2e custom instructions ${Date.now()}`;
  const assignee = `e2e-bot-${Date.now()}`;

  it("AI settings: an edit autosaves after the 500ms debounce", async () => {
    const page = s.page;
    await openSettingsTab(page, "ai", /AI access/);
    await openAiAdvanced(page);

    // Two fields at once: `customInstructions` predates this branch and
    // `explorerModel` is one of the fields the §2.2 refactor added, so a
    // missed entry in `originalValues`/`hasChanges`/the deps array for the
    // new field would show up as a partial save rather than no save at all.
    await page.locator("textarea#customInstructions").fill(customInstructions);
    await page.locator("input#explorerModel").fill(explorerModel);

    // Nothing should have been written yet — that is what the debounce is.
    await page.waitForTimeout(DEBOUNCE_MS / 2);
    const early = await queries.getAISettings(repoId);
    expect(early.explorerModel ?? "").not.toBe(explorerModel);

    await expect
      .poll(() => toastTexts(page), { timeout: AUTOSAVE_SETTLE_MS + 10_000 })
      .toEqual(
        expect.arrayContaining([expect.stringMatching(/AI settings saved/i)]),
      );
  }, 120_000);

  it("AI settings: the edit survives a real page reload", async () => {
    const page = s.page;
    await page.waitForTimeout(AUTOSAVE_SETTLE_MS);
    await openSettingsTab(page, "ai", /AI access/);
    await openAiAdvanced(page);

    expect(await page.locator("input#explorerModel").inputValue()).toBe(
      explorerModel,
    );
    expect(await page.locator("textarea#customInstructions").inputValue()).toBe(
      customInstructions,
    );

    const stored = await queries.getAISettings(repoId);
    expect(stored.explorerModel).toBe(explorerModel);
    expect(stored.customInstructions).toBe(customInstructions);
    // Per-repo row, not the global one: the card was rendered with
    // `repositoryId={selectedRepo.id}`.
    expect(stored.repositoryId).toBe(repoId);
  }, 120_000);

  it("Notification settings: a text edit and a switch both autosave", async () => {
    const page = s.page;
    await openSettingsTab(page, "account", /Discord Notifications/);
    const card = page.locator("#notifications");

    // Discord is the second switch in the card; flipping the right one is
    // self-verifying because only Discord reveals #discordWebhookUrl.
    await card.getByRole("switch").nth(1).click();
    await page
      .locator("input#discordWebhookUrl")
      .waitFor({ state: "visible", timeout: 15_000 });

    await card.locator("input#issueAssignee").fill(assignee);

    await expect
      .poll(() => toastTexts(page), { timeout: AUTOSAVE_SETTLE_MS + 10_000 })
      .toEqual(
        expect.arrayContaining([
          expect.stringMatching(/Notification settings saved/i),
        ]),
      );
  }, 120_000);

  it("Notification settings: both edits survive a real page reload", async () => {
    const page = s.page;
    await page.waitForTimeout(AUTOSAVE_SETTLE_MS);
    await openSettingsTab(page, "account", /Discord Notifications/);
    const card = page.locator("#notifications");

    expect(await card.locator("input#issueAssignee").inputValue()).toBe(
      assignee,
    );
    // A boolean rehydrated from the DB, not just a text field.
    expect(
      await card.getByRole("switch").nth(1).getAttribute("aria-checked"),
    ).toBe("true");
    // The switch being on is what conditionally renders the URL field, so its
    // presence after a reload is a second, independent read of the same bit.
    expect(await page.locator("input#discordWebhookUrl").isVisible()).toBe(
      true,
    );

    const stored = await queries.getNotificationSettings(repoId);
    expect(stored.issueAssignee).toBe(assignee);
    expect(stored.discordEnabled).toBe(true);
    expect(stored.repositoryId).toBe(repoId);
  }, 120_000);

  it("leaves no unexplained client-side errors across the settings surfaces", async () => {
    // The only 500s allowed are the server-action POSTs the invalid-cron case
    // deliberately provoked; every other 5xx is a genuine defect.
    const rejections = serverErrors.filter((e) =>
      /^500 POST \S+\/settings\?tab=integrations$/.test(e),
    );
    expect(rejections).toHaveLength(expectedActionRejections);
    expect(serverErrors.length - rejections.length).toBe(0);

    // …and the matching console noise is exactly one generic resource line per
    // rejection, nothing more.
    const unexplained = s.consoleErrors.filter(
      (e) => !/Failed to load resource.*status of 500/i.test(e),
    );
    expect(unexplained).toEqual([]);
    expect(s.consoleErrors).toHaveLength(expectedActionRejections);
  });
});
