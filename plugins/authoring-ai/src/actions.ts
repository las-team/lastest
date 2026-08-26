import type { PluginContext } from "@lastest/contracts";

import { agentCreateTest as generatorCreateTest } from "./generator-agent";
import type { GeneratorContext } from "./generator-agent";
import { agentEnhanceTest as enhancerEnhanceTest } from "./enhancer-agent";
import {
  agentHealTest as healerHealTest,
  type HealOptions,
} from "./healer-agent";
import type { AuthoringAiHost, AuthoringAiIntelligence } from "./host";
import { authoringAiPlugin } from "./index";
import { mergePlannerResults } from "./planner-merger";
import {
  agentDiscoverAreas as plannerDiscoverAreas,
  runDeepDiveExploration as plannerRunDeepDive,
  runScoutClassification as plannerRunScout,
} from "./planner-agent";
import type { PlannerArea, PlannerResult, ScoutOutput } from "./planner-types";
import { runBrowserPlanner as runBrowserPlannerImpl } from "./planners/browser-planner";
import type { BrowserPlannerOptions } from "./planners/browser-planner";
import { runCodePlanner as runCodePlannerImpl } from "./planners/code-planner";
import { runRoutePlanner as runRoutePlannerImpl } from "./planners/route-planner";
import { runSpecPlanner as runSpecPlannerImpl } from "./planners/spec-planner";
import {
  groupScenariosForGeneration,
  parseScenariosFromPlan,
  type ScenarioGroup,
} from "./scenario-grouping";
import { authoringAiWiring } from "./wiring";

export {
  mergePlannerResults,
  parseScenariosFromPlan,
  groupScenariosForGeneration,
};
export type { GeneratorContext, HealOptions, ScenarioGroup };
export type { PlannerArea, PlannerResult, ScoutOutput };
export type { BrowserPlannerOptions };

type AuthoringAiCtx = PluginContext<"ai" | "browser">;

async function context(
  repositoryId?: string,
): Promise<{ ctx: AuthoringAiCtx; host: AuthoringAiHost }> {
  const { runtime, host } = authoringAiWiring();
  const ctx = await runtime.contextFor(authoringAiPlugin, { repositoryId });
  return { ctx, host };
}

/**
 * Hooks a caller can use to mirror an agent session's live state (an
 * "activity session" row with a queued/streaming UI) while the browser
 * claim underneath is handled entirely by `ctx.browser.withBrowser`.
 */
export interface BrowserClaimHooks {
  /** The claim is queued behind the pool cap. */
  onQueued?: () => void;
  /** The claim resolved — `streamUrl` is null when streaming is off. */
  onSessionReady?: (streamUrl: string | null) => void;
}

/**
 * Generate a test using the PW Generator agent. Claims its own Embedded
 * Browser for the duration of the call (core owns claim/release/teardown).
 */
export async function agentCreateTest(
  repositoryId: string,
  generatorContext: GeneratorContext,
  options?: { signal?: AbortSignal } & BrowserClaimHooks,
): Promise<{ success: boolean; code?: string; error?: string }> {
  const { ctx, host } = await context(repositoryId);
  try {
    return await ctx.browser.withBrowser(
      { purpose: "interactive", onQueued: options?.onQueued },
      (session) => {
        options?.onSessionReady?.(session.streamUrl);
        return generatorCreateTest(
          host,
          ctx.ai,
          session,
          repositoryId,
          generatorContext,
          { signal: options?.signal },
        );
      },
    );
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "No embedded browsers available — all browsers are busy.",
    };
  }
}

/** Heal a single failing test. Claims its own Embedded Browser. */
export async function agentHealTest(
  repositoryId: string,
  testId: string,
  options?: HealOptions & BrowserClaimHooks,
): Promise<{ success: boolean; code?: string; error?: string }> {
  const { ctx, host } = await context(repositoryId);
  try {
    return await ctx.browser.withBrowser(
      { purpose: "interactive", onQueued: options?.onQueued },
      (session) => {
        options?.onSessionReady?.(session.streamUrl);
        return healerHealTest(host, ctx.ai, session, repositoryId, testId, {
          signal: options?.signal,
          intent: options?.intent,
        });
      },
    );
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "No embedded browsers available — all browsers are busy.",
    };
  }
}

export interface AuthoringAiSession {
  readonly streamUrl: string | null;
  /** Whether a requested `storageStateId` actually applied to this session. */
  readonly authApplied: boolean;
  createTest(
    generatorContext: GeneratorContext,
    options?: { signal?: AbortSignal },
  ): Promise<{ success: boolean; code?: string; error?: string }>;
  healTest(
    testId: string,
    options?: HealOptions,
  ): Promise<{ success: boolean; code?: string; error?: string }>;
  enhanceTest(
    testId: string,
    userPrompt?: string,
  ): Promise<{ success: boolean; code?: string; error?: string }>;
}

/**
 * Claim ONE Embedded Browser and generate/heal/enhance multiple tests on it
 * sequentially — for callers that need several agent calls to share one live
 * view (and to not drain the pool one EB per test). `qa-agent`'s batch
 * generation step is the reason this exists: it used to claim a single EB by
 * hand and pass the same `cdpEndpoint` into every `agentCreateTest` call.
 */
export async function withAuthoringAiSession<T>(
  repositoryId: string,
  claimOptions:
    | ({ storageStateId?: string; deadlineMs?: number } & BrowserClaimHooks)
    | undefined,
  fn: (session: AuthoringAiSession) => Promise<T>,
): Promise<T> {
  const { ctx, host } = await context(repositoryId);
  return ctx.browser.withBrowser(
    {
      purpose: "interactive",
      storageStateId: claimOptions?.storageStateId,
      deadlineMs: claimOptions?.deadlineMs,
      onQueued: claimOptions?.onQueued,
    },
    (session) => {
      claimOptions?.onSessionReady?.(session.streamUrl);
      return fn({
        streamUrl: session.streamUrl,
        authApplied: session.authApplied,
        createTest: (generatorContext, options) =>
          generatorCreateTest(
            host,
            ctx.ai,
            session,
            repositoryId,
            generatorContext,
            options,
          ),
        healTest: (testId, options) =>
          healerHealTest(host, ctx.ai, session, repositoryId, testId, options),
        enhanceTest: (testId, userPrompt) =>
          enhancerEnhanceTest(
            host,
            ctx.ai,
            session,
            repositoryId,
            testId,
            userPrompt,
          ),
      });
    },
  );
}

/**
 * Heal multiple failing tests in bulk. Each concurrent heal claims its OWN
 * Embedded Browser — they navigate independently and cannot safely share
 * one browser session.
 */
export async function agentHealTests(
  testIds: string[],
  repositoryId: string,
): Promise<{
  success: boolean;
  fixed: number;
  failed: number;
  errors: string[];
}> {
  const { ctx, host } = await context(repositoryId);
  const branch = await host.getCurrentBranchForRepo(repositoryId);
  const errors: string[] = [];
  let fixed = 0;
  let failed = 0;

  const CONCURRENCY = 3;
  for (let i = 0; i < testIds.length; i += CONCURRENCY) {
    const batch = testIds.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (testId) => {
        let result: { success: boolean; code?: string; error?: string };
        try {
          result = await ctx.browser.withBrowser(
            { purpose: "interactive" },
            (session) =>
              healerHealTest(host, ctx.ai, session, repositoryId, testId),
          );
        } catch {
          return {
            testId,
            success: false,
            error: "No embedded browsers available — all browsers are busy.",
          };
        }
        if (result.success && result.code) {
          await host.updateTestCode(testId, result.code, branch ?? undefined);
          return { testId, success: true };
        }
        return { testId, success: false, error: result.error };
      }),
    );

    for (const r of results) {
      if (r.status === "fulfilled" && r.value.success) {
        fixed++;
      } else {
        failed++;
        const error =
          r.status === "fulfilled" ? r.value.error : r.reason?.message;
        errors.push(error || "Unknown error");
      }
    }
  }

  const { revalidatePath } = await import("next/cache");
  revalidatePath("/tests");
  return { success: true, fixed, failed, errors };
}

/** Enhance an existing test. Claims its own Embedded Browser. */
export async function agentEnhanceTest(
  repositoryId: string,
  testId: string,
  userPrompt?: string,
): Promise<{ success: boolean; code?: string; error?: string }> {
  const { ctx, host } = await context(repositoryId);
  try {
    return await ctx.browser.withBrowser(
      { purpose: "interactive" },
      (session) =>
        enhancerEnhanceTest(
          host,
          ctx.ai,
          session,
          repositoryId,
          testId,
          userPrompt,
        ),
    );
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "No embedded browsers available — all browsers are busy.",
    };
  }
}

/**
 * Discover functional areas via monolithic MCP exploration. Claims its own
 * Embedded Browser.
 */
export async function agentDiscoverAreas(
  repositoryId: string,
  baseUrl: string,
  options?: { onLogCreated?: (logId: string) => void },
): ReturnType<typeof plannerDiscoverAreas> {
  const { ctx, host } = await context(repositoryId);
  return ctx.browser.withBrowser({ purpose: "interactive" }, (session) =>
    plannerDiscoverAreas(host, ctx.ai, session, repositoryId, baseUrl, options),
  );
}

/** Fast, no-MCP classification of already-discovered areas. */
export async function runScoutClassification(
  repositoryId: string,
  otherPlannerAreas: PlannerArea[],
  options?: { onLogCreated?: (logId: string) => void },
): Promise<ScoutOutput> {
  const { ctx, host } = await context(repositoryId);
  return plannerRunScout(
    host,
    ctx.ai,
    repositoryId,
    otherPlannerAreas,
    options,
  );
}

/** Focused MCP exploration of one area. Claims its own Embedded Browser. */
export async function runDeepDiveExploration(
  areaName: string,
  routes: string[],
  focusPoints: string[] | undefined,
  repositoryId: string,
  baseUrl: string,
  options?: { onLogCreated?: (logId: string) => void },
): Promise<PlannerArea[]> {
  const { ctx, host } = await context(repositoryId);
  return ctx.browser.withBrowser({ purpose: "interactive" }, (session) =>
    plannerRunDeepDive(
      host,
      ctx.ai,
      session,
      areaName,
      routes,
      focusPoints,
      repositoryId,
      baseUrl,
      options,
    ),
  );
}

/** Known-routes DB grouping. No AI, no browser. */
export async function runRoutePlanner(
  repositoryId: string,
): Promise<PlannerResult> {
  const { host } = await context(repositoryId);
  return runRoutePlannerImpl(host, repositoryId);
}

/** Codebase route scan via the sideways `ai-routes.ts`. No browser. */
export async function runCodePlanner(
  repositoryId: string,
  branch: string,
  intelligence?: AuthoringAiIntelligence,
): Promise<PlannerResult> {
  const { host } = await context(repositoryId);
  return runCodePlannerImpl(host, repositoryId, branch, intelligence);
}

/** Spec/PRD file discovery via GitHub. No browser. */
export async function runSpecPlanner(
  repositoryId: string,
  branch: string,
): Promise<PlannerResult> {
  const { host } = await context(repositoryId);
  return runSpecPlannerImpl(host, repositoryId, branch);
}

/**
 * Scout + parallel Deep-Dive browser exploration. Each dive claims its own
 * Embedded Browser internally.
 */
export async function runBrowserPlanner(
  repositoryId: string,
  baseUrl: string,
  options?: BrowserPlannerOptions,
): Promise<PlannerResult> {
  const { ctx, host } = await context(repositoryId);
  return runBrowserPlannerImpl(
    host,
    ctx.ai,
    ctx.browser,
    repositoryId,
    baseUrl,
    options,
  );
}
