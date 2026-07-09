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
  findAuthLinksOnEb,
  findExistingAuthSetup,
  loginWithCredsOnEb,
  probeAndCaptureOnEb,
  validateStorageStateOnEb,
  type ExistingAuthSetup,
} from "@/lib/qa-agent/auth";
import { injectStorageStateIntoEb } from "@/lib/eb/inject-storage-state";
import { captureStorageState } from "@/lib/quickstart/storage-capture";
import {
  renderAuthLoginCode,
  renderAuthSetupCode,
  renderQuickstartEmail,
  renderQuickstartPassword,
  slugify,
  utcStamp,
} from "@/lib/playwright/quickstart-templates";
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
  mergeRefinedJourneys,
  normalizeQaGroups,
  sanitizeQaPlan,
  QA_GROUPS,
  type ExistingTestSummary,
  type RefinedJourneys,
} from "@/lib/qa-agent/plan";
import type {
  ActivityEventType,
  AgentSession,
  AgentSessionMetadata,
  AgentStepId,
  AgentStepState,
  PwAgentType,
  QaAuthState,
  QaDiscovery,
  QaGeneratedTest,
  QaPlanItem,
  QaRunMode,
  QaTestGroup,
  QaTestPlan,
  TestSetupOverrides,
} from "@/lib/db/schema";

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

/** Whether this run's plan/tests target the AUTHENTICATED in-app surface.
 *  This is auth AVAILABILITY, not "plaintext credentials were typed": qa_login
 *  resolves auth via typed creds, a captured/existing storage state, or repo
 *  default setup steps — any of which means the crawl ran signed-in and
 *  generated tests start authenticated. Wiring the planner to credsProvided
 *  alone made it plan "public surface only" on storage-state runs. Mirrors the
 *  `preAuthenticated` calc in the generate step. */
function isRunAuthenticated(metadata: AgentSessionMetadata): boolean {
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

// ── Step: qa_login ───────────────────────────────────────────────────────────

/** Create (or refresh) the repo's reusable QA login setup test so the
 *  captured session can be re-established by the executor when it expires. */
async function upsertQaLoginSetupTest(
  repositoryId: string,
  opts: { email: string; password: string; loginUrl: string },
): Promise<string | undefined> {
  try {
    const name = "QA agent — auth login";
    const code = renderAuthLoginCode(opts);
    const tests = await queries.getTestsByRepo(repositoryId);
    const existing = tests.find((t) => t.name === name);
    if (existing) {
      await queries.updateTest(existing.id, { code });
      return existing.id;
    }
    const created = await queries.createTest({ repositoryId, name, code });
    return created.id;
  } catch (err) {
    console.warn("[QaAgent] login setup test upsert failed:", err);
    return undefined;
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
  sessionId: string,
  teamId: string,
  repositoryId: string,
  signal: AbortSignal,
): Promise<boolean> {
  await setStepActive(sessionId, "qa_login");
  const session = await queries.getAgentSession(sessionId);
  if (!session?.metadata.qaTargetUrl) return false;
  const targetUrl = session.metadata.qaTargetUrl;
  const credentials = credentialsFrom(session.metadata);
  const allowRegistration = session.metadata.qaAllowRegistration !== false;

  const SUB_EXISTING = 0;
  const SUB_SETUP_RUN = 1;
  const SUB_CREDS = 2;
  const SUB_REGISTER = 3;
  const SUB_RESOLVE = 4;
  const substeps: NonNullable<AgentStepState["substeps"]> = [
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

  const existing = await findExistingAuthSetup(repositoryId).catch(
    (): ExistingAuthSetup => ({ defaultSetupInUse: false }),
  );

  let auth: QaAuthState | null = null;
  let authLinks: { loginUrl?: string; signupUrl?: string } = {};
  let runnerId: string | undefined;

  try {
    // One EB for validation, link discovery, and the live credential test.
    // Unavailability is NOT fatal: resolution degrades and discovery (which
    // claims its own EB later) picks up the deferred validation.
    let cdpUrl: string | undefined;
    const eb = await claimEmbeddedBrowserForAgent(EB_CLAIM_TIMEOUT_MS, () => {
      mergeMetadata(sessionId, { queuedForBrowser: true }).catch(() => {});
    }).catch(() => undefined);
    await mergeMetadata(sessionId, {
      queuedForBrowser: false,
      ...(eb ? { streamUrl: proxiedStream(eb.streamUrl) } : {}),
    });
    if (eb) {
      runnerId = eb.runnerId;
      cdpUrl = eb.cdpUrl;
    }

    // 1) Existing setup infrastructure (setup steps / storage states).
    if (existing.storageStateId) {
      const row = await queries
        .getStorageState(existing.storageStateId)
        .catch(() => null);
      const stateName = existing.storageStateName ?? "storage state";
      if (!row?.storageStateJson) {
        substeps[SUB_EXISTING] = {
          ...substeps[SUB_EXISTING],
          status: "done",
          detail: `"${stateName}" could not be loaded — continuing`,
        };
      } else if (!cdpUrl) {
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
      } else {
        const check = await validateStorageStateOnEb(
          cdpUrl,
          row.storageStateJson,
          targetUrl,
        );
        if (check.validated || check.deferred) {
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
      const source = existing.setupTestId
        ? await queries.getTest(existing.setupTestId).catch(() => null)
        : await queries
            .getSetupScript(existing.setupScriptId!)
            .catch(() => null);
      const code = source?.code;
      if (!code) {
        setupRunFailed = true;
        substeps[SUB_SETUP_RUN] = {
          ...substeps[SUB_SETUP_RUN],
          status: "error",
          detail: `"${stepName}" has no code — continuing`,
        };
      } else {
        // Arbitrary setup code must not run in-process: captureStorageState
        // executes it in its own disposable runner/EB; ours stays claimed for
        // the validation probe right after.
        const captured = await captureStorageState({
          repositoryId,
          baseUrl: targetUrl,
          testCode: code,
          name: `QA agent setup ${utcStamp()}`,
        });
        if (captured.captured && captured.storageStateId) {
          let validated = false;
          let deferred = !cdpUrl;
          if (cdpUrl) {
            const fresh = await queries
              .getStorageState(captured.storageStateId)
              .catch(() => null);
            if (fresh?.storageStateJson) {
              const check = await validateStorageStateOnEb(
                cdpUrl,
                fresh.storageStateJson,
                targetUrl,
              );
              validated = check.validated;
              deferred = check.deferred;
            } else {
              deferred = true;
            }
          }
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
    // both the credential test and registration need them.
    if (
      !auth &&
      cdpUrl &&
      (credentials || (allowRegistration && !defaultSetupCoversAuth))
    ) {
      authLinks = await findAuthLinksOnEb(cdpUrl, targetUrl);
    }

    // 2) User-provided credentials — verify with a real login and capture the
    //    session so discovery and generated tests start authenticated.
    if (!auth && credentials && cdpUrl) {
      substeps[SUB_CREDS] = { ...substeps[SUB_CREDS], status: "running" };
      await updateSubsteps(sessionId, "qa_login", substeps);
      const login = await loginWithCredsOnEb({
        cdpUrl,
        targetUrl,
        loginUrl: authLinks.loginUrl,
        credentials,
      });
      if (login.ok && login.storageStateJson) {
        const persisted = await queries.createStorageState({
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
    } else {
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
      // (1-job-1-EB) — release ours before it claims.
      if (runnerId) {
        await mergeMetadata(sessionId, { streamUrl: undefined }).catch(
          () => {},
        );
        await releasePoolEB(runnerId).catch(() => {});
        runnerId = undefined;
        cdpUrl = undefined;
      }
      const repo = await queries.getRepository(repositoryId);
      const team = await queries.getTeam(teamId).catch(() => undefined);
      const stamp = utcStamp();
      const slug = slugify(repo?.name ?? "qa-agent");
      const template =
        team?.quickstartEmailTemplate ?? "viktor+{slug}{stamp}@lastest.cloud";
      const email = renderQuickstartEmail(template, slug, stamp);
      const password = renderQuickstartPassword(stamp);
      const code = renderAuthSetupCode({
        email,
        password,
        registerUrl: authLinks.signupUrl,
      });
      const setupTest = await queries.createTest({
        repositoryId,
        name: `QA agent — auth signup ${stamp}`,
        code,
      });
      const captured = await captureStorageState({
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
    await mergeMetadata(sessionId, { streamUrl: undefined }).catch(() => {});
    if (runnerId) await releasePoolEB(runnerId).catch(() => {});
  }
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

  const repo = await queries.getRepository(repositoryId);
  const ghAccount = await queries
    .getGithubAccountByTeam(teamId)
    .catch(() => undefined);
  const githubConnected = Boolean(
    ghAccount?.accessToken && repo?.provider === "github" && repo.owner,
  );
  const branch = repo?.selectedBranch || repo?.defaultBranch || "main";
  const baseBranch = repo?.defaultBranch || "main";

  // 1) Static routes: reuse a prior scan; else run the GitHub-tree scanner.
  let staticRoutes: Array<{ path: string; type: string }> = [];
  let framework: string | undefined;
  try {
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
        branch,
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
  if (githubConnected && repo && ghAccount?.accessToken) {
    try {
      const [
        { gatherCodebaseIntelligence },
        { getRepoTree, getFileContent, compareBranches },
      ] = await Promise.all([
        import("@/lib/ai/codebase-intelligence"),
        import("@/lib/github/content"),
      ]);
      const { extractDeclaredEndpoints } =
        await import("@/lib/qa-agent/code-check");
      const token = ghAccount.accessToken;
      const owner = repo.owner ?? "";
      const name = repo.name ?? "";
      const [intel, tree, comparison] = await Promise.all([
        gatherCodebaseIntelligence(token, owner, name, branch).catch(
          () => null,
        ),
        getRepoTree(token, owner, name, branch).catch(() => null),
        branch !== baseBranch
          ? compareBranches(token, owner, name, baseBranch, branch).catch(
              () => null,
            )
          : Promise.resolve(null),
      ]);
      const declaredEndpoints = tree
        ? await extractDeclaredEndpoints(tree.tree, (path) =>
            getFileContent(token, owner, name, path, branch),
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
        const { computePrChanges } = await import("@/lib/qa-agent/pr-check");
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
      substeps[2] = {
        ...substeps[2],
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

      // Start the crawl from the post-login state when qa_login resolved a
      // storage state; otherwise fall back to the inline first-page login
      // ("creds tested during discovery"). Unresolved auth also prioritizes
      // login/signup links so the auth surface itself gets mapped.
      const qaAuth = session.metadata.qaAuth;
      let preAuthed = false;
      if (qaAuth?.storageStateId) {
        const state = await queries
          .getStorageState(qaAuth.storageStateId)
          .catch(() => null);
        if (state?.storageStateJson) {
          preAuthed = await injectStorageStateIntoEb(
            eb.cdpUrl,
            state.storageStateJson,
          );
        }
      }
      const credentials = preAuthed
        ? undefined
        : credentialsFrom(session.metadata);
      crawled = await crawlTargetApp(eb.cdpUrl, targetUrl, {
        maxPages: MAX_CRAWL_PAGES,
        credentials,
        loginUrl: qaAuth?.loginUrl,
        // No injected session and no creds to try → make sure the crawl at
        // least maps the login/signup surface itself.
        prioritizeAuthLinks: !preAuthed && !credentials,
        signal,
        onPage: (snapshot, index) => {
          substeps[2] = {
            ...substeps[2],
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
        ((qaAuth.strategy === "creds_untested" && crawled.loginAttempted) ||
          (preAuthed && !qaAuth.validated))
      ) {
        const probe = await probeAndCaptureOnEb(eb.cdpUrl, targetUrl);
        if (probe.authed) {
          let upgraded = { ...qaAuth, validated: true };
          if (qaAuth.strategy === "creds_untested" && probe.storageStateJson) {
            const persisted = await queries.createStorageState({
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
    }
  } catch (err) {
    substeps[2] = {
      ...substeps[2],
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
    ...(githubConnected ? { branch, baseBranch } : {}),
    codeCheck,
    prChanges,
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
  // Target the authenticated in-app surface whenever qa_login resolved auth —
  // NOT only when raw credentials were typed (see isRunAuthenticated). Passing
  // credsProvided alone told the planner "public surface only" on storage-state
  // runs, so it discarded the whole authed digest and planned only login pages.
  const authenticated = isRunAuthenticated(session.metadata);
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
        authenticated,
        existingCoverage,
        docsDigest: session.metadata.qaDocsDigest || undefined,
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

  const sanitized = sanitizeQaPlan(plan, groups);

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
  // Auth resolved by qa_login: a storage state (or repo default setup) means
  // generated tests start pre-authenticated via setup steps instead of
  // scripting their own login with prompt-injected credentials.
  const qaAuth = session.metadata.qaAuth;
  const preAuthenticated = Boolean(
    qaAuth?.storageStateId || qaAuth?.defaultSetupInUse,
  );
  const authSetupOverrides: TestSetupOverrides | undefined =
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

      // Pre-authenticate the generation EB too, so the generator verifies
      // selectors against the same post-login state the tests will run in.
      if (qaAuth?.storageStateId) {
        const state = await queries
          .getStorageState(qaAuth.storageStateId)
          .catch(() => null);
        if (state?.storageStateJson) {
          await injectStorageStateIntoEb(eb.cdpUrl, state.storageStateJson);
        }
      }

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
          `Generator working on "${item.title}" (${itemGroups(item).join(" + ")})`,
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
              playwrightOverrides: itemPlaywrightOverrides(itemGroups(item)),
              // Chain the captured login session; when repo defaults already
              // cover auth this stays undefined (defaults apply to every test).
              ...(authSetupOverrides
                ? { setupOverrides: authSetupOverrides }
                : {}),
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
            intent: healIntentFor(entry),
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
        groups: itemGroups(i),
        testId: coveredBy.get(i.id),
        name: i.title,
        status: "covered" as const,
      }));
    await mergeMetadata(sessionId, { qaGeneratedTests: ledger });
  }

  const summary = computeQaSummary(plan, ledger);
  // Branch-aware runs: report, per function/endpoint the branch changed,
  // whether a test now covers it (the PR coverage panel).
  const prChanges = session.metadata.qaDiscovery?.prChanges;
  if (prChanges) {
    const { computePrCoverage } = await import("@/lib/qa-agent/pr-check");
    summary.prCoverage = computePrCoverage(prChanges, plan, ledger);
  }
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
const MODE_PIPELINES: Record<QaRunMode, AgentStepId[]> = {
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
        case "qa_login":
          ok = await runQaLogin(sessionId, teamId, repositoryId, signal);
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

  // Decode uploaded product docs into the planner's documentation digest.
  // Only the digest + per-file summaries persist — never the raw upload.
  let docsSeed: Partial<AgentSessionMetadata> = {};
  if (input.docs?.length) {
    const { processUploadedDocs } = await import("@/lib/qa-agent/docs");
    const { summaries, digest } = await processUploadedDocs(input.docs);
    if (digest) {
      docsSeed = { qaDocs: summaries, qaDocsDigest: digest };
    }
  }

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
      qaAllowRegistration: input.allowRegistration ?? true,
      credsProvided,
      authMode: credsProvided ? "login" : "public_only",
      ...planSeed,
      ...docsSeed,
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
 * Refine plain-language journeys the reviewer supplied at the plan gate into
 * structured, digest-grounded journeys + covering items, and MERGE them into
 * the current plan (existing items and the reviewer's enable/disable choices
 * are preserved — see mergeRefinedJourneys). The session STAYS paused at the
 * review gate showing the augmented plan; nothing advances until the reviewer
 * approves. Counters the "reduced context" quality gap by letting the human
 * inject the journeys the condensed digest lost.
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
  const plan = session.metadata.qaPlan;
  const discovery = session.metadata.qaDiscovery;
  if (!plan || !discovery) {
    return { success: false, error: "No plan to add journeys to" };
  }
  const journeys = parseUserJourneys(journeysText);
  if (journeys.length === 0) {
    return { success: false, error: "No journeys were provided" };
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
    const settings = await queries.getAISettings(repositoryId);
    const config = getAIConfig(settings);
    return generateWithAI(
      config,
      extra ? `${userPrompt}\n\n${extra}` : userPrompt,
      systemPrompt,
      {
        repositoryId,
        actionType: "qa_plan",
        responseFormat: "json_object",
        signal: AbortSignal.timeout(REFINER_TIMEOUT_MS),
      },
    );
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
  revalidatePath("/qa-agent");
  return {
    success: true,
    addedJourneys: merged.addedJourneys,
    addedItems: merged.addedItems,
  };
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
