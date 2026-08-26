"use server";

import { revalidatePath } from "next/cache";

import { parseAiJson } from "@lastest/ai-kit";
import type { BrowserSession, PluginContext } from "@lastest/contracts";
import { getNextRunTime, isValidCron } from "@lastest/cron";
import type {
  QaAuthState,
  QaDiscovery,
  QaExploreBlocked,
  QaExploreConfig,
  QaExploreState,
  QaExplorerState,
  QaGeneratedTest,
  QaPageSnapshot,
  QaPlanItem,
  QaRunMode,
  QaSessionTrigger,
  QaTestGroup,
  QaTestPlan,
} from "@lastest/eb-protocol";
import {
  renderAuthLoginCode,
  renderAuthSetupCode,
  renderQuickstartEmail,
  renderQuickstartPassword,
  slugify,
  utcStamp,
} from "@lastest/test-templates";

import { orm } from "./data/db";
import {
  createQaTaskRow,
  getNextQueuedQaTaskRow,
  getQaTaskRow,
  getQaTasksByRepoRows,
  updateQaTaskRow,
} from "./data/tasks";
import {
  getDueQaAgentTriggerRows,
  getQaAgentTriggerRow,
  markQaAgentTriggerFiredRow,
  upsertQaAgentTriggerRow,
} from "./data/triggers";
import {
  findAuthLinksOnEb,
  loginWithCredsOnEb,
  probeAndCaptureOnEb,
  validateStorageStateOnEb,
} from "./domain/auth";
import { crawlTargetApp } from "./domain/crawl";
import { processUploadedDocs } from "./domain/docs";
import { exploreTargetApp } from "./domain/explore";
import {
  buildApiDefinition,
  buildDiscoveryDigest,
  buildExistingCoverageDigest,
  buildExistingPlanDigest,
  buildGeneratorPrompt,
  buildJourneyRefinerSystemPrompt,
  buildJourneyRefinerUserPrompt,
  buildPlannerSystemPrompt,
  buildPlannerUserPrompt,
  computeQaSummary,
  enabledPlanItems,
  explainInvalidQaPlan,
  explainInvalidRefinedJourneys,
  isQaTestPlan,
  isRefinedJourneys,
  itemGroups,
  itemPlaywrightOverrides,
  matchPlanToExistingTests,
  MAX_PLAN_ITEMS,
  mergeRefinedJourneys,
  normalizeQaGroups,
  sanitizeQaPlan,
  QA_GROUPS,
  type ExistingTestSummary,
  type RefinedJourneys,
} from "./domain/plan";
import { extractDeclaredEndpoints } from "./domain/code-check";
import { computePrChanges, computePrCoverage } from "./domain/pr-check";
import {
  buildCoverageDirective,
  buildStopSummary,
  computePlanBudget,
} from "@lastest/coverage-model";
import { ensureCoverageFresh } from "@/lib/core/coverage-reads";
import {
  buildTaskPlanFromTriage,
  buildTaskTriageSystemPrompt,
  buildTaskTriageUserPrompt,
  explainInvalidTaskTriage,
  isTaskTriageResult,
  triageTestsToPlanItems,
  type TaskTriageResult,
} from "./domain/task-triage";
import type { QaActivityEvent, QaAgentHost, QaExistingAuthSetup } from "./host";
import { qaAgentPlugin } from "./index";
import type { QaAgentTask } from "./schema";
import type {
  QaAgentRole,
  QaSessionMetadata,
  QaSessionRow,
  QaSetupOverrides,
  QaStepId,
  QaStepState,
  QaTaskSource,
  QaTaskTestRef,
} from "./types";
import { qaAgentWiring } from "./wiring";

/**
 * QA Agent — the dedicated comprehensive-suite builder behind the /qa-agent
 * page. Orchestrates specialist subagents through a nine-phase pipeline:
 *
 *   qa_setup       orchestrator  preflight (AI provider, GitHub, target URL)
 *   qa_login       orchestrator  resolve auth: existing setup/storage state →
 *                                provided creds (verified live) → agent
 *                                self-registration → public-only fallback
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
 *
 * ### How this module reaches core (post-migration shape)
 *
 * - **Authorization**: `runtime.contextFor(qaAgentPlugin, …)` replaces the
 *   old inline `requireRepoAccess`/`requireTeamAccess` calls — a session
 *   scope for UI actions, the ownership-checked `{repositoryId, teamId}`
 *   background branch for the detached pipeline, triggers and the task
 *   dispatcher. The plan gate is `ctx.team.entitlements.has("qa-agent")`.
 * - **Browsers**: every claim is a `ctx.browser` scope. No CDP endpoint, no
 *   pod address, storage states injected by id.
 * - **AI**: the pipeline's own three JSON calls go through `ctx.ai.generate`
 *   under their pre-migration action types (`qa_auth_extract`, `qa_plan`,
 *   `qa_task_triage`). One observable difference, accepted and small: the
 *   planner substep's `promptLogId` link is recorded when the call *returns*
 *   (`AiResult.promptLogId`) rather than streamed mid-call via
 *   `onLogCreated`, which the capability deliberately does not expose.
 * - **Everything else** — sessions (core's `agent_sessions`, `kind: "qa"`),
 *   tests, runs, storage states, repo/source facts, activity, the
 *   authoring-ai generator/healer — arrives through `QaAgentHost`; see
 *   `host.ts` for the full port and each group's honest future.
 */

const QA_STEP_DEFINITIONS: Array<{
  id: QaStepId;
  label: string;
  description: string;
}> = [
  {
    id: "qa_setup",
    label: "Preflight",
    description: "Validate target URL, AI provider, and GitHub connection",
  },
  {
    id: "qa_login",
    label: "Login",
    description:
      "Resolve authentication — existing setup, provided credentials, or an agent-registered account",
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
/** Hold budget for a single-explorer discovery crawl. Core clamps it to the
 *  plan's ceiling (`maxHoldFor`), so this is a request, not a guarantee. */
const CRAWL_DEADLINE_MS = 10 * 60 * 1000;

// ── Wiring / context helpers ─────────────────────────────────────────────────

type QaCtx = PluginContext<"browser" | "ai" | "data">;

/** Resolve a context. No scope → the session's team (`requireTeamAccess`
 *  underneath); `{repositoryId}` → session + repo ownership; both ids → the
 *  background ownership branch (pipeline, triggers, dispatcher — no session). */
async function qaContext(scope?: {
  repositoryId?: string;
  teamId?: string;
}): Promise<{ host: QaAgentHost; ctx: QaCtx }> {
  const { runtime, host } = qaAgentWiring();
  const ctx = (await runtime.contextFor(qaAgentPlugin, scope)) as QaCtx;
  return { host, ctx };
}

/** The plugin's own tables, via the wiring slot — the same handle `ctx.data`
 *  carries. Callers authorize through `qaContext(...)` first. */
function tasksDb() {
  return orm(qaAgentWiring().data);
}

function hostOf(): QaAgentHost {
  return qaAgentWiring().host;
}

/**
 * Entitlement gate. The plugin asks for a capability name, never a plan —
 * but the user-facing message keeps the pre-migration wording, which names
 * the tier. "Pro" mirrors `QA_AGENT_MIN_PLAN` in core's
 * `src/lib/billing/feature-access.ts` (the module that also feeds
 * `entitlementsFor`); it drifts only if that ceiling changes, and the gate
 * itself cannot drift — only the message could.
 */
const QA_AGENT_GATE_MESSAGE =
  "The QA Agent requires the Pro plan. Upgrade under Settings → Billing to unlock it.";

function assertEntitled(ctx: QaCtx): void {
  if (!ctx.team.entitlements.has("qa-agent")) {
    throw new Error(QA_AGENT_GATE_MESSAGE);
  }
}

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
  eventType: QaActivityEvent["eventType"],
  summary: string,
  opts?: {
    stepId?: string;
    agentType?: QaAgentRole;
    detail?: Record<string, unknown>;
    artifactType?: "test" | "build";
    artifactId?: string;
    artifactLabel?: string;
    durationMs?: number;
    /** ai_prompt_logs id when this event was produced by an AI call — links
     *  the event to the exact prompt + response for debugging. */
    promptLogId?: string;
  },
) {
  // Fire-and-forget by contract — the host logs failures.
  hostOf().emitActivity({
    teamId,
    repositoryId,
    sessionId,
    eventType,
    summary,
    ...opts,
  });
}

async function updateStep(
  sessionId: string,
  stepId: QaStepId,
  update: Partial<QaStepState>,
) {
  const host = hostOf();
  const session = await host.getSession(sessionId);
  if (!session) return;
  const steps = [...session.steps];
  const idx = steps.findIndex((s) => s.id === stepId);
  if (idx === -1) return;
  steps[idx] = { ...steps[idx], ...update };
  await host.updateSession(sessionId, {
    steps,
    currentStepId:
      update.status === "active"
        ? stepId
        : (session.currentStepId ?? undefined),
  });
}

async function setStepActive(sessionId: string, stepId: QaStepId) {
  await updateStep(sessionId, stepId, {
    status: "active",
    startedAt: new Date().toISOString(),
    error: undefined,
  });
  await hostOf().updateSession(sessionId, { currentStepId: stepId });
}

async function setStepCompleted(
  sessionId: string,
  stepId: QaStepId,
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
  stepId: QaStepId,
  error: string,
  result?: Record<string, unknown>,
) {
  await updateStep(sessionId, stepId, {
    status: "failed",
    completedAt: new Date().toISOString(),
    error,
    ...(result ? { result } : {}),
  });
  await hostOf().updateSession(sessionId, {
    status: "failed",
    completedAt: new Date(),
  });
}

async function setStepSkipped(
  sessionId: string,
  stepId: QaStepId,
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
  stepId: QaStepId,
  substeps: QaStepState["substeps"],
) {
  await updateStep(sessionId, stepId, { substeps: [...(substeps ?? [])] });
}

async function mergeMetadata(
  sessionId: string,
  patch: Partial<QaSessionMetadata>,
) {
  const host = hostOf();
  const session = await host.getSession(sessionId);
  if (!session) return;
  await host.updateSession(sessionId, {
    metadata: { ...session.metadata, ...patch },
  });
}

/** True when the session was cancelled in the DB or aborted in-process. */
async function isStopped(
  sessionId: string,
  signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted) return true;
  const session = await hostOf().getSession(sessionId);
  if (!session) return true;
  if (session.status === "cancelled" || session.status === "paused") {
    activeControllers.get(sessionId)?.abort();
    return true;
  }
  return false;
}

function credentialsFrom(
  metadata: QaSessionMetadata,
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

/** Whether this run's plan/tests target the AUTHENTICATED in-app surface.
 *  This is auth AVAILABILITY, not "plaintext credentials were typed": qa_login
 *  resolves auth via typed creds, a captured/existing storage state, or repo
 *  default setup steps — any of which means the crawl ran signed-in and
 *  generated tests start authenticated. Wiring the planner to credsProvided
 *  alone made it plan "public surface only" on storage-state runs. Mirrors the
 *  `preAuthenticated` calc in the generate step. */
function isRunAuthenticated(metadata: QaSessionMetadata): boolean {
  return Boolean(
    metadata.credsProvided ||
    metadata.qaAuth?.storageStateId ||
    metadata.qaAuth?.defaultSetupInUse,
  );
}

/** Live (non-deleted) repo tests with their area names — the matcher's and
 *  planner's view of what coverage already exists. */
async function loadExistingTests(
  repositoryId: string,
): Promise<ExistingTestSummary[]> {
  const tests = await hostOf().listTests(repositoryId);
  return tests.map((t) => ({
    id: t.id,
    name: t.name,
    testType: t.testType,
    functionalAreaName: t.functionalAreaName,
  }));
}

/** Prior run's ledger for coverage matching: the fill_gaps source session's,
 *  else the newest earlier session that has one. */
async function loadPriorLedger(
  session: QaSessionRow,
): Promise<QaGeneratedTest[] | undefined> {
  const host = hostOf();
  if (session.metadata.qaPlanSourceSessionId) {
    const source = await host
      .getSession(session.metadata.qaPlanSourceSessionId)
      .catch(() => null);
    if (source?.metadata.qaGeneratedTests) {
      return source.metadata.qaGeneratedTests;
    }
  }
  const recent = await host
    .getRecentSessions(session.repositoryId, 10)
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
  const host = hostOf();
  await setStepActive(sessionId, "qa_setup");
  emitActivity(teamId, repositoryId, sessionId, "step:start", "Preflight", {
    stepId: "qa_setup",
    agentType: "orchestrator",
  });

  const session = await host.getSession(sessionId);
  if (!session) return false;
  const targetUrl = session.metadata.qaTargetUrl;
  if (!targetUrl) {
    await setStepFailed(sessionId, "qa_setup", "No target URL configured");
    return false;
  }

  const aiProvider = await host.getAiProviderName(repositoryId);
  if (!aiProvider) {
    await setStepFailed(
      sessionId,
      "qa_setup",
      "No AI provider configured — set one under Settings → AI",
    );
    return false;
  }

  const repoInfo = await host.getRepoInfo(repositoryId).catch(() => null);
  const githubConnected = Boolean(repoInfo?.githubConnected);

  await setStepCompleted(sessionId, "qa_setup", {
    targetUrl,
    aiProvider,
    githubConnected,
    credsProvided: Boolean(session.metadata.credsProvided),
  });
  emitActivity(
    teamId,
    repositoryId,
    sessionId,
    "step:complete",
    `Preflight OK — AI: ${aiProvider}, GitHub: ${githubConnected ? "connected (repo-aware discovery)" : "not connected (live discovery only)"}`,
    { stepId: "qa_setup", agentType: "orchestrator" },
  );
  return true;
}

// ── Step: qa_login ───────────────────────────────────────────────────────────

/** Create (or refresh) the repo's reusable QA login setup test so the
 *  captured session can be re-established by the executor when it expires. */
async function upsertQaLoginSetupTest(
  repositoryId: string,
  opts: { email: string; password: string; loginUrl: string },
): Promise<string | undefined> {
  const host = hostOf();
  try {
    const name = "QA agent — auth login";
    const code = renderAuthLoginCode(opts);
    const tests = await host.listTests(repositoryId);
    const existing = tests.find((t) => t.name === name);
    if (existing) {
      await host.updateTestCode(existing.id, code);
      return existing.id;
    }
    const created = await host.createTest({ repositoryId, name, code });
    return created.id;
  } catch (err) {
    console.warn("[QaAgent] login setup test upsert failed:", err);
    return undefined;
  }
}

interface ExtractedAuthContext {
  email?: string;
  password?: string;
  loginUrl?: string;
}

function isExtractedAuthContext(v: unknown): v is ExtractedAuthContext {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return ["email", "password", "loginUrl"].every(
    (k) => o[k] == null || typeof o[k] === "string",
  );
}

/**
 * AI-extract structured {email, password, loginUrl} from Explore's free-text
 * sign-in instructions ("Log in with demo@acme.com / hunter2, then tap
 * Continue"). Extraction only — values must be literally present in the
 * prose; interactive prose-following (SSO buttons, OTP) is a documented
 * non-goal for v1. Best-effort: null when nothing extractable.
 */
async function extractCredsFromAuthContext(
  ctx: QaCtx,
  repositoryId: string,
  authContext: string,
): Promise<ExtractedAuthContext | null> {
  try {
    const result = await ctx.ai.generate(
      `Extract sign-in details from these instructions:\n\n${authContext.slice(0, 4000)}\n\nReturn a JSON object: {"email": string|null, "password": string|null, "loginUrl": string|null}. "email" may also be a username. Use null for anything not literally present — NEVER invent values.`,
      {
        actionType: "qa_auth_extract",
        repositoryId,
        systemPrompt:
          "You extract structured login credentials from user-provided sign-in instructions for an automated browser. Respond with a single JSON object and nothing else.",
        json: true,
        signal: AbortSignal.timeout(60_000),
      },
    );
    const parsed = parseAiJson(result.text, isExtractedAuthContext);
    if (!parsed) return null;
    const clean = (s: unknown): string | undefined =>
      typeof s === "string" && s.trim() ? s.trim() : undefined;
    const out: ExtractedAuthContext = {
      email: clean(parsed.email),
      password: clean(parsed.password),
      loginUrl: clean(parsed.loginUrl),
    };
    if (out.loginUrl && !/^https?:\/\//i.test(out.loginUrl)) {
      out.loginUrl = undefined;
    }
    return out.email || out.password || out.loginUrl ? out : null;
  } catch (err) {
    console.warn("[QaAgent] auth-context extraction failed:", err);
    return null;
  }
}

/**
 * Resolve how this run authenticates, cheapest-and-safest option first:
 *   1. existing repo setup (default setup steps / storage states), validated
 *      live on an EB when possible;
 *   2. user-provided credentials — verified with a real login, session
 *      captured as a storage state for discovery + generated tests;
 *   3. agent self-registration (opt-out) — signup URL strictly from the DOM;
 *   4. fallback: creds tested inline during discovery, or public-only with
 *      the auth surface itself mapped by the crawl.
 * The step never fails the pipeline — every unresolved path degrades.
 */
async function runQaLogin(
  ctx: QaCtx,
  sessionId: string,
  teamId: string,
  repositoryId: string,
  signal: AbortSignal,
): Promise<boolean> {
  const host = hostOf();
  await setStepActive(sessionId, "qa_login");
  const session = await host.getSession(sessionId);
  if (!session?.metadata.qaTargetUrl) return false;
  const targetUrl = session.metadata.qaTargetUrl;

  // Explore auth context: AI-extract structured creds/login URL from the
  // user's sign-in prose, then feed the existing cascade below exactly as if
  // the creds had been typed into the form (creds_untested path included).
  let metadata = session.metadata;
  let extractedLoginUrl: string | undefined;
  if (metadata.qaAuthContext && !credentialsFrom(metadata)) {
    const extracted = await extractCredsFromAuthContext(
      ctx,
      repositoryId,
      metadata.qaAuthContext,
    );
    extractedLoginUrl = extracted?.loginUrl;
    if (extracted?.email && extracted.password) {
      const patch: Partial<QaSessionMetadata> = {
        quickstartEmail: extracted.email,
        quickstartPassword: extracted.password,
        credsProvided: true,
      };
      await mergeMetadata(sessionId, patch);
      metadata = { ...metadata, ...patch };
    }
  }

  const credentials = credentialsFrom(metadata);
  const allowRegistration = metadata.qaAllowRegistration !== false;

  const SUB_EXISTING = 0;
  const SUB_SETUP_RUN = 1;
  const SUB_CREDS = 2;
  const SUB_REGISTER = 3;
  const SUB_RESOLVE = 4;
  const substeps: NonNullable<QaStepState["substeps"]> = [
    { label: "Check existing setup", status: "running", agent: "orchestrator" },
    { label: "Run existing setup test", status: "pending", agent: "ranger" },
    { label: "Test provided credentials", status: "pending", agent: "ranger" },
    { label: "Register test account", status: "pending", agent: "ranger" },
    {
      label: "Resolve auth strategy",
      status: "pending",
      agent: "orchestrator",
    },
  ];
  await updateSubsteps(sessionId, "qa_login", substeps);
  emitActivity(
    teamId,
    repositoryId,
    sessionId,
    "step:start",
    "Resolving login — existing setup, credentials, or registration",
    { stepId: "qa_login", agentType: "orchestrator" },
  );

  const existing = await host
    .resolveExistingAuth(repositoryId)
    .catch((): QaExistingAuthSetup => ({ defaultSetupInUse: false }));

  let auth: QaAuthState | null = null;
  // A login URL named in the auth-context prose is authoritative over the
  // DOM-discovered one.
  let authLinks: { loginUrl?: string; signupUrl?: string } = {
    loginUrl: extractedLoginUrl,
  };
  // One core-claimed browser per probe, where this used to hold a single raw
  // CDP connection open across all of them. `ctx.browser` is the same
  // capability the pre-migration `agentBrowserCapability` bridge minted at the
  // composition root — the bridge existed only because this file had no `ctx`
  // yet. Core claims, injects any stored session **by id**, meters the
  // run-minutes, signs the stream grant and always releases. Three
  // consequences, all deliberate:
  //
  //   - the storage-state JSON never reaches this file (core resolves,
  //     ownership-checks and injects it), which is why the "could not be
  //     loaded" branch is gone: `session.authApplied` is core's single answer
  //     to "did the stored session take", and a `false` is treated as a
  //     deferral exactly as the pre-migration code treated a failed injection;
  //   - each probe claims and releases its own EB rather than sharing one, so
  //     the registration step below no longer has to release ours before
  //     `captureStorageState` can claim (1-job-1-EB, honestly);
  //   - `session.streamUrl` is already proxied and grant-signed, so the live
  //     view never sees a pod address.
  const browser = ctx.browser;

  /**
   * Run one probe on a core-claimed page. `undefined` means "no browser" —
   * never fatal, the same degradation the raw path had: resolution continues
   * and discovery, which claims its own EB later, picks up the deferred
   * validation.
   */
  async function withQaPage<T>(
    opts: { storageStateId?: string },
    fn: (session: BrowserSession) => Promise<T>,
  ): Promise<T | undefined> {
    try {
      return await browser.withBrowser(
        {
          purpose: "interactive",
          claimTimeoutMs: EB_CLAIM_TIMEOUT_MS,
          storageStateId: opts.storageStateId,
          onQueued: () => {
            mergeMetadata(sessionId, { queuedForBrowser: true }).catch(
              () => {},
            );
          },
        },
        async (session) => {
          await mergeMetadata(sessionId, {
            queuedForBrowser: false,
            ...(session.streamUrl ? { streamUrl: session.streamUrl } : {}),
          });
          try {
            return await fn(session);
          } finally {
            await mergeMetadata(sessionId, { streamUrl: undefined }).catch(
              () => {},
            );
          }
        },
      );
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name !== "NoBrowserAvailableError") {
        console.warn("[QaAgent] login probe failed:", err);
      }
      await mergeMetadata(sessionId, { queuedForBrowser: false }).catch(
        () => {},
      );
      return undefined;
    }
  }

  try {
    // 1) Existing setup infrastructure (setup steps / storage states).
    if (existing.storageStateId) {
      const stateName = existing.storageStateName ?? "storage state";
      const check = await withQaPage(
        { storageStateId: existing.storageStateId },
        (session) =>
          validateStorageStateOnEb(
            session.page,
            targetUrl,
            session.authApplied,
          ),
      );
      if (!check) {
        // Accept unvalidated; discovery validates after injecting it.
        auth = {
          strategy: "existing_setup",
          validated: false,
          storageStateId: existing.storageStateId,
          setupTestId: existing.setupTestId,
          defaultSetupInUse: existing.defaultSetupInUse,
          notes: "No browser available — validation deferred to discovery",
        };
        substeps[SUB_EXISTING] = {
          ...substeps[SUB_EXISTING],
          status: "done",
          detail: `"${stateName}" found (validation deferred — no browser)`,
        };
      } else if (check.validated || check.deferred) {
        auth = {
          strategy: "existing_setup",
          validated: check.validated,
          storageStateId: existing.storageStateId,
          setupTestId: existing.setupTestId,
          defaultSetupInUse: existing.defaultSetupInUse,
          notes: check.deferred
            ? "IndexedDB-only capture — validation deferred to discovery"
            : undefined,
        };
        substeps[SUB_EXISTING] = {
          ...substeps[SUB_EXISTING],
          status: "done",
          detail: check.validated
            ? `"${stateName}" validated live — reusing it`
            : `"${stateName}" accepted (IndexedDB-only, validation deferred)`,
        };
      } else {
        substeps[SUB_EXISTING] = {
          ...substeps[SUB_EXISTING],
          status: "done",
          detail: `"${stateName}" session is stale — continuing`,
        };
      }
    } else if (existing.defaultSetupInUse) {
      substeps[SUB_EXISTING] = {
        ...substeps[SUB_EXISTING],
        status: "done",
        detail:
          "Repo default setup steps found (test/script) — they run before every test",
      };
    } else {
      substeps[SUB_EXISTING] = {
        ...substeps[SUB_EXISTING],
        status: "done",
        detail: "No setup tests, scripts, or storage states in this repo",
      };
    }
    await updateSubsteps(sessionId, "qa_login", substeps);
    if (await isStopped(sessionId, signal)) return false;

    // 1b) A setup test/script exists but no valid storage state — RUN it to
    //     mint a fresh session. Discovery can't execute per-test setup steps
    //     itself, so this is what makes "a setup test that works is already
    //     in place" usable for a post-login crawl.
    let setupRunFailed = false;
    if (!auth && (existing.setupTestId || existing.setupScriptId)) {
      const stepName = existing.setupStepName ?? "setup step";
      substeps[SUB_SETUP_RUN] = {
        ...substeps[SUB_SETUP_RUN],
        status: "running",
        detail: `Running "${stepName}"`,
      };
      await updateSubsteps(sessionId, "qa_login", substeps);
      const code = await host
        .getAuthSetupCode(
          existing.setupTestId
            ? { testId: existing.setupTestId }
            : { scriptId: existing.setupScriptId },
        )
        .catch(() => null);
      if (!code) {
        setupRunFailed = true;
        substeps[SUB_SETUP_RUN] = {
          ...substeps[SUB_SETUP_RUN],
          status: "error",
          detail: `"${stepName}" has no code — continuing`,
        };
      } else {
        // Arbitrary setup code must not run in-process: captureStorageState
        // executes it in its own disposable runner/EB.
        const captured = await host.captureStorageState({
          repositoryId,
          baseUrl: targetUrl,
          testCode: code,
          name: `QA agent setup ${utcStamp()}`,
        });
        if (captured.captured && captured.storageStateId) {
          const check = await withQaPage(
            { storageStateId: captured.storageStateId },
            (session) =>
              validateStorageStateOnEb(
                session.page,
                targetUrl,
                session.authApplied,
              ),
          );
          const validated = check?.validated ?? false;
          const deferred = check ? check.deferred : true;
          if (validated || deferred) {
            auth = {
              strategy: "existing_setup",
              validated,
              storageStateId: captured.storageStateId,
              setupTestId: existing.setupTestId,
              defaultSetupInUse: existing.defaultSetupInUse,
              notes: deferred
                ? `Session refreshed by running "${stepName}" — validation deferred to discovery`
                : `Session refreshed by running "${stepName}"`,
            };
            substeps[SUB_SETUP_RUN] = {
              ...substeps[SUB_SETUP_RUN],
              status: "done",
              detail: validated
                ? `Ran "${stepName}" — fresh session captured and validated`
                : `Ran "${stepName}" — fresh session captured (validation deferred)`,
            };
          } else {
            setupRunFailed = true;
            substeps[SUB_SETUP_RUN] = {
              ...substeps[SUB_SETUP_RUN],
              status: "error",
              detail: `"${stepName}" ran but the session did not authenticate`,
            };
          }
        } else {
          setupRunFailed = true;
          substeps[SUB_SETUP_RUN] = {
            ...substeps[SUB_SETUP_RUN],
            status: "error",
            detail: captured.failureReason ?? `"${stepName}" failed`,
          };
        }
      }
    } else {
      substeps[SUB_SETUP_RUN] = {
        ...substeps[SUB_SETUP_RUN],
        status: "done",
        detail: auth ? "Not needed" : "No setup test or script to run",
      };
    }
    await updateSubsteps(sessionId, "qa_login", substeps);
    if (await isStopped(sessionId, signal)) return false;

    // A broken/uncapturable default setup shouldn't block the rest of the
    // cascade — creds and registration may still produce a working session.
    const defaultSetupCoversAuth =
      existing.defaultSetupInUse && !setupRunFailed;

    // Discover the app's real login/signup links once (DOM only, no guessing) —
    // both the credential test and registration need them — and, when the user
    // supplied credentials, test them in the same claim.
    //
    // 2) User-provided credentials — verify with a real login and capture the
    //    session so discovery and generated tests start authenticated.
    let credsTested = false;
    if (
      !auth &&
      (credentials || (allowRegistration && !defaultSetupCoversAuth))
    ) {
      await withQaPage({}, async (session) => {
        const domLinks = await findAuthLinksOnEb(session.page, targetUrl);
        authLinks = {
          ...domLinks,
          loginUrl: extractedLoginUrl ?? domLinks.loginUrl,
        };
        if (!credentials) return;

        credsTested = true;
        substeps[SUB_CREDS] = { ...substeps[SUB_CREDS], status: "running" };
        await updateSubsteps(sessionId, "qa_login", substeps);
        const login = await loginWithCredsOnEb({
          page: session.page,
          targetUrl,
          loginUrl: authLinks.loginUrl,
          credentials,
        });
        if (login.ok && login.storageStateJson) {
          const persisted = await host.persistStorageState({
            repositoryId,
            name: `QA agent login ${utcStamp()}`,
            storageStateJson: login.storageStateJson,
          });
          const setupTestId = await upsertQaLoginSetupTest(repositoryId, {
            email: credentials.email,
            password: credentials.password,
            loginUrl: authLinks.loginUrl ?? targetUrl,
          });
          auth = {
            strategy: "user_creds",
            validated: true,
            storageStateId: persisted.id,
            setupTestId,
            defaultSetupInUse: existing.defaultSetupInUse,
            loginUrl: authLinks.loginUrl,
          };
          substeps[SUB_CREDS] = {
            ...substeps[SUB_CREDS],
            status: "done",
            detail: "Logged in — session captured for reuse",
          };
        } else {
          substeps[SUB_CREDS] = {
            ...substeps[SUB_CREDS],
            status: "error",
            detail: `Could not verify credentials${login.detail ? ` — ${login.detail}` : ""}; discovery will retry inline`,
          };
        }
      });
    }
    if (!credsTested) {
      substeps[SUB_CREDS] = {
        ...substeps[SUB_CREDS],
        status: "done",
        detail: auth
          ? "Not needed"
          : credentials
            ? "No browser available — credentials will be tested during discovery"
            : "No credentials provided",
      };
    }
    await updateSubsteps(sessionId, "qa_login", substeps);
    if (await isStopped(sessionId, signal)) return false;

    // 3) Agent self-registration (opt-out). Signup URL strictly from the DOM;
    //    skipped when the user gave creds or the repo's default setup already
    //    produced/covers a working session (a failed setup run re-opens this).
    const canRegister =
      !auth && !credentials && allowRegistration && !defaultSetupCoversAuth;
    if (canRegister && authLinks.signupUrl) {
      substeps[SUB_REGISTER] = { ...substeps[SUB_REGISTER], status: "running" };
      await updateSubsteps(sessionId, "qa_login", substeps);
      // captureStorageState runs the signup in its own disposable runner/EB
      // (1-job-1-EB). Nothing to release first any more — every probe above
      // held its browser only for the length of its own `withQaPage` scope.
      const repo = await host.getRepoInfo(repositoryId).catch(() => null);
      const template = await host
        .getTeamEmailTemplate(teamId)
        .catch(() => "viktor+{slug}{stamp}@lastest.cloud");
      const stamp = utcStamp();
      const slug = slugify(repo?.name ?? "qa-agent");
      const email = renderQuickstartEmail(template, slug, stamp);
      const password = renderQuickstartPassword(stamp);
      const code = renderAuthSetupCode({
        email,
        password,
        registerUrl: authLinks.signupUrl,
      });
      const setupTest = await host.createTest({
        repositoryId,
        name: `QA agent — auth signup ${stamp}`,
        code,
      });
      const captured = await host.captureStorageState({
        repositoryId,
        baseUrl: targetUrl,
        testCode: code,
        name: `QA agent signup ${slug} ${stamp}`,
      });
      if (captured.captured && captured.storageStateId) {
        // Store the fresh account like user creds so credentialsFrom() and the
        // generator fallback keep working; encrypted at rest by the query layer.
        await mergeMetadata(sessionId, {
          quickstartEmail: email,
          quickstartPassword: password,
          credsProvided: true,
        });
        auth = {
          strategy: "self_registered",
          validated: true,
          storageStateId: captured.storageStateId,
          setupTestId: setupTest.id,
          registeredEmail: email,
          signupUrl: authLinks.signupUrl,
        };
        substeps[SUB_REGISTER] = {
          ...substeps[SUB_REGISTER],
          status: "done",
          detail: `Registered ${email} — session captured`,
        };
      } else {
        substeps[SUB_REGISTER] = {
          ...substeps[SUB_REGISTER],
          status: "error",
          detail: captured.failureReason ?? "signup did not complete",
        };
      }
    } else {
      substeps[SUB_REGISTER] = {
        ...substeps[SUB_REGISTER],
        status: "done",
        detail: auth
          ? "Not needed"
          : credentials
            ? "Skipped — credentials were provided"
            : !allowRegistration
              ? "Disabled for this run"
              : defaultSetupCoversAuth
                ? "Skipped — repo default setup already covers auth"
                : "No sign-up link found in the app's DOM",
      };
    }
    await updateSubsteps(sessionId, "qa_login", substeps);
    if (await isStopped(sessionId, signal)) return false;

    // 4) Fallback — never fails the pipeline.
    if (!auth) {
      if (existing.defaultSetupInUse) {
        auth = {
          strategy: "existing_setup",
          validated: false,
          setupTestId: existing.setupTestId,
          defaultSetupInUse: true,
          notes: setupRunFailed
            ? "Repo default setup could not produce a session — discovery runs without login; execution still applies the default steps"
            : "Repo default setup steps run before every test — validated at execution",
        };
      } else if (credentials) {
        auth = {
          strategy: "creds_untested",
          validated: false,
          notes: "Credentials will be tested inline during discovery",
        };
      } else {
        auth = { strategy: "public_only", validated: false };
      }
    }
    auth.loginUrl = auth.loginUrl ?? authLinks.loginUrl;
    auth.signupUrl = auth.signupUrl ?? authLinks.signupUrl;

    const strategyLabel: Record<QaAuthState["strategy"], string> = {
      existing_setup: "reusing existing setup",
      user_creds: "credentials verified",
      self_registered: "account registered by the agent",
      creds_untested: "credentials untested — discovery will try them",
      public_only: "public surface only",
    };
    substeps[SUB_RESOLVE] = {
      ...substeps[SUB_RESOLVE],
      status: "done",
      detail: strategyLabel[auth.strategy],
    };
    await updateSubsteps(sessionId, "qa_login", substeps);

    await mergeMetadata(sessionId, {
      qaAuth: auth,
      authMode: auth.strategy === "public_only" ? "public_only" : "login",
    });
    await setStepCompleted(sessionId, "qa_login", {
      strategy: auth.strategy,
      validated: auth.validated,
      ...(auth.storageStateId ? { storageStateId: auth.storageStateId } : {}),
    });
    emitActivity(
      teamId,
      repositoryId,
      sessionId,
      "step:complete",
      `Login resolved: ${strategyLabel[auth.strategy]}`,
      { stepId: "qa_login", agentType: "orchestrator" },
    );
    return true;
  } finally {
    // Release is core's — every claim above lived and died inside a
    // `withBrowser` scope. What is left is the UI's own bookkeeping.
    await mergeMetadata(sessionId, { streamUrl: undefined }).catch(() => {});
  }
}

// ── Explore swarm (mode = "explore", explorers > 1) ──────────────────────────

const SWARM_EXTRA_CLAIM_TIMEOUT_MS = 30_000;
/** Pool slots always left free for builds/other agents when sizing a swarm. */
const SWARM_POOL_HEADROOM = 5;

/**
 * Wait for a swarm's claims to arrive.
 *
 * `withBrowser`/`withBrowserSwarm` do not resolve until their callbacks do, and
 * this crawl's callbacks stay parked for the whole run — so "have the browsers
 * arrived" cannot be read off those promises. It is read off the sessions the
 * callbacks push instead, bounded by the same claim windows core was given:
 * once the 30s extras window has elapsed, no further claim can land.
 */
async function waitForSwarm(
  sessions: BrowserSession[],
  want: number,
  signal: AbortSignal,
): Promise<void> {
  const deadline =
    Date.now() + EB_CLAIM_TIMEOUT_MS + SWARM_EXTRA_CLAIM_TIMEOUT_MS;
  let extrasDeadline: number | undefined;
  while (Date.now() < deadline && !signal.aborted) {
    if (sessions.length >= want) return;
    // The extras window only starts once explorer #1 is in — before that the
    // whole swarm may still be queued behind the pool cap.
    if (sessions[0]) {
      extrasDeadline ??= Date.now() + SWARM_EXTRA_CLAIM_TIMEOUT_MS + 2_000;
      if (Date.now() >= extrasDeadline) return;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

/**
 * Multi-EB exploration: progressive claim (explorer #1 gets the full claim
 * timeout and must succeed; #2..K get 30s each — run with however many
 * arrive), one shared frontier in this process, a single serialized throttled
 * flush for all metadata writes (mergeMetadata is read-merge-rewrite — it
 * must never run concurrently), and ALL EBs released in `finally`.
 * `metadata.streamUrl` stays explorer 0's stream for /qa-agent page compat;
 * per-explorer streams live on `qaExplore.explorers[i].streamUrl`.
 */
async function runQaDiscoverSwarm(args: {
  ctx: QaCtx;
  sessionId: string;
  teamId: string;
  repositoryId: string;
  targetUrl: string;
  signal: AbortSignal;
  initialExplore: QaExploreState;
  /** Id only — core resolves and injects the session at claim time. */
  storageStateId?: string;
  credentials?: { email: string; password: string };
  loginUrl?: string;
  staticRoutes: Array<{ path: string; type: string }>;
  framework?: string;
  githubConnected: boolean;
  onDetail: (detail: string) => void;
}): Promise<{
  pages: QaPageSnapshot[];
  blocked: QaExploreBlocked[];
  loginAttempted: boolean;
  finalExplore: QaExploreState;
}> {
  const { ctx, sessionId, teamId, repositoryId, targetUrl, signal } = args;
  const host = hostOf();
  const config = args.initialExplore.config;

  // Cap the swarm so builds keep pool headroom: min(requested, poolMax − 5).
  const max = await host
    .getEbPoolMax()
    .then((limit) => limit ?? config.explorers + SWARM_POOL_HEADROOM)
    .catch(() => config.explorers + SWARM_POOL_HEADROOM);
  const want = Math.max(
    1,
    Math.min(config.explorers, max - SWARM_POOL_HEADROOM),
  );

  // Single-writer live state; every metadata write goes through one
  // serialized, ≥3s-throttled chain.
  let explore: QaExploreState = {
    ...args.initialExplore,
    explorers: args.initialExplore.explorers.map((e) => ({ ...e })),
  };
  const livePages: QaPageSnapshot[] = [];
  let lastFlushAt = 0;
  let flushChain: Promise<void> = Promise.resolve();
  const flushState = (force = false) => {
    const now = Date.now();
    if (!force && now - lastFlushAt < 3000) return;
    lastFlushAt = now;
    const patch: Partial<QaSessionMetadata> = {
      qaExplore: explore,
      qaDiscovery: {
        targetUrl,
        crawledPages: [...livePages],
        staticRoutes:
          args.staticRoutes.length > 0 ? args.staticRoutes : undefined,
        framework: args.framework,
        githubConnected: args.githubConnected,
      },
    };
    flushChain = flushChain
      .then(() => mergeMetadata(sessionId, patch))
      .catch((err) => console.warn("[QaAgent] swarm flush failed:", err));
  };
  const setExplorer = (index: number, patch: Partial<QaExplorerState>) => {
    explore = {
      ...explore,
      pagesDiscovered: livePages.length,
      explorers: explore.explorers.map((e) =>
        e.index === index ? { ...e, ...patch } : e,
      ),
    };
  };

  // Every claim goes through core: it meters, deadlines and releases each one,
  // and a page arrives already authenticated when `storageStateId` is set —
  // this function never resolves, holds or passes the session material.
  const browser = ctx.browser;

  // `withBrowserSwarm`'s callback is per session, and a shared-frontier crawl
  // is the one shape that does not fit it: every page has to be alive at the
  // same moment, in one call, because they share a frontier. So each callback
  // parks on `parked` and stays parked until the crawl is done — the claim is
  // held for exactly as long as the page is in use, which is the property
  // `withBrowser` exists to guarantee, expressed the only way this crawl can.
  let unpark!: () => void;
  const parked = new Promise<void>((resolve) => (unpark = resolve));
  const sessions: BrowserSession[] = [];
  // Declared out here so the `finally` can settle them; assigned in the `try`.
  let firstRun: Promise<unknown> = Promise.resolve();
  let extrasRun: Promise<unknown> = Promise.resolve();

  try {
    // Explorer #1 must succeed — full claim timeout. #2..K are best-effort with
    // a 30s window, exactly as before; a swarm of one is still a swarm.
    const claimOpts = {
      purpose: "interactive" as const,
      deadlineMs: Math.max(
        60_000,
        new Date(explore.deadlineAt).getTime() - Date.now(),
      ),
      ...(args.storageStateId ? { storageStateId: args.storageStateId } : {}),
    };
    firstRun = browser
      .withBrowser(
        {
          ...claimOpts,
          claimTimeoutMs: EB_CLAIM_TIMEOUT_MS,
          onQueued: () => {
            mergeMetadata(sessionId, { queuedForBrowser: true }).catch(
              () => {},
            );
          },
        },
        async (session) => {
          sessions[0] = session;
          await parked;
        },
      )
      .catch((err) => {
        // Nobody arrived at all: the pre-migration code threw here too.
        if (sessions.length === 0) throw err;
      });

    extrasRun =
      want > 1
        ? browser.withBrowserSwarm(
            {
              ...claimOpts,
              count: want - 1,
              claimTimeoutMs: SWARM_EXTRA_CLAIM_TIMEOUT_MS,
            },
            async (session) => {
              sessions.push(session);
              await parked;
            },
          )
        : Promise.resolve([]);

    // Neither promise settles until `unpark()`, so the arrival of the claims is
    // what has to be waited on, not the calls. Both windows are core's own
    // claim timeouts, so nothing can turn up after they elapse.
    await waitForSwarm(sessions, want, signal);
    if (sessions.length === 0 || !sessions[0]) {
      throw new Error("No embedded browser available");
    }

    for (const e of explore.explorers) {
      const session = sessions[e.index];
      if (session) {
        setExplorer(e.index, {
          status: "exploring",
          // Already proxied and grant-signed by core.
          streamUrl: session.streamUrl ?? undefined,
        });
      } else {
        setExplorer(e.index, {
          status: "failed",
          detail:
            e.index < want
              ? "no browser available"
              : "capped to keep pool headroom for builds",
        });
      }
    }
    await mergeMetadata(sessionId, {
      queuedForBrowser: false,
      streamUrl: sessions[0].streamUrl ?? undefined,
      qaExplore: explore,
    });
    emitActivity(
      teamId,
      repositoryId,
      sessionId,
      "map:explorer_status",
      `Explorer swarm: ${sessions.length} of ${config.explorers} browsers claimed`,
      {
        stepId: "qa_discover",
        agentType: "ranger",
        detail: { claimed: sessions.length, requested: config.explorers },
      },
    );

    const result = await exploreTargetApp({
      pages: sessions.map((s) => s.page),
      targetUrl,
      strategy: config.strategy,
      maxDepth: config.depth,
      pageBudget: config.pageBudget,
      deadline: new Date(explore.deadlineAt).getTime(),
      storageStateInjected: sessions.some((s) => s.authApplied),
      credentials: args.credentials,
      loginUrl: args.loginUrl,
      // Same UA the executor would use for this repo — these crawls run on a
      // core-claimed EB's existing context, so newContext() never applies it.
      userAgentOverride: await host
        .getUserAgentOverride(repositoryId)
        .catch(() => null),
      signal,
      onPage: (snapshot, explorerIndex, totalMapped) => {
        livePages.push(snapshot);
        const prev =
          explore.explorers.find((e) => e.index === explorerIndex)
            ?.pagesMapped ?? 0;
        setExplorer(explorerIndex, {
          status: "exploring",
          pagesMapped: prev + 1,
          currentUrl: snapshot.finalUrl,
        });
        flushState();
        args.onDetail(`${totalMapped} pages mapped — ${snapshot.finalUrl}`);
        emitActivity(
          teamId,
          repositoryId,
          sessionId,
          "map:page_discovered",
          `Discovered ${snapshot.finalUrl}`,
          {
            stepId: "qa_discover",
            agentType: "ranger",
            detail: {
              url: snapshot.finalUrl,
              title: snapshot.title,
              explorer: explorerIndex,
            },
          },
        );
      },
      onExplorerStatus: (index, status, detail) => {
        setExplorer(index, {
          status,
          detail,
          ...(status === "done" || status === "failed"
            ? { currentUrl: undefined, streamUrl: undefined }
            : {}),
        });
        flushState();
        emitActivity(
          teamId,
          repositoryId,
          sessionId,
          "map:explorer_status",
          `Explorer ${index + 1} ${status}${detail ? ` — ${detail}` : ""}`,
          {
            stepId: "qa_discover",
            agentType: "ranger",
            detail: { index, status },
          },
        );
      },
      onBlocked: (b) => {
        explore = { ...explore, blocked: [...explore.blocked, b] };
        flushState();
        emitActivity(
          teamId,
          repositoryId,
          sessionId,
          "map:blocked",
          `Blocked at ${b.url} (${b.reason.replace("_", " ")})`,
          {
            stepId: "qa_discover",
            agentType: "ranger",
            detail: { url: b.url, reason: b.reason },
          },
        );
      },
    });

    // Settle in-flight flushes, then finalize every explorer row.
    await flushChain.catch(() => {});
    explore = {
      ...explore,
      pagesDiscovered: result.pages.length,
      blocked: result.blocked,
      explorers: explore.explorers.map((e) => ({
        ...e,
        status:
          e.status === "exploring" || e.status === "blocked"
            ? "done"
            : e.status === "claiming"
              ? "failed"
              : e.status,
        currentUrl: undefined,
        streamUrl: undefined,
      })),
    };
    return { ...result, finalExplore: explore };
  } finally {
    await mergeMetadata(sessionId, { streamUrl: undefined }).catch(() => {});
    // Unpark every callback: releasing what they hold is core's job, on
    // success, failure AND cancel, and it cannot happen while they are parked.
    unpark();
    await Promise.allSettled([firstRun, extrasRun]);
  }
}

// ── Step: qa_discover ────────────────────────────────────────────────────────

async function runQaDiscover(
  ctx: QaCtx,
  sessionId: string,
  teamId: string,
  repositoryId: string,
  signal: AbortSignal,
): Promise<boolean> {
  const host = hostOf();
  await setStepActive(sessionId, "qa_discover");
  const session = await host.getSession(sessionId);
  if (!session?.metadata.qaTargetUrl) return false;
  const targetUrl = session.metadata.qaTargetUrl;

  const substeps: NonNullable<QaStepState["substeps"]> = [
    { label: "Static route scan", status: "running", agent: "scout" },
    { label: "Code analysis", status: "pending", agent: "diver" },
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

  const repoInfo = await host.getRepoInfo(repositoryId).catch(() => null);
  const githubConnected = Boolean(repoInfo?.githubConnected);
  const branch = repoInfo?.selectedBranch || repoInfo?.defaultBranch || "main";
  const baseBranch = repoInfo?.defaultBranch || "main";

  // 1) Static routes: reuse a prior scan; else run the GitHub-tree scanner.
  //    Both live behind one host read — the scanner needs the team's GitHub
  //    token, which never crosses into this package.
  let staticRoutes: Array<{ path: string; type: string }> = [];
  let framework: string | undefined;
  try {
    const scanned = await host.getStaticRoutes(repositoryId);
    if (scanned) {
      staticRoutes = scanned.routes;
      framework = scanned.framework;
    }
    substeps[0] = {
      ...substeps[0],
      status: "done",
      detail: githubConnected
        ? `${staticRoutes.length} routes (${framework ?? "unknown"}) · branch ${branch}`
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

  // 2) Code check (repo-aware mode): stack intelligence + endpoints declared
  //    in code — facts the crawl can't see, feeding the planner digest. When
  //    the scanned branch differs from the base branch, also diff the two so
  //    the planner knows exactly which functions/endpoints this branch (PR)
  //    adds or changes and can target them.
  let codeCheck: QaDiscovery["codeCheck"];
  let prChanges: QaDiscovery["prChanges"];
  substeps[1] = { ...substeps[1], status: "running" };
  await updateSubsteps(sessionId, "qa_discover", substeps);
  const source = githubConnected
    ? await host.getSourceAccess(repositoryId).catch(() => null)
    : null;
  if (source) {
    try {
      const [intel, tree, comparison] = await Promise.all([
        source.gatherIntelligence().catch(() => null),
        source.getRepoTree().catch(() => null),
        source.branch !== source.baseBranch
          ? source.compareBranches().catch(() => null)
          : Promise.resolve(null),
      ]);
      const declaredEndpoints = tree
        ? await extractDeclaredEndpoints(tree, (path) =>
            source.getFileContent(path),
          )
        : [];
      if (intel || declaredEndpoints.length > 0) {
        codeCheck = {
          framework: intel?.framework,
          authMechanism: intel?.authMechanism,
          apiLayer: intel?.apiLayer,
          projectDescription: intel?.projectDescription,
          testingNotes: [
            ...(intel?.keyDeps.map(
              (d) => `${d.name}: ${d.testingImplication}`,
            ) ?? []),
            ...(intel?.testingRecommendations ?? []),
          ].slice(0, 12),
          declaredEndpoints,
        };
      }
      if (comparison && comparison.files.length > 0) {
        const computed = computePrChanges(comparison, declaredEndpoints);
        if (computed.files.length > 0) prChanges = computed;
      }
      // Always say which branch was analyzed and why there is / isn't a diff.
      const prDetail = prChanges
        ? ` · diff ${branch} vs ${baseBranch}: ${prChanges.files.length} files, ${prChanges.symbols.length} functions, ${prChanges.endpoints.length} endpoints`
        : branch === baseBranch
          ? ` · branch ${branch} = base (no PR diff — select a feature branch on the repo to target PR changes)`
          : ` · diff ${branch} vs ${baseBranch}: none available`;
      substeps[1] = {
        ...substeps[1],
        status: "done",
        detail: codeCheck
          ? `${codeCheck.declaredEndpoints.length} declared endpoints · ${codeCheck.framework ?? "stack unknown"}${prDetail}`
          : `no code intelligence available${prDetail}`,
      };
      emitActivity(
        teamId,
        repositoryId,
        sessionId,
        "substep:update",
        `Code analysis: ${codeCheck?.declaredEndpoints.length ?? 0} declared endpoints, stack ${codeCheck?.framework ?? "unknown"}${prDetail}`,
        { stepId: "qa_discover", agentType: "diver" },
      );
    } catch (err) {
      substeps[1] = {
        ...substeps[1],
        status: "error",
        detail: err instanceof Error ? err.message : "code analysis failed",
      };
    }
  } else {
    substeps[1] = {
      ...substeps[1],
      status: "done",
      detail: "skipped — GitHub not connected",
    };
  }
  await updateSubsteps(sessionId, "qa_discover", substeps);

  if (await isStopped(sessionId, signal)) return false;

  // 3) Live crawl on an Embedded Browser (streamed to the page live view).
  substeps[2] = { ...substeps[2], status: "running" };
  await updateSubsteps(sessionId, "qa_discover", substeps);

  // Explore runs get depth/budget/deadline from the dialog config and flush
  // crawled pages incrementally (throttled ≥3s) so buildAppMap — computed on
  // read from qaDiscovery — picks up new nodes while the crawl is running.
  // This flush is what makes the map grow live.
  const isExplore = session.metadata.qaMode === "explore";
  let exploreState = isExplore ? session.metadata.qaExplore : undefined;
  const livePages: QaPageSnapshot[] = [];
  let lastFlushAt = 0;
  let flushChain: Promise<void> = Promise.resolve();
  const flushLive = () => {
    const now = Date.now();
    if (now - lastFlushAt < 3000) return;
    lastFlushAt = now;
    const patch: Partial<QaSessionMetadata> = {
      qaDiscovery: {
        targetUrl,
        crawledPages: [...livePages],
        staticRoutes: staticRoutes.length > 0 ? staticRoutes : undefined,
        framework,
        githubConnected,
      },
      ...(exploreState ? { qaExplore: exploreState } : {}),
    };
    // Serialized: mergeMetadata is read-merge-rewrite — concurrent flushes
    // would clobber each other.
    flushChain = flushChain
      .then(() => mergeMetadata(sessionId, patch))
      .catch((err) => console.warn("[QaAgent] explore flush failed:", err));
  };
  const setExplorerState = (
    patch: Partial<QaExploreState["explorers"][number]>,
  ) => {
    if (!exploreState) return;
    exploreState = {
      ...exploreState,
      pagesDiscovered: livePages.length,
      explorers: exploreState.explorers.map((e, i) =>
        i === 0 ? { ...e, ...patch } : e,
      ),
    };
  };

  let swarmRan = false;
  let crawled: Awaited<ReturnType<typeof crawlTargetApp>> = {
    pages: [],
    loginAttempted: false,
  };
  try {
    if (exploreState && exploreState.config.explorers > 1) {
      // Swarm path — claims and releases its own EBs.
      swarmRan = true;
      const qaAuth = session.metadata.qaAuth;
      // The id, not the blob: core resolves, ownership-checks and injects it
      // at claim time, so the swarm never holds session material.
      const storageStateId = qaAuth?.storageStateId;
      const result = await runQaDiscoverSwarm({
        ctx,
        sessionId,
        teamId,
        repositoryId,
        targetUrl,
        signal,
        initialExplore: exploreState,
        storageStateId,
        credentials: storageStateId
          ? undefined
          : credentialsFrom(session.metadata),
        loginUrl: qaAuth?.loginUrl,
        staticRoutes,
        framework,
        githubConnected,
        onDetail: (detail) => {
          substeps[2] = { ...substeps[2], detail };
          updateSubsteps(sessionId, "qa_discover", substeps).catch(() => {});
        },
      });
      crawled = {
        pages: result.pages,
        loginAttempted: result.loginAttempted,
      };
      exploreState = result.finalExplore;
      const doneCount = result.finalExplore.explorers.filter(
        (e) => e.status === "done",
      ).length;
      substeps[2] = {
        ...substeps[2],
        status: crawled.pages.length > 0 ? "done" : "error",
        detail:
          crawled.pages.length > 0
            ? `${crawled.pages.length} pages via ${doneCount} explorer${doneCount === 1 ? "" : "s"}${result.blocked.length > 0 ? `, ${result.blocked.length} blocked` : ""}`
            : "No pages could be mapped",
      };
      await updateSubsteps(sessionId, "qa_discover", substeps);
    } else {
      // Single-explorer crawl on one core-claimed page. `storageStateId` is
      // handed to the claim rather than injected here, so `session.authApplied`
      // is what "pre-authenticated" now means — the storage-state blob never
      // reaches this file.
      const qaAuth = session.metadata.qaAuth;
      const browser = ctx.browser;
      const ran = await browser
        .withBrowser(
          {
            purpose: "interactive",
            claimTimeoutMs: EB_CLAIM_TIMEOUT_MS,
            // A crawl is a long hold; core clamps this to the plan's ceiling.
            deadlineMs: exploreState
              ? Math.max(
                  60_000,
                  new Date(exploreState.deadlineAt).getTime() - Date.now(),
                )
              : CRAWL_DEADLINE_MS,
            ...(qaAuth?.storageStateId
              ? { storageStateId: qaAuth.storageStateId }
              : {}),
            onQueued: () => {
              mergeMetadata(sessionId, { queuedForBrowser: true }).catch(
                () => {},
              );
            },
          },
          async (ebSession) => {
            if (exploreState) {
              setExplorerState({
                status: "exploring",
                streamUrl: ebSession.streamUrl ?? undefined,
              });
              emitActivity(
                teamId,
                repositoryId,
                sessionId,
                "map:explorer_status",
                "Explorer 1 started",
                {
                  stepId: "qa_discover",
                  agentType: "ranger",
                  detail: { index: 0, status: "exploring" },
                },
              );
            }
            await mergeMetadata(sessionId, {
              queuedForBrowser: false,
              streamUrl: ebSession.streamUrl ?? undefined,
              ...(exploreState ? { qaExplore: exploreState } : {}),
            });

            // Start the crawl from the post-login state when qa_login resolved
            // a storage state; otherwise fall back to the inline first-page
            // login ("creds tested during discovery"). Unresolved auth also
            // prioritizes login/signup links so the auth surface itself gets
            // mapped.
            const preAuthed = ebSession.authApplied;
            const credentials = preAuthed
              ? undefined
              : credentialsFrom(session.metadata);
            crawled = await crawlTargetApp(ebSession.page, targetUrl, {
              maxPages: exploreState
                ? exploreState.config.pageBudget
                : MAX_CRAWL_PAGES,
              ...(exploreState
                ? {
                    maxPagesHardCap: 40,
                    maxDepth: exploreState.config.depth,
                    deadline: new Date(exploreState.deadlineAt).getTime(),
                  }
                : {}),
              credentials,
              loginUrl: qaAuth?.loginUrl,
              // No injected session and no creds to try → make sure the crawl at
              // least maps the login/signup surface itself.
              prioritizeAuthLinks: !preAuthed && !credentials,
              // Same UA the executor would use for this repo — this crawl runs
              // on a core-claimed EB's existing context, so newContext() never
              // applies it here.
              userAgentOverride: await hostOf()
                .getUserAgentOverride(repositoryId)
                .catch(() => null),
              signal,
              onPage: (snapshot, index) => {
                substeps[2] = {
                  ...substeps[2],
                  detail: `${index + 1} pages mapped — ${snapshot.finalUrl}`,
                };
                updateSubsteps(sessionId, "qa_discover", substeps).catch(
                  () => {},
                );
                if (isExplore) {
                  livePages.push(snapshot);
                  setExplorerState({
                    status: "exploring",
                    pagesMapped: livePages.length,
                    currentUrl: snapshot.finalUrl,
                  });
                  flushLive();
                  emitActivity(
                    teamId,
                    repositoryId,
                    sessionId,
                    "map:page_discovered",
                    `Discovered ${snapshot.finalUrl}`,
                    {
                      stepId: "qa_discover",
                      agentType: "ranger",
                      detail: {
                        url: snapshot.finalUrl,
                        title: snapshot.title,
                        index,
                      },
                    },
                  );
                }
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
            substeps[2] = {
              ...substeps[2],
              status: crawled.pages.length > 0 ? "done" : "error",
              detail:
                crawled.pages.length > 0
                  ? `${crawled.pages.length} pages, ${crawled.pages.reduce((n, p) => n + p.apiEndpoints.length, 0)} API calls observed${preAuthed ? ", pre-authenticated" : crawled.loginAttempted ? ", logged in" : ""}`
                  : "No pages could be mapped",
            };
            await updateSubsteps(sessionId, "qa_discover", substeps);

            // Post-crawl auth bookkeeping while we still hold the EB: upgrade a
            // creds_untested resolution whose inline login worked (capture the
            // session for generation), and settle deferred validation.
            if (
              qaAuth &&
              ((qaAuth.strategy === "creds_untested" &&
                crawled.loginAttempted) ||
                (preAuthed && !qaAuth.validated))
            ) {
              const probe = await probeAndCaptureOnEb(
                ebSession.page,
                targetUrl,
              );
              if (probe.authed) {
                let upgraded = { ...qaAuth, validated: true };
                if (
                  qaAuth.strategy === "creds_untested" &&
                  probe.storageStateJson
                ) {
                  const persisted = await hostOf().persistStorageState({
                    repositoryId,
                    name: `QA agent login ${utcStamp()}`,
                    storageStateJson: probe.storageStateJson,
                  });
                  upgraded = {
                    ...upgraded,
                    strategy: "user_creds",
                    storageStateId: persisted.id,
                    notes: "Credentials verified during discovery",
                  };
                }
                await mergeMetadata(sessionId, { qaAuth: upgraded });
              }
            }
          },
        )
        .then(() => true)
        .catch((err: unknown) => {
          // "No browser" is a soft failure with its own substep, exactly as it
          // was when the claim was raw; anything else is a crawl error and
          // belongs to the outer catch.
          if (err instanceof Error && err.name === "NoBrowserAvailableError") {
            return false;
          }
          throw err;
        });
      if (!ran) {
        substeps[2] = {
          ...substeps[2],
          status: "error",
          detail: "No embedded browser available",
        };
        await updateSubsteps(sessionId, "qa_discover", substeps);
      }
    }
  } catch (err) {
    substeps[2] = {
      ...substeps[2],
      status: "error",
      detail: err instanceof Error ? err.message : "crawl failed",
    };
    await updateSubsteps(sessionId, "qa_discover", substeps);
    if (exploreState) {
      setExplorerState({
        status: "failed",
        detail: err instanceof Error ? err.message : "crawl failed",
      });
    }
  } finally {
    await mergeMetadata(sessionId, { streamUrl: undefined }).catch(() => {});
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
    ...(githubConnected ? { branch, baseBranch } : {}),
    codeCheck,
    prChanges,
  };
  // Settle any in-flight incremental flush before the authoritative final
  // write, then mark the explorer finished. (The swarm path finalizes its
  // explorer rows itself — exploreState already holds its final form.)
  await flushChain.catch(() => {});
  if (exploreState && !swarmRan) {
    setExplorerState({
      status:
        exploreState.explorers[0]?.status === "failed" ? "failed" : "done",
      currentUrl: undefined,
      streamUrl: undefined,
    });
    exploreState = {
      ...exploreState,
      pagesDiscovered: crawled.pages.length,
    };
    emitActivity(
      teamId,
      repositoryId,
      sessionId,
      "map:explorer_status",
      `Explorer 1 finished — ${crawled.pages.length} pages mapped`,
      {
        stepId: "qa_discover",
        agentType: "ranger",
        detail: { index: 0, status: "done", pages: crawled.pages.length },
      },
    );
  }
  await mergeMetadata(sessionId, {
    qaDiscovery: discovery,
    ...(exploreState ? { qaExplore: exploreState } : {}),
  });
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
  ctx: QaCtx,
  sessionId: string,
  teamId: string,
  repositoryId: string,
  signal: AbortSignal,
): Promise<boolean> {
  const host = hostOf();
  await setStepActive(sessionId, "qa_plan");
  const session = await host.getSession(sessionId);
  const discovery = session?.metadata.qaDiscovery;
  if (!session || !discovery) {
    await setStepFailed(sessionId, "qa_plan", "Missing discovery data");
    return false;
  }
  const groups = normalizeQaGroups(session.metadata.qaGroups ?? []);
  // Target the authenticated in-app surface whenever qa_login resolved auth —
  // NOT only when raw credentials were typed (see isRunAuthenticated). Passing
  // credsProvided alone told the planner "public surface only" on storage-state
  // runs, so it discarded the whole authed digest and planned only login pages.
  const authenticated = isRunAuthenticated(session.metadata);
  const feedback = session.metadata.qaPlannerFeedback;

  const substeps: NonNullable<QaStepState["substeps"]> = [
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

  // P3: the item budget and the planner's work queue come from measured data
  // coverage rather than a constant. When no coverage model exists this yields
  // the old fixed cap, so repos that never profiled dimensions are unaffected.
  // Re-derive first when the model has gone stale. A scheduled run is exactly
  // the case where nobody has opened the Coverage page since the data moved,
  // and planning against yesterday's cell set produces a queue of gaps that no
  // longer exist. A failed re-sync degrades to the stale model, never to none.
  const coverageState = await ensureCoverageFresh(repositoryId);
  if (coverageState?.stale) {
    console.warn(
      `[qa-agent] planning against a stale coverage model for repo ${repositoryId}`,
    );
  }
  const planBudget = computePlanBudget({
    stop: coverageState?.stop ?? null,
    // The planner owns the wall-clock ceiling, not the coverage model — see
    // the inversion note in `src/lib/coverage/budget.ts`.
    hardCap: MAX_PLAN_ITEMS,
  });
  // Excluded cells are deliberately absent from stop.queue, so they have to be
  // read back from the ledger — sourcing them from the queue yielded an always
  // empty list and the "do NOT plan these" section never rendered.
  const excludedCells = coverageState
    ? await queries
        .getCoverageCells(repositoryId)
        .then((cells) =>
          cells
            .filter((c) => c.status === "excluded")
            .map((c) => ({
              objectType: c.objectType,
              coordsKey: c.coordsKey,
              coords: c.coords,
              observedCount: c.observedCount,
              weight: c.weight,
              covered: false,
              excluded: true,
              excludedReason: c.excludedReason ?? undefined,
            })),
        )
        .catch(() => [])
    : [];
  const coverageDirective = coverageState
    ? buildCoverageDirective({
        report: coverageState.report,
        queue: coverageState.stop.queue,
        budget: planBudget,
        excluded: excludedCells,
      })
    : null;

  const callPlanner = async (extraFeedback?: string): Promise<string> => {
    const timeoutSignal = AbortSignal.timeout(PLANNER_TIMEOUT_MS);
    const result = await ctx.ai.generate(
      buildPlannerUserPrompt({
        digest,
        groups,
        authenticated,
        existingCoverage,
        docsDigest: session.metadata.qaDocsDigest || undefined,
        coverageDirective: coverageDirective ?? undefined,
        maxItems: planBudget.coverageDriven ? planBudget.maxItems : undefined,
        feedback:
          [feedback, extraFeedback].filter(Boolean).join("\n") || undefined,
      }),
      {
        actionType: "qa_plan",
        repositoryId,
        systemPrompt,
        json: true,
        signal: AbortSignal.any([signal, timeoutSignal]),
      },
    );
    // Post-call rather than mid-call: `AiResult.promptLogId` is the
    // capability's replacement for the old `onLogCreated` hook.
    if (result.promptLogId) {
      substeps[0] = { ...substeps[0], promptLogId: result.promptLogId };
      updateSubsteps(sessionId, "qa_plan", substeps).catch(() => {});
    }
    return result.text;
  };

  let plan: QaTestPlan | null = null;
  let lastRaw = "";
  try {
    const raw = await callPlanner();
    lastRaw = raw;
    plan = parseAiJson(raw, isQaTestPlan, { source: "qa-plan" });
    if (!plan) {
      // Surface the specific validation failure (parsed shape when we could
      // parse it, else a generic note) so the retry is a targeted correction.
      const parsedShape = parseAiJson(raw, (x): x is unknown => true, {
        source: "qa-plan-explain",
      });
      const reason =
        explainInvalidQaPlan(parsedShape) ?? "the JSON was invalid";
      const retry = await callPlanner(
        `Your previous response was not a valid plan: ${reason}. Fix exactly that and respond with ONLY the JSON object described in the system prompt.`,
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

  const sanitized = sanitizeQaPlan(plan, groups, {
    maxItems: planBudget.maxItems,
  });

  // The account of what the agent planned AND what it deliberately skipped.
  // Logged and emitted so a stop is never an unexplained silence.
  const stopSummary = buildStopSummary({
    budget: planBudget,
    stop: coverageState?.stop ?? null,
    plannedItems: sanitized.items.length,
  });
  console.log(`[qa-agent] ${stopSummary}`);
  emitActivity(teamId, repositoryId, sessionId, "substep:update", stopSummary, {
    stepId: "qa_plan",
    agentType: "planner",
  });

  // Annotate items a pre-existing test already covers so the review matrix
  // shows what exists vs what this run would create. Same matcher the
  // generate/summary steps use, run early for the human gate.
  const existingNameById = new Map(existingTests.map((t) => [t.id, t.name]));
  const preCovered = matchPlanToExistingTests(sanitized.items, existingTests);
  for (const item of sanitized.items) {
    const testId = preCovered.get(item.id);
    if (testId) {
      item.existingTestId = testId;
      item.existingTestName = existingNameById.get(testId);
    } else {
      // Re-plans must not carry stale matches from a previous plan round.
      delete item.existingTestId;
      delete item.existingTestName;
    }
  }

  substeps[0] = {
    ...substeps[0],
    status: "done",
    durationMs: Date.now() - started,
    outputSummary: `${sanitized.journeys.length} journeys, ${sanitized.items.length} test items${preCovered.size > 0 ? `, ${preCovered.size} already covered by existing tests` : ""}`,
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
        sanitized.items.filter((i) => itemGroups(i).includes(g.id)).length,
      ]).filter(([, n]) => (n as number) > 0),
    ),
  });
  emitActivity(
    teamId,
    repositoryId,
    sessionId,
    "step:complete",
    `Plan ready: ${sanitized.journeys.length} journeys, ${sanitized.items.length} tests across ${groups.length} groups${preCovered.size > 0 ? ` (${preCovered.size} already covered by existing tests)` : ""}`,
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
  const host = hostOf();
  await setStepActive(sessionId, "qa_plan_review");
  const session = await host.getSession(sessionId);
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
  await host.updateSession(sessionId, { status: "paused" });
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
  const host = hostOf();
  await setStepActive(sessionId, "qa_generate");
  const session = await host.getSession(sessionId);
  const plan = session?.metadata.qaPlan;
  const targetUrl = session?.metadata.qaTargetUrl;
  if (!session || !plan || !targetUrl) {
    await setStepFailed(sessionId, "qa_generate", "Missing approved plan");
    return false;
  }
  const credentials = credentialsFrom(session.metadata);
  // Auth resolved by qa_login: a storage state (or repo default setup) means
  // generated tests start pre-authenticated via setup steps instead of
  // scripting their own login with prompt-injected credentials.
  const qaAuth = session.metadata.qaAuth;
  const preAuthenticated = Boolean(
    qaAuth?.storageStateId || qaAuth?.defaultSetupInUse,
  );
  const authSetupOverrides: QaSetupOverrides | undefined =
    qaAuth?.storageStateId && !qaAuth.defaultSetupInUse
      ? {
          skippedDefaultStepIds: [],
          extraSteps: [
            {
              stepType: "storage_state",
              storageStateId: qaAuth.storageStateId,
            },
          ],
        }
      : undefined;
  // Task-scoped runs (Direct the agent): only the items the directive
  // resolved to are work — the rest of the stored plan is context. Scoping
  // here keeps the ledger, and therefore execute/heal/reply, on-directive.
  const allItems = enabledPlanItems(plan);
  const taskItemIds = session.metadata.qaTaskItemIds;
  const items = taskItemIds?.length
    ? allItems.filter((i) => taskItemIds.includes(i.id))
    : allItems;
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
      groups: itemGroups(item),
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
  const itemLabel = (item: QaPlanItem) =>
    itemGroups(item).map(groupLabel).join(" + ");

  // Areas: one per group, flat, prefixed for recognizability in /tests.
  const areaIdByGroup = new Map<QaTestGroup, string>();
  for (const group of new Set(items.map((i) => i.group))) {
    const area = await host.getOrCreateFunctionalArea(
      repositoryId,
      `QA: ${groupLabel(group)}`,
    );
    areaIdByGroup.set(group, area.id);
  }

  const substeps: NonNullable<QaStepState["substeps"]> = pending.map(
    (item) => ({
      label: `${itemLabel(item)}: ${item.title}`,
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
  const apiItems = pending.filter(
    (i) => itemGroups(i).includes("api") && i.api,
  );
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
        groups: itemGroups(item),
        name: item.title,
        status: "generation_failed",
        error: "Plan item had no API definition",
      });
      continue;
    }
    // Attribution to the play_agent bot happens inside the host method — a
    // feature must not read another feature's table to attribute its own
    // work, and this one no longer can (see src/lib/db/test-hooks.ts).
    const test = await host.createTest({
      repositoryId,
      functionalAreaId: areaIdByGroup.get(item.group),
      name: item.title,
      code: `// Headless API test — executed via apiDefinition (${definition.method} ${definition.url})`,
      targetUrl,
      testType: "api",
      apiDefinition: definition,
    });
    substeps[subIdx] = { ...substeps[subIdx], status: "done" };
    await updateSubsteps(sessionId, "qa_generate", substeps);
    await upsertLedger({
      planItemId: item.id,
      group: item.group,
      groups: itemGroups(item),
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
  // coherent and the pool isn't drained. `host.withAuthoringSession` claims
  // one Embedded Browser through `@lastest/plugin-authoring-ai` (core injects
  // `qaAuth.storageStateId` as part of the claim itself, so the generator
  // sees the same post-login state the tests will run in) and hands back
  // bound `createTest` calls that all reuse it.
  let stoppedEarly = false;
  try {
    if (browserItems.length > 0) {
      try {
        await host.withAuthoringSession(
          repositoryId,
          {
            storageStateId: qaAuth?.storageStateId,
            onQueued: () => {
              mergeMetadata(sessionId, { queuedForBrowser: true }).catch(
                () => {},
              );
            },
            onSessionReady: (streamUrl) => {
              mergeMetadata(sessionId, {
                queuedForBrowser: false,
                streamUrl: streamUrl ?? undefined,
              }).catch(() => {});
            },
          },
          async (browserSession) => {
            for (const item of browserItems) {
              if (await isStopped(sessionId, signal)) {
                stoppedEarly = true;
                return;
              }
              const subIdx = pending.indexOf(item);
              const started = Date.now();
              substeps[subIdx] = { ...substeps[subIdx], status: "running" };
              await updateSubsteps(sessionId, "qa_generate", substeps);
              emitActivity(
                teamId,
                repositoryId,
                sessionId,
                "substep:update",
                `Generator working on "${item.title}" (${itemGroups(item).join(" + ")})`,
                { stepId: "qa_generate", agentType: "generator" },
              );
              try {
                const timeoutSignal = AbortSignal.timeout(GENERATOR_TIMEOUT_MS);
                const result = await browserSession.createTest(
                  {
                    testName: item.title,
                    baseUrl: targetUrl,
                    routePath: item.pagePath,
                    preAuthenticated,
                    userPrompt: buildGeneratorPrompt({
                      item,
                      plan,
                      targetUrl,
                      credentials: preAuthenticated ? undefined : credentials,
                      auth: { preAuthenticated },
                      loginContext: {
                        loginUrl: qaAuth?.loginUrl,
                        signupUrl: qaAuth?.signupUrl,
                      },
                    }),
                  },
                  { signal: AbortSignal.any([signal, timeoutSignal]) },
                );
                if (result.success && result.code) {
                  const test = await host.createTest({
                    repositoryId,
                    functionalAreaId: areaIdByGroup.get(item.group),
                    name: item.title,
                    code: result.code,
                    targetUrl,
                    playwrightOverrides: itemPlaywrightOverrides(
                      itemGroups(item),
                    ),
                    // Chain the captured login session; when repo defaults already
                    // cover auth this stays undefined (defaults apply to every test).
                    ...(authSetupOverrides
                      ? { setupOverrides: authSetupOverrides }
                      : {}),
                    // play_agent attribution — inside the host, see above.
                  });
                  substeps[subIdx] = {
                    ...substeps[subIdx],
                    status: "done",
                    durationMs: Date.now() - started,
                  };
                  await upsertLedger({
                    planItemId: item.id,
                    group: item.group,
                    groups: itemGroups(item),
                    testId: test.id,
                    name: item.title,
                    status: "generated",
                  });
                  emitActivity(
                    teamId,
                    repositoryId,
                    sessionId,
                    "artifact:created",
                    `Generated test "${item.title}" (${itemGroups(item).join(" + ")})`,
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
                    groups: itemGroups(item),
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
                  groups: itemGroups(item),
                  name: item.title,
                  status: "generation_failed",
                  error: msg,
                });
              }
              await updateSubsteps(sessionId, "qa_generate", substeps);
            }
          },
        );
      } catch (error) {
        await setStepFailed(
          sessionId,
          "qa_generate",
          error instanceof Error
            ? error.message
            : "No embedded browser available for test generation",
        );
        return false;
      }
    }
  } finally {
    await mergeMetadata(sessionId, { streamUrl: undefined }).catch(() => {});
  }
  if (stoppedEarly) return false;

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
  const host = hostOf();
  // `startRun` returns { runId, jobId } directly, or { runId: null, jobId }
  // when the pool was busy and the run got queued as a pending background job.
  const run = await host.startRun(repositoryId, testIds);
  const runId = run.runId ?? undefined;
  const jobId = run.jobId;
  if (runId) {
    const current = await host.getSession(sessionId);
    await mergeMetadata(sessionId, {
      qaRunIds: [...(current?.metadata.qaRunIds ?? []), runId],
    });
  }

  const deadline = Date.now() + RUN_TIMEOUT_MS;
  for (;;) {
    if (await isStopped(sessionId, signal)) return null;
    if (Date.now() > deadline) break;
    if (!runId && !jobId) break;
    // One host read covers both shapes: the run row's status when we have a
    // run id, else the queued background job's (a missing row counts as
    // settled for the job branch and as still-pending for the run branch —
    // the exact pre-migration polling semantics).
    if (await host.isRunSettled({ runId, jobId })) break;
    await new Promise((r) => setTimeout(r, RUN_POLL_INTERVAL_MS));
  }

  // Resolve outcome per test from its latest result (robust for both the
  // direct-run and queued paths).
  const statuses = new Map<string, "passed" | "failed">();
  for (const testId of testIds) {
    const latest = await host.getLatestResultStatus(testId);
    statuses.set(testId, latest === "passed" ? "passed" : "failed");
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
  const host = hostOf();
  await setStepActive(sessionId, "qa_execute");
  const session = await host.getSession(sessionId);
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
  const host = hostOf();
  await setStepActive(sessionId, "qa_heal");
  const session = await host.getSession(sessionId);
  const ledger = [...(session?.metadata.qaGeneratedTests ?? [])];
  const failing = ledger.filter((g) => g.testId && g.status === "failed");
  if (failing.length === 0) {
    await setStepSkipped(sessionId, "qa_heal", "Nothing to heal — all passed");
    return true;
  }

  // Statement of each failing test's purpose, so the healer preserves it
  // instead of loosening assertions (resilience injections, negative-input
  // gates, and journey end-state proofs must survive the fix).
  const plan = session?.metadata.qaPlan;
  const planItemById = new Map(
    (plan?.items ?? []).map((i) => [i.id, i] as const),
  );
  const healIntentFor = (entry: QaGeneratedTest): string | undefined => {
    const item = planItemById.get(entry.planItemId);
    const groups = (entry.groups?.length ? entry.groups : [entry.group]).join(
      " + ",
    );
    const lines = [`Coverage groups: ${groups}.`];
    const journey = item?.journeyId
      ? plan?.journeys.find((j) => j.id === item.journeyId)
      : undefined;
    if (journey) {
      lines.push(
        `Business outcome: ${journey.businessOutcome}. Required end-state proof: ${journey.endStateVerification}.`,
      );
    }
    return lines.join(" ");
  };

  const substeps: NonNullable<QaStepState["substeps"]> = failing.map((g) => ({
    label: `Healing "${g.name}"`,
    status: "pending",
    agent: "healer",
  }));
  await updateSubsteps(sessionId, "qa_heal", substeps);
  emitActivity(
    teamId,
    repositoryId,
    sessionId,
    "step:start",
    `Healer fixing ${failing.length} failing tests`,
    { stepId: "qa_heal", agentType: "healer" },
  );

  const healedTestIds: string[] = [];
  let stoppedEarly = false;
  try {
    await host
      .withAuthoringSession(
        repositoryId,
        {
          onQueued: () => {
            mergeMetadata(sessionId, { queuedForBrowser: true }).catch(
              () => {},
            );
          },
          onSessionReady: (streamUrl) => {
            mergeMetadata(sessionId, {
              queuedForBrowser: false,
              streamUrl: streamUrl ?? undefined,
            }).catch(() => {});
          },
        },
        async (browserSession) => {
          for (let i = 0; i < failing.length; i++) {
            if (await isStopped(sessionId, signal)) {
              stoppedEarly = true;
              return;
            }
            const entry = failing[i];
            substeps[i] = { ...substeps[i], status: "running" };
            await updateSubsteps(sessionId, "qa_heal", substeps);
            try {
              const timeoutSignal = AbortSignal.timeout(HEAL_TIMEOUT_MS);
              const result = await browserSession.healTest(entry.testId!, {
                signal: AbortSignal.any([signal, timeoutSignal]),
                intent: healIntentFor(entry),
              });
              if (result.success && result.code) {
                await host.updateTestCode(entry.testId!, result.code);
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
                detail:
                  err instanceof Error ? err.message.slice(0, 200) : "failed",
              };
            }
            await updateSubsteps(sessionId, "qa_heal", substeps);
          }
        },
      )
      .catch(async () => {
        for (let i = 0; i < substeps.length; i++) {
          substeps[i] = {
            ...substeps[i],
            status: "error",
            detail: "No embedded browser available",
          };
        }
        await updateSubsteps(sessionId, "qa_heal", substeps);
      });
  } finally {
    await mergeMetadata(sessionId, { streamUrl: undefined }).catch(() => {});
  }
  if (stoppedEarly) return false;

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
  const host = hostOf();
  await setStepActive(sessionId, "qa_summary");
  const session = await host.getSession(sessionId);
  const plan = session?.metadata.qaPlan;
  if (!session || !plan) {
    await setStepFailed(sessionId, "qa_summary", "Missing plan");
    return false;
  }

  // The ledger only contains items this session actually worked — task-scoped
  // runs carry just the directive's items, and spec-refresh runs none at all.
  // Coverage is a whole-plan statement, so backfill "covered" entries for
  // every enabled item the run didn't touch but an existing test already
  // satisfies. Without this, a scoped run's summary reports the untouched
  // majority of the plan as gaps and the dashboard "loses" coverage even
  // though no test was deleted and no plan item added.
  let ledger = session.metadata.qaGeneratedTests ?? [];
  const inLedger = new Set(ledger.map((g) => g.planItemId));
  const untouched = enabledPlanItems(plan).filter((i) => !inLedger.has(i.id));
  if (untouched.length > 0) {
    const [existingTests, priorLedger] = await Promise.all([
      loadExistingTests(repositoryId).catch(() => []),
      loadPriorLedger(session).catch(() => undefined),
    ]);
    const coveredBy = matchPlanToExistingTests(
      untouched,
      existingTests,
      priorLedger,
    );
    const backfilled = untouched
      .filter((i) => coveredBy.has(i.id))
      .map((i) => ({
        planItemId: i.id,
        group: i.group,
        groups: itemGroups(i),
        testId: coveredBy.get(i.id),
        name: i.title,
        status: "covered" as const,
      }));
    if (backfilled.length > 0) {
      ledger = [...ledger, ...backfilled];
      await mergeMetadata(sessionId, { qaGeneratedTests: ledger });
    }
  }

  const summary = computeQaSummary(plan, ledger);
  // Branch-aware runs: report, per function/endpoint the branch changed,
  // whether a test now covers it (the PR coverage panel).
  const prChanges = session.metadata.qaDiscovery?.prChanges;
  if (prChanges) {
    summary.prCoverage = computePrCoverage(prChanges, plan, ledger);
  }
  await mergeMetadata(sessionId, { qaSummary: summary });
  await setStepCompleted(sessionId, "qa_summary", {
    planned: summary.planned,
    generated: summary.generated,
    covered: summary.covered,
    passed: summary.passed,
  });
  await host.updateSession(sessionId, {
    status: "completed",
    completedAt: new Date(),
  });
  const gaps = summary.planned - summary.covered - summary.generated;
  emitActivity(
    teamId,
    repositoryId,
    sessionId,
    "session:complete",
    (session.metadata.qaMode === "refresh_spec"
      ? `Specification refreshed: ${summary.planned} planned, ${summary.covered} covered by existing tests, ${gaps} gaps`
      : `QA suite build complete: ${summary.generated} tests generated, ${summary.covered} already covered, ${summary.passed} passing`) +
      (summary.prCoverage
        ? ` · branch changes covered: ${summary.prCoverage.coveredCount}/${summary.prCoverage.entries.length}`
        : ""),
  );
  return true;
}

// ── Pipeline ─────────────────────────────────────────────────────────────────

/** Step lists per run mode — a session's `steps` array IS its pipeline; the
 *  executor walks it in order, so segmented modes just build shorter lists. */
const MODE_PIPELINES: Record<QaRunMode, QaStepId[]> = {
  full: QA_STEP_DEFINITIONS.map((s) => s.id),
  // Re-discover + re-plan against existing coverage; no generation. Summary
  // reports which plan items the current suite already covers vs. the gaps.
  refresh_spec: [
    "qa_setup",
    "qa_login",
    "qa_discover",
    "qa_plan",
    "qa_plan_review",
    "qa_summary",
  ],
  // Reuse the latest plan/discovery; generate only uncovered items. qa_login
  // still runs: generation/execution need auth context, and a prior capture
  // may have expired — a still-valid one resolves in seconds via option (a).
  fill_gaps: [
    "qa_setup",
    "qa_login",
    "qa_generate",
    "qa_execute",
    "qa_heal",
    "qa_summary",
  ],
  // App Map exploration: map the app, nothing else. No plan, no generation —
  // the map is computed-on-read from qaDiscovery, which discover flushes
  // incrementally so the map grows live. Finalized at the end of
  // executeQaPipeline (no qa_summary step to mark the session completed).
  explore: ["qa_setup", "qa_login", "qa_discover"],
};

function buildStepsForMode(mode: QaRunMode): QaStepState[] {
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
  fromStep: QaStepId,
) {
  const host = hostOf();
  const controller = getOrCreateController(sessionId);
  const signal = controller.signal;
  const session = await host.getSession(sessionId);
  if (!session) return;
  // The session's own steps define the pipeline (mode-dependent).
  const pipeline = session.steps.map((s) => s.id);
  const startIdx = pipeline.indexOf(fromStep);
  if (startIdx === -1) return;

  try {
    // The detached half of every start action: no session survives into this
    // fire-and-forget continuation, so the scope is the ownership-checked
    // background branch — the caller already authorized both ids.
    const { ctx } = await qaContext({ repositoryId, teamId });

    for (let i = startIdx; i < pipeline.length; i++) {
      if (await isStopped(sessionId, signal)) return;
      const stepId = pipeline[i];
      let ok = false;
      switch (stepId) {
        case "qa_setup":
          ok = await runQaSetup(sessionId, teamId, repositoryId, signal);
          break;
        case "qa_login":
          ok = await runQaLogin(ctx, sessionId, teamId, repositoryId, signal);
          break;
        case "qa_discover":
          ok = await runQaDiscover(
            ctx,
            sessionId,
            teamId,
            repositoryId,
            signal,
          );
          break;
        case "qa_plan":
          ok = await runQaPlan(ctx, sessionId, teamId, repositoryId, signal);
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

    // Explore pipelines end at qa_discover — no summary step marks the
    // session terminal, so finalize here once every step succeeded.
    const finished = await host.getSession(sessionId);
    if (
      finished?.metadata.qaMode === "explore" &&
      finished.status === "active"
    ) {
      await host.updateSession(sessionId, {
        status: "completed",
        completedAt: new Date(),
      });
      const discovered =
        finished.metadata.qaExplore?.pagesDiscovered ??
        finished.metadata.qaDiscovery?.crawledPages.length ??
        0;
      emitActivity(
        teamId,
        repositoryId,
        sessionId,
        "session:complete",
        `Exploration complete: ${discovered} screens mapped`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[QaAgent] pipeline error:", err);
    const session = await host.getSession(sessionId).catch(() => null);
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
    // Task-queue bookkeeping: if this session worked a queue task and ended
    // terminally, write the agent's reply back and advance the queue.
    await finalizeQaTaskAndDispatch(sessionId, teamId, repositoryId).catch(
      (err) => console.error("[QaAgent] task finalize error:", err),
    );
  }
}

// ── Public actions ───────────────────────────────────────────────────────────

export interface StartQaAgentInput {
  repositoryId: string;
  targetUrl: string;
  /** full (default) | refresh_spec | fill_gaps — see QaRunMode. */
  mode?: QaRunMode;
  /** Product documentation uploads (.md/.txt/.pdf/.docx, base64) — the
   *  planner treats their content as authoritative for intended behavior. */
  docs?: Array<{ name: string; contentBase64: string }>;
  groups: QaTestGroup[];
  email?: string;
  password?: string;
  autoApprove?: boolean;
  /** Allow the qa_login step to self-register a throwaway account when no
   *  creds/setup exist and a signup link is found in the DOM. Default true. */
  allowRegistration?: boolean;
  /** Explore-mode parameters (mode = "explore" only). */
  explore?: Omit<QaExploreConfig, "pageBudget">;
  /** Free-text sign-in instructions for explore runs — qa_login AI-extracts
   *  structured creds/loginUrl from the prose. Encrypted at rest. */
  authContext?: string;
}

/** Page budget an explore run gets for its chosen depth (spec: 6 + depth*5,
 *  capped at 40 pages). */
function explorePageBudget(depth: number): number {
  return Math.min(6 + depth * 5, 40);
}

export async function startQaAgent(
  input: StartQaAgentInput,
): Promise<{ sessionId: string }> {
  const { host, ctx } = await qaContext({ repositoryId: input.repositoryId });
  assertEntitled(ctx);
  const teamId = ctx.team.id;
  // Agent sessions hold embedded browsers for their whole run — metered
  // against the same run-minute quota as test runs. Covers the App Map
  // "Explore" launcher too, which funnels through here.
  await host.assertRunMinutesAvailable(teamId);

  const targetUrl = input.targetUrl.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(targetUrl)) {
    throw new Error("Target URL must start with http(s)://");
  }
  const urlCheck = await host.checkOutboundUrl(targetUrl);
  if (!urlCheck.ok) {
    throw new Error(`URL rejected: ${urlCheck.reason}`);
  }

  // One active QA session per repo — cancel a stale one before starting.
  const existing = await host.getActiveSession(input.repositoryId);
  if (existing) {
    activeControllers.get(existing.id)?.abort();
    await host.updateSession(existing.id, {
      status: "cancelled",
      completedAt: new Date(),
    });
  }

  const mode: QaRunMode = input.mode ?? "full";
  const credsProvided = Boolean(input.email?.trim() && input.password);
  const steps = buildStepsForMode(mode);

  // Explore runs carry their swarm config + live progress skeleton so the App
  // Map progress UI has state to poll from the first second.
  let exploreSeed: Partial<QaSessionMetadata> = {};
  if (mode === "explore") {
    const requested = input.explore ?? {
      explorers: 1,
      depth: 2,
      strategy: "balanced" as const,
      maxMinutes: 5,
    };
    const depth = Math.max(1, Math.min(Math.floor(requested.depth), 6));
    const config: QaExploreConfig = {
      explorers: Math.max(1, Math.min(Math.floor(requested.explorers), 10)),
      depth,
      strategy: requested.strategy,
      maxMinutes: Math.max(1, Math.min(requested.maxMinutes, 20)),
      pageBudget: explorePageBudget(depth),
    };
    const startedAt = new Date();
    const exploreState: QaExploreState = {
      config,
      explorers: Array.from({ length: config.explorers }, (_, index) => ({
        index,
        status: "claiming",
        pagesMapped: 0,
      })),
      pagesDiscovered: 0,
      blocked: [],
      startedAt: startedAt.toISOString(),
      deadlineAt: new Date(
        startedAt.getTime() + config.maxMinutes * 60_000,
      ).toISOString(),
    };
    exploreSeed = {
      qaExplore: exploreState,
      ...(input.authContext?.trim()
        ? { qaAuthContext: input.authContext.trim().slice(0, 4000) }
        : {}),
    };
  }

  // Decode uploaded product docs into the planner's documentation digest.
  // Only the digest + per-file summaries persist — never the raw upload.
  let docsSeed: Partial<QaSessionMetadata> = {};
  if (input.docs?.length) {
    const { summaries, digest } = await processUploadedDocs(input.docs);
    if (digest) {
      docsSeed = { qaDocs: summaries, qaDocsDigest: digest };
    }
  }

  // fill_gaps reuses the newest stored plan (from any prior full/refresh run)
  // instead of re-discovering and re-planning.
  let planSeed: Partial<QaSessionMetadata> = {};
  if (mode === "fill_gaps") {
    const recent = await host.getRecentSessions(input.repositoryId, 10);
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

  const session = await host.createSession({
    repositoryId: input.repositoryId,
    teamId,
    currentStepId: "qa_setup",
    steps,
    metadata: {
      qaTargetUrl: targetUrl,
      qaMode: mode,
      qaGroups: normalizeQaGroups(input.groups),
      qaAutoApprove: Boolean(input.autoApprove),
      qaAllowRegistration: input.allowRegistration ?? true,
      qaTrigger: "manual",
      credsProvided,
      authMode: credsProvided ? "login" : "public_only",
      ...planSeed,
      ...docsSeed,
      ...exploreSeed,
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
    `QA agent started on ${targetUrl} (${mode.replace("_", " ")})`,
  );

  executeQaPipeline(session.id, teamId, input.repositoryId, "qa_setup").catch(
    (err) => console.error("[QaAgent] unhandled:", err),
  );

  revalidatePath("/qa-agent");
  return { sessionId: session.id };
}

async function requireQaSession(sessionId: string): Promise<{
  session: QaSessionRow;
  teamId: string;
}> {
  const { host, ctx } = await qaContext();
  assertEntitled(ctx);
  // Kind filtering happens inside `host.getSession` — a non-QA session id
  // resolves null here exactly as the old inline `kind !== "qa"` check did.
  const session = await host.getSession(sessionId);
  if (!session) {
    throw new Error("QA session not found");
  }
  if (session.teamId && session.teamId !== ctx.team.id) {
    throw new Error("QA session not found");
  }
  return { session, teamId: ctx.team.id };
}

export async function approveQaPlan(
  sessionId: string,
  opts?: { disabledItemIds?: string[]; autoApprove?: boolean },
): Promise<{ success: boolean }> {
  const { session, teamId } = await requireQaSession(sessionId);
  const host = hostOf();
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

  await host.updateSession(sessionId, { status: "active" });
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
  const host = hostOf();
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
  await host.updateSession(sessionId, { status: "active" });

  executeQaPipeline(sessionId, teamId, session.repositoryId, "qa_plan").catch(
    (err) => console.error("[QaAgent] unhandled:", err),
  );
  revalidatePath("/qa-agent");
  return { success: true };
}

/** Split a free-text blob of user journeys into individual journeys. Accepts
 *  newline- or bullet-separated input; trims markers and empties. */
function parseUserJourneys(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter((l) => l.length > 0)
    .slice(0, 15);
}

const REFINER_TIMEOUT_MS = 3 * 60 * 1000;

/**
 * Refine plain-language journeys into structured, digest-grounded journeys +
 * covering items and MERGE them into the session's current plan (existing
 * items and enable/disable choices are preserved — see mergeRefinedJourneys).
 * Shared by the reviewer's "add journeys" gate action and the task
 * dispatcher (which merges a task directive into a fill-gaps run's plan).
 */
async function refineAndMergeJourneysIntoPlan(
  ctx: QaCtx,
  session: QaSessionRow,
  teamId: string,
  journeys: string[],
): Promise<{
  success: boolean;
  addedJourneys?: number;
  addedItems?: number;
  /** Ids of the plan items the merge added — task runs scope generation to
   *  exactly these. */
  addedItemIds?: string[];
  error?: string;
}> {
  const sessionId = session.id;
  const plan = session.metadata.qaPlan;
  const discovery = session.metadata.qaDiscovery;
  if (!plan || !discovery) {
    return { success: false, error: "No plan to add journeys to" };
  }

  const repositoryId = session.repositoryId;
  const groups = normalizeQaGroups(session.metadata.qaGroups ?? []);
  const authenticated = isRunAuthenticated(session.metadata);
  const digest = buildDiscoveryDigest(discovery);
  const systemPrompt = buildJourneyRefinerSystemPrompt();
  const userPrompt = buildJourneyRefinerUserPrompt({
    digest,
    groups,
    userJourneys: journeys,
    existingPlanDigest: buildExistingPlanDigest(plan),
    authenticated,
  });

  const callRefiner = async (extra?: string): Promise<string> => {
    const result = await ctx.ai.generate(
      extra ? `${userPrompt}\n\n${extra}` : userPrompt,
      {
        actionType: "qa_plan",
        repositoryId,
        systemPrompt,
        json: true,
        signal: AbortSignal.timeout(REFINER_TIMEOUT_MS),
      },
    );
    return result.text;
  };

  let refined: RefinedJourneys | null = null;
  try {
    const raw = await callRefiner();
    refined = parseAiJson(raw, isRefinedJourneys, { source: "qa-refine" });
    if (!refined) {
      const shape = parseAiJson(raw, (x): x is unknown => true, {
        source: "qa-refine-explain",
      });
      const reason =
        explainInvalidRefinedJourneys(shape) ?? "the JSON was invalid";
      const retry = await callRefiner(
        `Your previous response was not valid: ${reason}. Respond with ONLY the JSON object described in the system prompt.`,
      );
      refined = parseAiJson(retry, isRefinedJourneys, {
        source: "qa-refine-retry",
      });
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Journey refiner failed",
    };
  }
  if (!refined) {
    return {
      success: false,
      error:
        "The AI could not turn those journeys into a valid plan. Reword them and try again.",
    };
  }

  const merged = mergeRefinedJourneys(plan, refined, groups);
  await mergeMetadata(sessionId, {
    qaPlan: merged.plan,
    qaUserJourneys: [...(session.metadata.qaUserJourneys ?? []), ...journeys],
  });
  emitActivity(
    teamId,
    repositoryId,
    sessionId,
    "substep:update",
    `Added ${merged.addedJourneys} journey${merged.addedJourneys === 1 ? "" : "s"} and ${merged.addedItems} test${merged.addedItems === 1 ? "" : "s"} from your input`,
    { stepId: "qa_plan_review", agentType: "planner" },
  );
  return {
    success: true,
    addedJourneys: merged.addedJourneys,
    addedItems: merged.addedItems,
    addedItemIds: merged.addedItemIds,
  };
}

/**
 * Reviewer action at the plan gate: refine plain-language journeys and merge
 * them into the plan. The session STAYS paused at the review gate showing the
 * augmented plan; nothing advances until the reviewer approves. Counters the
 * "reduced context" quality gap by letting the human inject the journeys the
 * condensed digest lost.
 */
export async function addQaUserJourneys(
  sessionId: string,
  journeysText: string,
): Promise<{
  success: boolean;
  addedJourneys?: number;
  addedItems?: number;
  error?: string;
}> {
  const { session, teamId } = await requireQaSession(sessionId);
  // A scoped context for the refiner's AI call — the session's own repo.
  const { ctx } = await qaContext({ repositoryId: session.repositoryId });
  const journeys = parseUserJourneys(journeysText);
  if (journeys.length === 0) {
    return { success: false, error: "No journeys were provided" };
  }
  const result = await refineAndMergeJourneysIntoPlan(
    ctx,
    session,
    teamId,
    journeys,
  );
  if (result.success) revalidatePath("/qa-agent");
  return result;
}

export async function pauseQaAgent(
  sessionId: string,
): Promise<{ success: boolean }> {
  const { session } = await requireQaSession(sessionId);
  if (session.status !== "active") return { success: false };
  activeControllers.get(sessionId)?.abort();
  await hostOf().updateSession(sessionId, { status: "paused" });
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
  await hostOf().updateSession(sessionId, { status: "active" });
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
  await hostOf().updateSession(sessionId, {
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

/** Re-run a prior session with its stored configuration (target URL, mode,
 *  groups, credentials, docs digest). Powers the run-history "Re-run" action —
 *  credentials stay server-side (copied between encrypted metadata records). */
export async function rerunQaSession(
  sourceSessionId: string,
): Promise<{ sessionId: string }> {
  const { session: source, teamId } = await requireQaSession(sourceSessionId);
  const host = hostOf();
  const m = source.metadata;
  const targetUrl = m.qaTargetUrl;
  if (!targetUrl) {
    throw new Error("This run has no stored target URL to re-run against");
  }
  const urlCheck = await host.checkOutboundUrl(targetUrl);
  if (!urlCheck.ok) {
    throw new Error(`URL rejected: ${urlCheck.reason}`);
  }

  // One active QA session per repo — cancel a running one before starting.
  const existing = await host.getActiveSession(source.repositoryId);
  if (existing) {
    activeControllers.get(existing.id)?.abort();
    await host.updateSession(existing.id, {
      status: "cancelled",
      completedAt: new Date(),
    });
  }

  const mode: QaRunMode = m.qaMode ?? "full";
  let planSeed: Partial<QaSessionMetadata> = {};
  if (mode === "fill_gaps") {
    if (!m.qaPlan) {
      throw new Error("The original fill-gaps run has no stored plan");
    }
    planSeed = {
      qaPlan: m.qaPlan,
      qaDiscovery: m.qaDiscovery,
      qaPlanSourceSessionId: source.id,
    };
  }

  const session = await host.createSession({
    repositoryId: source.repositoryId,
    teamId,
    currentStepId: "qa_setup",
    steps: buildStepsForMode(mode),
    metadata: {
      qaTargetUrl: targetUrl,
      qaMode: mode,
      qaGroups: normalizeQaGroups(m.qaGroups ?? QA_GROUPS.map((g) => g.id)),
      qaAutoApprove: Boolean(m.qaAutoApprove),
      qaAllowRegistration: m.qaAllowRegistration ?? true,
      credsProvided: Boolean(m.credsProvided),
      authMode: m.credsProvided ? "login" : "public_only",
      ...(m.credsProvided
        ? {
            quickstartEmail: m.quickstartEmail,
            quickstartPassword: m.quickstartPassword,
          }
        : {}),
      ...(m.qaDocsDigest
        ? { qaDocs: m.qaDocs, qaDocsDigest: m.qaDocsDigest }
        : {}),
      ...planSeed,
      qaTrigger: "rerun",
    },
  });

  emitActivity(
    teamId,
    source.repositoryId,
    session.id,
    "session:start",
    `QA agent re-run on ${targetUrl} (${mode.replace("_", " ")})`,
  );
  executeQaPipeline(session.id, teamId, source.repositoryId, "qa_setup").catch(
    (err) => console.error("[QaAgent] unhandled:", err),
  );
  revalidatePath("/qa-agent");
  return { sessionId: session.id };
}

// ── Direction queue (qa_agent_tasks) ─────────────────────────────────────────
//
// The team (and external agents via MCP) drops directives into a queue; when
// no QA session is active the dispatcher claims the oldest queued task and
// TRIAGES it with a small logged AI call (see domain/task-triage.ts):
//
//   targeted + stored plan   fill_gaps scoped to the directive — the journey
//                            refiner merges it into the plan and ONLY the
//                            items it adds are generated, run, and healed
//   targeted + no plan       fill_gaps against a minimal plan synthesized
//                            from the triage's own tests — straight to the
//                            generator, no discovery pass
//   explore                  full pipeline — the scout re-discovers the app,
//                            the planner must cover the directive, then
//                            generate → execute → heal as usual
//
// EVERY task is triaged, including coverage_gap ones: the App Map files
// route-specific "Cover /path" tasks (targeted — the route is usually NOT a
// stored-plan item, so a plain gap-fill would generate nothing), while the
// dashboard's "increase overall coverage" asks are broad. The one source-based
// nuance: a broad (explore-scoped) coverage_gap directive with a stored plan
// runs gap_fill — generate that plan's uncovered items — instead of paying for
// a full re-discovery.
//
// Auth is reused from run history (storage state / verified creds) — by the
// time a directive lands here, login is a solved problem, so qa_login resolves
// in seconds instead of re-registering. Runs are autonomous (review gate
// auto-approved) and the agent's reply is written back onto the task card.
// The triage prompt/response is logged to ai_prompt_logs (qa_task_triage) and
// linked from a task:triaged activity event + the session's qaTaskTriage
// metadata, so routing decisions can be debugged and improved later.

const TERMINAL_SESSION_STATUSES: QaSessionRow["status"][] = [
  "completed",
  "failed",
  "cancelled",
];

const MAX_TASK_TITLE = 200;
const MAX_TASK_DESCRIPTION = 2000;
const TRIAGE_TIMEOUT_MS = 2 * 60 * 1000;

/** The agent's reply for a completed task run — the card's "done" comment. */
function buildTaskReply(session: QaSessionRow): string {
  // Targeted run: report only the directive's own items, not the whole plan.
  const taskItemIds = session.metadata.qaTaskItemIds;
  if (taskItemIds?.length) {
    const scoped = (session.metadata.qaGeneratedTests ?? []).filter((g) =>
      taskItemIds.includes(g.planItemId),
    );
    const generated = scoped.filter(
      (g) => g.testId && g.status !== "covered",
    ).length;
    const covered = scoped.filter((g) => g.status === "covered").length;
    const passed = scoped.filter(
      (g) => g.status === "passed" || g.status === "healed",
    ).length;
    const healed = scoped.filter((g) => g.status === "healed").length;
    const stillFailing = scoped.filter((g) => g.status === "failed").length;
    const genFailed = scoped.filter(
      (g) => g.status === "generation_failed",
    ).length;
    const parts = [`generated ${generated}`, `${passed} passing`];
    if (covered > 0) parts.push(`${covered} already covered`);
    if (healed > 0) parts.push(`${healed} healed`);
    if (stillFailing > 0) parts.push(`${stillFailing} still failing`);
    if (genFailed > 0) parts.push(`${genFailed} could not be generated`);
    return `Done — ${parts.join(", ")} for this directive.`;
  }
  const s = session.metadata.qaSummary;
  if (!s) return "Run completed. Coverage dashboard updated.";
  const genFailed = (session.metadata.qaGeneratedTests ?? []).filter(
    (t) => t.status === "generation_failed",
  ).length;
  if (s.generated === 0 && s.covered > 0 && s.failed === 0 && genFailed === 0) {
    // Gap-fill that found no gaps — say so instead of "0 generated, 0 passing".
    return `Done — all ${s.covered} of the plan's ${s.planned} runnable items are already covered by existing tests; nothing new to generate. Coverage dashboard updated.`;
  }
  const parts = [
    `planned ${s.planned}`,
    `${s.covered} already covered`,
    `${s.generated} generated`,
    `${s.passed} passing`,
  ];
  if (s.healed > 0) parts.push(`${s.healed} healed`);
  if (s.failed > 0) parts.push(`${s.failed} still failing`);
  if (genFailed > 0) parts.push(`${genFailed} could not be generated`);
  return `Done — ${parts.join(", ")}. Coverage dashboard updated.`;
}

/** Tests the session's run touched for THIS task — the card's linked chips.
 *  Targeted runs list exactly the directive's items; unscoped runs list every
 *  ledger entry that produced or matched a test. */
function buildTaskTestRefs(session: QaSessionRow | null): QaTaskTestRef[] {
  if (!session) return [];
  const taskItemIds = session.metadata.qaTaskItemIds;
  return (session.metadata.qaGeneratedTests ?? [])
    .filter((g) => g.testId)
    .filter((g) => !taskItemIds?.length || taskItemIds.includes(g.planItemId))
    .map((g) => ({ testId: g.testId!, name: g.name, status: g.status }));
}

/** Write a terminal session's outcome back onto its task card. */
async function finalizeTask(
  task: QaAgentTask,
  session: QaSessionRow | null,
  teamId: string,
  repositoryId: string,
): Promise<void> {
  const db = tasksDb();
  if (session?.status === "completed") {
    await updateQaTaskRow(db, task.id, {
      status: "done",
      agentReply: buildTaskReply(session),
      tests: buildTaskTestRefs(session),
      completedAt: new Date(),
    });
    emitActivity(
      teamId,
      repositoryId,
      session.id,
      "task:completed",
      `Task done: ${task.title}`,
    );
    return;
  }
  const failedStep = session?.steps.find((s) => s.status === "failed");
  const reply = !session
    ? "The session working this task is gone (server restart?). Retry to requeue it."
    : session.status === "cancelled"
      ? "The run was cancelled before this task finished. Retry to requeue it."
      : `The run failed at ${failedStep?.label ?? "an unexpected point"}${
          failedStep?.error ? `: ${failedStep.error}` : ""
        }. Retry to requeue it.`;
  await updateQaTaskRow(db, task.id, {
    status: "needs_input",
    agentReply: reply,
    // Partial progress still links: tests generated before the failure.
    tests: buildTaskTestRefs(session),
    completedAt: new Date(),
  });
  emitActivity(
    teamId,
    repositoryId,
    session?.id ?? task.id,
    "task:failed",
    `Task needs input: ${task.title}`,
  );
}

/** Pipeline epilogue: settle the session's task (if any), then advance the
 *  queue. Safe to call for non-task sessions — dispatch no-ops while any QA
 *  session is active or paused. */
async function finalizeQaTaskAndDispatch(
  sessionId: string,
  teamId: string,
  repositoryId: string,
): Promise<void> {
  const session = await hostOf().getSession(sessionId);
  if (!session || !TERMINAL_SESSION_STATUSES.includes(session.status)) return;
  const taskId = session.metadata.qaTaskId;
  if (taskId) {
    const task = await getQaTaskRow(tasksDb(), taskId);
    if (task && task.status === "working" && task.sessionId === sessionId) {
      await finalizeTask(task, session, teamId, repositoryId);
    }
  }
  await dispatchNextQaTask(teamId, repositoryId);
}

// Per-repo dispatch lock — poll-triggered kicks and pipeline epilogues can
// race; only one claim may run at a time (in-process, same as the controller
// registry).
const dispatchingRepos = new Set<string>();

/** Everything an autonomous run borrows from run history: target URL (env
 *  config fallback), stored plan/discovery, groups, and credentials. Shared by
 *  the task dispatcher and the schedule/PR/MCP trigger starts. */
async function resolveQaRunSeed(repositoryId: string): Promise<{
  targetUrl: string | undefined;
  planSource: QaSessionRow | undefined;
  groups: QaTestGroup[];
  creds: { email: string; password: string } | undefined;
  allowRegistration: boolean;
}> {
  const host = hostOf();
  const recent = await host.getRecentSessions(repositoryId, 10);
  const planSource = recent.find((s) => s.metadata.qaPlan);
  let targetUrl =
    planSource?.metadata.qaTargetUrl ??
    recent.find((s) => s.metadata.qaTargetUrl)?.metadata.qaTargetUrl;
  if (!targetUrl) {
    const envBaseUrl = await host
      .getEnvironmentBaseUrl(repositoryId)
      .catch(() => null);
    targetUrl = envBaseUrl || undefined;
  }
  const credSession = recent.find((s) => credentialsFrom(s.metadata));
  return {
    targetUrl,
    planSource,
    groups: normalizeQaGroups(
      planSource?.metadata.qaGroups ?? QA_GROUPS.map((g) => g.id),
    ),
    creds: credSession ? credentialsFrom(credSession.metadata) : undefined,
    allowRegistration: planSource?.metadata.qaAllowRegistration ?? true,
  };
}

/** Park a task as needs_input with an actionable reply, before or instead of
 *  a run. The human retries (→ queued) or drops it. */
async function parkTask(
  task: QaAgentTask,
  teamId: string,
  repositoryId: string,
  reply: string,
  sessionId?: string,
): Promise<void> {
  await updateQaTaskRow(tasksDb(), task.id, {
    status: "needs_input",
    agentReply: reply,
    completedAt: new Date(),
  });
  emitActivity(
    teamId,
    repositoryId,
    sessionId ?? task.id,
    "task:failed",
    `Task needs input: ${task.title}`,
  );
}

/** Scope a directive with one small AI call — "targeted" (generate the named
 *  coverage directly) vs "explore" (broad; scout + planner first). The prompt
 *  and response land in ai_prompt_logs under qa_task_triage; the returned
 *  promptLogId links the decision back to that row. Throws when the model
 *  can't produce a valid decision — the caller parks the task, never guesses. */
async function triageQaTask(
  ctx: QaCtx,
  repositoryId: string,
  directive: string,
  seed: Awaited<ReturnType<typeof resolveQaRunSeed>>,
): Promise<TaskTriageResult & { promptLogId?: string }> {
  const plan = seed.planSource?.metadata.qaPlan;
  const knownPagePaths = plan
    ? [
        ...new Set(
          plan.items
            .map((i) => i.pagePath)
            .filter((p): p is string => Boolean(p)),
        ),
      ]
    : undefined;
  const systemPrompt = buildTaskTriageSystemPrompt();
  const userPrompt = buildTaskTriageUserPrompt({
    directive,
    groups: seed.groups,
    existingPlanDigest: plan ? buildExistingPlanDigest(plan) : undefined,
    knownPagePaths,
    authenticated: Boolean(seed.creds),
  });

  let promptLogId: string | undefined;
  const call = async (extra?: string): Promise<string> => {
    const result = await ctx.ai.generate(
      extra ? `${userPrompt}\n\n${extra}` : userPrompt,
      {
        actionType: "qa_task_triage",
        repositoryId,
        systemPrompt,
        json: true,
        signal: AbortSignal.timeout(TRIAGE_TIMEOUT_MS),
      },
    );
    if (result.promptLogId) promptLogId = result.promptLogId;
    return result.text;
  };

  const raw = await call();
  let triage = parseAiJson(raw, isTaskTriageResult, {
    source: "qa-task-triage",
  });
  if (!triage) {
    const shape = parseAiJson(raw, (x): x is unknown => true, {
      source: "qa-task-triage-explain",
    });
    const reason = explainInvalidTaskTriage(shape) ?? "the JSON was invalid";
    const retry = await call(
      `Your previous response was not valid: ${reason}. Respond with ONLY the JSON object described in the system prompt.`,
    );
    triage = parseAiJson(retry, isTaskTriageResult, {
      source: "qa-task-triage-retry",
    });
  }
  if (!triage) {
    throw new Error(
      "The AI could not turn this directive into a routing decision",
    );
  }
  return { ...triage, promptLogId };
}

/** Claim the oldest queued task, triage its directive, and run the matching
 *  task-scoped session (see the section comment above for the protocols). */
async function dispatchNextQaTask(
  teamId: string,
  repositoryId: string,
): Promise<void> {
  if (dispatchingRepos.has(repositoryId)) return;
  dispatchingRepos.add(repositoryId);
  try {
    const host = hostOf();
    const db = tasksDb();
    // One QA session per repo — an active/paused session owns the agent.
    const active = await host.getActiveSession(repositoryId);
    if (active) return;
    const task = await getNextQueuedQaTaskRow(db, repositoryId);
    if (!task) return;

    // Background scope for the triage/refine AI calls — the dispatcher runs
    // from fire-and-forget continuations and the pipeline epilogue, where no
    // request session exists.
    const { ctx } = await qaContext({ repositoryId, teamId });

    const seed = await resolveQaRunSeed(repositoryId);
    const { targetUrl, planSource, groups, creds, allowRegistration } = seed;
    if (!targetUrl) {
      await parkTask(
        task,
        teamId,
        repositoryId,
        "I don't have a target URL yet — start one QA run from the form first, then retry this task.",
      );
      return;
    }

    const directive = [task.title, task.description ?? ""]
      .filter(Boolean)
      .join("\n");
    const storedPlan = planSource?.metadata.qaPlan;
    const storedDiscovery = planSource?.metadata.qaDiscovery;

    // Route the directive. The task stays "queued" while triaging so a crash
    // here leaves it claimable.
    let triage: TaskTriageResult & { promptLogId?: string };
    try {
      triage = await triageQaTask(ctx, repositoryId, directive, seed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await parkTask(
        task,
        teamId,
        repositoryId,
        `I couldn't scope this directive: ${msg}. Reword it or retry.`,
      );
      return;
    }

    const protocol:
      | "gap_fill" // unscoped fill_gaps against the stored plan
      | "explore" // full pipeline, directive fed to the planner
      | "targeted_refine" // fill_gaps scoped to refiner-merged items
      | "targeted_direct" = // fill_gaps against a synthesized mini plan
      triage.scope === "explore"
        ? task.source === "coverage_gap" && storedPlan
          ? "gap_fill" // broad "close the gaps" ask — the plan already knows them
          : "explore"
        : storedPlan && storedDiscovery
          ? "targeted_refine"
          : triage.tests.length > 0
            ? "targeted_direct"
            : "explore"; // targeted, but nothing concrete to target against

    const directItems =
      protocol === "targeted_direct"
        ? triageTestsToPlanItems(triage.tests, groups)
        : [];
    const mode: QaRunMode = protocol === "explore" ? "full" : "fill_gaps";
    const qaTaskTriage = {
      scope: triage.scope,
      reason: triage.reason,
      promptLogId: triage.promptLogId,
    };

    const session = await host.createSession({
      repositoryId,
      teamId,
      currentStepId: "qa_setup",
      steps: buildStepsForMode(mode),
      metadata: {
        qaTargetUrl: targetUrl,
        qaMode: mode,
        qaGroups: groups,
        // Queue runs are autonomous — no human at the review gate.
        qaAutoApprove: true,
        qaAllowRegistration: allowRegistration,
        credsProvided: Boolean(creds),
        authMode: creds ? "login" : "public_only",
        ...(creds
          ? {
              quickstartEmail: creds.email,
              quickstartPassword: creds.password,
            }
          : {}),
        ...(protocol === "gap_fill" || protocol === "targeted_refine"
          ? {
              qaPlan: planSource!.metadata.qaPlan,
              qaDiscovery: planSource!.metadata.qaDiscovery,
              qaPlanSourceSessionId: planSource!.id,
            }
          : protocol === "targeted_direct"
            ? {
                qaPlan: buildTaskPlanFromTriage(directive, directItems),
                qaTaskItemIds: directItems.map((i) => i.id),
              }
            : {
                qaPlannerFeedback: `Directive from the team's task queue — the plan must cover it:\n${directive}`,
              }),
        qaTaskTriage,
        qaTaskId: task.id,
        qaTrigger: "task",
      },
    });

    await updateQaTaskRow(db, task.id, {
      status: "working",
      sessionId: session.id,
      startedAt: new Date(),
    });
    emitActivity(
      teamId,
      repositoryId,
      session.id,
      "task:started",
      `QA agent picked up task: ${task.title}`,
    );
    emitActivity(
      teamId,
      repositoryId,
      session.id,
      "task:triaged",
      `Directive scoped as ${qaTaskTriage.scope}: ${qaTaskTriage.reason}`,
      {
        detail: {
          protocol,
          scope: qaTaskTriage.scope,
          reason: qaTaskTriage.reason,
        },
        promptLogId: qaTaskTriage.promptLogId,
      },
    );

    // targeted_refine: merge the directive into the reused plan and scope the
    // run to exactly the items it adds. This is a hard gate — a failed merge
    // parks the task instead of silently running an unrelated gap-fill.
    let workingNote: string;
    if (protocol === "targeted_refine") {
      const fresh = await host.getSession(session.id);
      // One task card = ONE ask: pass the directive as a single journey so the
      // refiner doesn't treat title and description as two separate journeys.
      const merged = fresh
        ? await refineAndMergeJourneysIntoPlan(ctx, fresh, teamId, [directive])
        : { success: false as const, error: "Session vanished before refine" };
      if (!merged.success) {
        await host.updateSession(session.id, {
          status: "failed",
          completedAt: new Date(),
        });
        await parkTask(
          task,
          teamId,
          repositoryId,
          `I couldn't turn this directive into plan items: ${merged.error ?? "unknown error"}. Reword it or retry.`,
          session.id,
        );
        return;
      }
      const ids = merged.addedItemIds ?? [];
      if (ids.length > 0) {
        await mergeMetadata(session.id, { qaTaskItemIds: ids });
        workingNote = `Scoped as targeted — generating ${ids.length} test${ids.length === 1 ? "" : "s"} for this directive, then running and healing them.`;
      } else {
        // Every refined item deduplicated against the stored plan: the
        // directive is already planned. Run an unscoped gap-fill so the
        // planned-but-never-generated case still produces the asked-for tests.
        workingNote =
          "The stored plan already covers this — filling its remaining gaps (generate, run, heal).";
      }
    } else if (protocol === "targeted_direct") {
      workingNote = `Scoped as targeted — generating ${directItems.length} test${directItems.length === 1 ? "" : "s"} from the directive, then running and healing them.`;
    } else if (protocol === "explore") {
      workingNote =
        "Scoped as a broader run — scouting the app, planning coverage for this directive, then generating, running, and healing.";
    } else {
      workingNote =
        "Filling coverage gaps against the stored plan (generate, run, heal).";
    }
    await updateQaTaskRow(db, task.id, { agentReply: workingNote });

    executeQaPipeline(session.id, teamId, repositoryId, "qa_setup").catch(
      (err) => console.error("[QaAgent] unhandled:", err),
    );
  } finally {
    dispatchingRepos.delete(repositoryId);
  }
}

async function requireQaTask(
  taskId: string,
): Promise<{ task: QaAgentTask; teamId: string }> {
  const { ctx } = await qaContext();
  assertEntitled(ctx);
  const task = await getQaTaskRow(tasksDb(), taskId);
  if (!task || task.teamId !== ctx.team.id) {
    throw new Error("Task not found");
  }
  return { task, teamId: ctx.team.id };
}

/** Drop a directive into the QA agent's queue. The dispatcher picks it up as
 *  soon as no session is running. */
export async function addQaTask(input: {
  repositoryId: string;
  title: string;
  description?: string;
  /** "mcp" is passed by the v1 API when an external agent files the task —
   *  the board renders it with a distinct actor chip. */
  source?: QaTaskSource;
}): Promise<{ taskId: string }> {
  const { host, ctx } = await qaContext({ repositoryId: input.repositoryId });
  assertEntitled(ctx);
  const title = input.title.trim().slice(0, MAX_TASK_TITLE);
  if (!title) throw new Error("The task needs a title");
  const actor = await host.currentActor();
  const actorName = actor?.name || actor?.email || null;
  const task = await createQaTaskRow(tasksDb(), {
    repositoryId: input.repositoryId,
    teamId: ctx.team.id,
    title,
    description:
      input.description?.trim().slice(0, MAX_TASK_DESCRIPTION) || null,
    source: input.source ?? "user",
    createdById: actor?.id ?? null,
    createdByName:
      input.source === "mcp" && actorName ? `${actorName} · MCP` : actorName,
  });
  emitActivity(
    ctx.team.id,
    input.repositoryId,
    task.id,
    "task:created",
    `Task queued for the QA agent: ${title}`,
  );
  // Fire-and-forget: pickup can involve an AI refine call — don't block the
  // composer on it.
  dispatchNextQaTask(ctx.team.id, input.repositoryId).catch((err) =>
    console.error("[QaAgent] dispatch error:", err),
  );
  revalidatePath("/qa-agent");
  return { taskId: task.id };
}

/** Requeue a needs_input/cancelled task. */
export async function retryQaTask(
  taskId: string,
): Promise<{ success: boolean }> {
  const { task, teamId } = await requireQaTask(taskId);
  if (task.status !== "needs_input" && task.status !== "cancelled") {
    return { success: false };
  }
  await updateQaTaskRow(tasksDb(), taskId, {
    status: "queued",
    sessionId: null,
    agentReply: null,
    tests: null,
    startedAt: null,
    completedAt: null,
  });
  dispatchNextQaTask(teamId, task.repositoryId).catch((err) =>
    console.error("[QaAgent] dispatch error:", err),
  );
  revalidatePath("/qa-agent");
  return { success: true };
}

/** Cancel a task; a working task's session is cancelled with it. */
export async function dropQaTask(
  taskId: string,
): Promise<{ success: boolean }> {
  const { task, teamId } = await requireQaTask(taskId);
  if (task.status === "done" || task.status === "cancelled") {
    return { success: false };
  }
  if (task.status === "working" && task.sessionId) {
    activeControllers.get(task.sessionId)?.abort();
    await hostOf().updateSession(task.sessionId, {
      status: "cancelled",
      completedAt: new Date(),
    });
  }
  await updateQaTaskRow(tasksDb(), taskId, {
    status: "cancelled",
    completedAt: new Date(),
  });
  emitActivity(
    teamId,
    task.repositoryId,
    task.sessionId ?? task.id,
    "task:failed",
    `Task cancelled: ${task.title}`,
  );
  revalidatePath("/qa-agent");
  return { success: true };
}

/** Board state for the client. Also does lazy reconciliation: a "working"
 *  task whose session ended without the in-process finalizer (server restart)
 *  is settled here, and an orphaned queue gets the dispatcher kicked. */
export async function listQaTasks(
  repositoryId: string,
): Promise<QaAgentTask[]> {
  const { host, ctx } = await qaContext({ repositoryId });
  const db = tasksDb();
  let tasks = await getQaTasksByRepoRows(db, repositoryId);

  let changed = false;
  for (const task of tasks) {
    if (task.status !== "working" || !task.sessionId) continue;
    const session = await host.getSession(task.sessionId);
    if (!session || TERMINAL_SESSION_STATUSES.includes(session.status)) {
      await finalizeTask(task, session ?? null, ctx.team.id, repositoryId);
      changed = true;
    }
  }
  if (changed) tasks = await getQaTasksByRepoRows(db, repositoryId);

  if (
    tasks.some((t) => t.status === "queued") &&
    !tasks.some((t) => t.status === "working")
  ) {
    dispatchNextQaTask(ctx.team.id, repositoryId).catch(() => {});
  }
  return tasks;
}

// ── Automation triggers (schedule / PR / MCP) ────────────────────────────────

/** Session-less start used by the scheduler tick, the PR webhook, and the v1
 *  API (MCP). Borrows target URL / plan / groups / creds from run history via
 *  resolveQaRunSeed, auto-approves the gate, and SKIPS (with an activity
 *  event) when a session is already running — triggers never preempt.
 *
 *  NOT a UI action: callers are trusted server code that already resolved the
 *  team (webhook signature, scheduler row, or bearer-authed v1 route). The
 *  `{repositoryId, teamId}` scope below is the ownership-checked background
 *  branch of `resolveScope` — no request session is consulted. */
export async function startQaAgentFromTrigger(opts: {
  repositoryId: string;
  teamId: string;
  trigger: Extract<QaSessionTrigger, "schedule" | "pr" | "mcp">;
  mode?: QaRunMode;
  targetUrl?: string;
  /** Extra context for the activity feed (e.g. "PR #12 sync", token owner). */
  reason?: string;
}): Promise<{ sessionId?: string; skipped?: string }> {
  const { repositoryId, teamId } = opts;

  // Triggers respect the same plan gate as the UI. An unresolvable team (or
  // a repo that stopped belonging to it) skips for the same reason a plan
  // below the gate does — there is no tenant this trigger may run as.
  let host: QaAgentHost;
  let ctx: QaCtx;
  try {
    ({ host, ctx } = await qaContext({ repositoryId, teamId }));
  } catch {
    return { skipped: "QA agent not available on the team's plan" };
  }
  if (!ctx.team.entitlements.has("qa-agent")) {
    return { skipped: "QA agent not available on the team's plan" };
  }

  // ...and the same run-minute ceiling as a manual start.
  try {
    await host.assertRunMinutesAvailable(teamId);
  } catch {
    return { skipped: "Monthly run-minute quota exceeded" };
  }

  const active = await host.getActiveSession(repositoryId);
  if (active) {
    emitActivity(
      teamId,
      repositoryId,
      active.id,
      "substep:update",
      `QA ${opts.trigger} trigger skipped — a session is already running${
        opts.reason ? ` (${opts.reason})` : ""
      }`,
    );
    return { skipped: "A QA session is already running" };
  }

  const seed = await resolveQaRunSeed(repositoryId);
  const targetUrl =
    opts.targetUrl?.trim().replace(/\/+$/, "") || seed.targetUrl;
  if (!targetUrl) {
    return {
      skipped:
        "No target URL — run the QA agent once from the UI (or pass targetUrl)",
    };
  }
  const urlCheck = await host.checkOutboundUrl(targetUrl);
  if (!urlCheck.ok) {
    return { skipped: `URL rejected: ${urlCheck.reason}` };
  }

  // Mode default: reuse the stored plan cheaply when one exists (fill_gaps);
  // otherwise a full autonomous run.
  let mode: QaRunMode = opts.mode ?? (seed.planSource ? "fill_gaps" : "full");
  if (mode === "fill_gaps" && !seed.planSource) mode = "full";

  const session = await host.createSession({
    repositoryId,
    teamId,
    currentStepId: "qa_setup",
    steps: buildStepsForMode(mode),
    metadata: {
      qaTargetUrl: targetUrl,
      qaMode: mode,
      qaGroups: seed.groups,
      qaAutoApprove: true,
      qaAllowRegistration: seed.allowRegistration,
      credsProvided: Boolean(seed.creds),
      authMode: seed.creds ? "login" : "public_only",
      ...(seed.creds
        ? {
            quickstartEmail: seed.creds.email,
            quickstartPassword: seed.creds.password,
          }
        : {}),
      ...(mode === "fill_gaps" && seed.planSource
        ? {
            qaPlan: seed.planSource.metadata.qaPlan,
            qaDiscovery: seed.planSource.metadata.qaDiscovery,
            qaPlanSourceSessionId: seed.planSource.id,
          }
        : {}),
      qaTrigger: opts.trigger,
    },
  });

  emitActivity(
    teamId,
    repositoryId,
    session.id,
    "session:start",
    `QA agent started by ${opts.trigger} trigger on ${targetUrl} (${mode.replace("_", " ")})${
      opts.reason ? ` — ${opts.reason}` : ""
    }`,
  );
  executeQaPipeline(session.id, teamId, repositoryId, "qa_setup").catch((err) =>
    console.error("[QaAgent] unhandled:", err),
  );
  return { sessionId: session.id };
}

const TRIGGER_MODES: QaRunMode[] = ["full", "refresh_spec", "fill_gaps"];

export interface QaTriggerConfigInput {
  scheduleEnabled?: boolean;
  cronExpression?: string | null;
  scheduleMode?: QaRunMode;
  prEnabled?: boolean;
  prMode?: QaRunMode;
}

/** Current automation config for the repo (null when never configured). */
export async function getQaTriggerConfig(repositoryId: string) {
  await qaContext({ repositoryId }); // authorization only
  return (await getQaAgentTriggerRow(tasksDb(), repositoryId)) ?? null;
}

/** Upsert the repo's automation config; recomputes nextRunAt on save. */
export async function updateQaTriggerConfig(
  repositoryId: string,
  input: QaTriggerConfigInput,
) {
  const { ctx } = await qaContext({ repositoryId });
  assertEntitled(ctx);
  const db = tasksDb();

  const patch: Parameters<typeof upsertQaAgentTriggerRow>[3] = {};
  if (input.scheduleEnabled !== undefined) {
    patch.scheduleEnabled = input.scheduleEnabled;
  }
  if (input.cronExpression !== undefined) {
    const cron = input.cronExpression?.trim() || null;
    if (cron && !isValidCron(cron)) {
      throw new Error("Invalid cron expression (5 fields expected)");
    }
    patch.cronExpression = cron;
  }
  if (input.scheduleMode !== undefined) {
    if (!TRIGGER_MODES.includes(input.scheduleMode)) {
      throw new Error("Invalid schedule mode");
    }
    patch.scheduleMode = input.scheduleMode;
  }
  if (input.prEnabled !== undefined) patch.prEnabled = input.prEnabled;
  if (input.prMode !== undefined) {
    if (!TRIGGER_MODES.includes(input.prMode)) {
      throw new Error("Invalid PR mode");
    }
    patch.prMode = input.prMode;
  }

  // Recompute the next fire time from the effective (post-patch) state.
  const existing = await getQaAgentTriggerRow(db, repositoryId);
  const effectiveEnabled =
    patch.scheduleEnabled ?? existing?.scheduleEnabled ?? false;
  const effectiveCron =
    patch.cronExpression !== undefined
      ? patch.cronExpression
      : (existing?.cronExpression ?? null);
  patch.nextRunAt =
    effectiveEnabled && effectiveCron
      ? getNextRunTime(effectiveCron, new Date())
      : null;

  const row = await upsertQaAgentTriggerRow(
    db,
    repositoryId,
    ctx.team.id,
    patch,
  );
  revalidatePath("/qa-agent");
  return row;
}

/**
 * Fire due QA agent cron triggers — one tick, called from the app's scheduler
 * loop (`src/lib/core/scheduler.ts`), the same call shape
 * `dispatchDueSchedules` (scheduling) and `dispatchDueExplorerTriggers`
 * (explorer) already use. Owns the due-trigger query, `nextRunAt` advancement
 * (BEFORE starting, so a slow run can't double-fire) and the busy-skip —
 * `startQaAgentFromTrigger` reports why a fire was declined.
 *
 * Takes the data handle from the wiring slot: a scheduler tick has no session
 * to build a context from. Returns how many sessions were started.
 */
export async function dispatchDueQaTriggers(): Promise<number> {
  const db = tasksDb();
  const due = await getDueQaAgentTriggerRows(db);
  let fired = 0;

  for (const trigger of due) {
    try {
      if (!trigger.cronExpression) continue;
      const nextRunAt = getNextRunTime(trigger.cronExpression, new Date());
      await markQaAgentTriggerFiredRow(db, trigger.id, { nextRunAt });

      const result = await startQaAgentFromTrigger({
        repositoryId: trigger.repositoryId,
        teamId: trigger.teamId,
        trigger: "schedule",
        mode: trigger.scheduleMode,
      });

      if (result.sessionId) {
        await markQaAgentTriggerFiredRow(db, trigger.id, {
          nextRunAt,
          lastRunAt: new Date(),
          lastSessionId: result.sessionId,
        });
        fired += 1;
        console.log(
          `[scheduler] Started scheduled QA agent session ${result.sessionId}`,
        );
      } else if (result.skipped) {
        console.log(`[scheduler] QA agent trigger skipped: ${result.skipped}`);
      }
    } catch (error) {
      console.error("[scheduler] Failed to fire QA agent trigger:", error);
    }
  }
  return fired;
}
