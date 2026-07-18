"use server";

import { revalidatePath } from "next/cache";
import * as queries from "@/lib/db/queries";
import { requireRepoAccess, requireTeamAccess } from "@/lib/auth";
import { assertQaAgentAccess } from "@/lib/billing/feature-access";
import { getNextRunTime, isValidCron } from "@/lib/scheduling/cron";
import {
  assertSafeOutboundUrl,
  SsrfBlockedError,
} from "@/lib/security/outbound-url";
import { emitAndPersistActivityEvent } from "@/lib/db/queries/activity-events";
import { claimEmbeddedBrowserForAgent } from "./ai";
import { releasePoolEB } from "./embedded-sessions";
import { toProxyStreamUrl } from "@/lib/eb/stream-url";
import { appendStreamToken } from "@/lib/eb/stream-token";
import { injectStorageStateIntoEb } from "@/lib/eb/inject-storage-state";
import {
  findExistingAuthSetup,
  loginWithCredsOnEb,
  type ExistingAuthSetup,
} from "@/lib/qa-agent/auth";
import {
  researchPage,
  extractFrontierLinks,
  type ResearchResult,
} from "@/lib/explorer/research";
import { planScenarios } from "@/lib/explorer/planner";
import {
  runScenariosConcurrent,
  SCENARIO_CONCURRENCY,
} from "@/lib/explorer/tester";
import { clusterFindings } from "@/lib/explorer/analyst";
import { buildCoverageDigest } from "@/lib/explorer/coverage";
import { renderKeptTestCode, isKeepable } from "@/lib/explorer/keep";
import { explorerConfigFromSettings } from "@/lib/explorer/config";
import {
  renderKnowledgeBlock,
  renderExperienceBlock,
  pickKnowledgeCredentials,
  collectPageAutomation,
} from "@/lib/explorer/knowledge";
import { nextStyle, parseStyleRotation } from "@/lib/explorer/styles";
import {
  isStuck,
  MAX_SCENARIOS_PER_ITERATION,
} from "@/lib/explorer/supervisor";
import type {
  ActivityEventType,
  AgentSession,
  AgentSessionMetadata,
  AgentStepId,
  AgentStepState,
  ExperienceNote,
  ExplorerActionLog,
  ExplorerScenario,
  ExplorerSessionTrigger,
  ExplorerStyle,
  KnowledgePageAutomationStep,
  NewAgentKnowledge,
  QaAuthState,
} from "@/lib/db/schema";

/**
 * Explorer Agent — explorbot-style autonomous exploratory testing behind the
 * /explorer page. Where the QA agent BUILDS a suite (discover → plan →
 * generate → execute), the explorer TESTS the app directly: an iterative
 * research → plan → act → analyze loop that drives a live Embedded Browser,
 * records defect/UX findings, learns per-page-state experience for later
 * runs, and finally keeps passing flows as quarantined tests.
 *
 *   explorer_setup      orchestrator  preflight (target URL, AI provider)
 *   explorer_login      orchestrator  resolve auth (existing setup / creds)
 *   ── per iteration i (repeated step entries, AgentStepState.iteration) ──
 *   explorer_research   explorer      map the frontier page (live DOM via EB)
 *   explorer_plan       planner       scenarios in the rotating style
 *   explorer_act        explorer      AI-in-the-loop scenario execution
 *                                     (scenarios run concurrently — isolated
 *                                     authed contexts on one EB — since each
 *                                     tester turn is a blocking model call)
 *   explorer_analyze    explorer      findings + experience write-back
 *   ──────────────────────────────────────────────────────────────────────
 *   explorer_keep       generator     passing flows → quarantined tests
 *   explorer_summary    orchestrator  root-cause clustering + report
 *
 * Memory: agent_knowledge (human hints matched by URL pattern) is injected
 * into planner/tester prompts; agent_experience (learned notes keyed by
 * page-state hash) accumulates across sessions. The step machine runs
 * detached and the page polls /api/explorer-agent/[sessionId].
 */

const EXPLORER_STEP_DEFINITIONS: Array<{
  id: AgentStepId;
  label: string;
  description: string;
}> = [
  {
    id: "explorer_setup",
    label: "Preflight",
    description: "Validate target URL and AI provider",
  },
  {
    id: "explorer_login",
    label: "Login",
    description: "Resolve authentication — existing setup or credentials",
  },
  {
    id: "explorer_research",
    label: "Research",
    description: "Map the current page's rendered DOM",
  },
  {
    id: "explorer_plan",
    label: "Plan",
    description: "Draft exploratory scenarios in the iteration's style",
  },
  {
    id: "explorer_act",
    label: "Act",
    description: "Drive the browser through each scenario, adapting live",
  },
  {
    id: "explorer_analyze",
    label: "Analyze",
    description: "Record findings and write back learned experience",
  },
  {
    id: "explorer_keep",
    label: "Keep",
    description: "Save passing flows as quarantined tests",
  },
  {
    id: "explorer_summary",
    label: "Summary",
    description: "Cluster findings by root cause and write the report",
  },
];

const LOOP_STEP_IDS: AgentStepId[] = [
  "explorer_research",
  "explorer_plan",
  "explorer_act",
  "explorer_analyze",
];

const EB_CLAIM_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_ITERATIONS_CAP = 12;
const DEFAULT_MAX_ITERATIONS = 4;

// ── In-process registries (per session) ─────────────────────────────────────

const activeControllers = new Map<string, AbortController>();

/** EB held across the steps of one iteration (research claims, analyze
 *  releases). On resume after a process restart the entry is simply absent
 *  and the next step re-claims. */
const sessionEbs = new Map<
  string,
  { runnerId: string; cdpUrl: string; authApplied: boolean }
>();

function getOrCreateController(sessionId: string): AbortController {
  let controller = activeControllers.get(sessionId);
  if (!controller || controller.signal.aborted) {
    controller = new AbortController();
    activeControllers.set(sessionId, controller);
  }
  return controller;
}

// ── Session helpers (QA-agent conventions) ──────────────────────────────────

function emitActivity(
  teamId: string,
  repositoryId: string,
  sessionId: string,
  eventType: ActivityEventType,
  summary: string,
  opts?: {
    stepId?: string;
    detail?: Record<string, unknown>;
    artifactType?: "test" | "build";
    artifactId?: string;
    artifactLabel?: string;
    durationMs?: number;
  },
) {
  emitAndPersistActivityEvent({
    teamId,
    repositoryId,
    sessionId,
    sourceType: "explorer_agent",
    eventType,
    summary,
    stepId: opts?.stepId ?? null,
    agentType: "explorer",
    detail: opts?.detail ?? null,
    artifactType: opts?.artifactType ?? null,
    artifactId: opts?.artifactId ?? null,
    artifactLabel: opts?.artifactLabel ?? null,
    durationMs: opts?.durationMs ?? null,
    promptLogId: null,
  }).catch((err) => console.error("[Explorer] activity emit error:", err));
}

/** Patch a step entry by ARRAY INDEX — loop step ids repeat across
 *  iterations, so ids alone are ambiguous. */
async function updateStepAt(
  sessionId: string,
  index: number,
  update: Partial<AgentStepState>,
) {
  const session = await queries.getAgentSession(sessionId);
  if (!session || !session.steps[index]) return;
  const steps = [...session.steps];
  steps[index] = { ...steps[index], ...update };
  await queries.updateAgentSession(sessionId, {
    steps,
    currentStepId:
      update.status === "active"
        ? steps[index].id
        : (session.currentStepId ?? undefined),
  });
}

async function setStepActiveAt(sessionId: string, index: number) {
  await updateStepAt(sessionId, index, {
    status: "active",
    startedAt: new Date().toISOString(),
    error: undefined,
  });
}

async function setStepCompletedAt(
  sessionId: string,
  index: number,
  result?: Record<string, unknown>,
) {
  await updateStepAt(sessionId, index, {
    status: "completed",
    completedAt: new Date().toISOString(),
    ...(result ? { result } : {}),
  });
}

async function setStepFailedAt(
  sessionId: string,
  index: number,
  error: string,
) {
  await updateStepAt(sessionId, index, {
    status: "failed",
    completedAt: new Date().toISOString(),
    error,
  });
  await queries.updateAgentSession(sessionId, {
    status: "failed",
    completedAt: new Date(),
  });
}

/** Skip every remaining loop step (stuck/budget early-exit) so the pipeline
 *  falls through to keep/summary. */
async function skipRemainingLoopSteps(sessionId: string, reason: string) {
  const session = await queries.getAgentSession(sessionId);
  if (!session) return;
  const steps = session.steps.map((s) =>
    LOOP_STEP_IDS.includes(s.id) && s.status === "pending"
      ? {
          ...s,
          status: "skipped" as const,
          completedAt: new Date().toISOString(),
          result: { reason },
        }
      : s,
  );
  await queries.updateAgentSession(sessionId, { steps });
}

async function mergeMetadata(
  sessionId: string,
  patch: Partial<AgentSessionMetadata>,
) {
  const session = await queries.getAgentSession(sessionId);
  if (!session) return;
  await queries.updateAgentSession(sessionId, {
    metadata: { ...session.metadata, ...patch },
  });
}

function proxiedStream(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const proxied = toProxyStreamUrl(raw) ?? raw;
  return appendStreamToken(proxied, process.env.STREAM_AUTH_TOKEN) || undefined;
}

async function isStopped(
  sessionId: string,
  signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted) return true;
  const session = await queries.getAgentSession(sessionId);
  if (!session) return true;
  if (session.status === "cancelled" || session.status === "paused") {
    activeControllers.get(sessionId)?.abort();
    return true;
  }
  return false;
}

function credentialsFrom(
  metadata: AgentSessionMetadata,
): { email: string; password: string } | undefined {
  if (
    metadata.credsProvided &&
    typeof metadata.quickstartEmail === "string" &&
    typeof metadata.quickstartPassword === "string" &&
    metadata.quickstartEmail &&
    metadata.quickstartPassword
  ) {
    return {
      email: metadata.quickstartEmail,
      password: metadata.quickstartPassword,
    };
  }
  return undefined;
}

// ── EB lifecycle (one EB spans research → act within an iteration) ──────────

async function claimSessionEb(
  sessionId: string,
): Promise<{ runnerId: string; cdpUrl: string; authApplied: boolean } | null> {
  const held = sessionEbs.get(sessionId);
  if (held) return held;
  const eb = await claimEmbeddedBrowserForAgent(EB_CLAIM_TIMEOUT_MS, () => {
    mergeMetadata(sessionId, { queuedForBrowser: true }).catch(() => {});
  }).catch(() => undefined);
  await mergeMetadata(sessionId, {
    queuedForBrowser: false,
    ...(eb ? { streamUrl: proxiedStream(eb.streamUrl) } : {}),
  });
  if (!eb) return null;
  const entry = {
    runnerId: eb.runnerId,
    cdpUrl: eb.cdpUrl,
    authApplied: false,
  };
  sessionEbs.set(sessionId, entry);
  return entry;
}

async function releaseSessionEb(sessionId: string) {
  const held = sessionEbs.get(sessionId);
  sessionEbs.delete(sessionId);
  await mergeMetadata(sessionId, { streamUrl: undefined }).catch(() => {});
  if (held) await releasePoolEB(held.runnerId).catch(() => {});
}

/** Apply the resolved auth to a freshly-claimed EB: inject the storage state
 *  when one exists, else perform a live credential login. Best-effort — a
 *  failed application degrades to exploring the public surface. */
async function applyAuthToEb(
  sessionId: string,
  eb: { cdpUrl: string; authApplied: boolean },
  metadata: AgentSessionMetadata,
): Promise<void> {
  if (eb.authApplied) return;
  eb.authApplied = true;
  const auth = metadata.explorerAuth;
  const targetUrl = metadata.explorerTargetUrl;
  if (!targetUrl) return;
  try {
    if (auth?.storageStateId) {
      const row = await queries
        .getStorageState(auth.storageStateId)
        .catch(() => null);
      if (row?.storageStateJson) {
        await injectStorageStateIntoEb(eb.cdpUrl, row.storageStateJson);
        return;
      }
    }
    const credentials = credentialsFrom(metadata);
    if (credentials) {
      await loginWithCredsOnEb({
        cdpUrl: eb.cdpUrl,
        targetUrl,
        loginUrl: auth?.loginUrl,
        credentials,
      });
    }
  } catch (err) {
    console.warn("[Explorer] auth application failed:", err);
  }
}

// ── Steps ────────────────────────────────────────────────────────────────────

async function runExplorerSetup(
  sessionId: string,
  teamId: string,
  repositoryId: string,
  stepIndex: number,
): Promise<boolean> {
  await setStepActiveAt(sessionId, stepIndex);
  emitActivity(teamId, repositoryId, sessionId, "step:start", "Preflight", {
    stepId: "explorer_setup",
  });

  const session = await queries.getAgentSession(sessionId);
  if (!session) return false;
  if (!session.metadata.explorerTargetUrl) {
    await setStepFailedAt(sessionId, stepIndex, "No target URL configured");
    return false;
  }

  const aiSettings = await queries.getAISettings(repositoryId);
  if (!aiSettings.provider || aiSettings.provider === "none") {
    await setStepFailedAt(
      sessionId,
      stepIndex,
      "No AI provider configured — set one under Settings → AI",
    );
    return false;
  }

  await setStepCompletedAt(sessionId, stepIndex, {
    targetUrl: session.metadata.explorerTargetUrl,
    aiProvider: aiSettings.provider,
    maxIterations: session.metadata.explorerMaxIterations,
    styleRotation: (session.metadata.explorerStyleRotation ?? []).join(","),
  });
  emitActivity(
    teamId,
    repositoryId,
    sessionId,
    "step:complete",
    `Preflight OK — AI: ${aiSettings.provider}, budget: ${session.metadata.explorerMaxIterations} iterations`,
    { stepId: "explorer_setup" },
  );
  return true;
}

async function runExplorerLogin(
  sessionId: string,
  teamId: string,
  repositoryId: string,
  stepIndex: number,
  _signal: AbortSignal,
): Promise<boolean> {
  await setStepActiveAt(sessionId, stepIndex);
  emitActivity(
    teamId,
    repositoryId,
    sessionId,
    "step:start",
    "Resolving authentication",
    { stepId: "explorer_login" },
  );

  const session = await queries.getAgentSession(sessionId);
  if (!session?.metadata.explorerTargetUrl) return false;

  // Credentials can come from the start form or from a matched knowledge note
  // (explorbot's credential hints). The session form wins.
  let credentials = credentialsFrom(session.metadata);
  if (!credentials) {
    const notes = await queries
      .matchKnowledgeForUrl(repositoryId, session.metadata.explorerTargetUrl)
      .catch(() => []);
    const fromKnowledge = pickKnowledgeCredentials(notes);
    if (fromKnowledge?.password) {
      credentials = fromKnowledge;
      await mergeMetadata(sessionId, {
        credsProvided: true,
        quickstartEmail: fromKnowledge.email,
        quickstartPassword: fromKnowledge.password,
      });
    }
  }

  const existing = await findExistingAuthSetup(repositoryId).catch(
    (): ExistingAuthSetup => ({ defaultSetupInUse: false }),
  );

  let auth: QaAuthState;
  if (existing.storageStateId) {
    auth = {
      strategy: "existing_setup",
      validated: false,
      storageStateId: existing.storageStateId,
      setupTestId: existing.setupTestId,
      defaultSetupInUse: existing.defaultSetupInUse,
      notes: "Storage state injected into each iteration's browser",
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

  await mergeMetadata(sessionId, { explorerAuth: auth });
  await setStepCompletedAt(sessionId, stepIndex, { strategy: auth.strategy });
  emitActivity(
    teamId,
    repositoryId,
    sessionId,
    "step:complete",
    `Auth resolved: ${auth.strategy.replace(/_/g, " ")}`,
    { stepId: "explorer_login" },
  );
  return true;
}

async function runExplorerResearch(
  sessionId: string,
  teamId: string,
  repositoryId: string,
  stepIndex: number,
  iteration: number,
  signal: AbortSignal,
): Promise<boolean> {
  await setStepActiveAt(sessionId, stepIndex);
  const session = await queries.getAgentSession(sessionId);
  if (!session?.metadata.explorerTargetUrl) return false;
  const meta = session.metadata;
  const explorerTargetUrl = session.metadata.explorerTargetUrl;

  // Budget/stuck exit BEFORE claiming a browser.
  const history = meta.explorerStateHistory ?? [];
  if (isStuck(history)) {
    await mergeMetadata(sessionId, { explorerStuck: true });
    await updateStepAt(sessionId, stepIndex, {
      status: "skipped",
      completedAt: new Date().toISOString(),
      result: { reason: "loop detected — same page state repeating" },
    });
    await skipRemainingLoopSteps(
      sessionId,
      "loop detected — same page state repeating",
    );
    emitActivity(
      teamId,
      repositoryId,
      sessionId,
      "step:complete",
      "Exploration stopped early: the loop kept landing on the same page state",
      { stepId: "explorer_research" },
    );
    return true;
  }

  const frontier = [...(meta.explorerFrontier ?? [])];
  const visited = new Set(meta.explorerVisitedUrls ?? []);
  const targetUrl =
    iteration === 0
      ? explorerTargetUrl
      : (frontier.shift() ?? explorerTargetUrl);

  emitActivity(
    teamId,
    repositoryId,
    sessionId,
    "step:start",
    `Iteration ${iteration + 1}: researching ${targetUrl}`,
    { stepId: "explorer_research" },
  );

  const eb = await claimSessionEb(sessionId);
  if (!eb) {
    await setStepFailedAt(
      sessionId,
      stepIndex,
      "No embedded browser available",
    );
    return false;
  }
  if (signal.aborted) return false;
  await applyAuthToEb(sessionId, eb, meta);

  let research: ResearchResult;
  try {
    research = await researchPage(eb.cdpUrl, targetUrl);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await setStepFailedAt(sessionId, stepIndex, `Research failed: ${msg}`);
    return false;
  }

  visited.add(research.normalizedUrl);
  const baseOrigin = new URL(explorerTargetUrl).origin;
  const newLinks = extractFrontierLinks(research.pageMap, baseOrigin, visited);
  const mergedFrontier = Array.from(new Set([...frontier, ...newLinks])).slice(
    0,
    30,
  );

  await mergeMetadata(sessionId, {
    explorerPageMap: research.pageMap as unknown as Record<string, unknown>,
    explorerCurrentState: {
      hash: research.stateHash,
      url: research.pageMap.finalUrl || targetUrl,
      headings: research.headings,
    },
    explorerStateHistory: [...history, research.stateHash].slice(-20),
    explorerFrontier: mergedFrontier,
    explorerVisitedUrls: Array.from(visited).slice(-60),
  });

  // Record the visit (experience row exists even before any notes are learned).
  await queries
    .recordExperience({
      repositoryId,
      teamId,
      stateHash: research.stateHash,
      normalizedUrl: research.normalizedUrl,
      headingsDigest: research.headingsDigest,
      sessionId,
    })
    .catch((err) => console.warn("[Explorer] experience record failed:", err));

  await setStepCompletedAt(sessionId, stepIndex, {
    url: research.pageMap.finalUrl || targetUrl,
    stateHash: research.stateHash,
    forms: research.pageMap.forms.length,
    buttons: research.pageMap.buttons.length,
    links: research.pageMap.links.length,
    frontierSize: mergedFrontier.length,
  });
  emitActivity(
    teamId,
    repositoryId,
    sessionId,
    "step:complete",
    `Mapped ${research.pageMap.finalUrl || targetUrl}: ${research.pageMap.forms.length} forms, ${research.pageMap.buttons.length} buttons`,
    { stepId: "explorer_research" },
  );
  return true;
}

async function runExplorerPlan(
  sessionId: string,
  teamId: string,
  repositoryId: string,
  stepIndex: number,
  iteration: number,
  signal: AbortSignal,
): Promise<boolean> {
  await setStepActiveAt(sessionId, stepIndex);
  const session = await queries.getAgentSession(sessionId);
  if (!session) return false;
  const meta = session.metadata;
  const pageMap = meta.explorerPageMap as
    | Parameters<typeof planScenarios>[1]["pageMap"]
    | undefined;
  const state = meta.explorerCurrentState;
  if (!pageMap || !state) {
    await setStepFailedAt(
      sessionId,
      stepIndex,
      "No research output to plan from",
    );
    return false;
  }

  const style = nextStyle(meta.explorerStyleRotation, iteration);
  emitActivity(
    teamId,
    repositoryId,
    sessionId,
    "step:start",
    `Iteration ${iteration + 1}: planning (${style} style)`,
    { stepId: "explorer_plan" },
  );

  const [knowledge, experience, coverageDigest] = await Promise.all([
    queries.matchKnowledgeForUrl(repositoryId, state.url).catch(() => []),
    queries
      .listExperienceByStates(repositoryId, meta.explorerStateHistory ?? [])
      .catch(() => []),
    buildCoverageDigest(repositoryId).catch(() => "(coverage unavailable)"),
  ]);

  const priorTitles = Object.values(meta.explorerActionLogs ?? {})
    .map((l) => l.scenarioId)
    .concat((meta.explorerCurrentPlan ?? []).map((s) => s.title));

  const settings = await queries.getAISettings(repositoryId);
  const config = explorerConfigFromSettings(settings);

  let scenarios: ExplorerScenario[];
  try {
    scenarios = await planScenarios(config, {
      pageMap,
      style,
      iteration,
      knowledgeBlock: renderKnowledgeBlock(knowledge),
      experienceBlock: renderExperienceBlock(experience),
      coverageDigest,
      priorScenarioTitles: priorTitles,
      repositoryId,
      signal,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await setStepFailedAt(sessionId, stepIndex, `Planner failed: ${msg}`);
    return false;
  }

  if (scenarios.length === 0) {
    // Nothing new to try on this page — skip act/analyze for this iteration.
    await updateStepAt(sessionId, stepIndex, {
      status: "completed",
      completedAt: new Date().toISOString(),
      result: { scenarios: 0, style, note: "nothing new to plan here" },
    });
    await mergeMetadata(sessionId, { explorerCurrentPlan: [] });
    emitActivity(
      teamId,
      repositoryId,
      sessionId,
      "step:complete",
      `Iteration ${iteration + 1}: no new scenarios on this page`,
      { stepId: "explorer_plan" },
    );
    return true;
  }

  await mergeMetadata(sessionId, { explorerCurrentPlan: scenarios });
  await setStepCompletedAt(sessionId, stepIndex, {
    scenarios: scenarios.length,
    style,
    titles: scenarios.map((s) => s.title),
  });
  emitActivity(
    teamId,
    repositoryId,
    sessionId,
    "step:complete",
    `Iteration ${iteration + 1}: ${scenarios.length} ${style} scenarios drafted`,
    { stepId: "explorer_plan" },
  );
  return true;
}

async function runExplorerAct(
  sessionId: string,
  teamId: string,
  repositoryId: string,
  stepIndex: number,
  iteration: number,
  signal: AbortSignal,
): Promise<boolean> {
  await setStepActiveAt(sessionId, stepIndex);
  const session = await queries.getAgentSession(sessionId);
  if (!session?.metadata.explorerTargetUrl) return false;
  const meta = session.metadata;
  const scenarios = (meta.explorerCurrentPlan ?? []).filter((s) => !s.skipped);
  const state = meta.explorerCurrentState;

  if (scenarios.length === 0 || !state) {
    await updateStepAt(sessionId, stepIndex, {
      status: "skipped",
      completedAt: new Date().toISOString(),
      result: { reason: "no scenarios planned" },
    });
    return true;
  }

  emitActivity(
    teamId,
    repositoryId,
    sessionId,
    "step:start",
    `Iteration ${iteration + 1}: executing ${scenarios.length} scenarios`,
    { stepId: "explorer_act" },
  );

  const eb = await claimSessionEb(sessionId);
  if (!eb) {
    await setStepFailedAt(
      sessionId,
      stepIndex,
      "No embedded browser available",
    );
    return false;
  }
  await applyAuthToEb(sessionId, eb, meta);

  const [knowledge, settings] = await Promise.all([
    queries.matchKnowledgeForUrl(repositoryId, state.url).catch(() => []),
    queries.getAISettings(repositoryId),
  ]);
  const config = explorerConfigFromSettings(settings);
  const knowledgeBlock = renderKnowledgeBlock(knowledge);
  const pageAutomation: KnowledgePageAutomationStep[] =
    collectPageAutomation(knowledge);

  const capped = scenarios.slice(0, MAX_SCENARIOS_PER_ITERATION);
  if (await isStopped(sessionId, signal)) return false;

  // All capped scenarios run in one concurrent batch — show them all active.
  const substeps: NonNullable<AgentStepState["substeps"]> = capped.map((s) => ({
    label: s.title,
    status: "running",
    agent: "explorer",
  }));
  await updateStepAt(sessionId, stepIndex, { substeps: [...substeps] });

  const logs: Record<string, ExplorerActionLog> = {
    ...(meta.explorerActionLogs ?? {}),
  };
  const newFindingIds: string[] = [...(meta.explorerFindingIds ?? [])];
  const startedAt = Date.now();
  let passed = 0;
  let failed = 0;

  // Scenario execution runs concurrently (the AI round-trips are the cost);
  // the per-scenario bookkeeping below is serialized on one chain so the
  // shared substeps array + session-metadata read-modify-write never race.
  let writeChain: Promise<void> = Promise.resolve();

  await runScenariosConcurrent(
    config,
    eb.cdpUrl,
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

          // Findings: failed scenarios are defects; console/network anomalies
          // on a passing scenario are low-severity observations.
          if (log.status === "failed") {
            failed++;
            const finding = await queries
              .createAgentFinding({
                repositoryId,
                teamId,
                sessionId,
                kind: "defect",
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
              newFindingIds.push(finding.id);
              emitActivity(
                teamId,
                repositoryId,
                sessionId,
                "substep:update",
                `Finding: ${finding.title}`,
                { stepId: "explorer_act", detail: { findingId: finding.id } },
              );
            }
          } else if (
            log.status === "passed" &&
            ((log.consoleErrors?.length ?? 0) > 0 ||
              (log.failedRequests?.length ?? 0) > 0)
          ) {
            passed++;
            const finding = await queries
              .createAgentFinding({
                repositoryId,
                teamId,
                sessionId,
                kind: "defect",
                severity: "low",
                title: `Console/network errors during "${scenario.title}"`,
                description: [
                  `The scenario passed, but the app surfaced errors while it ran.`,
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
            if (finding) newFindingIds.push(finding.id);
          } else if (log.status === "passed") {
            passed++;
          }

          substeps[i] = {
            ...substeps[i],
            status: log.status === "passed" ? "done" : "error",
            detail: `${log.status}${log.summary ? ` — ${log.summary.slice(0, 120)}` : ""}`,
          };
          await updateStepAt(sessionId, stepIndex, {
            substeps: [...substeps],
          });
          await mergeMetadata(sessionId, {
            explorerActionLogs: logs,
            explorerFindingIds: newFindingIds,
          });
        });
        return writeChain;
      },
    },
  );

  await setStepCompletedAt(sessionId, stepIndex, {
    executed: capped.length,
    passed,
    failed,
    durationMs: Date.now() - startedAt,
    concurrency: Math.min(SCENARIO_CONCURRENCY, capped.length),
  });
  emitActivity(
    teamId,
    repositoryId,
    sessionId,
    "step:complete",
    `Iteration ${iteration + 1}: ${passed} passed, ${failed} failed`,
    { stepId: "explorer_act" },
  );
  return true;
}

async function runExplorerAnalyze(
  sessionId: string,
  teamId: string,
  repositoryId: string,
  stepIndex: number,
  iteration: number,
): Promise<boolean> {
  await setStepActiveAt(sessionId, stepIndex);
  const session = await queries.getAgentSession(sessionId);
  if (!session) return false;
  const meta = session.metadata;
  const state = meta.explorerCurrentState;
  const plan = meta.explorerCurrentPlan ?? [];
  const logs = meta.explorerActionLogs ?? {};

  // Experience write-back: what worked and what failed on this page state.
  if (state) {
    const notes: ExperienceNote[] = [];
    for (const scenario of plan) {
      const log = logs[scenario.id];
      if (!log) continue;
      if (log.status === "passed") {
        notes.push({
          kind: "resolution",
          text: `"${scenario.title}" works${log.summary ? `: ${log.summary.slice(0, 160)}` : ""}`,
          scenarioStyle: scenario.style,
          sessionId,
          at: new Date().toISOString(),
        });
      } else if (log.status === "failed") {
        notes.push({
          kind: "failure",
          text: `"${scenario.title}" fails${log.summary ? `: ${log.summary.slice(0, 160)}` : ""}`,
          scenarioStyle: scenario.style,
          sessionId,
          at: new Date().toISOString(),
        });
      } else if (log.status === "stuck") {
        notes.push({
          kind: "observation",
          text: `"${scenario.title}" got stuck — avoid this approach`,
          scenarioStyle: scenario.style,
          sessionId,
          at: new Date().toISOString(),
        });
      }
    }
    if (notes.length > 0) {
      await queries
        .appendExperienceNotes(repositoryId, state.hash, notes)
        .catch((err) =>
          console.warn("[Explorer] experience write-back failed:", err),
        );
    }
  }

  // The iteration is over: advance the cursor and release the EB so the pool
  // isn't held while the next iteration queues (it re-claims).
  await mergeMetadata(sessionId, {
    explorerIteration: iteration + 1,
    explorerCurrentPlan: [],
  });
  await releaseSessionEb(sessionId);

  await setStepCompletedAt(sessionId, stepIndex, {
    iteration: iteration + 1,
    findingsSoFar: (meta.explorerFindingIds ?? []).length,
  });
  emitActivity(
    teamId,
    repositoryId,
    sessionId,
    "step:complete",
    `Iteration ${iteration + 1} complete`,
    { stepId: "explorer_analyze" },
  );
  return true;
}

async function runExplorerKeep(
  sessionId: string,
  teamId: string,
  repositoryId: string,
  stepIndex: number,
): Promise<boolean> {
  await setStepActiveAt(sessionId, stepIndex);
  const session = await queries.getAgentSession(sessionId);
  if (!session?.metadata.explorerTargetUrl) return false;
  const meta = session.metadata;
  const explorerTargetUrl = session.metadata.explorerTargetUrl;
  const logs = meta.explorerActionLogs ?? {};

  // Reconstruct scenario objects from findings + kept plan metadata: the
  // authoritative copy of each executed scenario travels on its action-log
  // finding OR the current plan; we keep a per-scenario record in the log map.
  const allScenarios = new Map<string, ExplorerScenario>();
  for (const f of await queries
    .listFindingsBySession(sessionId)
    .catch(() => [])) {
    if (f.scenario) allScenarios.set(f.scenario.id, f.scenario);
  }
  for (const s of meta.explorerCurrentPlan ?? []) allScenarios.set(s.id, s);

  const keepable = Object.values(logs).filter(isKeepable);
  if (keepable.length === 0) {
    await updateStepAt(sessionId, stepIndex, {
      status: "completed",
      completedAt: new Date().toISOString(),
      result: { kept: 0, note: "no passing flows worth keeping" },
    });
    return true;
  }

  // All kept tests live under one "Explorer" area.
  let areaId: string | undefined;
  try {
    const areas = await queries.getFunctionalAreasByRepo(repositoryId);
    const existing = areas.find((a) => a.name === "Explorer");
    areaId = existing
      ? existing.id
      : (await queries.createFunctionalArea({ repositoryId, name: "Explorer" }))
          .id;
  } catch (err) {
    console.warn("[Explorer] area resolution failed:", err);
  }

  const keptIds: string[] = [];
  for (const log of keepable) {
    const scenario = allScenarios.get(log.scenarioId);
    if (!scenario) continue;
    try {
      const code = renderKeptTestCode(
        scenario,
        log,
        log.finalUrl ?? explorerTargetUrl,
      );
      const test = await queries.createTest({
        repositoryId,
        functionalAreaId: areaId,
        name: `Explorer: ${scenario.title.slice(0, 120)}`,
        code,
        targetUrl: explorerTargetUrl,
        quarantined: true,
      });
      keptIds.push(test.id);
      emitActivity(
        teamId,
        repositoryId,
        sessionId,
        "artifact:created",
        `Kept test: ${scenario.title}`,
        {
          stepId: "explorer_keep",
          artifactType: "test",
          artifactId: test.id,
          artifactLabel: scenario.title,
        },
      );
    } catch (err) {
      console.warn("[Explorer] keep failed for scenario:", err);
    }
  }

  await mergeMetadata(sessionId, { explorerKeptTestIds: keptIds });
  await setStepCompletedAt(sessionId, stepIndex, { kept: keptIds.length });
  emitActivity(
    teamId,
    repositoryId,
    sessionId,
    "step:complete",
    `Kept ${keptIds.length} passing flows as quarantined tests`,
    { stepId: "explorer_keep" },
  );
  return true;
}

async function runExplorerSummary(
  sessionId: string,
  teamId: string,
  repositoryId: string,
  stepIndex: number,
  signal: AbortSignal,
): Promise<boolean> {
  await setStepActiveAt(sessionId, stepIndex);
  const session = await queries.getAgentSession(sessionId);
  if (!session) return false;
  const meta = session.metadata;

  emitActivity(
    teamId,
    repositoryId,
    sessionId,
    "step:start",
    "Clustering findings by root cause",
    { stepId: "explorer_summary" },
  );

  const findings = await queries
    .listFindingsBySession(sessionId)
    .catch(() => []);
  const settings = await queries.getAISettings(repositoryId);
  const config = explorerConfigFromSettings(settings);

  const report = await clusterFindings(config, {
    findings,
    iterationsRun: meta.explorerIteration ?? 0,
    repositoryId,
    signal,
  });

  // Back-fill cluster labels + refined severity/kind onto the finding rows.
  for (const cluster of report.clusters) {
    await queries
      .updateFindingCluster(cluster.findingIds, {
        rootCauseCluster: cluster.rootCause,
        severity: cluster.severity,
        kind: cluster.kind,
      })
      .catch(() => {});
  }

  await mergeMetadata(sessionId, { explorerReport: report });
  await setStepCompletedAt(sessionId, stepIndex, {
    findings: report.totalFindings,
    clusters: report.clusters.length,
    iterations: report.iterationsRun,
    kept: (meta.explorerKeptTestIds ?? []).length,
  });
  await queries.updateAgentSession(sessionId, {
    status: "completed",
    completedAt: new Date(),
  });
  emitActivity(
    teamId,
    repositoryId,
    sessionId,
    "session:complete",
    `Exploration complete: ${report.totalFindings} findings in ${report.clusters.length} clusters across ${report.iterationsRun} iterations`,
  );
  return true;
}

// ── Pipeline driver ──────────────────────────────────────────────────────────

function buildExplorerSteps(maxIterations: number): AgentStepState[] {
  const def = (id: AgentStepId) =>
    EXPLORER_STEP_DEFINITIONS.find((d) => d.id === id)!;
  const steps: AgentStepState[] = [];
  for (const id of ["explorer_setup", "explorer_login"] as AgentStepId[]) {
    const d = def(id);
    steps.push({
      id,
      status: steps.length === 0 ? "active" : "pending",
      label: d.label,
      description: d.description,
    });
  }
  for (let i = 0; i < maxIterations; i++) {
    for (const id of LOOP_STEP_IDS) {
      const d = def(id);
      steps.push({
        id,
        status: "pending",
        label: d.label,
        description: d.description,
        iteration: i,
      });
    }
  }
  for (const id of ["explorer_keep", "explorer_summary"] as AgentStepId[]) {
    const d = def(id);
    steps.push({
      id,
      status: "pending",
      label: d.label,
      description: d.description,
    });
  }
  return steps;
}

async function executeExplorerPipeline(
  sessionId: string,
  teamId: string,
  repositoryId: string,
) {
  const controller = getOrCreateController(sessionId);
  const signal = controller.signal;

  try {
    for (;;) {
      if (await isStopped(sessionId, signal)) return;
      const session = await queries.getAgentSession(sessionId);
      if (!session) return;
      // Resume-safe: always run the first not-yet-finished step entry.
      const index = session.steps.findIndex(
        (s) => s.status === "pending" || s.status === "active",
      );
      if (index === -1) return; // every step resolved
      const step = session.steps[index];
      const iteration = step.iteration ?? 0;

      let ok = false;
      switch (step.id) {
        case "explorer_setup":
          ok = await runExplorerSetup(sessionId, teamId, repositoryId, index);
          break;
        case "explorer_login":
          ok = await runExplorerLogin(
            sessionId,
            teamId,
            repositoryId,
            index,
            signal,
          );
          break;
        case "explorer_research":
          ok = await runExplorerResearch(
            sessionId,
            teamId,
            repositoryId,
            index,
            iteration,
            signal,
          );
          break;
        case "explorer_plan":
          ok = await runExplorerPlan(
            sessionId,
            teamId,
            repositoryId,
            index,
            iteration,
            signal,
          );
          break;
        case "explorer_act":
          ok = await runExplorerAct(
            sessionId,
            teamId,
            repositoryId,
            index,
            iteration,
            signal,
          );
          break;
        case "explorer_analyze":
          ok = await runExplorerAnalyze(
            sessionId,
            teamId,
            repositoryId,
            index,
            iteration,
          );
          break;
        case "explorer_keep":
          ok = await runExplorerKeep(sessionId, teamId, repositoryId, index);
          break;
        case "explorer_summary":
          ok = await runExplorerSummary(
            sessionId,
            teamId,
            repositoryId,
            index,
            signal,
          );
          break;
        default:
          // Unknown step (never expected) — fail loudly rather than spin.
          await setStepFailedAt(sessionId, index, `Unknown step ${step.id}`);
          return;
      }
      if (!ok) return;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Explorer] pipeline error:", err);
    const session = await queries.getAgentSession(sessionId).catch(() => null);
    const index = session?.steps.findIndex((s) => s.status === "active") ?? -1;
    if (index !== -1) {
      await setStepFailedAt(sessionId, index, msg).catch(() => {});
    } else {
      await queries
        .updateAgentSession(sessionId, {
          status: "failed",
          completedAt: new Date(),
        })
        .catch(() => {});
    }
    emitActivity(
      teamId,
      repositoryId,
      sessionId,
      "session:error",
      `Explorer failed: ${msg}`,
    );
  } finally {
    activeControllers.delete(sessionId);
    await releaseSessionEb(sessionId).catch(() => {});
  }
}

// ── Public actions ───────────────────────────────────────────────────────────

export interface StartExplorerInput {
  repositoryId: string;
  targetUrl: string;
  maxIterations?: number;
  styleRotation?: ExplorerStyle[];
  email?: string;
  password?: string;
}

async function startExplorerCore(
  teamId: string,
  input: StartExplorerInput,
  trigger: ExplorerSessionTrigger,
): Promise<{ sessionId: string }> {
  const targetUrl = input.targetUrl.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(targetUrl)) {
    throw new Error("Target URL must start with http(s)://");
  }
  try {
    await assertSafeOutboundUrl(targetUrl);
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      throw new Error(`URL rejected: ${err.message}`);
    }
    throw err;
  }

  // One active explorer session per repo.
  const existing = await queries.getActiveAgentSession(
    input.repositoryId,
    "explorer",
  );
  if (existing) {
    activeControllers.get(existing.id)?.abort();
    await queries.updateAgentSession(existing.id, {
      status: "cancelled",
      completedAt: new Date(),
    });
    await releaseSessionEb(existing.id).catch(() => {});
  }

  const settings = await queries.getAISettings(input.repositoryId);
  const maxIterations = Math.max(
    1,
    Math.min(
      input.maxIterations ??
        settings.explorerMaxIterations ??
        DEFAULT_MAX_ITERATIONS,
      MAX_ITERATIONS_CAP,
    ),
  );
  const styleRotation =
    input.styleRotation && input.styleRotation.length > 0
      ? input.styleRotation
      : parseStyleRotation(settings.explorerStyleRotation);
  const credsProvided = Boolean(input.email?.trim() && input.password);

  const session = await queries.createAgentSession({
    repositoryId: input.repositoryId,
    teamId,
    kind: "explorer",
    status: "active",
    currentStepId: "explorer_setup",
    steps: buildExplorerSteps(maxIterations),
    metadata: {
      explorerTargetUrl: targetUrl,
      explorerMaxIterations: maxIterations,
      explorerIteration: 0,
      explorerStyleRotation: styleRotation,
      explorerTrigger: trigger,
      credsProvided,
      ...(credsProvided
        ? {
            quickstartEmail: input.email!.trim(),
            quickstartPassword: input.password!,
          }
        : {}),
    },
  });

  emitActivity(
    teamId,
    input.repositoryId,
    session.id,
    "session:start",
    `Explorer started on ${targetUrl} (${maxIterations} iterations, ${styleRotation.join("→")})`,
  );

  executeExplorerPipeline(session.id, teamId, input.repositoryId).catch((err) =>
    console.error("[Explorer] unhandled:", err),
  );

  return { sessionId: session.id };
}

export async function startExplorerAgent(
  input: StartExplorerInput,
): Promise<{ sessionId: string }> {
  const { team } = await requireRepoAccess(input.repositoryId);
  assertQaAgentAccess(team.plan);
  const result = await startExplorerCore(team.id, input, "manual");
  revalidatePath("/explorer");
  return result;
}

async function requireExplorerSession(sessionId: string): Promise<{
  session: AgentSession;
  teamId: string;
}> {
  const { team } = await requireTeamAccess();
  const session = await queries.getAgentSession(sessionId);
  if (!session || session.kind !== "explorer") {
    throw new Error("Explorer session not found");
  }
  if (session.teamId && session.teamId !== team.id) {
    throw new Error("Explorer session not found");
  }
  return { session, teamId: team.id };
}

export async function getExplorerSession(
  sessionId: string,
): Promise<AgentSession | null> {
  try {
    const { session } = await requireExplorerSession(sessionId);
    return session;
  } catch {
    return null;
  }
}

export async function getLatestExplorerSession(
  repositoryId: string,
): Promise<AgentSession | null> {
  await requireRepoAccess(repositoryId);
  const session = await queries.getLatestAgentSession(repositoryId, "explorer");
  return session ?? null;
}

export async function getRecentExplorerSessions(
  repositoryId: string,
  limit = 10,
): Promise<AgentSession[]> {
  await requireRepoAccess(repositoryId);
  return queries.getRecentAgentSessions(repositoryId, "explorer", limit);
}

export async function pauseExplorerAgent(
  sessionId: string,
): Promise<{ success: boolean }> {
  const { session } = await requireExplorerSession(sessionId);
  if (session.status !== "active") return { success: false };
  activeControllers.get(sessionId)?.abort();
  await queries.updateAgentSession(sessionId, { status: "paused" });
  await releaseSessionEb(sessionId).catch(() => {});
  revalidatePath("/explorer");
  return { success: true };
}

export async function resumeExplorerAgent(
  sessionId: string,
): Promise<{ success: boolean }> {
  const { session, teamId } = await requireExplorerSession(sessionId);
  if (session.status !== "paused") return { success: false };
  // Re-open the interrupted step so the resume-safe driver re-runs it.
  const steps = session.steps.map((s) =>
    s.status === "active" ? { ...s, status: "pending" as const } : s,
  );
  await queries.updateAgentSession(sessionId, { status: "active", steps });
  executeExplorerPipeline(sessionId, teamId, session.repositoryId).catch(
    (err) => console.error("[Explorer] unhandled:", err),
  );
  revalidatePath("/explorer");
  return { success: true };
}

export async function cancelExplorerAgent(
  sessionId: string,
): Promise<{ success: boolean }> {
  const { session, teamId } = await requireExplorerSession(sessionId);
  activeControllers.get(sessionId)?.abort();
  await queries.updateAgentSession(sessionId, {
    status: "cancelled",
    completedAt: new Date(),
  });
  await releaseSessionEb(sessionId).catch(() => {});
  emitActivity(
    teamId,
    session.repositoryId,
    sessionId,
    "session:error",
    "Explorer cancelled by user",
  );
  revalidatePath("/explorer");
  return { success: true };
}

// ── Findings actions ─────────────────────────────────────────────────────────

export async function listExplorerFindings(sessionId: string) {
  const { session } = await requireExplorerSession(sessionId);
  return queries.listFindingsBySession(session.id);
}

export async function listRepoFindings(repositoryId: string) {
  await requireRepoAccess(repositoryId);
  return queries.listFindingsByRepo(repositoryId);
}

export async function setFindingStatus(
  findingId: string,
  status: "open" | "triaged" | "dismissed" | "kept",
): Promise<{ success: boolean }> {
  const { team } = await requireTeamAccess();
  const finding = await queries.getAgentFinding(findingId);
  if (!finding || finding.teamId !== team.id) return { success: false };
  await queries.updateFindingStatus(findingId, status);
  revalidatePath("/explorer");
  return { success: true };
}

// ── Knowledge CRUD (the /explorer knowledge editor + MCP learn tool) ────────

export async function listExplorerKnowledge(repositoryId: string) {
  await requireRepoAccess(repositoryId);
  const rows = await queries.listKnowledgeByRepo(repositoryId);
  // Never ship passwords to the client — presence flag only.
  return rows.map(({ credPassword, ...rest }) => ({
    ...rest,
    hasCredentials: Boolean(credPassword),
  }));
}

export interface UpsertKnowledgeInput {
  id?: string;
  repositoryId: string;
  title: string;
  urlPattern: string;
  matchKind: "exact" | "prefix" | "regex";
  body: string;
  credEmail?: string;
  /** Only sent when (re)setting the password; omitted = keep existing. */
  credPassword?: string;
  pageAutomation?: KnowledgePageAutomationStep[];
  enabled?: boolean;
}

export async function upsertExplorerKnowledge(
  input: UpsertKnowledgeInput,
): Promise<{ id: string }> {
  const { team } = await requireRepoAccess(input.repositoryId);
  if (!input.title.trim() || !input.urlPattern.trim() || !input.body.trim()) {
    throw new Error("Title, URL pattern, and body are required");
  }
  const patch = {
    title: input.title.trim().slice(0, 200),
    urlPattern: input.urlPattern.trim().slice(0, 300),
    matchKind: input.matchKind,
    body: input.body.slice(0, 20_000),
    credEmail: input.credEmail?.trim() || null,
    ...(input.credPassword !== undefined
      ? { credPassword: input.credPassword || null }
      : {}),
    pageAutomation: input.pageAutomation ?? null,
    enabled: input.enabled ?? true,
  } satisfies Partial<NewAgentKnowledge>;

  if (input.id) {
    const existing = await queries.getKnowledge(input.id);
    if (!existing || existing.repositoryId !== input.repositoryId) {
      throw new Error("Knowledge note not found");
    }
    await queries.updateKnowledge(input.id, patch);
    revalidatePath("/explorer");
    return { id: input.id };
  }
  const created = await queries.createKnowledge({
    ...patch,
    repositoryId: input.repositoryId,
    teamId: team.id,
    credPassword: input.credPassword || null,
  });
  revalidatePath("/explorer");
  return { id: created.id };
}

export async function deleteExplorerKnowledge(
  id: string,
  repositoryId: string,
): Promise<{ success: boolean }> {
  await requireRepoAccess(repositoryId);
  const existing = await queries.getKnowledge(id);
  if (!existing || existing.repositoryId !== repositoryId) {
    return { success: false };
  }
  await queries.deleteKnowledge(id);
  revalidatePath("/explorer");
  return { success: true };
}

export async function listExplorerExperience(repositoryId: string) {
  await requireRepoAccess(repositoryId);
  return queries.listExperienceByRepo(repositoryId);
}

// ── Trigger config + scheduled dispatch ─────────────────────────────────────

export interface ExplorerTriggerConfigInput {
  repositoryId: string;
  scheduleEnabled: boolean;
  cronExpression?: string | null;
  maxIterations?: number;
}

export async function getExplorerTriggerConfig(repositoryId: string) {
  await requireRepoAccess(repositoryId);
  return (await queries.getExplorerTrigger(repositoryId)) ?? null;
}

export async function updateExplorerTriggerConfig(
  input: ExplorerTriggerConfigInput,
): Promise<{ success: boolean }> {
  const { team } = await requireRepoAccess(input.repositoryId);
  assertQaAgentAccess(team.plan);

  let nextRunAt: Date | null = null;
  if (input.scheduleEnabled) {
    if (!input.cronExpression || !isValidCron(input.cronExpression)) {
      throw new Error(
        "A valid cron expression is required to enable the schedule",
      );
    }
    nextRunAt = getNextRunTime(input.cronExpression);
  }

  await queries.upsertExplorerTrigger(input.repositoryId, team.id, {
    scheduleEnabled: input.scheduleEnabled,
    cronExpression: input.cronExpression ?? null,
    maxIterations: Math.max(
      1,
      Math.min(input.maxIterations ?? 4, MAX_ITERATIONS_CAP),
    ),
    nextRunAt,
  });
  revalidatePath("/explorer");
  return { success: true };
}

/** Fire due explorer cron triggers. Called from the scheduler tick alongside
 *  the QA-agent trigger dispatch — no user session (system context). */
export async function dispatchDueExplorerTriggers(): Promise<number> {
  const due = await queries.getDueExplorerTriggers().catch(() => []);
  let fired = 0;
  for (const trigger of due) {
    const nextRunAt = trigger.cronExpression
      ? getNextRunTime(trigger.cronExpression)
      : null;
    try {
      // Skip (but re-arm) when a session is already running for this repo.
      const active = await queries.getActiveAgentSession(
        trigger.repositoryId,
        "explorer",
      );
      if (active) {
        await queries.markExplorerTriggerFired(trigger.id, { nextRunAt });
        continue;
      }
      const repo = await queries.getRepository(trigger.repositoryId);
      const branchBaseUrls = (repo?.branchBaseUrls ?? {}) as Record<
        string,
        string
      >;
      const targetUrl =
        (repo?.defaultBranch
          ? branchBaseUrls[repo.defaultBranch]
          : undefined) ??
        branchBaseUrls.main ??
        Object.values(branchBaseUrls)[0];
      if (!targetUrl) {
        await queries.markExplorerTriggerFired(trigger.id, { nextRunAt });
        continue;
      }
      const { sessionId } = await startExplorerCore(
        trigger.teamId,
        {
          repositoryId: trigger.repositoryId,
          targetUrl,
          maxIterations: trigger.maxIterations,
        },
        "schedule",
      );
      await queries.markExplorerTriggerFired(trigger.id, {
        nextRunAt,
        lastRunAt: new Date(),
        lastSessionId: sessionId,
      });
      fired++;
    } catch (err) {
      console.error("[Explorer] trigger dispatch failed:", err);
      await queries
        .markExplorerTriggerFired(trigger.id, { nextRunAt })
        .catch(() => {});
    }
  }
  return fired;
}
