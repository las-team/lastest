/**
 * Runtime verification for Authoring AI (§3, P1, "Indirect via core/ai") —
 * generate a test via AI, heal a broken selector, and confirm what actually
 * gets written to `ai_prompt_logs`.
 *
 * Both flows are exercised through their real underlying functions
 * (`generateWithAI`, `agentHealTestCore`) rather than the `"use server"`
 * actions that wrap them (`startGenerateTestAgent`, `healTest` in
 * `src/server/actions/ai.ts`) — those wrappers open with `requireRepoAccess`,
 * a session-based guard that needs `headers()`/cookies, unavailable outside
 * a real Next.js request. `agentHealTestCore` is literally the same function
 * `healTest` calls after its own `requireRepoAccess` check, so this exercises
 * 100% of the AI/heal logic, just not the auth wrapper (already covered
 * generically elsewhere, and untouched by this refactor).
 *
 * FINDING (corrects the test plan's framing, not a refactor regression):
 * `ai_prompt_logs` (`packages/db/src/schema/settings.ts`) has never had
 * `inputTokens`/`outputTokens` columns — byte-identical to `main` on this
 * table. The ONLY place those fields exist anywhere in the app is
 * `AiResult` (`core/contracts/src/ai.ts`) — the plugin-facing return value
 * of `ctx.ai.generate()` — whose single implementation
 * (`src/lib/core/ai-capability.ts`) hardcodes `inputTokens: 0,
 * outputTokens: 0` for EVERY caller, with an explicit comment explaining
 * why ("token accounting ... is not returned per call"). That is not an
 * explorer-specific gap: explorer is simply the only plugin using `ctx.ai`
 * today, so it is the only place the placeholder is currently visible. This
 * file confirms the actual write path both explorer and non-explorer
 * callers share (`generateWithAI` → `createAIPromptLog`/`updateAIPromptLog`)
 * writes real prompt/response/status/duration for a non-explorer caller —
 * proving the write path itself is unaffected by the refactor — and asserts
 * directly that no token columns exist to write into, on either path.
 *
 * Run with `pnpm test:integration`.
 */
import { eq } from "drizzle-orm";
import { getPoolStatus } from "@lastest/pool-service/client";
import { validateTestCode } from "@lastest/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import * as queries from "@/lib/db/queries";
import { aiPromptLogs } from "@/lib/db/schema";
import {
  generateWithAI,
  extractCodeFromResponse,
  SYSTEM_PROMPT,
} from "@/lib/ai";
import { getAIConfig } from "@/lib/playwright/agent-context";
import { agentHealTestCore } from "@/lib/playwright/healer-agent";
import { claimEmbeddedBrowserForAgent } from "@/server/actions/ai";
import { releasePoolEB } from "@/server/actions/embedded-sessions";

const TARGET = "https://the-internet.herokuapp.com/login";

async function poolHeadroom(): Promise<number> {
  const status = await getPoolStatus();
  return status ? status.max - status.size : 99;
}

let teamId: string;
let repoId: string;

beforeAll(async () => {
  const team = await queries.createTeam({ name: "authoring-ai-it-team" });
  teamId = team.id;
  const repo = await queries.createRepository({
    teamId,
    provider: "local",
    owner: "authoring-ai-it",
    name: "target",
    fullName: "authoring-ai-it/target",
    defaultBranch: "main",
  });
  repoId = repo.id;
}, 30_000);

afterAll(async () => {
  await db.delete(aiPromptLogs).where(eq(aiPromptLogs.repositoryId, repoId));
  await queries.deleteRepository(repoId);
  await queries.deleteTeam(teamId);
}, 30_000);

describe("ai_prompt_logs schema — token-count finding", () => {
  it("has no inputTokens/outputTokens columns on either path (not an explorer-only gap)", async () => {
    const columns = Object.keys(aiPromptLogs);
    // Drizzle table objects expose their columns as own keys.
    expect(columns.some((c) => /token/i.test(c))).toBe(false);
  });
});

describe("Authoring AI — generate a test via AI", () => {
  it("a real (non-explorer) generateWithAI call writes a real ai_prompt_logs row (prompt, response, status, duration — no token fields)", async () => {
    const settings = await queries.getAISettings(repoId);
    const config = getAIConfig(settings);
    expect(config.provider).toBeTruthy();

    const prompt = `Write a Playwright visual regression test for ${TARGET}. It should navigate to the page, wait for the login form to be visible, and take one screenshot. Output only the code.`;

    const response = await generateWithAI(config, prompt, SYSTEM_PROMPT, {
      actionType: "create_test",
      repositoryId: repoId,
    });
    expect(typeof response).toBe("string");
    expect(response.length).toBeGreaterThan(0);

    const code = extractCodeFromResponse(response);
    expect(code).toBeTruthy();
    const validation = validateTestCode(code!);
    expect(validation.valid).toBe(true);

    // Persist it, same as the generator action would on success — proves
    // the generated code is usable, not just "AI said something".
    const test = await queries.createTest(
      {
        repositoryId: repoId,
        name: "ai-generated-login-test",
        code: code!,
        targetUrl: TARGET,
      },
      "main",
    );
    const stored = await queries.getTest(test.id);
    expect(stored?.code).toBe(code);

    const logs = await queries.getAIPromptLogs(repoId);
    const created = logs.find((l) => l.actionType === "create_test");
    expect(created).toBeTruthy();
    expect(created!.status).toBe("success");
    expect(created!.response).toBeTruthy();
    expect(created!.userPrompt).toContain(TARGET);
    expect(created!.durationMs).toBeGreaterThan(0);
    // The finding, checked against a real row rather than just the schema:
    expect("inputTokens" in created!).toBe(false);
    expect("outputTokens" in created!).toBe(false);
  }, 240_000);
});

describe("Authoring AI — heal a broken selector", () => {
  it("agentHealTestCore fixes a deliberately broken selector against a live EB and logs a real ai_prompt_logs row", async () => {
    await expect
      .poll(poolHeadroom, { timeout: 90_000, interval: 1_000 })
      .toBeGreaterThanOrEqual(1);

    const brokenCode = `export async function test(page, baseUrl, screenshotPath, stepLogger) {
  await stepLogger?.("open login");
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  // Deliberately wrong selector — the real field is #username.
  await page.locator("#this-field-does-not-exist-12345").fill("tomsmith");
  await page.screenshot({ path: screenshotPath });
}`;
    const test = await queries.createTest(
      {
        repositoryId: repoId,
        name: "broken-selector-test",
        code: brokenCode,
        targetUrl: TARGET,
      },
      "main",
    );
    await queries.createTestResult({
      testId: test.id,
      status: "failed",
      errorMessage:
        'locator.fill: Timeout 30000ms exceeded.\nwaiting for locator("#this-field-does-not-exist-12345")',
    });

    const eb = await claimEmbeddedBrowserForAgent(120_000);
    expect(eb).toBeTruthy();
    try {
      const result = await agentHealTestCore(repoId, test.id, {
        cdpEndpoint: eb!.cdpUrl,
      });

      expect(result.success).toBe(true);
      expect(result.code).toBeTruthy();
      // The healer must actually change something — the broken locator
      // must not survive into the "fixed" code.
      expect(result.code).not.toContain("this-field-does-not-exist-12345");

      const logs = await queries.getAIPromptLogs(repoId);
      const healLog = logs.find((l) => l.actionType === "agent_heal");
      expect(healLog).toBeTruthy();
      expect(healLog!.status).toBe("success");
      expect(healLog!.response).toBeTruthy();
      expect("inputTokens" in healLog!).toBe(false);
    } finally {
      await releasePoolEB(eb!.runnerId).catch(() => {});
    }

    const statusAfter = await getPoolStatus();
    if (statusAfter) {
      expect(statusAfter.size).toBeLessThanOrEqual(statusAfter.max);
    }
  }, 300_000);
});
