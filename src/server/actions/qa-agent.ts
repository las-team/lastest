"use server";

import { revalidatePath } from "next/cache";
import * as queries from "@/lib/db/queries";
import { requireRepoAccess, requireTeamAccess } from "@/lib/auth";
import {
  assertSafeOutboundUrl,
  SsrfBlockedError,
} from "@/lib/security/outbound-url";
import { emitAndPersistActivityEvent } from "@/lib/db/queries/activity-events";
import { generateWithAI } from "@/lib/ai";
import { parseAiJson } from "@/lib/ai/json-parse";
import { getAIConfig } from "@/lib/playwright/agent-context";
import { claimEmbeddedBrowserForAgent } from "./ai";
import { releasePoolEB } from "./embedded-sessions";
import { runTestsCore } from "./runs";
import { toProxyStreamUrl } from "@/lib/eb/stream-url";
import { appendStreamToken } from "@/lib/eb/stream-token";
import { crawlTargetApp } from "@/lib/qa-agent/crawl";
import {
  buildApiDefinition,
  buildDiscoveryDigest,
  buildExistingCoverageDigest,
  buildGeneratorPrompt,
  buildPlannerSystemPrompt,
  buildPlannerUserPrompt,
  computeQaSummary,
  enabledPlanItems,
  groupPlaywrightOverrides,
  isQaTestPlan,
  matchPlanToExistingTests,
  normalizeQaGroups,
  sanitizeQaPlan,
  QA_GROUPS,
  type ExistingTestSummary,
} from "@/lib/qa-agent/plan";
import type {
  ActivityEventType,
  AgentSession,
  AgentSessionMetadata,
  AgentStepId,
  AgentStepState,
  PwAgentType,
  QaDiscovery,
  QaGeneratedTest,
  QaRunMode,
  QaTestGroup,
  QaTestPlan,
} from "@/lib/db/schema";

/**
 * QA Agent — the dedicated comprehensive-suite builder behind the /qa-agent
 * page. Orchestrates specialist subagents through an eight-phase pipeline:
 *
 *   qa_setup       orchestrator  preflight (AI provider, GitHub, target URL)
 *   qa_discover    scout         static route scan + live EB crawl (DOM,
 *                                selectors, observed API endpoints)
 *   qa_plan        planner       best-practices test plan grounded in discovery
 *   qa_plan_review (human gate)  approve / adjust / request changes
 *   qa_generate    generator     one test per plan item (EB + MCP verified
 *                                selectors); api items become headless tests
 *   qa_execute     orchestrator  run the generated suite
 *   qa_heal        healer        fix failing tests, re-run them
 *   qa_summary     orchestrator  coverage + journey traceability
 *
 * Each phase's AI work is a separate, narrowly-scoped subagent call: the
 * planner sees a condensed discovery digest, each generator sees only its
 * plan item + relevant selectors, the healer sees one failing test. That keeps
 * every context window small while the session metadata carries the full
 * state. The step machine runs detached (fire-and-forget) and the page polls
 * /api/qa-agent/[sessionId], same as the play agent.
 */

const QA_STEP_DEFINITIONS: Array<{
  id: AgentStepId;
  label: string;
  description: string;
}> = [
  {
    id: "qa_setup",
    label: "Preflight",
    description: "Validate target URL, AI provider, and GitHub connection",
  },
  {
    id: "qa_discover",
    label: "Discover",
    description: "Scan source routes and crawl the live app for DOM/selectors",
  },
  {
    id: "qa_plan",
    label: "Plan",
    description: "Design a risk-prioritized test plan from real discovery data",
  },
  {
    id: "qa_plan_review",
    label: "Review",
    description: "Human review gate — approve or request plan changes",
  },
  {
    id: "qa_generate",
    label: "Generate",
    description: "Generate tests per plan item with live selector verification",
  },
  {
    id: "qa_execute",
    label: "Execute",
    description: "Run the generated suite against the target app",
  },
  {
    id: "qa_heal",
    label: "Heal",
    description: "Fix failing tests and re-run them",
  },
  {
    id: "qa_summary",
    label: "Summary",
    description: "Coverage matrix and journey traceability",
  },
];

const EB_CLAIM_TIMEOUT_MS = 5 * 60 * 1000;
const PLANNER_TIMEOUT_MS = 5 * 60 * 1000;
const GENERATOR_TIMEOUT_MS = 8 * 60 * 1000;
const HEAL_TIMEOUT_MS = 8 * 60 * 1000;
const RUN_POLL_INTERVAL_MS = 3000;
const RUN_TIMEOUT_MS = 20 * 60 * 1000;
const MAX_CRAWL_PAGES = 6;

// ── AbortController registry (per session, in-process) ──────────────────────

const activeControllers = new Map<string, AbortController>();

function getOrCreateController(sessionId: string): AbortController {
  let controller = activeControllers.get(sessionId);
  if (!controller || controller.signal.aborted) {
    controller = new AbortController();
    activeControllers.set(sessionId, controller);
  }
  return controller;
}

// ── Session helpers ──────────────────────────────────────────────────────────

function emitActivity(
  teamId: string,
  repositoryId: string,
  sessionId: string,
  eventType: ActivityEventType,
  summary: string,
  opts?: {
    stepId?: string;
    agentType?: PwAgentType;
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
    sourceType: "qa_agent",
    eventType,
    summary,
    stepId: opts?.stepId ?? null,
    agentType: opts?.agentType ?? null,
    detail: opts?.detail ?? null,
    artifactType: opts?.artifactType ?? null,
    artifactId: opts?.artifactId ?? null,
    artifactLabel: opts?.artifactLabel ?? null,
    durationMs: opts?.durationMs ?? null,
    promptLogId: null,
  }).catch((err) => console.error("[QaAgent] activity emit error:", err));
}

async function updateStep(
  sessionId: string,
  stepId: AgentStepId,
  update: Partial<AgentStepState>,
) {
  const session = await queries.getAgentSession(sessionId);
  if (!session) return;
  const steps = [...session.steps];
  const idx = steps.findIndex((s) => s.id === stepId);
  if (idx === -1) return;
  steps[idx] = { ...steps[idx], ...update };
  await queries.updateAgentSession(sessionId, {
    steps,
    currentStepId:
      update.status === "active"
        ? stepId
        : (session.currentStepId ?? undefined),
  });
}

async function setStepActive(sessionId: string, stepId: AgentStepId) {
  await updateStep(sessionId, stepId, {
    status: "active",
    startedAt: new Date().toISOString(),
    error: undefined,
  });
  await queries.updateAgentSession(sessionId, { currentStepId: stepId });
}

async function setStepCompleted(
  sessionId: string,
  stepId: AgentStepId,
  result?: Record<string, unknown>,
) {
  await updateStep(sessionId, stepId, {
    status: "completed",
    completedAt: new Date().toISOString(),
    ...(result ? { result } : {}),
  });
}

async function setStepFailed(
  sessionId: string,
  stepId: AgentStepId,
  error: string,
  result?: Record<string, unknown>,
) {
  await updateStep(sessionId, stepId, {
    status: "failed",
    completedAt: new Date().toISOString(),
    error,
    ...(result ? { result } : {}),
  });
  await queries.updateAgentSession(sessionId, {
    status: "failed",
    completedAt: new Date(),
  });
}

async function setStepSkipped(
  sessionId: string,
  stepId: AgentStepId,
  reason?: string,
) {
  await updateStep(sessionId, stepId, {
    status: "skipped",
    completedAt: new Date().toISOString(),
    ...(reason ? { result: { reason } } : {}),
  });
}

async function updateSubsteps(
  sessionId: string,
  stepId: AgentStepId,
  substeps: AgentStepState["substeps"],
) {
  await updateStep(sessionId, stepId, { substeps: [...(substeps ?? [])] });
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

/** True when the session was cancelled in the DB or aborted in-process. */
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

/** Live (non-deleted) repo tests with their area names — the matcher's and
 *  planner's view of what coverage already exists. */
async function loadExistingTests(
  repositoryId: string,
): Promise<ExistingTestSummary[]> {
  const [tests, areas] = await Promise.all([
    queries.getTestsByRepo(repositoryId),
    queries.getFunctionalAreasByRepo(repositoryId).catch(() => []),
  ]);
  const areaName = new Map(areas.map((a) => [a.id, a.name]));
  return tests.map((t) => ({
    id: t.id,
    name: t.name,
    testType: t.testType,
    functionalAreaName: t.functionalAreaId
      ? (areaName.get(t.functionalAreaId) ?? null)
      : null,
  }));
}

/** Prior run's ledger for coverage matching: the fill_gaps source session's,
 *  else the newest earlier session that has one. */
async function loadPriorLedger(
  session: AgentSession,
): Promise<QaGeneratedTest[] | undefined> {
  if (session.metadata.qaPlanSourceSessionId) {
    const source = await queries
      .getAgentSession(session.metadata.qaPlanSourceSessionId)
      .catch(() => null);
    if (source?.metadata.qaGeneratedTests) {
      return source.metadata.qaGeneratedTests;
    }
  }
  const recent = await queries
    .getRecentAgentSessions(session.repositoryId, "qa", 10)
    .catch(() => []);
  return recent.find(
    (s) => s.id !== session.id && s.metadata.qaGeneratedTests?.length,
  )?.metadata.qaGeneratedTests;
}

// ── Step: qa_setup ───────────────────────────────────────────────────────────

async function runQaSetup(
  sessionId: string,
  teamId: string,
  repositoryId: string,
  _signal: AbortSignal,
): Promise<boolean> {
  await setStepActive(sessionId, "qa_setup");
  emitActivity(teamId, repositoryId, sessionId, "step:start", "Preflight", {
    stepId: "qa_setup",
    agentType: "orchestrator",
  });

  const session = await queries.getAgentSession(sessionId);
  if (!session) return false;
  const targetUrl = session.metadata.qaTargetUrl;
  if (!targetUrl) {
    await setStepFailed(sessionId, "qa_setup", "No target URL configured");
    return false;
  }

  const aiSettings = await queries.getAISettings(repositoryId);
  if (!aiSettings.provider || aiSettings.provider === "none") {
    await setStepFailed(
      sessionId,
      "qa_setup",
      "No AI provider configured — set one under Settings → AI",
    );
    return false;
  }

  const ghAccount = await queries
    .getGithubAccountByTeam(teamId)
    .catch(() => undefined);
  const repo = await queries.getRepository(repositoryId);
  const githubConnected = Boolean(
    ghAccount?.accessToken && repo?.provider === "github" && repo.owner,
  );

  await setStepCompleted(sessionId, "qa_setup", {
    targetUrl,
    aiProvider: aiSettings.provider,
    githubConnected,
    credsProvided: Boolean(session.metadata.credsProvided),
  });
  emitActivity(
    teamId,
    repositoryId,
    sessionId,
    "step:complete",
    `Preflight OK — AI: ${aiSettings.provider}, GitHub: ${githubConnected ? "connected (repo-aware discovery)" : "not connected (live discovery only)"}`,
    { stepId: "qa_setup", agentType: "orchestrator" },
  );
  return true;
}

// ── Step: qa_discover ────────────────────────────────────────────────────────

async function runQaDiscover(
  sessionId: string,
  teamId: string,
  repositoryId: string,
  signal: AbortSignal,
): Promise<boolean> {
  await setStepActive(sessionId, "qa_discover");
  const session = await queries.getAgentSession(sessionId);
  if (!session?.metadata.qaTargetUrl) return false;
  const targetUrl = session.metadata.qaTargetUrl;

  const substeps: NonNullable<AgentStepState["substeps"]> = [
    { label: "Static route scan", status: "running", agent: "scout" },
    { label: "Live crawl", status: "pending", agent: "ranger" },
  ];
  await updateSubsteps(sessionId, "qa_discover", substeps);
  emitActivity(
    teamId,
    repositoryId,
    sessionId,
    "step:start",
    "Discovery started",
    { stepId: "qa_discover", agentType: "scout" },
  );

  // 1) Static routes: reuse a prior scan; else run the GitHub-tree scanner.
  let staticRoutes: Array<{ path: string; type: string }> = [];
  let framework: string | undefined;
  let githubConnected = false;
  try {
    const repo = await queries.getRepository(repositoryId);
    const ghAccount = await queries
      .getGithubAccountByTeam(teamId)
      .catch(() => undefined);
    githubConnected = Boolean(
      ghAccount?.accessToken && repo?.provider === "github" && repo.owner,
    );

    const existing = await queries.getRoutesByRepo(repositoryId);
    if (existing.length > 0) {
      staticRoutes = existing.map((r) => ({ path: r.path, type: r.type }));
      framework = existing[0]?.framework ?? undefined;
    } else if (githubConnected && repo && ghAccount?.accessToken) {
      const { RemoteRouteScanner } =
        await import("@/lib/scanner/remote-scanner");
      const scanner = new RemoteRouteScanner({
        accessToken: ghAccount.accessToken,
        owner: repo.owner ?? "",
        repo: repo.name ?? "",
        branch: repo.selectedBranch || repo.defaultBranch || "main",
      });
      const result = await scanner.scan();
      staticRoutes = result.routes.map((r) => ({
        path: r.path,
        type: r.type,
      }));
      framework = result.framework;
    }
    substeps[0] = {
      ...substeps[0],
      status: "done",
      detail: githubConnected
        ? `${staticRoutes.length} routes (${framework ?? "unknown"})`
        : "skipped — GitHub not connected",
    };
  } catch (err) {
    substeps[0] = {
      ...substeps[0],
      status: "error",
      detail: err instanceof Error ? err.message : "scan failed",
    };
  }
  await updateSubsteps(sessionId, "qa_discover", substeps);

  if (await isStopped(sessionId, signal)) return false;

  // 2) Live crawl on an Embedded Browser (streamed to the page live view).
  substeps[1] = { ...substeps[1], status: "running" };
  await updateSubsteps(sessionId, "qa_discover", substeps);

  let runnerId: string | undefined;
  let crawled: Awaited<ReturnType<typeof crawlTargetApp>> = {
    pages: [],
    loginAttempted: false,
  };
  try {
    const eb = await claimEmbeddedBrowserForAgent(EB_CLAIM_TIMEOUT_MS, () => {
      mergeMetadata(sessionId, { queuedForBrowser: true }).catch(() => {});
    });
    if (!eb) {
      substeps[1] = {
        ...substeps[1],
        status: "error",
        detail: "No embedded browser available",
      };
      await updateSubsteps(sessionId, "qa_discover", substeps);
    } else {
      runnerId = eb.runnerId;
      await mergeMetadata(sessionId, {
        queuedForBrowser: false,
        streamUrl: proxiedStream(eb.streamUrl),
      });
      const credentials = credentialsFrom(session.metadata);
      crawled = await crawlTargetApp(eb.cdpUrl, targetUrl, {
        maxPages: MAX_CRAWL_PAGES,
        credentials,
        signal,
        onPage: (snapshot, index) => {
          substeps[1] = {
            ...substeps[1],
            detail: `${index + 1} pages mapped — ${snapshot.finalUrl}`,
          };
          updateSubsteps(sessionId, "qa_discover", substeps).catch(() => {});
          emitActivity(
            teamId,
            repositoryId,
            sessionId,
            "substep:update",
            `Mapped ${snapshot.finalUrl}: ${snapshot.links.length} links, ${snapshot.forms.length} forms, ${snapshot.apiEndpoints.length} API calls`,
            { stepId: "qa_discover", agentType: "ranger" },
          );
        },
      });
      substeps[1] = {
        ...substeps[1],
        status: crawled.pages.length > 0 ? "done" : "error",
        detail:
          crawled.pages.length > 0
            ? `${crawled.pages.length} pages, ${crawled.pages.reduce((n, p) => n + p.apiEndpoints.length, 0)} API calls observed${crawled.loginAttempted ? ", logged in" : ""}`
            : "No pages could be mapped",
      };
      await updateSubsteps(sessionId, "qa_discover", substeps);
    }
  } catch (err) {
    substeps[1] = {
      ...substeps[1],
      status: "error",
      detail: err instanceof Error ? err.message : "crawl failed",
    };
    await updateSubsteps(sessionId, "qa_discover", substeps);
  } finally {
    await mergeMetadata(sessionId, { streamUrl: undefined }).catch(() => {});
    if (runnerId) await releasePoolEB(runnerId).catch(() => {});
  }

  if (crawled.pages.length === 0 && staticRoutes.length === 0) {
    await setStepFailed(
      sessionId,
      "qa_discover",
      "Discovery produced nothing — the target URL could not be crawled and no source routes were found",
    );
    return false;
  }

  const discovery: QaDiscovery = {
    targetUrl,
    crawledPages: crawled.pages,
    staticRoutes: staticRoutes.length > 0 ? staticRoutes : undefined,
    framework,
    githubConnected,
  };
  await mergeMetadata(sessionId, { qaDiscovery: discovery });
  await setStepCompleted(sessionId, "qa_discover", {
    pagesCrawled: crawled.pages.length,
    staticRoutes: staticRoutes.length,
    apiEndpoints: crawled.pages.reduce((n, p) => n + p.apiEndpoints.length, 0),
  });
  emitActivity(
    teamId,
    repositoryId,
    sessionId,
    "step:complete",
    `Discovery complete: ${crawled.pages.length} pages crawled, ${staticRoutes.length} source routes`,
    { stepId: "qa_discover", agentType: "scout" },
  );
  return true;
}

// ── Step: qa_plan ────────────────────────────────────────────────────────────

async function runQaPlan(
  sessionId: string,
  teamId: string,
  repositoryId: string,
  signal: AbortSignal,
): Promise<boolean> {
  await setStepActive(sessionId, "qa_plan");
  const session = await queries.getAgentSession(sessionId);
  const discovery = session?.metadata.qaDiscovery;
  if (!session || !discovery) {
    await setStepFailed(sessionId, "qa_plan", "Missing discovery data");
    return false;
  }
  const groups = normalizeQaGroups(session.metadata.qaGroups ?? []);
  const credsProvided = Boolean(session.metadata.credsProvided);
  const feedback = session.metadata.qaPlannerFeedback;

  const substeps: NonNullable<AgentStepState["substeps"]> = [
    {
      label: "Planner designing test plan",
      status: "running",
      agent: "planner",
      inputSummary: `${discovery.crawledPages.length} pages, ${discovery.staticRoutes?.length ?? 0} routes, groups: ${groups.join(", ")}`,
    },
  ];
  await updateSubsteps(sessionId, "qa_plan", substeps);
  emitActivity(
    teamId,
    repositoryId,
    sessionId,
    "step:start",
    "Planner designing the test plan",
    { stepId: "qa_plan", agentType: "planner" },
  );

  const digest = buildDiscoveryDigest(discovery);
  const systemPrompt = buildPlannerSystemPrompt();
  const started = Date.now();

  // Coverage-aware planning: the planner always sees what already exists so
  // repeat runs (after code or manual test changes) refresh the spec instead
  // of redesigning it from scratch.
  const existingTests = await loadExistingTests(repositoryId).catch(() => []);
  const existingCoverage =
    existingTests.length > 0
      ? buildExistingCoverageDigest(existingTests)
      : undefined;

  const callPlanner = async (extraFeedback?: string): Promise<string> => {
    const settings = await queries.getAISettings(repositoryId);
    const config = getAIConfig(settings);
    const timeoutSignal = AbortSignal.timeout(PLANNER_TIMEOUT_MS);
    return generateWithAI(
      config,
      buildPlannerUserPrompt({
        digest,
        groups,
        credsProvided,
        existingCoverage,
        feedback:
          [feedback, extraFeedback].filter(Boolean).join("\n") || undefined,
      }),
      systemPrompt,
      {
        repositoryId,
        actionType: "qa_plan",
        responseFormat: "json_object",
        signal: AbortSignal.any([signal, timeoutSignal]),
        onLogCreated: (logId) => {
          substeps[0] = { ...substeps[0], promptLogId: logId };
          updateSubsteps(sessionId, "qa_plan", substeps).catch(() => {});
        },
      },
    );
  };

  let plan: QaTestPlan | null = null;
  let lastRaw = "";
  try {
    const raw = await callPlanner();
    lastRaw = raw;
    plan = parseAiJson(raw, isQaTestPlan, { source: "qa-plan" });
    if (!plan) {
      const retry = await callPlanner(
        "Your previous response was not a valid plan JSON object. Respond with ONLY the JSON object described in the system prompt.",
      );
      lastRaw = retry;
      plan = parseAiJson(retry, isQaTestPlan, { source: "qa-plan-retry" });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    substeps[0] = { ...substeps[0], status: "error", rawError: msg };
    await updateSubsteps(sessionId, "qa_plan", substeps);
    await setStepFailed(sessionId, "qa_plan", `Planner failed: ${msg}`);
    return false;
  }

  if (!plan) {
    // The planner replied (twice) but neither reply parsed into a valid plan.
    // Don't just fail with a bare message — surface the raw model output so the
    // user can read/copy it and proceed manually (retry, or build tests by
    // hand from what the planner produced). Cap the payload so a runaway reply
    // can't bloat the session row.
    const MAX_RAW_CHARS = 8_000;
    const rawOutput =
      lastRaw.length > MAX_RAW_CHARS
        ? `${lastRaw.slice(0, MAX_RAW_CHARS)}\n…(truncated — ${lastRaw.length} chars total)`
        : lastRaw;
    substeps[0] = {
      ...substeps[0],
      status: "error",
      rawError: "Planner output could not be parsed into a valid plan",
    };
    await updateSubsteps(sessionId, "qa_plan", substeps);
    await setStepFailed(
      sessionId,
      "qa_plan",
      "The planner replied but its output couldn't be parsed into a valid test plan after an automatic retry.",
      {
        manual: true,
        rawOutput,
        manualHint:
          "Start a new run to retry, or use the raw output below to build the suite manually (record a test, or create tests by hand). If this keeps happening, check the AI provider in Settings — its replies aren't valid JSON.",
      },
    );
    return false;
  }

  const sanitized = sanitizeQaPlan(plan, groups);
  substeps[0] = {
    ...substeps[0],
    status: "done",
    durationMs: Date.now() - started,
    outputSummary: `${sanitized.journeys.length} journeys, ${sanitized.items.length} test items`,
  };
  await updateSubsteps(sessionId, "qa_plan", substeps);
  await mergeMetadata(sessionId, {
    qaPlan: sanitized,
    qaPlannerFeedback: undefined,
  });
  await setStepCompleted(sessionId, "qa_plan", {
    journeys: sanitized.journeys.length,
    items: sanitized.items.length,
    byGroup: Object.fromEntries(
      QA_GROUPS.map((g) => [
        g.id,
        sanitized.items.filter((i) => i.group === g.id).length,
      ]).filter(([, n]) => (n as number) > 0),
    ),
  });
  emitActivity(
    teamId,
    repositoryId,
    sessionId,
    "step:complete",
    `Plan ready: ${sanitized.journeys.length} journeys, ${sanitized.items.length} tests across ${groups.length} groups`,
    { stepId: "qa_plan", agentType: "planner" },
  );
  return true;
}

// ── Step: qa_plan_review (human gate) ────────────────────────────────────────

async function runQaPlanReview(
  sessionId: string,
  teamId: string,
  repositoryId: string,
): Promise<boolean> {
  await setStepActive(sessionId, "qa_plan_review");
  const session = await queries.getAgentSession(sessionId);
  if (session?.metadata.qaAutoApprove) {
    await updateStep(sessionId, "qa_plan_review", {
      status: "completed",
      completedAt: new Date().toISOString(),
      userAction: "auto-approved",
    });
    return true;
  }
  await updateStep(sessionId, "qa_plan_review", {
    status: "waiting_user",
    userAction: "Review the test plan, then approve or request changes",
  });
  await queries.updateAgentSession(sessionId, { status: "paused" });
  emitActivity(
    teamId,
    repositoryId,
    sessionId,
    "step:start",
    "Waiting for plan review",
    { stepId: "qa_plan_review", agentType: "orchestrator" },
  );
  return false; // pipeline resumes via approveQaPlan
}

// ── Step: qa_generate ────────────────────────────────────────────────────────

async function runQaGenerate(
  sessionId: string,
  teamId: string,
  repositoryId: string,
  signal: AbortSignal,
): Promise<boolean> {
  await setStepActive(sessionId, "qa_generate");
  const session = await queries.getAgentSession(sessionId);
  const plan = session?.metadata.qaPlan;
  const targetUrl = session?.metadata.qaTargetUrl;
  if (!session || !plan || !targetUrl) {
    await setStepFailed(sessionId, "qa_generate", "Missing approved plan");
    return false;
  }
  const credentials = credentialsFrom(session.metadata);
  const items = enabledPlanItems(plan);
  // Resume-safe: skip items that already produced a test in a prior attempt.
  const ledger: QaGeneratedTest[] = [
    ...(session.metadata.qaGeneratedTests ?? []),
  ];
  const doneItemIds = new Set(
    ledger.filter((g) => g.testId).map((g) => g.planItemId),
  );

  // Gap awareness: items already satisfied by a live test (from a prior run's
  // ledger or a name-matching manual test) are marked covered and skipped —
  // this is what makes repeat runs fill gaps instead of duplicating the suite.
  const [existingTests, priorLedger] = await Promise.all([
    loadExistingTests(repositoryId).catch(() => []),
    loadPriorLedger(session).catch(() => undefined),
  ]);
  const coveredBy = matchPlanToExistingTests(items, existingTests, priorLedger);
  for (const item of items) {
    if (doneItemIds.has(item.id)) continue;
    const testId = coveredBy.get(item.id);
    if (!testId) continue;
    ledger.push({
      planItemId: item.id,
      group: item.group,
      testId,
      name: item.title,
      status: "covered",
    });
    doneItemIds.add(item.id);
  }
  if (coveredBy.size > 0) {
    await mergeMetadata(sessionId, { qaGeneratedTests: [...ledger] });
  }

  const pending = items.filter((i) => !doneItemIds.has(i.id));

  emitActivity(
    teamId,
    repositoryId,
    sessionId,
    "step:start",
    `Generating ${pending.length} tests (${items.length - pending.length} already covered or done)`,
    { stepId: "qa_generate", agentType: "generator" },
  );

  const groupLabel = (g: QaTestGroup) =>
    QA_GROUPS.find((m) => m.id === g)?.label ?? g;

  // Areas: one per group, flat, prefixed for recognizability in /tests.
  const areaIdByGroup = new Map<QaTestGroup, string>();
  for (const group of new Set(items.map((i) => i.group))) {
    const area = await queries.getOrCreateFunctionalAreaByRepo(
      repositoryId,
      `QA: ${groupLabel(group)}`,
    );
    areaIdByGroup.set(group, area.id);
  }

  const qaBot = await queries
    .getBotByKind(teamId, "play_agent")
    .catch(() => undefined);

  const substeps: NonNullable<AgentStepState["substeps"]> = pending.map(
    (item) => ({
      label: `${groupLabel(item.group)}: ${item.title}`,
      status: "pending",
      agent: "generator",
    }),
  );
  await updateSubsteps(sessionId, "qa_generate", substeps);

  const upsertLedger = async (entry: QaGeneratedTest) => {
    const idx = ledger.findIndex((g) => g.planItemId === entry.planItemId);
    if (idx === -1) ledger.push(entry);
    else ledger[idx] = entry;
    await mergeMetadata(sessionId, { qaGeneratedTests: [...ledger] });
  };

  // API items need no browser — build headless definitions directly.
  const apiItems = pending.filter((i) => i.group === "api" && i.api);
  const browserItems = pending.filter((i) => !apiItems.includes(i));

  for (const item of apiItems) {
    if (await isStopped(sessionId, signal)) return false;
    const subIdx = pending.indexOf(item);
    substeps[subIdx] = { ...substeps[subIdx], status: "running" };
    await updateSubsteps(sessionId, "qa_generate", substeps);
    const definition = buildApiDefinition(item, targetUrl);
    if (!definition) {
      substeps[subIdx] = {
        ...substeps[subIdx],
        status: "error",
        detail: "No API endpoint on plan item",
      };
      await upsertLedger({
        planItemId: item.id,
        group: item.group,
        name: item.title,
        status: "generation_failed",
        error: "Plan item had no API definition",
      });
      continue;
    }
    const test = await queries.createTest({
      repositoryId,
      functionalAreaId: areaIdByGroup.get(item.group),
      name: item.title,
      code: `// Headless API test — executed via apiDefinition (${definition.method} ${definition.url})`,
      targetUrl,
      testType: "api",
      apiDefinition: definition,
      ...(qaBot ? { createdByBotId: qaBot.id } : {}),
    });
    substeps[subIdx] = { ...substeps[subIdx], status: "done" };
    await updateSubsteps(sessionId, "qa_generate", substeps);
    await upsertLedger({
      planItemId: item.id,
      group: item.group,
      testId: test.id,
      name: item.title,
      status: "generated",
    });
    emitActivity(
      teamId,
      repositoryId,
      sessionId,
      "artifact:created",
      `Created API test "${item.title}"`,
      {
        stepId: "qa_generate",
        agentType: "generator",
        artifactType: "test",
        artifactId: test.id,
        artifactLabel: item.title,
      },
    );
  }

  // Browser items share one EB, generated sequentially so the live view is
  // coherent and the pool isn't drained.
  let runnerId: string | undefined;
  try {
    if (browserItems.length > 0) {
      const eb = await claimEmbeddedBrowserForAgent(EB_CLAIM_TIMEOUT_MS, () => {
        mergeMetadata(sessionId, { queuedForBrowser: true }).catch(() => {});
      });
      if (!eb) {
        await setStepFailed(
          sessionId,
          "qa_generate",
          "No embedded browser available for test generation",
        );
        return false;
      }
      runnerId = eb.runnerId;
      await mergeMetadata(sessionId, {
        queuedForBrowser: false,
        streamUrl: proxiedStream(eb.streamUrl),
      });

      const { agentCreateTest } =
        await import("@/lib/playwright/generator-agent");

      for (const item of browserItems) {
        if (await isStopped(sessionId, signal)) return false;
        const subIdx = pending.indexOf(item);
        const started = Date.now();
        substeps[subIdx] = { ...substeps[subIdx], status: "running" };
        await updateSubsteps(sessionId, "qa_generate", substeps);
        emitActivity(
          teamId,
          repositoryId,
          sessionId,
          "substep:update",
          `Generator working on "${item.title}" (${item.group})`,
          { stepId: "qa_generate", agentType: "generator" },
        );
        try {
          const timeoutSignal = AbortSignal.timeout(GENERATOR_TIMEOUT_MS);
          const result = await agentCreateTest(
            repositoryId,
            {
              testName: item.title,
              baseUrl: targetUrl,
              routePath: item.pagePath,
              userPrompt: buildGeneratorPrompt({
                item,
                plan,
                targetUrl,
                credentials,
              }),
            },
            {
              signal: AbortSignal.any([signal, timeoutSignal]),
              cdpEndpoint: eb.cdpUrl,
            },
          );
          if (result.success && result.code) {
            const test = await queries.createTest({
              repositoryId,
              functionalAreaId: areaIdByGroup.get(item.group),
              name: item.title,
              code: result.code,
              targetUrl,
              playwrightOverrides: groupPlaywrightOverrides(item.group),
              ...(qaBot ? { createdByBotId: qaBot.id } : {}),
            });
            substeps[subIdx] = {
              ...substeps[subIdx],
              status: "done",
              durationMs: Date.now() - started,
            };
            await upsertLedger({
              planItemId: item.id,
              group: item.group,
              testId: test.id,
              name: item.title,
              status: "generated",
            });
            emitActivity(
              teamId,
              repositoryId,
              sessionId,
              "artifact:created",
              `Generated test "${item.title}" (${item.group})`,
              {
                stepId: "qa_generate",
                agentType: "generator",
                artifactType: "test",
                artifactId: test.id,
                artifactLabel: item.title,
                durationMs: Date.now() - started,
              },
            );
          } else {
            substeps[subIdx] = {
              ...substeps[subIdx],
              status: "error",
              detail: result.error?.slice(0, 200),
              rawError: result.error,
              durationMs: Date.now() - started,
            };
            await upsertLedger({
              planItemId: item.id,
              group: item.group,
              name: item.title,
              status: "generation_failed",
              error: result.error,
            });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          substeps[subIdx] = {
            ...substeps[subIdx],
            status: "error",
            detail: msg.slice(0, 200),
            rawError: msg,
            durationMs: Date.now() - started,
          };
          await upsertLedger({
            planItemId: item.id,
            group: item.group,
            name: item.title,
            status: "generation_failed",
            error: msg,
          });
        }
        await updateSubsteps(sessionId, "qa_generate", substeps);
      }
    }
  } finally {
    await mergeMetadata(sessionId, { streamUrl: undefined }).catch(() => {});
    if (runnerId) await releasePoolEB(runnerId).catch(() => {});
  }

  const generatedCount = ledger.filter(
    (g) => g.testId && g.status !== "covered",
  ).length;
  const coveredCount = ledger.filter((g) => g.status === "covered").length;
  if (generatedCount === 0 && coveredCount === 0) {
    await setStepFailed(
      sessionId,
      "qa_generate",
      "No tests could be generated — check the AI provider and embedded-browser pool",
    );
    return false;
  }
  await setStepCompleted(sessionId, "qa_generate", {
    generated: generatedCount,
    covered: coveredCount,
    failed: ledger.filter((g) => g.status === "generation_failed").length,
  });
  emitActivity(
    teamId,
    repositoryId,
    sessionId,
    "step:complete",
    `Generated ${generatedCount}/${items.length} tests (${coveredCount} already covered)`,
    { stepId: "qa_generate", agentType: "generator" },
  );
  return true;
}

// ── Execution helper: run tests and resolve per-test results ────────────────

async function runAndCollect(
  sessionId: string,
  repositoryId: string,
  testIds: string[],
  signal: AbortSignal,
): Promise<Map<string, "passed" | "failed"> | null> {
  // runTestsCore returns { runId, jobId } directly, or { runId: null, jobId }
  // when the pool was busy and the run got queued as a pending background job.
  const run = await runTestsCore(testIds, repositoryId, true);
  const runId = run.runId ?? undefined;
  const jobId = run.jobId;
  if (runId) {
    const current = await queries.getAgentSession(sessionId);
    await mergeMetadata(sessionId, {
      qaRunIds: [...(current?.metadata.qaRunIds ?? []), runId],
    });
  }

  const deadline = Date.now() + RUN_TIMEOUT_MS;
  for (;;) {
    if (await isStopped(sessionId, signal)) return null;
    if (Date.now() > deadline) break;
    if (runId) {
      const runRow = await queries.getTestRun(runId);
      if (runRow?.status && runRow.status !== "running") break;
    } else if (jobId) {
      // The run was queued for a free browser; wait on the background job.
      const job = await queries.getBackgroundJob(jobId);
      if (job && job.status !== "pending" && job.status !== "running") break;
      if (!job) break;
    } else {
      break;
    }
    await new Promise((r) => setTimeout(r, RUN_POLL_INTERVAL_MS));
  }

  // Resolve outcome per test from its latest result (robust for both the
  // direct-run and queued paths).
  const statuses = new Map<string, "passed" | "failed">();
  for (const testId of testIds) {
    const results = await queries.getTestResultsByTest(testId);
    const latest = results[0];
    statuses.set(testId, latest?.status === "passed" ? "passed" : "failed");
  }
  return statuses;
}

// ── Step: qa_execute ─────────────────────────────────────────────────────────

async function runQaExecute(
  sessionId: string,
  teamId: string,
  repositoryId: string,
  signal: AbortSignal,
): Promise<boolean> {
  await setStepActive(sessionId, "qa_execute");
  const session = await queries.getAgentSession(sessionId);
  const ledger = [...(session?.metadata.qaGeneratedTests ?? [])];
  // Only newly generated tests run here (plus prior failures on a resume) —
  // "covered" entries belong to the standing suite and run via normal builds.
  const runnable = ledger.filter(
    (g) => g.testId && (g.status === "generated" || g.status === "failed"),
  );
  if (runnable.length === 0) {
    const anyCovered = ledger.some((g) => g.status === "covered");
    if (anyCovered) {
      await setStepSkipped(
        sessionId,
        "qa_execute",
        "Nothing new to run — every plan item is covered by an existing test",
      );
      return true;
    }
    await setStepFailed(sessionId, "qa_execute", "No generated tests to run");
    return false;
  }

  await updateSubsteps(sessionId, "qa_execute", [
    {
      label: `Running ${runnable.length} tests`,
      status: "running",
      agent: "orchestrator",
    },
  ]);
  emitActivity(
    teamId,
    repositoryId,
    sessionId,
    "step:start",
    `Executing ${runnable.length} generated tests`,
    { stepId: "qa_execute", agentType: "orchestrator" },
  );

  let statuses: Map<string, "passed" | "failed"> | null;
  try {
    statuses = await runAndCollect(
      sessionId,
      repositoryId,
      runnable.map((g) => g.testId!) as string[],
      signal,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await setStepFailed(sessionId, "qa_execute", `Run failed: ${msg}`);
    return false;
  }
  if (!statuses) return false; // stopped

  let passed = 0;
  const ranIds = new Set(runnable.map((g) => g.testId));
  for (const entry of ledger) {
    if (!entry.testId || !ranIds.has(entry.testId)) continue;
    const status = statuses.get(entry.testId);
    entry.status = status === "passed" ? "passed" : "failed";
    if (status === "passed") passed += 1;
  }
  await mergeMetadata(sessionId, { qaGeneratedTests: [...ledger] });
  await updateSubsteps(sessionId, "qa_execute", [
    {
      label: `Running ${runnable.length} tests`,
      status: "done",
      detail: `${passed} passed, ${runnable.length - passed} failed`,
      agent: "orchestrator",
    },
  ]);
  await setStepCompleted(sessionId, "qa_execute", {
    total: runnable.length,
    passed,
    failed: runnable.length - passed,
  });
  emitActivity(
    teamId,
    repositoryId,
    sessionId,
    "step:complete",
    `Suite executed: ${passed}/${runnable.length} passed`,
    { stepId: "qa_execute", agentType: "orchestrator" },
  );
  return true;
}

// ── Step: qa_heal ────────────────────────────────────────────────────────────

async function runQaHeal(
  sessionId: string,
  teamId: string,
  repositoryId: string,
  signal: AbortSignal,
): Promise<boolean> {
  await setStepActive(sessionId, "qa_heal");
  const session = await queries.getAgentSession(sessionId);
  const ledger = [...(session?.metadata.qaGeneratedTests ?? [])];
  const failing = ledger.filter((g) => g.testId && g.status === "failed");
  if (failing.length === 0) {
    await setStepSkipped(sessionId, "qa_heal", "Nothing to heal — all passed");
    return true;
  }

  const substeps: NonNullable<AgentStepState["substeps"]> = failing.map(
    (g) => ({
      label: `Healing "${g.name}"`,
      status: "pending",
      agent: "healer",
    }),
  );
  await updateSubsteps(sessionId, "qa_heal", substeps);
  emitActivity(
    teamId,
    repositoryId,
    sessionId,
    "step:start",
    `Healer fixing ${failing.length} failing tests`,
    { stepId: "qa_heal", agentType: "healer" },
  );

  let runnerId: string | undefined;
  const healedTestIds: string[] = [];
  try {
    const eb = await claimEmbeddedBrowserForAgent(EB_CLAIM_TIMEOUT_MS, () => {
      mergeMetadata(sessionId, { queuedForBrowser: true }).catch(() => {});
    });
    if (eb) {
      runnerId = eb.runnerId;
      await mergeMetadata(sessionId, {
        queuedForBrowser: false,
        streamUrl: proxiedStream(eb.streamUrl),
      });
      const { agentHealTestCore } =
        await import("@/lib/playwright/healer-agent");
      for (let i = 0; i < failing.length; i++) {
        if (await isStopped(sessionId, signal)) return false;
        const entry = failing[i];
        substeps[i] = { ...substeps[i], status: "running" };
        await updateSubsteps(sessionId, "qa_heal", substeps);
        try {
          const timeoutSignal = AbortSignal.timeout(HEAL_TIMEOUT_MS);
          const result = await agentHealTestCore(repositoryId, entry.testId!, {
            cdpEndpoint: eb.cdpUrl,
            signal: AbortSignal.any([signal, timeoutSignal]),
          });
          if (result.success && result.code) {
            await queries.updateTest(entry.testId!, { code: result.code });
            healedTestIds.push(entry.testId!);
            substeps[i] = { ...substeps[i], status: "done" };
          } else {
            substeps[i] = {
              ...substeps[i],
              status: "error",
              detail: result.error?.slice(0, 200),
            };
          }
        } catch (err) {
          substeps[i] = {
            ...substeps[i],
            status: "error",
            detail: err instanceof Error ? err.message.slice(0, 200) : "failed",
          };
        }
        await updateSubsteps(sessionId, "qa_heal", substeps);
      }
    } else {
      for (let i = 0; i < substeps.length; i++) {
        substeps[i] = {
          ...substeps[i],
          status: "error",
          detail: "No embedded browser available",
        };
      }
      await updateSubsteps(sessionId, "qa_heal", substeps);
    }
  } finally {
    await mergeMetadata(sessionId, { streamUrl: undefined }).catch(() => {});
    if (runnerId) await releasePoolEB(runnerId).catch(() => {});
  }

  // Re-run only the healed tests to confirm the fixes.
  let confirmed = 0;
  if (healedTestIds.length > 0) {
    if (await isStopped(sessionId, signal)) return false;
    const statuses = await runAndCollect(
      sessionId,
      repositoryId,
      healedTestIds,
      signal,
    ).catch(() => null);
    if (statuses === null && signal.aborted) return false;
    for (const entry of ledger) {
      if (!entry.testId || !healedTestIds.includes(entry.testId)) continue;
      const status = statuses?.get(entry.testId);
      entry.status = status === "passed" ? "healed" : "failed";
      if (status === "passed") confirmed += 1;
    }
    await mergeMetadata(sessionId, { qaGeneratedTests: [...ledger] });
  }

  await setStepCompleted(sessionId, "qa_heal", {
    attempted: failing.length,
    healed: confirmed,
  });
  emitActivity(
    teamId,
    repositoryId,
    sessionId,
    "step:complete",
    `Healed ${confirmed}/${failing.length} failing tests`,
    { stepId: "qa_heal", agentType: "healer" },
  );
  return true;
}

// ── Step: qa_summary ─────────────────────────────────────────────────────────

async function runQaSummary(
  sessionId: string,
  teamId: string,
  repositoryId: string,
): Promise<boolean> {
  await setStepActive(sessionId, "qa_summary");
  const session = await queries.getAgentSession(sessionId);
  const plan = session?.metadata.qaPlan;
  if (!session || !plan) {
    await setStepFailed(sessionId, "qa_summary", "Missing plan");
    return false;
  }

  // Spec-refresh runs skip generation, so their ledger is empty — build it
  // here from existing-coverage matches so the summary shows exactly which
  // plan items the current suite covers and which are gaps (fill_gaps input).
  let ledger = session.metadata.qaGeneratedTests ?? [];
  if (ledger.length === 0) {
    const [existingTests, priorLedger] = await Promise.all([
      loadExistingTests(repositoryId).catch(() => []),
      loadPriorLedger(session).catch(() => undefined),
    ]);
    const items = enabledPlanItems(plan);
    const coveredBy = matchPlanToExistingTests(
      items,
      existingTests,
      priorLedger,
    );
    ledger = items
      .filter((i) => coveredBy.has(i.id))
      .map((i) => ({
        planItemId: i.id,
        group: i.group,
        testId: coveredBy.get(i.id),
        name: i.title,
        status: "covered" as const,
      }));
    await mergeMetadata(sessionId, { qaGeneratedTests: ledger });
  }

  const summary = computeQaSummary(plan, ledger);
  await mergeMetadata(sessionId, { qaSummary: summary });
  await setStepCompleted(sessionId, "qa_summary", {
    planned: summary.planned,
    generated: summary.generated,
    covered: summary.covered,
    passed: summary.passed,
  });
  await queries.updateAgentSession(sessionId, {
    status: "completed",
    completedAt: new Date(),
  });
  const gaps = summary.planned - summary.covered - summary.generated;
  emitActivity(
    teamId,
    repositoryId,
    sessionId,
    "session:complete",
    session.metadata.qaMode === "refresh_spec"
      ? `Specification refreshed: ${summary.planned} planned, ${summary.covered} covered by existing tests, ${gaps} gaps`
      : `QA suite build complete: ${summary.generated} tests generated, ${summary.covered} already covered, ${summary.passed} passing`,
  );
  return true;
}

// ── Pipeline ─────────────────────────────────────────────────────────────────

/** Step lists per run mode — a session's `steps` array IS its pipeline; the
 *  executor walks it in order, so segmented modes just build shorter lists. */
const MODE_PIPELINES: Record<QaRunMode, AgentStepId[]> = {
  full: QA_STEP_DEFINITIONS.map((s) => s.id),
  // Re-discover + re-plan against existing coverage; no generation. Summary
  // reports which plan items the current suite already covers vs. the gaps.
  refresh_spec: [
    "qa_setup",
    "qa_discover",
    "qa_plan",
    "qa_plan_review",
    "qa_summary",
  ],
  // Reuse the latest plan/discovery; generate only uncovered items.
  fill_gaps: ["qa_setup", "qa_generate", "qa_execute", "qa_heal", "qa_summary"],
};

function buildStepsForMode(mode: QaRunMode): AgentStepState[] {
  return MODE_PIPELINES[mode].map((id, i) => {
    const def = QA_STEP_DEFINITIONS.find((d) => d.id === id)!;
    return {
      id,
      status: i === 0 ? ("active" as const) : ("pending" as const),
      label: def.label,
      description: def.description,
    };
  });
}

async function executeQaPipeline(
  sessionId: string,
  teamId: string,
  repositoryId: string,
  fromStep: AgentStepId,
) {
  const controller = getOrCreateController(sessionId);
  const signal = controller.signal;
  const session = await queries.getAgentSession(sessionId);
  if (!session) return;
  // The session's own steps define the pipeline (mode-dependent).
  const pipeline = session.steps.map((s) => s.id);
  const startIdx = pipeline.indexOf(fromStep);
  if (startIdx === -1) return;

  try {
    for (let i = startIdx; i < pipeline.length; i++) {
      if (await isStopped(sessionId, signal)) return;
      const stepId = pipeline[i];
      let ok = false;
      switch (stepId) {
        case "qa_setup":
          ok = await runQaSetup(sessionId, teamId, repositoryId, signal);
          break;
        case "qa_discover":
          ok = await runQaDiscover(sessionId, teamId, repositoryId, signal);
          break;
        case "qa_plan":
          ok = await runQaPlan(sessionId, teamId, repositoryId, signal);
          break;
        case "qa_plan_review":
          ok = await runQaPlanReview(sessionId, teamId, repositoryId);
          break;
        case "qa_generate":
          ok = await runQaGenerate(sessionId, teamId, repositoryId, signal);
          break;
        case "qa_execute":
          ok = await runQaExecute(sessionId, teamId, repositoryId, signal);
          break;
        case "qa_heal":
          ok = await runQaHeal(sessionId, teamId, repositoryId, signal);
          break;
        case "qa_summary":
          ok = await runQaSummary(sessionId, teamId, repositoryId);
          break;
      }
      if (!ok) return;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[QaAgent] pipeline error:", err);
    const session = await queries.getAgentSession(sessionId).catch(() => null);
    const current = session?.currentStepId ?? fromStep;
    await setStepFailed(sessionId, current, msg).catch(() => {});
    emitActivity(
      teamId,
      repositoryId,
      sessionId,
      "session:error",
      `QA agent failed: ${msg}`,
    );
  } finally {
    activeControllers.delete(sessionId);
  }
}

// ── Public actions ───────────────────────────────────────────────────────────

export interface StartQaAgentInput {
  repositoryId: string;
  targetUrl: string;
  /** full (default) | refresh_spec | fill_gaps — see QaRunMode. */
  mode?: QaRunMode;
  groups: QaTestGroup[];
  email?: string;
  password?: string;
  autoApprove?: boolean;
}

export async function startQaAgent(
  input: StartQaAgentInput,
): Promise<{ sessionId: string }> {
  const { team } = await requireRepoAccess(input.repositoryId);

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

  // One active QA session per repo — cancel a stale one before starting.
  const existing = await queries.getActiveAgentSession(
    input.repositoryId,
    "qa",
  );
  if (existing) {
    activeControllers.get(existing.id)?.abort();
    await queries.updateAgentSession(existing.id, {
      status: "cancelled",
      completedAt: new Date(),
    });
  }

  const mode: QaRunMode = input.mode ?? "full";
  const credsProvided = Boolean(input.email?.trim() && input.password);
  const steps = buildStepsForMode(mode);

  // fill_gaps reuses the newest stored plan (from any prior full/refresh run)
  // instead of re-discovering and re-planning.
  let planSeed: Partial<AgentSessionMetadata> = {};
  if (mode === "fill_gaps") {
    const recent = await queries.getRecentAgentSessions(
      input.repositoryId,
      "qa",
      10,
    );
    const source = recent.find((s) => s.metadata.qaPlan);
    if (!source) {
      throw new Error(
        "No stored test plan to fill gaps from — run the agent (full or refresh specification) first",
      );
    }
    planSeed = {
      qaPlan: source.metadata.qaPlan,
      qaDiscovery: source.metadata.qaDiscovery,
      qaPlanSourceSessionId: source.id,
    };
  }

  const session = await queries.createAgentSession({
    repositoryId: input.repositoryId,
    teamId: team.id,
    kind: "qa",
    status: "active",
    currentStepId: "qa_setup",
    steps,
    metadata: {
      qaTargetUrl: targetUrl,
      qaMode: mode,
      qaGroups: normalizeQaGroups(input.groups),
      qaAutoApprove: Boolean(input.autoApprove),
      credsProvided,
      authMode: credsProvided ? "login" : "public_only",
      ...planSeed,
      ...(credsProvided
        ? {
            quickstartEmail: input.email!.trim(),
            quickstartPassword: input.password!,
          }
        : {}),
    },
  });

  emitActivity(
    team.id,
    input.repositoryId,
    session.id,
    "session:start",
    `QA agent started on ${targetUrl} (${mode.replace("_", " ")})`,
  );

  executeQaPipeline(session.id, team.id, input.repositoryId, "qa_setup").catch(
    (err) => console.error("[QaAgent] unhandled:", err),
  );

  revalidatePath("/qa-agent");
  return { sessionId: session.id };
}

async function requireQaSession(sessionId: string): Promise<{
  session: AgentSession;
  teamId: string;
}> {
  const { team } = await requireTeamAccess();
  const session = await queries.getAgentSession(sessionId);
  if (!session || session.kind !== "qa") {
    throw new Error("QA session not found");
  }
  if (session.teamId && session.teamId !== team.id) {
    throw new Error("QA session not found");
  }
  return { session, teamId: team.id };
}

export async function approveQaPlan(
  sessionId: string,
  opts?: { disabledItemIds?: string[]; autoApprove?: boolean },
): Promise<{ success: boolean }> {
  const { session, teamId } = await requireQaSession(sessionId);
  const plan = session.metadata.qaPlan;
  if (!plan) return { success: false };

  const disabled = new Set(opts?.disabledItemIds ?? []);
  const updatedPlan: QaTestPlan = {
    ...plan,
    items: plan.items.map((i) => ({ ...i, enabled: !disabled.has(i.id) })),
  };
  if (enabledPlanItems(updatedPlan).length === 0) {
    throw new Error("Cannot approve a plan with every test disabled");
  }

  await queries.updateAgentSession(sessionId, { status: "active" });
  await mergeMetadata(sessionId, {
    qaPlan: updatedPlan,
    ...(opts?.autoApprove !== undefined
      ? { qaAutoApprove: opts.autoApprove }
      : {}),
  });
  await updateStep(sessionId, "qa_plan_review", {
    status: "completed",
    completedAt: new Date().toISOString(),
    userAction: `approved (${enabledPlanItems(updatedPlan).length} tests)`,
  });
  emitActivity(
    teamId,
    session.repositoryId,
    sessionId,
    "step:complete",
    `Plan approved with ${enabledPlanItems(updatedPlan).length} tests`,
    { stepId: "qa_plan_review", agentType: "orchestrator" },
  );

  // Continue with whatever follows the review gate in THIS session's
  // pipeline — qa_generate on full runs, qa_summary on refresh_spec runs.
  const reviewIdx = session.steps.findIndex((s) => s.id === "qa_plan_review");
  const nextStep = session.steps[reviewIdx + 1]?.id ?? "qa_summary";
  executeQaPipeline(sessionId, teamId, session.repositoryId, nextStep).catch(
    (err) => console.error("[QaAgent] unhandled:", err),
  );
  revalidatePath("/qa-agent");
  return { success: true };
}

export async function rerunQaPlanner(
  sessionId: string,
  feedback: string,
): Promise<{ success: boolean }> {
  const { session, teamId } = await requireQaSession(sessionId);
  await mergeMetadata(sessionId, {
    qaPlannerFeedback: feedback.slice(0, 4000),
  });
  await updateStep(sessionId, "qa_plan", {
    status: "pending",
    completedAt: undefined,
    error: undefined,
    substeps: [],
  });
  await updateStep(sessionId, "qa_plan_review", {
    status: "pending",
    userAction: undefined,
  });
  await queries.updateAgentSession(sessionId, { status: "active" });

  executeQaPipeline(sessionId, teamId, session.repositoryId, "qa_plan").catch(
    (err) => console.error("[QaAgent] unhandled:", err),
  );
  revalidatePath("/qa-agent");
  return { success: true };
}

export async function pauseQaAgent(
  sessionId: string,
): Promise<{ success: boolean }> {
  const { session } = await requireQaSession(sessionId);
  if (session.status !== "active") return { success: false };
  activeControllers.get(sessionId)?.abort();
  await queries.updateAgentSession(sessionId, { status: "paused" });
  revalidatePath("/qa-agent");
  return { success: true };
}

export async function resumeQaAgent(
  sessionId: string,
): Promise<{ success: boolean }> {
  const { session, teamId } = await requireQaSession(sessionId);
  if (session.status !== "paused") return { success: false };

  // If we're paused at the review gate, resuming means "keep waiting" — the
  // user should approve instead. Everything else re-runs the current step.
  const current = session.currentStepId ?? "qa_setup";
  if (current === "qa_plan_review" && !session.metadata.qaAutoApprove) {
    return { success: false };
  }
  await queries.updateAgentSession(sessionId, { status: "active" });
  executeQaPipeline(sessionId, teamId, session.repositoryId, current).catch(
    (err) => console.error("[QaAgent] unhandled:", err),
  );
  revalidatePath("/qa-agent");
  return { success: true };
}

export async function cancelQaAgent(
  sessionId: string,
): Promise<{ success: boolean }> {
  const { session, teamId } = await requireQaSession(sessionId);
  activeControllers.get(sessionId)?.abort();
  await queries.updateAgentSession(sessionId, {
    status: "cancelled",
    completedAt: new Date(),
  });
  emitActivity(
    teamId,
    session.repositoryId,
    sessionId,
    "session:error",
    "QA agent cancelled by user",
  );
  revalidatePath("/qa-agent");
  return { success: true };
}
