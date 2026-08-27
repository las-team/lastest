/**
 * §4 step 17 — WebMCP: Lastest as a tool surface for browser AI agents.
 *
 * `feat(webmcp): expose Lastest to browser AI agents via document.modelContext`
 * (5ea08c8e) and its follow-up (76175ad0) are, uniquely, a feature that exists
 * *only* in the browser. Nothing on the server can tell you whether
 * `document.modelContext` ever received a tool, whether the set narrows when
 * the route changes, or whether the consent dialog actually stands between an
 * agent and a mutation. Every claim below is a client-side one, so this suite
 * is the only place they can be checked at all.
 *
 * ### Why a stub rather than the real polyfill
 *
 * `registerWebMcpToolsWithPolyfill` installs `@mcp-b/webmcp-polyfill` only when
 * the page has no native WebMCP (`ensureModelContext`), and the polyfill bails
 * out of `initializeWebMCPPolyfill` if `document.modelContext` already exists.
 * Injecting our own recorder before navigation therefore takes the same code
 * path a *native* Chrome 150 would, and hands the test the descriptors verbatim
 * — including `annotations.readOnlyHint`, which the polyfill's `getTools()`
 * projection makes awkward to read (its objects hold a live `window`, so they
 * are not serialisable out of `page.evaluate`).
 *
 * ### Prerequisites beyond the usual
 *
 * WebMCP is on unless the deployment opted out with `WEBMCP_ENABLED=0` — read
 * in `(app)/layout.tsx` and `/r/[slug]/page.tsx` as a server env var, so
 * setting it in this process does nothing. When it *is* opted out, both
 * surfaces render no provider at all and every case here would fail for an
 * environmental reason, so the suite says so and skips instead.
 *
 * Otherwise: `pnpm dev` (app on :3000) and host postgres. No EB, no AI.
 */
import { v4 as uuid } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { BrowserContext, Page } from "playwright";
import { generateShareSlug } from "@lastest/plugin-share";
import { sharePublicShares } from "@lastest/plugin-share/schema";

import { db } from "@/lib/db";
import { repositories, teams, users } from "@/lib/db/schema";
import * as queries from "@/lib/db/queries";

import {
  BASE_URL,
  destroyTeam,
  gotoSettled,
  launchSession,
  registerViaUi,
  teamIdForEmail,
  type Session,
} from "./harness";

/**
 * The server-side flag, mirroring `isWebMcpEnabled()`. Read from this process
 * only to decide whether the suite can say anything at all —
 * `vitest.integration.config.ts` loads the same `.env.local` the dev server was
 * started from, so in the normal case the two agree.
 */
const WEBMCP_ENABLED = !["0", "false", "off"].includes(
  process.env.WEBMCP_ENABLED?.trim().toLowerCase() ?? "",
);

let s: Session;
let teamId: string | undefined;
let repoId: string;
let buildId: string;
let slug: string;
let totalTests: number;

/**
 * Records every tool the page registers, and exposes a caller.
 *
 * Installed with `addInitScript` so it is in place before any React effect
 * runs — registration happens in a `useEffect` inside `WebMcpProvider`, which
 * is early enough that a post-load injection would race it.
 */
const STUB = `
window.__webmcp = [];
Object.defineProperty(document, "modelContext", {
  configurable: true,
  value: {
    registerTool(descriptor) {
      window.__webmcp = window.__webmcp
        .filter((t) => t.name !== descriptor.name)
        .concat(descriptor);
      return {};
    },
    unregisterTool(name) {
      window.__webmcp = window.__webmcp.filter((t) => t.name !== name);
    },
  },
});
window.__webmcpNames = () => window.__webmcp.map((t) => t.name).sort();
window.__webmcpCall = (name, args) => {
  const tool = window.__webmcp.find((t) => t.name === name);
  if (!tool) throw new Error("no such tool: " + name);
  return tool.execute(args || {});
};
`;

async function toolNames(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    (window as unknown as { __webmcpNames(): string[] }).__webmcpNames(),
  );
}

/** Poll until `predicate` holds for the registered set, then return it. */
async function toolsWhen(
  page: Page,
  what: string,
  predicate: (names: string[]) => boolean,
  timeoutMs = 60_000,
): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  let last: string[] = [];
  for (;;) {
    last = await toolNames(page).catch(() => []);
    if (predicate(last)) return last;
    if (Date.now() > deadline) {
      throw new Error(
        `timed out waiting for ${what} (saw: ${last.join(", ")})`,
      );
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

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
      await db
        .update(users)
        .set({ teamId: null })
        .where(eq(users.id, member.id));
    });
  }
  await destroyTeam(id);
}

beforeAll(async () => {
  if (!WEBMCP_ENABLED) return;
  s = await launchSession();
  await s.context.addInitScript(STUB);
  await registerViaUi(s, "WebMCP UI");
  teamId = await teamIdForEmail(s.email);

  const suffix = Date.now().toString(36);
  const repo = await queries.createRepository({
    teamId: teamId!,
    provider: "local",
    owner: "webmcp-e2e",
    name: `repo-${suffix}`,
    fullName: `webmcp-e2e/repo-${suffix}`,
  });
  repoId = repo.id;
  await db
    .update(users)
    .set({ onboardingCompletedAt: new Date(), selectedRepositoryId: repoId })
    .where(eq(users.email, s.email));
  // Pro, so the app surfaces this walks are not the upgrade screen.
  await db.update(teams).set({ plan: "pro" }).where(eq(teams.id, teamId!));

  // One completed build, so `/verify/<id>` is a real page and the share page
  // has something to summarise.
  const test = await queries.createTest({
    repositoryId: repoId,
    name: "webmcp smoke",
    code: "export async function test(page) {}",
    targetUrl: "https://example.test/",
  });
  const now = new Date();
  const run = await queries.createTestRun({
    repositoryId: repoId,
    status: "completed",
    startedAt: now,
    completedAt: now,
    gitBranch: "main",
    gitCommit: "abc1234",
  });
  await queries.createTestResult({
    testRunId: run.id,
    testId: test.id,
    status: "passed",
    browser: "chromium",
    durationMs: 2_100,
  });
  totalTests = 1;
  const build = await queries.createBuild({
    testRunId: run.id,
    triggerType: "manual",
    overallStatus: "safe_to_merge",
    completedAt: now,
    totalTests,
    passedCount: 1,
    failedCount: 0,
    changesDetected: 0,
  });
  buildId = build.id;

  // Share rows are plugin-owned; inserted directly as a fixture, the same way
  // `src/app/(public)/r/public-share.integration.test.ts` does it.
  slug = generateShareSlug();
  await db.insert(sharePublicShares).values({
    id: uuid(),
    slug,
    buildId,
    testId: test.id,
    repositoryId: repoId,
    ownerTeamId: teamId!,
    status: "public",
    kind: "regression",
    targetDomain: "example.test",
    createdAt: new Date(),
  });
}, 300_000);

afterAll(async () => {
  await s?.close();
  await destroyTeamDeep(teamId);
});

describe.skipIf(!WEBMCP_ENABLED)(
  "§4 step 17 — WebMCP tool surface in the browser",
  () => {
    it("registers the global + repo tools for any signed-in user", async () => {
      const { page } = s;
      // There is no team opt-in any more: the surface is on wherever the
      // deployment has not set `WEBMCP_ENABLED=0`, because consent (not a
      // tenant switch) is what stands between an agent and a mutation.
      await gotoSettled(page, "/tests");
      const names = await toolsWhen(
        page,
        "the global + repo tools to register",
        (n) => n.includes("lastest_list_projects"),
      );
      // Global tools plus the repo-scoped ones the selected repository unlocks.
      for (const tool of [
        "lastest_list_projects",
        "lastest_check_running_jobs",
        "lastest_list_builds",
        "lastest_list_failing_tests",
        "lastest_run_tests",
      ]) {
        expect(names, `tool ${tool}`).toContain(tool);
      }
      // Build-scoped tools need a buildId, which /tests does not supply.
      expect(names).not.toContain("lastest_review_build");
      // And no name is registered twice — the StrictMode double-effect race
      // that used to throw "Tool already registered" would show up here.
      expect(new Set(names).size).toBe(names.length);
    });

    it("no longer offers a team-level toggle in Settings", async () => {
      const { page } = s;
      await gotoSettled(page, "/settings?tab=general");
      const card = page.locator("#features");
      await card.waitFor({ state: "visible", timeout: 60_000 });
      expect(await card.innerText()).not.toMatch(/Browser AI agents/);
    });

    it("the tool set narrows to the route, and widens on a build page", async () => {
      const { page } = s;
      // `/verify/<id>` is the build surface — `/builds/<id>` only redirects
      // here now (docs/architecture/retire-run-build-pages.md).
      await gotoSettled(page, `/verify/${buildId}`);
      const onBuild = await toolsWhen(page, "the build-scoped tools", (n) =>
        n.includes("lastest_review_build"),
      );
      expect(onBuild).toContain("lastest_list_build_diffs");
      expect(onBuild).toContain("lastest_get_change_map");
      // Route context is *additive* — the globals stay.
      expect(onBuild).toContain("lastest_list_projects");

      // …and leaving the build unregisters them again. This is the half that
      // proves the AbortSignal/unregisterTool disposal actually runs; a leak
      // here would leave an agent holding a tool bound to a stale build.
      await gotoSettled(page, "/settings?tab=general");
      const after = await toolsWhen(
        page,
        "the build tools to be unregistered",
        (n) => !n.includes("lastest_review_build"),
      );
      expect(after).toContain("lastest_list_projects");
    });

    it("a mutating tool is gated by the consent dialog, and Cancel means no request", async () => {
      const { page } = s;
      await gotoSettled(page, "/tests");
      await toolsWhen(page, "lastest_run_tests", (n) =>
        n.includes("lastest_run_tests"),
      );

      const bridgeCalls: string[] = [];
      const onRequest = (r: { url(): string; method(): string }) => {
        if (r.method() === "POST" && r.url().includes("/api/mcp/session")) {
          bridgeCalls.push(r.url());
        }
      };
      page.on("request", onRequest);

      // Kick the call off without awaiting it — it blocks on the dialog.
      await page.evaluate(() => {
        const w = window as unknown as {
          __webmcpCall(n: string, a?: unknown): Promise<unknown>;
          __pending?: Promise<string>;
        };
        w.__pending = w
          .__webmcpCall("lastest_run_tests", {})
          .then(() => "resolved")
          .catch((e: Error) => `rejected:${e.message}`);
      });

      // The dialog names the tool and says, in fixed words, who is asking.
      const dialog = page.getByRole("dialog");
      await dialog.waitFor({ state: "visible", timeout: 30_000 });
      const dialogText = await dialog.innerText();
      expect(dialogText).toMatch(/Run tests in this project/);
      expect(dialogText).toMatch(
        /An AI agent in your browser is asking to do this in Lastest, as you\./,
      );

      await dialog.getByRole("button", { name: /^Cancel$/ }).click();

      const outcome = await page.evaluate(
        () => (window as unknown as { __pending: Promise<string> }).__pending,
      );
      expect(outcome).toBe("rejected:The user declined this action.");
      // The point of the gate: no build was ever dispatched.
      expect(bridgeCalls).toEqual([]);
      page.off("request", onRequest);
    });

    it("a read-only tool goes through the bridge and returns real data", async () => {
      const { page } = s;
      await gotoSettled(page, "/tests");
      await toolsWhen(page, "lastest_list_projects", (n) =>
        n.includes("lastest_list_projects"),
      );

      // No consent prompt for a read-only tool — if one appeared this would
      // hang rather than return.
      const result = await page.evaluate(async () => {
        const w = window as unknown as {
          __webmcpCall(n: string, a?: unknown): Promise<unknown>;
        };
        return JSON.stringify(
          await w.__webmcpCall("lastest_list_projects", {}),
        );
      });
      expect(result).toContain(repoId);
    });

    it("a public share page exposes exactly the three read-only tools, with no session", async () => {
      // A brand-new context: no cookies, no team, nothing but the slug.
      let anon: BrowserContext | undefined;
      try {
        anon = await s.browser.newContext({
          viewport: { width: 1280, height: 900 },
        });
        await anon.addInitScript(STUB);
        const page = await anon.newPage();
        await page.goto(`${BASE_URL}/r/${slug}`, {
          waitUntil: "domcontentloaded",
        });

        const names = await toolsWhen(
          page,
          "the share tools",
          (n) => n.length >= 3,
        );
        // Exactly these three — emphatically not `lastest_approve_diffs`,
        // which is registered on every *app* route.
        expect(names).toEqual([
          "lastest_list_failing_steps",
          "lastest_list_visual_changes",
          "lastest_report_summary",
        ]);

        const summary = await page.evaluate(async () => {
          const w = window as unknown as {
            __webmcpCall(n: string, a?: unknown): Promise<unknown>;
          };
          return (await w.__webmcpCall("lastest_report_summary", {})) as {
            tests?: { total?: number };
            reportUrl?: string;
          };
        });
        // Real data from the slug-scoped route, not a rendering of the page.
        expect(summary.tests?.total).toBe(totalTests);
        expect(summary.reportUrl).toContain(slug);
      } finally {
        await anon?.close();
      }
    });

    it("leaves no unexplained client-side errors", async () => {
      // The deprecated `navigator.modelContext` warning would show up here if
      // the code ever reached for it — it does not, because the stub installs
      // on `document`.
      expect(s.consoleErrors).toEqual([]);
    });
  },
);
