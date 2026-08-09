import type { BrowserSession, PluginContext } from "@lastest/contracts";

import { clusterFindings } from "./ai/analyst";
import { planScenarios } from "./ai/planner";
import { loginWithCredentials } from "./browser/login";
import type { ExplorerPage } from "./browser/page";
import { researchPage } from "./browser/research";
import { runScenariosConcurrent, SCENARIO_CONCURRENCY } from "./browser/tester";
import { orm } from "./data/db";
import * as q from "./data/queries";
import { extractFrontierLinks } from "./domain/frontier";
import { isKeepable, renderKeptTestCode } from "./domain/keep";
import {
  collectPageAutomation,
  pickKnowledgeCredentials,
  renderExperienceBlock,
  renderKnowledgeBlock,
} from "./domain/knowledge";
import { nextStyle } from "./domain/styles";
import { isStuck, MAX_SCENARIOS_PER_ITERATION } from "./domain/supervisor";
import type {
  ExplorerActivityEvent,
  ExplorerExistingAuth,
  ExplorerHost,
} from "./host";
import type { ExplorerSession } from "./schema";
import type {
  ExperienceNote,
  ExplorerActionLog,
  ExplorerAuthState,
  ExplorerScenario,
  ExplorerSessionMetadata,
  ExplorerStepId,
  ExplorerSubstep,
  ExplorerStepState,
} from "./types";

/**
 * The explorer step machine.
 *
 * ```
 *   explorer_setup      preflight (target URL, AI budget)
 *   explorer_login      resolve auth — existing storage state or credentials
 *   ── per iteration, inside ONE ctx.browser.withBrowser scope ──
 *   explorer_research   map the frontier page from the live DOM
 *   explorer_plan       scenarios in the rotating style
 *   explorer_act        AI-in-the-loop scenario execution
 *   explorer_analyze    findings + experience write-back
 *   ─────────────────────────────────────────────────────────────
 *   explorer_keep       passing flows → quarantined tests
 *   explorer_summary    root-cause clustering + report
 * ```
 *
 * ### The one structural change the migration forced
 *
 * The old driver ran one step per turn and claimed/released an EB across them
 * by hand: `claimSessionEb` at research, `releaseSessionEb` at analyze, plus a
 * `finally` and four `.catch(() => {})` calls covering the paths where that
 * pairing could be missed. `withBrowser` is a *scope*, not a pair of calls, so
 * the four loop steps now run inside one callback.
 *
 * That is strictly better and it is worth being precise about why: release no
 * longer depends on this file being correct. Pause, cancel, a thrown planner
 * error, a process signal, the plan's hold ceiling expiring — every one of them
 * unwinds the same scope, and the plugin never held the runner id that release
 * needs. The bookkeeping that used to guarantee it is simply deleted.
 *
 * What it costs: resume granularity. A restart mid-iteration now re-runs that
 * iteration's research rather than resuming at the exact step. Iterations are
 * idempotent by design — research re-reads the page, the frontier is
 * persisted — so the cost is one repeated page map, and the browser it would
 * have resumed onto was gone anyway.
 */

const STEP_DEFINITIONS: Record<
  ExplorerStepId,
  { label: string; description: string }
> = {
  explorer_setup: {
    label: "Preflight",
    description: "Validate target URL and AI budget",
  },
  explorer_login: {
    label: "Login",
    description: "Resolve authentication — existing setup or credentials",
  },
  explorer_research: {
    label: "Research",
    description: "Map the current page's rendered DOM",
  },
  explorer_plan: {
    label: "Plan",
    description: "Draft exploratory scenarios in the iteration's style",
  },
  explorer_act: {
    label: "Act",
    description: "Drive the browser through each scenario, adapting live",
  },
  explorer_analyze: {
    label: "Analyze",
    description: "Record findings and write back learned experience",
  },
  explorer_keep: {
    label: "Keep",
    description: "Save passing flows as quarantined tests",
  },
  explorer_summary: {
    label: "Summary",
    description: "Cluster findings by root cause and write the report",
  },
};

const LOOP_STEP_IDS: ExplorerStepId[] = [
  "explorer_research",
  "explorer_plan",
  "explorer_act",
  "explorer_analyze",
];

export const MAX_ITERATIONS_CAP = 12;
export const DEFAULT_MAX_ITERATIONS = 4;

/**
 * Wall-clock budget for one iteration's browser hold.
 *
 * Core clamps this down to the plan's ceiling (`MAX_HOLD_MS`) and tears the
 * session down when it expires, so this is a request, not a guarantee — which
 * is the point. A plugin cannot hold shared capacity by passing a bigger number.
 */
const ITERATION_DEADLINE_MS = 12 * 60_000;

export type ExplorerContext = PluginContext<
  "browser" | "ai" | "data" | "events" | "tests" | "repos"
>;

/** In-flight pipelines, so pause/cancel can interrupt a detached run. */
const activeControllers = new Map<string, AbortController>();

function getOrCreateController(sessionId: string): AbortController {
  let controller = activeControllers.get(sessionId);
  if (!controller || controller.signal.aborted) {
    controller = new AbortController();
    activeControllers.set(sessionId, controller);
  }
  return controller;
}

export function abortSession(sessionId: string): void {
  activeControllers.get(sessionId)?.abort();
}

export function buildSteps(maxIterations: number): ExplorerStepState[] {
  const entry = (
    id: ExplorerStepId,
    iteration?: number,
  ): ExplorerStepState => ({
    id,
    status: "pending",
    label: STEP_DEFINITIONS[id].label,
    description: STEP_DEFINITIONS[id].description,
    ...(iteration === undefined ? {} : { iteration }),
  });

  const steps: ExplorerStepState[] = [
    { ...entry("explorer_setup"), status: "active" },
    entry("explorer_login"),
  ];
  for (let i = 0; i < maxIterations; i++) {
    for (const id of LOOP_STEP_IDS) steps.push(entry(id, i));
  }
  steps.push(entry("explorer_keep"), entry("explorer_summary"));
  return steps;
}

// ── the driver ───────────────────────────────────────────────────────────────

/**
 * One run, start to finish.
 *
 * Detached: the caller starts it and returns a session id, the UI polls. Every
 * step persists its own outcome, so a crash leaves a readable session rather
 * than a hung spinner.
 */
export async function runPipeline(
  ctx: ExplorerContext,
  host: ExplorerHost,
  sessionId: string,
): Promise<void> {
  const db = { db: orm(ctx.data), host };
  const controller = getOrCreateController(sessionId);
  const signal = controller.signal;
  const teamId = ctx.team.id;

  // `repositoryId` is kept as a parameter for readability at each call site
  // even though it is no longer sent: `ctx.events.emit` attributes the event
  // to `ctx.repo.id` itself, taken from the resolved scope rather than from
  // anything the plugin says (`core-scope.md` §6's tenancy argument, applied
  // to the events provider).
  const emit = (
    _repositoryId: string,
    type: ExplorerActivityEvent["type"],
    summary: string,
    extra: Partial<Omit<ExplorerActivityEvent, "type" | "summary">> = {},
  ) => ctx.events.emit(type, { sessionId, summary, ...extra });

  const load = () => q.getSession(db, sessionId);

  const patchStep = async (
    index: number,
    update: Partial<ExplorerStepState>,
  ): Promise<void> => {
    const session = await load();
    if (!session?.steps[index]) return;
    const steps = [...session.steps];
    steps[index] = { ...steps[index], ...update };
    await q.updateSession(db, sessionId, {
      steps,
      ...(update.status === "active" ? { currentStepId: steps[index].id } : {}),
    });
  };

  const mergeMeta = async (
    patch: Partial<ExplorerSessionMetadata>,
  ): Promise<void> => {
    const session = await load();
    if (!session) return;
    await q.updateSession(db, sessionId, {
      metadata: { ...session.metadata, ...patch },
    });
  };

  const failStep = async (index: number, error: string): Promise<void> => {
    await patchStep(index, {
      status: "failed",
      completedAt: new Date().toISOString(),
      error,
    });
    await q.updateSession(db, sessionId, {
      status: "failed",
      completedAt: new Date(),
    });
  };

  /** Cancelled or paused from the UI, or aborted in-process. */
  const stopped = async (): Promise<boolean> => {
    if (signal.aborted) return true;
    const session = await load();
    if (!session) return true;
    if (session.status === "cancelled" || session.status === "paused") {
      controller.abort();
      return true;
    }
    return false;
  };

  /** Skip every remaining loop step so the run falls through to keep/summary. */
  const skipRemainingLoopSteps = async (reason: string): Promise<void> => {
    const session = await load();
    if (!session) return;
    await q.updateSession(db, sessionId, {
      steps: session.steps.map((s) =>
        LOOP_STEP_IDS.includes(s.id) && s.status === "pending"
          ? {
              ...s,
              status: "skipped" as const,
              completedAt: new Date().toISOString(),
              result: { reason },
            }
          : s,
      ),
    });
  };

  const indexOfStep = (
    session: ExplorerSession,
    id: ExplorerStepId,
    iteration: number,
  ): number =>
    session.steps.findIndex(
      (s) => s.id === id && (s.iteration ?? 0) === iteration,
    );

  // ── steps ─────────────────────────────────────────────────────────────────

  async function runSetup(
    index: number,
    repositoryId: string,
  ): Promise<boolean> {
    await patchStep(index, {
      status: "active",
      startedAt: new Date().toISOString(),
      error: undefined,
    });
    emit(repositoryId, "step:start", "Preflight", { stepId: "explorer_setup" });

    const session = await load();
    if (!session) return false;
    if (!session.metadata.targetUrl) {
      await failStep(index, "No target URL configured");
      return false;
    }

    // Entitlement, not a plan string: the plugin asks whether AI is available
    // and core owns the mapping from plan to answer.
    const budget = await ctx.ai.budget();
    if (!budget.enabled) {
      await failStep(
        index,
        "AI is not available for this team — the explorer cannot plan or drive without it",
      );
      return false;
    }

    await patchStep(index, {
      status: "completed",
      completedAt: new Date().toISOString(),
      result: {
        targetUrl: session.metadata.targetUrl,
        maxIterations: session.metadata.maxIterations,
        styleRotation: (session.metadata.styleRotation ?? []).join(","),
      },
    });
    emit(
      repositoryId,
      "step:complete",
      `Preflight OK — budget: ${session.metadata.maxIterations} iterations`,
      { stepId: "explorer_setup" },
    );
    return true;
  }

  async function runLogin(
    index: number,
    repositoryId: string,
  ): Promise<boolean> {
    await patchStep(index, {
      status: "active",
      startedAt: new Date().toISOString(),
      error: undefined,
    });
    emit(repositoryId, "step:start", "Resolving authentication", {
      stepId: "explorer_login",
    });

    const session = await load();
    if (!session?.metadata.targetUrl) return false;

    // Credentials come from the start form or from a matched knowledge note.
    // The form wins — an operator typing them now means more than a note
    // somebody saved a month ago.
    let credentials =
      session.metadata.credsProvided &&
      session.metadata.email &&
      session.metadata.password
        ? { email: session.metadata.email, password: session.metadata.password }
        : undefined;

    if (!credentials) {
      const notes = await q
        .matchKnowledgeForUrl(db, repositoryId, session.metadata.targetUrl)
        .catch(() => []);
      const fromKnowledge = pickKnowledgeCredentials(notes);
      if (fromKnowledge?.password) {
        credentials = fromKnowledge;
        await mergeMeta({
          credsProvided: true,
          email: fromKnowledge.email,
          password: fromKnowledge.password,
        });
      }
    }

    const existing: ExplorerExistingAuth = await host
      .resolveExistingAuth(repositoryId)
      .catch(() => ({ defaultSetupInUse: false }));

    let auth: ExplorerAuthState;
    if (existing.storageStateId) {
      auth = {
        strategy: "existing_setup",
        validated: false,
        storageStateId: existing.storageStateId,
        setupTestId: existing.setupTestId,
        defaultSetupInUse: existing.defaultSetupInUse,
        notes: "Core injects the stored session into each iteration's browser",
      };
    } else if (credentials) {
      auth = {
        strategy: "creds_untested",
        validated: false,
        notes: "Live login performed on each iteration's browser",
      };
    } else {
      auth = {
        strategy: "public_only",
        validated: false,
        notes: "No credentials or setup — exploring the public surface",
      };
    }

    await mergeMeta({ auth });
    await patchStep(index, {
      status: "completed",
      completedAt: new Date().toISOString(),
      result: { strategy: auth.strategy },
    });
    emit(
      repositoryId,
      "step:complete",
      `Auth resolved: ${auth.strategy.replace(/_/g, " ")}`,
      { stepId: "explorer_login" },
    );
    return true;
  }

  /**
   * One research → plan → act → analyze iteration, inside one browser scope.
   *
   * Returns false only when the run should stop entirely; a failed iteration
   * that leaves later ones worth attempting returns true.
   */
  async function runIteration(
    repositoryId: string,
    iteration: number,
  ): Promise<boolean> {
    const session = await load();
    if (!session?.metadata.targetUrl) return false;
    const meta = session.metadata;
    const targetRoot = meta.targetUrl!;

    const researchIndex = indexOfStep(session, "explorer_research", iteration);
    const planIndex = indexOfStep(session, "explorer_plan", iteration);
    const actIndex = indexOfStep(session, "explorer_act", iteration);
    const analyzeIndex = indexOfStep(session, "explorer_analyze", iteration);

    // Stuck check before the claim: an exploration going in circles must not
    // occupy a pool slot to discover that.
    const history = meta.stateHistory ?? [];
    if (isStuck(history)) {
      const reason = "loop detected — same page state repeating";
      await mergeMeta({ stuck: true });
      await patchStep(researchIndex, {
        status: "skipped",
        completedAt: new Date().toISOString(),
        result: { reason },
      });
      await skipRemainingLoopSteps(reason);
      emit(
        repositoryId,
        "step:complete",
        "Exploration stopped early: the loop kept landing on the same page state",
        { stepId: "explorer_research" },
      );
      return true;
    }

    const frontier = [...(meta.frontier ?? [])];
    const targetUrl =
      iteration === 0 ? targetRoot : (frontier.shift() ?? targetRoot);

    await patchStep(researchIndex, {
      status: "active",
      startedAt: new Date().toISOString(),
      error: undefined,
    });
    emit(
      repositoryId,
      "step:start",
      `Iteration ${iteration + 1}: researching ${targetUrl}`,
      { stepId: "explorer_research" },
    );

    return ctx.browser.withBrowser(
      {
        purpose: "interactive",
        deadlineMs: ITERATION_DEADLINE_MS,
        // The plugin passes an id. Core resolves and injects the credential
        // material; explorer never holds it and never could.
        storageStateId: meta.auth?.storageStateId,
        onQueued: () => {
          void mergeMeta({ queuedForBrowser: true }).catch(() => {});
        },
      },
      async (browserSession) => {
        await mergeMeta({
          queuedForBrowser: false,
          streamUrl: browserSession.streamUrl ?? undefined,
        });
        try {
          return await runIterationOnBrowser(
            browserSession,
            repositoryId,
            iteration,
            targetUrl,
            targetRoot,
            frontier,
            { researchIndex, planIndex, actIndex, analyzeIndex },
          );
        } finally {
          // The grant dies with the scope; leaving it in metadata would show
          // the UI a live-view button that cannot connect.
          await mergeMeta({ streamUrl: undefined }).catch(() => {});
        }
      },
    );
  }

  async function runIterationOnBrowser(
    browserSession: BrowserSession,
    repositoryId: string,
    iteration: number,
    targetUrl: string,
    targetRoot: string,
    frontier: string[],
    idx: {
      researchIndex: number;
      planIndex: number;
      actIndex: number;
      analyzeIndex: number;
    },
  ): Promise<boolean> {
    const page = browserSession.page as ExplorerPage;
    let session = await load();
    if (!session) return false;
    let meta = session.metadata;

    // ── credential login, when that is the resolved strategy ────────────────
    if (
      meta.auth?.strategy === "creds_untested" &&
      meta.credsProvided &&
      meta.email &&
      meta.password
    ) {
      const attempt = await loginWithCredentials({
        page,
        targetUrl: targetRoot,
        loginUrl: meta.auth.loginUrl,
        credentials: { email: meta.email, password: meta.password },
      });
      if (!attempt.ok) {
        // Degrading to the public surface is the established behaviour and is
        // usually still useful, but it must be visible rather than silent.
        ctx.log.warn(
          { sessionId, detail: attempt.detail },
          "explorer credential login failed — continuing unauthenticated",
        );
      }
    }

    // ── research ────────────────────────────────────────────────────────────
    let research;
    try {
      research = await researchPage(page, targetUrl);
    } catch (err) {
      await failStep(
        idx.researchIndex,
        `Research failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }

    const visited = new Set(meta.visitedUrls ?? []);
    visited.add(research.normalizedUrl);
    const baseOrigin = new URL(targetRoot).origin;
    const newLinks = extractFrontierLinks(
      research.pageMap,
      baseOrigin,
      visited,
    );
    const mergedFrontier = Array.from(
      new Set([...frontier, ...newLinks]),
    ).slice(0, 30);

    await mergeMeta({
      pageMap: research.pageMap,
      currentState: {
        hash: research.stateHash,
        url: research.pageMap.finalUrl || targetUrl,
        headings: research.headings,
      },
      stateHistory: [...(meta.stateHistory ?? []), research.stateHash].slice(
        -20,
      ),
      frontier: mergedFrontier,
      visitedUrls: Array.from(visited).slice(-60),
    });

    await q
      .recordExperience(db, {
        repositoryId,
        teamId,
        stateHash: research.stateHash,
        normalizedUrl: research.normalizedUrl,
        headingsDigest: research.headingsDigest,
        sessionId,
      })
      .catch((err) =>
        ctx.log.warn({ err }, "explorer experience record failed"),
      );

    await patchStep(idx.researchIndex, {
      status: "completed",
      completedAt: new Date().toISOString(),
      result: {
        url: research.pageMap.finalUrl || targetUrl,
        stateHash: research.stateHash,
        forms: research.pageMap.forms.length,
        buttons: research.pageMap.buttons.length,
        links: research.pageMap.links.length,
        frontierSize: mergedFrontier.length,
      },
    });
    emit(
      repositoryId,
      "step:complete",
      `Mapped ${research.pageMap.finalUrl || targetUrl}: ${research.pageMap.forms.length} forms, ${research.pageMap.buttons.length} buttons`,
      { stepId: "explorer_research" },
    );

    if (await stopped()) return false;

    // ── plan ────────────────────────────────────────────────────────────────
    session = await load();
    if (!session) return false;
    meta = session.metadata;
    const state = meta.currentState!;
    const style = nextStyle(meta.styleRotation, iteration);

    await patchStep(idx.planIndex, {
      status: "active",
      startedAt: new Date().toISOString(),
      error: undefined,
    });
    emit(
      repositoryId,
      "step:start",
      `Iteration ${iteration + 1}: planning (${style} style)`,
      { stepId: "explorer_plan" },
    );

    const [knowledge, experience, coverage, knownFindings] = await Promise.all([
      q.matchKnowledgeForUrl(db, repositoryId, state.url).catch(() => []),
      q
        .listExperienceByStates(db, repositoryId, meta.stateHistory ?? [])
        .catch(() => []),
      ctx.tests
        .listCoverage(repositoryId)
        .catch(() => ({ tests: [], areaPlans: [] })),
      // Explorer's own findings — no longer a core read, just its own table.
      q.listFindingsByRepo(db, repositoryId, { limit: 40 }).catch(() => []),
    ]);

    const priorTitles = Object.values(meta.actionLogs ?? {})
      .map((l) => l.scenarioId)
      .concat((meta.currentPlan ?? []).map((s) => s.title));

    let scenarios: ExplorerScenario[];
    try {
      scenarios = await planScenarios(ctx.ai, {
        pageMap: research.pageMap,
        style,
        iteration,
        knowledgeBlock: renderKnowledgeBlock(knowledge),
        experienceBlock: renderExperienceBlock(experience),
        coverageDigest: renderCoverage(coverage, knownFindings),
        priorScenarioTitles: priorTitles,
        repositoryId,
        signal,
      });
    } catch (err) {
      await failStep(
        idx.planIndex,
        `Planner failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }

    if (scenarios.length === 0) {
      // Nothing new to try here — close out the iteration cleanly rather than
      // holding the browser through an act step with no work.
      await patchStep(idx.planIndex, {
        status: "completed",
        completedAt: new Date().toISOString(),
        result: { scenarios: 0, style, note: "nothing new to plan here" },
      });
      await patchStep(idx.actIndex, {
        status: "skipped",
        completedAt: new Date().toISOString(),
        result: { reason: "no scenarios planned" },
      });
      await mergeMeta({ currentPlan: [] });
      emit(
        repositoryId,
        "step:complete",
        `Iteration ${iteration + 1}: no new scenarios on this page`,
        { stepId: "explorer_plan" },
      );
      return finishIteration(repositoryId, iteration, idx.analyzeIndex);
    }

    await mergeMeta({ currentPlan: scenarios });
    await patchStep(idx.planIndex, {
      status: "completed",
      completedAt: new Date().toISOString(),
      result: {
        scenarios: scenarios.length,
        style,
        titles: scenarios.map((s) => s.title),
      },
    });
    emit(
      repositoryId,
      "step:complete",
      `Iteration ${iteration + 1}: ${scenarios.length} ${style} scenarios drafted`,
      { stepId: "explorer_plan" },
    );

    if (await stopped()) return false;

    // ── act ─────────────────────────────────────────────────────────────────
    await runAct(
      browserSession,
      repositoryId,
      iteration,
      idx.actIndex,
      scenarios.filter((s) => !s.skipped),
      state,
      knowledge,
    );

    // ── analyze ─────────────────────────────────────────────────────────────
    return finishIteration(repositoryId, iteration, idx.analyzeIndex);
  }

  async function runAct(
    browserSession: BrowserSession,
    repositoryId: string,
    iteration: number,
    stepIndex: number,
    scenarios: ExplorerScenario[],
    state: { hash: string; url: string },
    knowledge: Awaited<ReturnType<typeof q.matchKnowledgeForUrl>>,
  ): Promise<void> {
    await patchStep(stepIndex, {
      status: "active",
      startedAt: new Date().toISOString(),
      error: undefined,
    });
    emit(
      repositoryId,
      "step:start",
      `Iteration ${iteration + 1}: executing ${scenarios.length} scenarios`,
      { stepId: "explorer_act" },
    );

    const session = await load();
    if (!session) return;
    const capped = scenarios.slice(0, MAX_SCENARIOS_PER_ITERATION);
    const knowledgeBlock = renderKnowledgeBlock(knowledge);
    const pageAutomation = collectPageAutomation(knowledge);

    const substeps: ExplorerSubstep[] = capped.map((s) => ({
      label: s.title,
      status: "running",
      agent: "explorer",
    }));
    await patchStep(stepIndex, { substeps: [...substeps] });

    const logs: Record<string, ExplorerActionLog> = {
      ...(session.metadata.actionLogs ?? {}),
    };
    const findingIds: string[] = [...(session.metadata.findingIds ?? [])];
    const startedAt = Date.now();
    let passed = 0;
    let failed = 0;

    // Scenarios execute concurrently — the AI round-trips dominate — but the
    // bookkeeping below is serialized on one chain, because the substeps array
    // and the session metadata are both read-modify-write.
    let writeChain: Promise<void> = Promise.resolve();

    await runScenariosConcurrent(
      ctx.ai,
      browserSession,
      capped.map((scenario) => ({
        scenario,
        targetUrl: state.url,
        repositoryId,
        knowledgeBlock,
        pageAutomation,
        signal,
      })),
      {
        concurrency: SCENARIO_CONCURRENCY,
        signal,
        onComplete: (log, i) => {
          writeChain = writeChain.then(async () => {
            const scenario = capped[i];
            logs[scenario.id] = log;

            if (log.status === "failed") {
              failed++;
              const finding = await q
                .createFinding(db, {
                  repositoryId,
                  teamId,
                  sessionId,
                  kind: "defect",
                  // A `psycho`-style scenario is *trying* to break things, so a
                  // failure there is weaker evidence of a real defect than the
                  // same failure on a normal user flow.
                  severity: scenario.style === "psycho" ? "medium" : "high",
                  title: `${scenario.title} — ${log.summary?.slice(0, 100) ?? "failed"}`,
                  description: [
                    `Scenario (${scenario.style}): ${scenario.title}`,
                    scenario.expectedOutcome
                      ? `Expected: ${scenario.expectedOutcome}`
                      : null,
                    `Observed: ${log.summary ?? "the flow failed"}`,
                    `Final URL: ${log.finalUrl ?? state.url}`,
                  ]
                    .filter(Boolean)
                    .join("\n"),
                  pageStateHash: log.finalStateHash ?? state.hash,
                  url: log.finalUrl ?? state.url,
                  scenario,
                  evidence: {
                    consoleErrors: log.consoleErrors,
                    failedRequests: log.failedRequests,
                    actionSteps: log.steps.slice(-8),
                  },
                  status: "open",
                })
                .catch(() => null);
              if (finding) {
                findingIds.push(finding.id);
                emit(
                  repositoryId,
                  "substep:update",
                  `Finding: ${finding.title}`,
                  {
                    stepId: "explorer_act",
                    detail: { findingId: finding.id },
                  },
                );
              }
            } else if (
              log.status === "passed" &&
              ((log.consoleErrors?.length ?? 0) > 0 ||
                (log.failedRequests?.length ?? 0) > 0)
            ) {
              passed++;
              const finding = await q
                .createFinding(db, {
                  repositoryId,
                  teamId,
                  sessionId,
                  kind: "defect",
                  severity: "low",
                  title: `Console/network errors during "${scenario.title}"`,
                  description: [
                    "The scenario passed, but the app surfaced errors while it ran.",
                    log.consoleErrors?.length
                      ? `Console: ${log.consoleErrors.slice(0, 5).join(" | ")}`
                      : null,
                    log.failedRequests?.length
                      ? `Failed requests: ${log.failedRequests
                          .slice(0, 5)
                          .map((r) => `${r.method} ${r.url} → ${r.status}`)
                          .join(" | ")}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join("\n"),
                  pageStateHash: log.finalStateHash ?? state.hash,
                  url: log.finalUrl ?? state.url,
                  scenario,
                  evidence: {
                    consoleErrors: log.consoleErrors,
                    failedRequests: log.failedRequests,
                  },
                  status: "open",
                })
                .catch(() => null);
              if (finding) findingIds.push(finding.id);
            } else if (log.status === "passed") {
              passed++;
            }

            substeps[i] = {
              ...substeps[i],
              status: log.status === "passed" ? "done" : "error",
              detail: `${log.status}${log.summary ? ` — ${log.summary.slice(0, 120)}` : ""}`,
            };
            await patchStep(stepIndex, { substeps: [...substeps] });
            await mergeMeta({ actionLogs: logs, findingIds });
          });
          return writeChain;
        },
      },
    );

    await patchStep(stepIndex, {
      status: "completed",
      completedAt: new Date().toISOString(),
      result: {
        executed: capped.length,
        passed,
        failed,
        durationMs: Date.now() - startedAt,
        concurrency: Math.min(SCENARIO_CONCURRENCY, capped.length),
      },
    });
    emit(
      repositoryId,
      "step:complete",
      `Iteration ${iteration + 1}: ${passed} passed, ${failed} failed`,
      { stepId: "explorer_act" },
    );
  }

  /** Experience write-back + cursor advance. Runs whether or not act did. */
  async function finishIteration(
    repositoryId: string,
    iteration: number,
    stepIndex: number,
  ): Promise<boolean> {
    await patchStep(stepIndex, {
      status: "active",
      startedAt: new Date().toISOString(),
      error: undefined,
    });
    const session = await load();
    if (!session) return false;
    const meta = session.metadata;
    const state = meta.currentState;
    const logs = meta.actionLogs ?? {};

    if (state) {
      const notes: ExperienceNote[] = [];
      for (const scenario of meta.currentPlan ?? []) {
        const log = logs[scenario.id];
        if (!log) continue;
        const at = new Date().toISOString();
        if (log.status === "passed") {
          notes.push({
            kind: "resolution",
            text: `"${scenario.title}" works${log.summary ? `: ${log.summary.slice(0, 160)}` : ""}`,
            scenarioStyle: scenario.style,
            sessionId,
            at,
          });
        } else if (log.status === "failed") {
          notes.push({
            kind: "failure",
            text: `"${scenario.title}" fails${log.summary ? `: ${log.summary.slice(0, 160)}` : ""}`,
            scenarioStyle: scenario.style,
            sessionId,
            at,
          });
        } else if (log.status === "stuck") {
          notes.push({
            kind: "observation",
            text: `"${scenario.title}" got stuck — avoid this approach`,
            scenarioStyle: scenario.style,
            sessionId,
            at,
          });
        }
      }
      if (notes.length > 0) {
        await q
          .appendExperienceNotes(db, repositoryId, state.hash, notes)
          .catch((err) =>
            ctx.log.warn({ err }, "explorer experience write-back failed"),
          );
      }
    }

    await mergeMeta({ iteration: iteration + 1, currentPlan: [] });
    await patchStep(stepIndex, {
      status: "completed",
      completedAt: new Date().toISOString(),
      result: {
        iteration: iteration + 1,
        findingsSoFar: (meta.findingIds ?? []).length,
      },
    });
    emit(repositoryId, "step:complete", `Iteration ${iteration + 1} complete`, {
      stepId: "explorer_analyze",
    });
    return true;
  }

  async function runKeep(
    index: number,
    repositoryId: string,
  ): Promise<boolean> {
    await patchStep(index, {
      status: "active",
      startedAt: new Date().toISOString(),
      error: undefined,
    });
    const session = await load();
    if (!session?.metadata.targetUrl) return false;
    const meta = session.metadata;
    const logs = meta.actionLogs ?? {};

    // The authoritative copy of each executed scenario travels on its finding
    // or on the current plan, so both are consulted.
    const scenarios = new Map<string, ExplorerScenario>();
    for (const f of await q
      .listFindingsBySession(db, sessionId)
      .catch(() => [])) {
      if (f.scenario) scenarios.set(f.scenario.id, f.scenario);
    }
    for (const s of meta.currentPlan ?? []) scenarios.set(s.id, s);

    const keepable = Object.values(logs).filter(isKeepable);
    if (keepable.length === 0) {
      await patchStep(index, {
        status: "completed",
        completedAt: new Date().toISOString(),
        result: { kept: 0, note: "no passing flows worth keeping" },
      });
      return true;
    }

    const keptIds: string[] = [];
    for (const log of keepable) {
      const scenario = scenarios.get(log.scenarioId);
      if (!scenario) continue;
      try {
        const test = await ctx.tests.createQuarantined({
          repositoryId,
          areaName: "Explorer",
          name: `Explorer: ${scenario.title.slice(0, 120)}`,
          code: renderKeptTestCode(
            scenario,
            log,
            log.finalUrl ?? meta.targetUrl!,
          ),
          targetUrl: meta.targetUrl!,
        });
        keptIds.push(test.id);
        emit(repositoryId, "artifact:created", `Kept test: ${scenario.title}`, {
          stepId: "explorer_keep",
          artifact: { type: "test", id: test.id, label: scenario.title },
        });
      } catch (err) {
        ctx.log.warn({ err }, "explorer keep failed for scenario");
      }
    }

    await mergeMeta({ keptTestIds: keptIds });
    await patchStep(index, {
      status: "completed",
      completedAt: new Date().toISOString(),
      result: { kept: keptIds.length },
    });
    emit(
      repositoryId,
      "step:complete",
      `Kept ${keptIds.length} passing flows as quarantined tests`,
      { stepId: "explorer_keep" },
    );
    return true;
  }

  async function runSummary(
    index: number,
    repositoryId: string,
  ): Promise<boolean> {
    await patchStep(index, {
      status: "active",
      startedAt: new Date().toISOString(),
      error: undefined,
    });
    const session = await load();
    if (!session) return false;
    const meta = session.metadata;

    emit(repositoryId, "step:start", "Clustering findings by root cause", {
      stepId: "explorer_summary",
    });

    const findings = await q
      .listFindingsBySession(db, sessionId)
      .catch(() => []);
    const report = await clusterFindings(ctx.ai, {
      findings,
      iterationsRun: meta.iteration ?? 0,
      repositoryId,
      signal,
    });

    for (const cluster of report.clusters) {
      await q
        .updateFindingCluster(db, cluster.findingIds, {
          rootCauseCluster: cluster.rootCause,
          severity: cluster.severity,
          kind: cluster.kind,
        })
        .catch(() => {});
    }

    await mergeMeta({ report });
    await patchStep(index, {
      status: "completed",
      completedAt: new Date().toISOString(),
      result: {
        findings: report.totalFindings,
        clusters: report.clusters.length,
        iterations: report.iterationsRun,
        kept: (meta.keptTestIds ?? []).length,
      },
    });
    await q.updateSession(db, sessionId, {
      status: "completed",
      completedAt: new Date(),
    });
    emit(
      repositoryId,
      "session:complete",
      `Exploration complete: ${report.totalFindings} findings in ${report.clusters.length} clusters across ${report.iterationsRun} iterations`,
    );
    return true;
  }

  // ── driver loop ───────────────────────────────────────────────────────────

  const initial = await load();
  if (!initial) return;
  const repositoryId = initial.repositoryId;

  try {
    for (;;) {
      if (await stopped()) return;
      const session = await load();
      if (!session) return;

      // Resume-safe: always take the first unresolved step entry.
      const index = session.steps.findIndex(
        (s) => s.status === "pending" || s.status === "active",
      );
      if (index === -1) return;
      const step = session.steps[index];

      let ok: boolean;
      switch (step.id) {
        case "explorer_setup":
          ok = await runSetup(index, repositoryId);
          break;
        case "explorer_login":
          ok = await runLogin(index, repositoryId);
          break;
        case "explorer_research":
        case "explorer_plan":
        case "explorer_act":
        case "explorer_analyze":
          // Any of the four entering means the whole iteration runs: they share
          // one browser scope and cannot be entered independently.
          ok = await runIteration(repositoryId, step.iteration ?? 0);
          break;
        case "explorer_keep":
          ok = await runKeep(index, repositoryId);
          break;
        case "explorer_summary":
          ok = await runSummary(index, repositoryId);
          break;
        default:
          await failStep(index, `Unknown step ${step.id}`);
          return;
      }
      if (!ok) return;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.log.error({ err, sessionId }, "explorer pipeline error");
    const session = await load().catch(() => undefined);
    const index = session?.steps.findIndex((s) => s.status === "active") ?? -1;
    if (index !== -1) {
      await failStep(index, msg).catch(() => {});
    } else {
      await q
        .updateSession(db, sessionId, {
          status: "failed",
          completedAt: new Date(),
        })
        .catch(() => {});
    }
    emit(repositoryId, "session:error", `Explorer failed: ${msg}`);
  } finally {
    activeControllers.delete(sessionId);
  }
}

/** Coverage digest for the planner prompt. Names and titles only, hard-capped. */
function renderCoverage(
  coverage: {
    tests: readonly { name: string; targetUrl: string | null }[];
    areaPlans: readonly { name: string; plan: string }[];
  },
  knownFindings: Array<{ severity: string; title: string; url: string | null }>,
): string {
  const sections: string[] = [];
  if (coverage.tests.length > 0) {
    sections.push(
      `EXISTING TESTS (${coverage.tests.length} total — do not re-plan these flows):\n` +
        coverage.tests
          .slice(0, 60)
          .map((t) => `- ${t.name}${t.targetUrl ? ` (${t.targetUrl})` : ""}`)
          .join("\n"),
    );
  }
  if (knownFindings.length > 0) {
    sections.push(
      `KNOWN FINDINGS (already reported — do not re-discover):\n` +
        knownFindings
          .map(
            (f) => `- [${f.severity}] ${f.title}${f.url ? ` @ ${f.url}` : ""}`,
          )
          .join("\n"),
    );
  }

  if (coverage.areaPlans.length > 0) {
    sections.push(
      `AREA TEST PLANS (existing intent):\n` +
        coverage.areaPlans
          .slice(0, 12)
          .map((a) => `- ${a.name}: ${a.plan.slice(0, 200)}`)
          .join("\n"),
    );
  }
  return sections.join("\n\n") || "(no existing coverage)";
}
