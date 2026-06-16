"use server";

import * as queries from "@/lib/db/queries";
import { requireRepoAccess, requireTeamAccess } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import type {
  AgentSession,
  AgentSessionMetadata,
  AgentStepId,
  AgentStepRichResult,
  AgentStepState,
  ActivityEventType,
  PwAgentType,
  TestSetupOverrides,
} from "@/lib/db/schema";
import { isQuickstartEnabled, gateReasonHint } from "@/lib/quickstart/gating";
import {
  renderAuthSetupCode,
  renderAuthLoginCode,
  renderWalkthroughCode,
  renderQuickstartEmail,
  renderQuickstartPassword,
  utcStamp,
  slugify,
  AUTH_CHAIN_FAILED_MARKER,
} from "@/lib/playwright/quickstart-templates";
import {
  runQuickstartScoutPublic,
  runQuickstartScoutAuthed,
} from "@/lib/playwright/quickstart-scout";
import { captureStorageState } from "@/lib/quickstart/storage-capture";
import {
  generateDemoNotes,
  type QuickstartRunFacts,
} from "@/lib/quickstart/quickstart-notes";
import { createAndRunBuildCore, getBuildSummary } from "./builds";
import { approveAllDiffs } from "./diffs";
import { publishBuildShare } from "./public-shares";
import { claimEmbeddedBrowserForAgent } from "./ai";
import { releasePoolEB } from "./embedded-sessions";
import { emitAndPersistActivityEvent } from "@/lib/db/queries/activity-events";
import { db } from "@/lib/db";
import { embeddedSessions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { toProxyStreamUrl } from "@/lib/eb/stream-url";
import { appendStreamToken } from "@/lib/eb/stream-token";

/**
 * Normalise a raw EB `ws://host:port` stream URL into a browser-routable form for
 * the QuickStart panel's live view: a same-origin proxy path (works on HTTPS +
 * k3s dev where pod IPs aren't routable) plus the stream auth token. Mirrors the
 * build page's stream wiring.
 */
function proxiedStream(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const proxied = toProxyStreamUrl(raw) ?? raw;
  return appendStreamToken(proxied, process.env.STREAM_AUTH_TOKEN) || undefined;
}

/** Resolve the live stream URL of the EB currently running a build's test run. */
async function resolveBuildStreamUrl(
  buildId: string,
): Promise<string | undefined> {
  const build = await queries.getBuild(buildId);
  if (!build?.testRunId) return undefined;
  const testRun = await queries.getTestRun(build.testRunId);
  if (!testRun?.runnerId) return undefined;
  const [sess] = await db
    .select({ streamUrl: embeddedSessions.streamUrl })
    .from(embeddedSessions)
    .where(eq(embeddedSessions.runnerId, testRun.runnerId));
  return proxiedStream(sess?.streamUrl);
}

// ---------------------------------------------------------------------------
// Step definitions
// ---------------------------------------------------------------------------

const QS_STEP_DEFINITIONS: Array<{
  id: AgentStepId;
  label: string;
  description: string;
}> = [
  {
    id: "qs_preflight",
    label: "Preflight",
    description: "Verify repo, baseUrl, AI provider, and console-error mode",
  },
  {
    id: "qs_scout_public",
    label: "Public Scout",
    description: "Browse the landing page and classify the sign-up flow",
  },
  {
    id: "qs_auth_setup",
    label: "Auth Setup",
    description: "Register a demo user and capture the storage state",
  },
  {
    id: "qs_scout_authed",
    label: "Authed Scout",
    description: "Walk the in-app surface as the demo user",
  },
  {
    id: "qs_generate",
    label: "Generate Walkthrough",
    description: "Author the walkthrough test from scout results",
  },
  {
    id: "qs_run_and_notes",
    label: "Run & Notes",
    description: "Run the build with video and write demo notes",
  },
  {
    id: "qs_approve_baselines",
    label: "Approve Baselines",
    description: "Accept first-run baselines so the share looks clean",
  },
  {
    id: "qs_rerun_after_approval",
    label: "Rerun for Pairing",
    description:
      "Re-run walkthrough so authed shots pair with their own baselines",
  },
  {
    id: "qs_publish_share",
    label: "Publish Share",
    description: "Publish the founder-facing /r/<slug> share URL",
  },
];

const QS_STEP_ORDER: AgentStepId[] = QS_STEP_DEFINITIONS.map((s) => s.id);
const BUILD_POLL_INTERVAL_MS = 4000;
const BUILD_POLL_TIMEOUT_MS = 8 * 60 * 1000;

function buildInitialQsSteps(): AgentStepState[] {
  return QS_STEP_DEFINITIONS.map((def) => ({
    id: def.id,
    status: "pending" as const,
    label: def.label,
    description: def.description,
  }));
}

// ---------------------------------------------------------------------------
// AbortController registry (separate from play-agent's so cancels stay scoped)
// ---------------------------------------------------------------------------

const activeQuickstartControllers = new Map<string, AbortController>();

function getOrCreateQsController(sessionId: string): AbortController {
  let ctrl = activeQuickstartControllers.get(sessionId);
  if (!ctrl || ctrl.signal.aborted) {
    ctrl = new AbortController();
    activeQuickstartControllers.set(sessionId, ctrl);
  }
  return ctrl;
}

function cleanupQsController(sessionId: string) {
  activeQuickstartControllers.delete(sessionId);
}

// ---------------------------------------------------------------------------
// Step state helpers
// ---------------------------------------------------------------------------

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
    artifactType?: "test" | "build" | "area" | "baseline" | "score";
    artifactId?: string;
    artifactLabel?: string;
    durationMs?: number;
  },
) {
  emitAndPersistActivityEvent({
    teamId,
    repositoryId,
    sessionId,
    sourceType: "play_agent",
    eventType,
    summary,
    stepId: opts?.stepId ?? null,
    agentType: opts?.agentType ?? "quickstart",
    detail: opts?.detail ?? null,
    artifactType: opts?.artifactType ?? null,
    artifactId: opts?.artifactId ?? null,
    artifactLabel: opts?.artifactLabel ?? null,
    durationMs: opts?.durationMs ?? null,
    promptLogId: null,
  }).catch((err) => console.error("[QuickStart] activity emit error:", err));
}

async function patchStep(
  sessionId: string,
  stepId: AgentStepId,
  patch: Partial<AgentStepState>,
) {
  const session = await queries.getAgentSession(sessionId);
  if (!session) return;
  const steps = [...session.steps];
  const idx = steps.findIndex((s) => s.id === stepId);
  if (idx === -1) return;
  steps[idx] = { ...steps[idx], ...patch };
  await queries.updateAgentSession(sessionId, {
    steps,
    currentStepId:
      patch.status === "active" ? stepId : (session.currentStepId ?? undefined),
  });
}

async function setActive(sessionId: string, stepId: AgentStepId) {
  await patchStep(sessionId, stepId, {
    status: "active",
    startedAt: new Date().toISOString(),
  });
  await queries.updateAgentSession(sessionId, { currentStepId: stepId });
}

async function setCompleted(
  sessionId: string,
  stepId: AgentStepId,
  result?: Record<string, unknown>,
  richResult?: AgentStepRichResult,
) {
  await patchStep(sessionId, stepId, {
    status: "completed",
    completedAt: new Date().toISOString(),
    result,
    ...(richResult ? { richResult } : {}),
  });
}

async function setFailed(
  sessionId: string,
  stepId: AgentStepId,
  error: string,
) {
  await patchStep(sessionId, stepId, {
    status: "failed",
    completedAt: new Date().toISOString(),
    error,
  });
  await queries.updateAgentSession(sessionId, {
    status: "failed",
    completedAt: new Date(),
  });
}

async function setSkipped(
  sessionId: string,
  stepId: AgentStepId,
  reason: string,
) {
  await patchStep(sessionId, stepId, {
    status: "skipped",
    completedAt: new Date().toISOString(),
    result: { skipped: true, reason },
  });
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

async function isCancelled(
  sessionId: string,
  signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted) return true;
  const session = await queries.getAgentSession(sessionId);
  if (session?.status === "cancelled") {
    activeQuickstartControllers.get(sessionId)?.abort();
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Build helper — create a build and poll to completion. Used for the public-only
// downgrade rerun inside runQsRunAndNotes. The primary run + the pairing rerun
// keep their inline loops (they emit progress-specific activity between create
// and poll); this helper is for the conditional auth-downgrade path only.
// ---------------------------------------------------------------------------

type QsBuildSummary = NonNullable<Awaited<ReturnType<typeof getBuildSummary>>>;

async function runBuildAndWait(
  repositoryId: string,
  testIds: string[],
  sessionId: string,
  signal: AbortSignal,
): Promise<
  | { ok: true; buildId: string; summary: QsBuildSummary }
  | { ok: false; error: string }
> {
  let buildId: string;
  try {
    const result = await createAndRunBuildCore(
      "manual",
      testIds,
      repositoryId,
      undefined,
      undefined,
      undefined,
      true,
    );
    if (!result.buildId) {
      return {
        ok: false,
        error: `Build was queued (EB pool busy). Job ID: ${(result as { jobId?: string }).jobId ?? "unknown"}.`,
      };
    }
    buildId = result.buildId;
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const started = Date.now();
  let summary = await getBuildSummary(buildId);
  while (!summary || !summary.completedAt) {
    if (Date.now() - started > BUILD_POLL_TIMEOUT_MS) {
      return { ok: false, error: "Build timed out (>8 min)." };
    }
    if (await isCancelled(sessionId, signal)) {
      return { ok: false, error: "cancelled" };
    }
    await new Promise((r) => setTimeout(r, BUILD_POLL_INTERVAL_MS));
    summary = await getBuildSummary(buildId);
  }
  return { ok: true, buildId, summary };
}

// ---------------------------------------------------------------------------
// Step runners
// ---------------------------------------------------------------------------

async function runQsPreflight(
  sessionId: string,
  repositoryId: string,
  teamId: string,
): Promise<boolean> {
  await setActive(sessionId, "qs_preflight");

  const gate = await isQuickstartEnabled(repositoryId);
  if (!gate.enabled || !gate.repo || !gate.team || !gate.baseUrl) {
    const reason = gate.reason ?? "no_repo";
    await mergeMetadata(sessionId, { disabledReason: reason });
    await setFailed(
      sessionId,
      "qs_preflight",
      `QuickStart disabled: ${gateReasonHint(reason)}`,
    );
    return false;
  }

  const aiSettings = await queries.getAISettings(repositoryId);
  if (!aiSettings.provider) {
    await setFailed(
      sessionId,
      "qs_preflight",
      "No AI provider configured for this repo.",
    );
    return false;
  }

  const stamp = utcStamp();
  const slug = slugify(gate.repo.name);

  // QuickStart runs against the user's OWN app. If they supplied real login
  // credentials (set on the session at start), use those for a LOGIN handshake
  // and skip generating a throwaway demo account. Otherwise fall back to a fresh
  // demo signup via the team email template.
  const preMeta = (await queries.getAgentSession(sessionId))?.metadata;
  const credsProvided =
    preMeta?.credsProvided === true &&
    !!preMeta?.quickstartEmail &&
    !!preMeta?.quickstartPassword;

  let email: string;
  let password: string;
  if (credsProvided) {
    email = preMeta!.quickstartEmail!;
    password = preMeta!.quickstartPassword!;
  } else {
    const template =
      gate.team.quickstartEmailTemplate ?? "viktor+{slug}{stamp}@lastest.cloud";
    email = renderQuickstartEmail(template, slug, stamp);
    password = renderQuickstartPassword(stamp);
  }

  await mergeMetadata(sessionId, {
    quickstartEmail: email,
    quickstartPassword: password,
    quickstartSlug: slug,
    quickstartStamp: stamp,
    credsProvided,
  });

  // Force the repo's EB error gates to "warn" before the first run. Founder
  // sites almost always emit benign console/network noise (analytics 401s,
  // third-party scripts); with the default "fail" mode every clean screenshot
  // reds the walk. The walkthrough template also route-blocks known noise, but
  // this is the belt to that suspenders. Best-effort — never fail preflight on it.
  let errorModesSet = false;
  try {
    await queries.upsertPlaywrightSettings(repositoryId, {
      consoleErrorMode: "warn",
      networkErrorMode: "warn",
    });
    errorModesSet = true;
  } catch (err) {
    console.warn(
      "[QuickStart] could not set console/network error modes:",
      err,
    );
  }

  await setCompleted(sessionId, "qs_preflight", {
    baseUrl: gate.baseUrl,
    slug,
    stamp,
    errorModesSet,
  });
  emitActivity(
    teamId,
    repositoryId,
    sessionId,
    "step:complete",
    "Preflight passed",
    {
      stepId: "qs_preflight",
    },
  );
  return true;
}

async function runQsScoutPublic(
  sessionId: string,
  repositoryId: string,
  teamId: string,
): Promise<boolean> {
  await setActive(sessionId, "qs_scout_public");

  const session = await queries.getAgentSession(sessionId);
  const gate = await isQuickstartEnabled(repositoryId);
  if (!session || !gate.enabled || !gate.baseUrl) {
    await setFailed(sessionId, "qs_scout_public", "Repo or baseUrl missing.");
    return false;
  }

  // Claim a containerized browser from the EB pool so the scout's MCP attaches
  // to a dedicated chromium instead of fighting for the user-data-dir held by
  // any ambient @playwright/mcp process. Mirrors healer/generator pattern.
  // Hard-fail when no EB is available — never fall through to a host-process
  // Chromium (applyScoutMcpWiring would launch @playwright/mcp without a
  // --cdp-endpoint, the exact in-host execution this codebase forbids). While
  // waiting, surface "queued" so the panel reflects the pool back-pressure.
  const eb = await claimEmbeddedBrowserForAgent(5 * 60 * 1000, () => {
    mergeMetadata(sessionId, { queuedForBrowser: true }).catch(() => {});
  }).catch(() => undefined);
  if (!eb) {
    await mergeMetadata(sessionId, { queuedForBrowser: false }).catch(() => {});
    await setFailed(
      sessionId,
      "qs_scout_public",
      "All browsers are busy. Please try again later.",
    );
    return false;
  }
  // Surface the EB's live screencast so the panel can show the scout browsing.
  await mergeMetadata(sessionId, {
    streamUrl: proxiedStream(eb?.streamUrl),
    queuedForBrowser: false,
  });
  try {
    const { data, promptLogId } = await runQuickstartScoutPublic(
      repositoryId,
      gate.baseUrl,
      {
        cdpEndpoint: eb.cdpUrl,
      },
    );
    await mergeMetadata(sessionId, { publicScout: data });

    // 'unknown' is the scout's "I could not classify" sentinel. Treat as a hard
    // failure rather than silently running a doomed public-only walk on a
    // target whose auth flow was never actually determined.
    if (data.classification === "unknown") {
      await setFailed(
        sessionId,
        "qs_scout_public",
        "Scout could not classify the sign-up flow. The browser may have failed or the landing page returned no actionable content. Retry by starting a new QuickStart session.",
      );
      return false;
    }

    await setCompleted(sessionId, "qs_scout_public", {
      classification: data.classification,
      authAutomatable: data.authAutomatable,
      navLinkCount: data.navLinks.length,
      promptLogId,
      ebClaimed: !!eb,
    });
    emitActivity(
      teamId,
      repositoryId,
      sessionId,
      "step:complete",
      `Public scout: ${data.classification} (${data.authAutomatable ? "automatable" : "manual"})`,
      { stepId: "qs_scout_public", agentType: "quickstart" },
    );
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await setFailed(
      sessionId,
      "qs_scout_public",
      `Public scout failed: ${msg}`,
    );
    return false;
  } finally {
    if (eb) await releasePoolEB(eb.runnerId).catch(() => {});
    // Stop the panel pointing at a released EB.
    await mergeMetadata(sessionId, { streamUrl: undefined }).catch(() => {});
  }
}

async function runQsAuthSetup(
  sessionId: string,
  repositoryId: string,
  teamId: string,
): Promise<boolean> {
  await setActive(sessionId, "qs_auth_setup");

  const session = await queries.getAgentSession(sessionId);
  const gate = await isQuickstartEnabled(repositoryId);
  if (!session || !gate.enabled || !gate.baseUrl) {
    await setFailed(sessionId, "qs_auth_setup", "Repo or baseUrl missing.");
    return false;
  }

  const meta = session.metadata;
  const publicScout = meta.publicScout;
  if (!publicScout) {
    await setSkipped(sessionId, "qs_auth_setup", "no public scout output");
    return true;
  }

  const email = meta.quickstartEmail!;
  const password = meta.quickstartPassword!;
  const stamp = meta.quickstartStamp!;
  const slug = meta.quickstartSlug!;
  const credsProvided = meta.credsProvided === true;

  // Decide the handshake. QuickStart runs against the user's OWN app:
  //  - creds provided + a login surface exists  -> LOGIN (real creds, most reliable)
  //  - else automatable email+password register -> SIGNUP (fresh demo account)
  //  - else                                      -> skip (public-only walkthrough)
  const canLogin =
    credsProvided &&
    !!publicScout.loginPath &&
    (publicScout.classification === "email_password" ||
      publicScout.classification === "login_email_password");
  const canSignup = publicScout.authAutomatable && !!publicScout.registerPath;

  let authMode: "login" | "signup";
  let code: string;
  let testName: string;
  if (canLogin) {
    authMode = "login";
    code = renderAuthLoginCode({
      email,
      password,
      loginUrl: publicScout.loginPath!,
      apiLoginEndpoint: publicScout.apiLoginEndpoint ?? undefined,
    });
    testName = `${slug} — auth login`;
  } else if (canSignup) {
    authMode = "signup";
    code = renderAuthSetupCode({
      email,
      password,
      registerUrl: publicScout.registerPath!,
    });
    testName = `${slug} — auth setup`;
  } else {
    const reason = credsProvided
      ? "Credentials were provided but the scout found no usable login form on the site — running public-only."
      : publicScout.authAutomatable
        ? "Scout did not observe a register URL in the page DOM — running public-only (no path guessing)."
        : "auth flow not automatable — running public-only";
    await mergeMetadata(sessionId, { authMode: "public_only" });
    await setSkipped(sessionId, "qs_auth_setup", reason);
    return true;
  }

  // Persist the auth test so the authed scout can replay it and (in non-chained
  // mode) the build includes it. Test code is team-gated; the public /r/ share
  // renders screenshots + notes only, never code.
  const created = await queries.createTest({
    repositoryId,
    name: testName,
    code,
  });
  const testId = created.id;

  // Capture storage state in a disposable runner/EB (or transient host browser).
  const captured = await captureStorageState({
    repositoryId,
    baseUrl: gate.baseUrl,
    testCode: code,
    name: `QuickStart auth ${slug} ${stamp}`,
    tokenLocation: publicScout.tokenLocation,
    authFlavor: publicScout.authLibrary,
  });

  await mergeMetadata(sessionId, {
    authMode,
    authSetup: {
      testId,
      storageStateId: captured.storageStateId,
      captured: captured.captured,
      failureReason: captured.failureReason,
      mode: authMode,
    },
  });

  await setCompleted(sessionId, "qs_auth_setup", {
    testId,
    mode: authMode,
    captured: captured.captured,
    storageStateId: captured.storageStateId,
    failureReason: captured.failureReason,
    durationMs: captured.durationMs,
  });
  emitActivity(
    teamId,
    repositoryId,
    sessionId,
    "step:complete",
    captured.captured
      ? `Auth setup captured (${captured.durationMs}ms)`
      : `Auth setup failed: ${captured.failureReason ?? "unknown"}`,
    { stepId: "qs_auth_setup", agentType: "quickstart" },
  );
  return true;
}

async function runQsScoutAuthed(
  sessionId: string,
  repositoryId: string,
  teamId: string,
): Promise<boolean> {
  await setActive(sessionId, "qs_scout_authed");

  const session = await queries.getAgentSession(sessionId);
  const gate = await isQuickstartEnabled(repositoryId);
  if (!session || !gate.enabled || !gate.baseUrl) {
    await setFailed(sessionId, "qs_scout_authed", "Repo or baseUrl missing.");
    return false;
  }

  const meta = session.metadata;
  const authSetup = meta.authSetup;
  if (!authSetup || !authSetup.captured || !authSetup.testId) {
    await setSkipped(sessionId, "qs_scout_authed", "no captured auth setup");
    return true;
  }

  const authTest = await queries.getTest(authSetup.testId);
  if (!authTest?.code) {
    await setSkipped(
      sessionId,
      "qs_scout_authed",
      "auth setup test missing code",
    );
    return true;
  }

  // Hard-fail when no EB is available — never fall through to a host-process
  // Chromium (see runQsScoutPublic for the rationale).
  const eb = await claimEmbeddedBrowserForAgent(5 * 60 * 1000, () => {
    mergeMetadata(sessionId, { queuedForBrowser: true }).catch(() => {});
  }).catch(() => undefined);
  if (!eb) {
    await mergeMetadata(sessionId, { queuedForBrowser: false }).catch(() => {});
    await setFailed(
      sessionId,
      "qs_scout_authed",
      "All browsers are busy. Please try again later.",
    );
    return false;
  }
  await mergeMetadata(sessionId, {
    streamUrl: proxiedStream(eb?.streamUrl),
    queuedForBrowser: false,
  });
  try {
    const { data, promptLogId } = await runQuickstartScoutAuthed(
      repositoryId,
      gate.baseUrl,
      authTest.code,
      { cdpEndpoint: eb.cdpUrl },
    );
    await mergeMetadata(sessionId, { authedScout: data });
    await setCompleted(sessionId, "qs_scout_authed", {
      navLinkCount: data.inAppNavLinks.length,
      ctaCount: data.safeCtaCandidates.length,
      promptLogId,
      ebClaimed: !!eb,
    });
    emitActivity(
      teamId,
      repositoryId,
      sessionId,
      "step:complete",
      `Authed scout: ${data.inAppNavLinks.length} in-app nav links`,
      { stepId: "qs_scout_authed", agentType: "quickstart" },
    );
    return true;
  } catch (err) {
    // Authed scout failure is not fatal — we still ship a public-only walk.
    const msg = err instanceof Error ? err.message : String(err);
    await setSkipped(
      sessionId,
      "qs_scout_authed",
      `authed scout error: ${msg}`,
    );
    return true;
  } finally {
    if (eb) await releasePoolEB(eb.runnerId).catch(() => {});
    await mergeMetadata(sessionId, { streamUrl: undefined }).catch(() => {});
  }
}

async function runQsGenerate(
  sessionId: string,
  repositoryId: string,
  teamId: string,
): Promise<boolean> {
  await setActive(sessionId, "qs_generate");

  const session = await queries.getAgentSession(sessionId);
  if (!session) {
    await setFailed(sessionId, "qs_generate", "Session missing.");
    return false;
  }

  const meta = session.metadata;
  const publicScout = meta.publicScout;
  if (!publicScout) {
    await setFailed(sessionId, "qs_generate", "Public scout output missing.");
    return false;
  }

  const slug = meta.quickstartSlug!;
  // Authed walkthrough is driven purely by whether the auth-setup actually
  // captured a chainable storage_state — true for BOTH the signup path
  // (classification email_password) and the user-creds login path
  // (login_email_password, where publicScout.authAutomatable is false). No
  // fallback to inline-login (we don't guess login URLs).
  const authAutomatable =
    (meta.authSetup?.captured ?? false) && !!meta.authSetup?.storageStateId;

  const biz = publicScout.businessInteraction;
  const code = renderWalkthroughCode({
    authAutomatable,
    chainedAuth: authAutomatable,
    primaryInputLabel: biz?.primaryInputLabel,
    primaryCtaLabel: biz?.primaryCtaLabel,
    demoInputValue: biz?.demoInputValue,
  });

  const setupOverrides: TestSetupOverrides | undefined =
    authAutomatable && meta.authSetup?.storageStateId
      ? {
          skippedDefaultStepIds: [],
          extraSteps: [
            {
              stepType: "storage_state",
              storageStateId: meta.authSetup.storageStateId,
            },
          ],
        }
      : undefined;

  const created = await queries.createTest({
    repositoryId,
    name: `${slug} — app walkthrough`,
    code,
    setupOverrides,
  });

  await mergeMetadata(sessionId, { walkthroughTestId: created.id });
  await setCompleted(sessionId, "qs_generate", {
    walkthroughTestId: created.id,
    authAutomatable,
    mode: authAutomatable ? "chained" : "public_only",
    businessInteractionBaked: !!(biz?.primaryInputLabel && biz?.demoInputValue),
    businessInteractionInput: biz?.primaryInputLabel,
    businessInteractionCta: biz?.primaryCtaLabel,
  });
  emitActivity(
    teamId,
    repositoryId,
    sessionId,
    "artifact:created",
    `Walkthrough test generated (${authAutomatable ? "authed" : "public-only"})`,
    { stepId: "qs_generate", artifactType: "test", artifactId: created.id },
  );
  return true;
}

async function runQsRunAndNotes(
  sessionId: string,
  repositoryId: string,
  teamId: string,
  signal: AbortSignal,
): Promise<boolean> {
  await setActive(sessionId, "qs_run_and_notes");

  const session = await queries.getAgentSession(sessionId);
  if (!session) {
    await setFailed(sessionId, "qs_run_and_notes", "Session missing.");
    return false;
  }

  const meta = session.metadata;
  const walkthroughTestId = meta.walkthroughTestId;
  if (!walkthroughTestId) {
    await setFailed(sessionId, "qs_run_and_notes", "No walkthrough test id.");
    return false;
  }

  const repo = await queries.getRepository(repositoryId);
  const productName = repo?.name ?? meta.quickstartSlug ?? "Quickstart target";

  // Include the auth setup test (if any) only when we are NOT chaining via
  // setupOverrides — chained mode replays it as part of the walkthrough run.
  const authTestId = meta.authSetup?.testId;
  const chainedAuth = !!meta.authSetup?.storageStateId;
  const testIds =
    chainedAuth || !authTestId
      ? [walkthroughTestId]
      : [authTestId, walkthroughTestId];

  let buildId: string;
  try {
    const result = await createAndRunBuildCore(
      "manual",
      testIds,
      repositoryId,
      undefined,
      undefined,
      undefined,
      true,
    );
    if (!result.buildId) {
      // EB pool was busy — the build got queued instead of running synchronously.
      await setFailed(
        sessionId,
        "qs_run_and_notes",
        `Build was queued (EB pool busy). Job ID: ${(result as { jobId?: string }).jobId ?? "unknown"}.`,
      );
      return false;
    }
    buildId = result.buildId;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await setFailed(
      sessionId,
      "qs_run_and_notes",
      `Build failed to start: ${msg}`,
    );
    return false;
  }

  await mergeMetadata(sessionId, { buildId });
  emitActivity(
    teamId,
    repositoryId,
    sessionId,
    "artifact:created",
    `Build queued: ${buildId.slice(0, 8)}`,
    { stepId: "qs_run_and_notes", artifactType: "build", artifactId: buildId },
  );

  // Poll for completion. Surface the run's live EB stream into the panel as soon
  // as the EB picks up the test (set once), so the two-column view shows the
  // walkthrough run — including the canvas-draw step — not just the scout phases.
  const started = Date.now();
  let streamSurfaced = false;
  let summary = await getBuildSummary(buildId);
  while (!summary || !summary.completedAt) {
    if (Date.now() - started > BUILD_POLL_TIMEOUT_MS) {
      await setFailed(
        sessionId,
        "qs_run_and_notes",
        "Build timed out (>8 min).",
      );
      return false;
    }
    if (await isCancelled(sessionId, signal)) return false;
    if (!streamSurfaced) {
      const live = await resolveBuildStreamUrl(buildId).catch(() => undefined);
      if (live) {
        await mergeMetadata(sessionId, { streamUrl: live });
        streamSurfaced = true;
      }
    }
    await new Promise((r) => setTimeout(r, BUILD_POLL_INTERVAL_MS));
    summary = await getBuildSummary(buildId);
  }
  // Build done — stop the panel pointing at the (about-to-be-released) build EB.
  await mergeMetadata(sessionId, { streamUrl: undefined });
  // After the loop, summary is non-null and has a completedAt; help TS narrow.
  if (!summary) {
    await setFailed(
      sessionId,
      "qs_run_and_notes",
      "Build summary unavailable after completion.",
    );
    return false;
  }

  // Build run facts from the summary + test results
  let build = await queries.getBuild(buildId);
  let testResults = build?.testRunId
    ? await queries.getTestResultsWithTestInfo(build.testRunId).catch(() => [])
    : [];

  // ── Post-run auth verification (the skill's "is the authed frame real?" gate) ──
  // The walkthrough throws AUTH_CHAIN_FAILED_MARKER when the chained storage_state
  // didn't replay an authenticated session. Rather than publish a red build (or
  // login-page screenshots dressed up as authed), downgrade the walkthrough to
  // public-only and rerun ONCE so the user still gets a clean public share, with
  // the reason recorded in the demo notes.
  const chainedAuth0 = !!meta.authSetup?.storageStateId;
  let authDowngraded = false;
  if (chainedAuth0) {
    const wt = testResults.find((r) => r.testId === walkthroughTestId);
    const wtFailed =
      !!wt && (wt.status === "failed" || wt.status === "setup_failed");
    const authChainFailed =
      wtFailed && (wt?.errorMessage ?? "").includes(AUTH_CHAIN_FAILED_MARKER);
    if (authChainFailed) {
      emitActivity(
        teamId,
        repositoryId,
        sessionId,
        "step:start",
        "Login session did not verify — downgrading walkthrough to public-only and re-running",
        { stepId: "qs_run_and_notes" },
      );
      const biz = meta.publicScout?.businessInteraction;
      const publicOnlyCode = renderWalkthroughCode({
        authAutomatable: false,
        chainedAuth: false,
        primaryInputLabel: biz?.primaryInputLabel,
        primaryCtaLabel: biz?.primaryCtaLabel,
        demoInputValue: biz?.demoInputValue,
      });
      await queries.updateTest(walkthroughTestId, {
        code: publicOnlyCode,
        setupOverrides: null,
      });
      const rerun = await runBuildAndWait(
        repositoryId,
        [walkthroughTestId],
        sessionId,
        signal,
      );
      if (rerun.ok) {
        buildId = rerun.buildId;
        summary = rerun.summary;
        build = await queries.getBuild(buildId);
        testResults = build?.testRunId
          ? await queries
              .getTestResultsWithTestInfo(build.testRunId)
              .catch(() => [])
          : [];
        authDowngraded = true;
        await mergeMetadata(sessionId, { buildId });
      } else {
        // Downgrade rerun failed to start/complete; keep the original (red)
        // build so the failure stays visible rather than vanishing.
        console.warn(
          "[QuickStart] public-only downgrade rerun failed:",
          rerun.error,
        );
      }
    }
  }

  const runFacts: QuickstartRunFacts = {
    passedCount: summary.passedCount,
    failedCount: summary.failedCount,
    changesDetected: summary.changesDetected,
    testNames: testResults.map((r) => r.testName ?? "test"),
    consoleErrors: [],
    failedSteps: testResults
      .filter((r) => r.status === "failed" || r.status === "setup_failed")
      .slice(0, 5)
      .map((r) => ({
        test: r.testName ?? "test",
        step: "unknown",
        error: r.errorMessage ?? "unknown",
      })),
  };

  // Generate demo notes
  const publicScout = meta.publicScout!;
  let demoNotesPersisted = false;
  try {
    const notes = await generateDemoNotes({
      repositoryId,
      productName,
      publicScout,
      authedScout: meta.authedScout,
      authSetup: meta.authSetup,
      runFacts,
      authVerificationFailed: authDowngraded,
    });
    await queries.upsertBuildDemoNotes(buildId, notes);
    demoNotesPersisted = true;
  } catch (err) {
    console.error("[QuickStart] demo notes generation failed:", err);
  }

  await mergeMetadata(sessionId, {
    demoNotesId: demoNotesPersisted ? buildId : undefined,
  });
  await setCompleted(sessionId, "qs_run_and_notes", {
    buildId,
    passed: summary.passedCount,
    failed: summary.failedCount,
    changes: summary.changesDetected,
    demoNotesPersisted,
    authDowngraded,
  });

  emitActivity(
    teamId,
    repositoryId,
    sessionId,
    "step:complete",
    `Run + notes complete: ${summary.passedCount} passed, ${summary.failedCount} failed, ${summary.changesDetected} screenshots`,
    {
      stepId: "qs_run_and_notes",
      detail: { buildId, demoNotesPersisted } as Record<string, unknown>,
    },
  );
  return true;
}

async function runQsApproveBaselines(
  sessionId: string,
  repositoryId: string,
  teamId: string,
): Promise<boolean> {
  await setActive(sessionId, "qs_approve_baselines");

  const session = await queries.getAgentSession(sessionId);
  const buildId = session?.metadata.buildId;
  if (!buildId) {
    await setFailed(
      sessionId,
      "qs_approve_baselines",
      "No build id on session.",
    );
    return false;
  }

  try {
    const { approvedCount } = await approveAllDiffs(
      buildId,
      "quickstart-agent",
    );
    await setCompleted(sessionId, "qs_approve_baselines", {
      buildId,
      approvedCount,
    });
    emitActivity(
      teamId,
      repositoryId,
      sessionId,
      "step:complete",
      `Approved ${approvedCount} baselines`,
      { stepId: "qs_approve_baselines", agentType: "quickstart" },
    );
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await setFailed(
      sessionId,
      "qs_approve_baselines",
      `Approve all failed: ${msg}`,
    );
    return false;
  }
}

async function runQsRerunAfterApproval(
  sessionId: string,
  repositoryId: string,
  teamId: string,
  signal: AbortSignal,
): Promise<boolean> {
  await setActive(sessionId, "qs_rerun_after_approval");

  const session = await queries.getAgentSession(sessionId);
  if (!session) {
    await setFailed(sessionId, "qs_rerun_after_approval", "Session missing.");
    return false;
  }

  const meta = session.metadata;
  const walkthroughTestId = meta.walkthroughTestId;
  if (!walkthroughTestId) {
    await setFailed(
      sessionId,
      "qs_rerun_after_approval",
      "No walkthrough test id.",
    );
    return false;
  }

  // The rerun is walkthrough-only — auth setup ran in the first build and is
  // either replayed via storageState (chained) or already captured. Running it
  // twice in a row trips Firebase per-IP rate limits + risks the "email already
  // exists" path when the stamp doesn't rotate. Always rerun just the walkthrough.
  let rerunBuildId: string;
  try {
    const result = await createAndRunBuildCore(
      "manual",
      [walkthroughTestId],
      repositoryId,
      undefined,
      undefined,
      undefined,
      true,
    );
    if (!result.buildId) {
      await setFailed(
        sessionId,
        "qs_rerun_after_approval",
        `Rerun queued (EB pool busy). Job ID: ${(result as { jobId?: string }).jobId ?? "unknown"}.`,
      );
      return false;
    }
    rerunBuildId = result.buildId;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await setFailed(
      sessionId,
      "qs_rerun_after_approval",
      `Rerun failed to start: ${msg}`,
    );
    return false;
  }

  await mergeMetadata(sessionId, { rerunBuildId });
  emitActivity(
    teamId,
    repositoryId,
    sessionId,
    "artifact:created",
    `Rerun queued: ${rerunBuildId.slice(0, 8)}`,
    {
      stepId: "qs_rerun_after_approval",
      artifactType: "build",
      artifactId: rerunBuildId,
    },
  );

  const started = Date.now();
  let rerunStreamSurfaced = false;
  let summary = await getBuildSummary(rerunBuildId);
  while (!summary || !summary.completedAt) {
    if (Date.now() - started > BUILD_POLL_TIMEOUT_MS) {
      await setFailed(
        sessionId,
        "qs_rerun_after_approval",
        "Rerun timed out (>8 min).",
      );
      return false;
    }
    if (await isCancelled(sessionId, signal)) return false;
    if (!rerunStreamSurfaced) {
      const live = await resolveBuildStreamUrl(rerunBuildId).catch(
        () => undefined,
      );
      if (live) {
        await mergeMetadata(sessionId, { streamUrl: live });
        rerunStreamSurfaced = true;
      }
    }
    await new Promise((r) => setTimeout(r, BUILD_POLL_INTERVAL_MS));
    summary = await getBuildSummary(rerunBuildId);
  }
  await mergeMetadata(sessionId, { streamUrl: undefined });

  await setCompleted(sessionId, "qs_rerun_after_approval", {
    rerunBuildId,
    passed: summary.passedCount,
    failed: summary.failedCount,
    changes: summary.changesDetected,
  });
  return true;
}

async function runQsPublishShare(
  sessionId: string,
  repositoryId: string,
  teamId: string,
): Promise<boolean> {
  await setActive(sessionId, "qs_publish_share");

  const session = await queries.getAgentSession(sessionId);
  if (!session) {
    await setFailed(sessionId, "qs_publish_share", "Session missing.");
    return false;
  }

  const meta = session.metadata;
  const walkthroughTestId = meta.walkthroughTestId;
  if (!walkthroughTestId) {
    await setFailed(sessionId, "qs_publish_share", "No walkthrough test id.");
    return false;
  }

  // Prefer the rerun build so newly-created baselines pair with the rerun's
  // current images on the share renderer. Falls back to the first build if
  // the rerun step was skipped or failed.
  const buildToShare = meta.rerunBuildId ?? meta.buildId;
  if (!buildToShare) {
    await setFailed(
      sessionId,
      "qs_publish_share",
      "No build id available to publish.",
    );
    return false;
  }

  try {
    const result = await publishBuildShare(buildToShare, {
      scopedTestId: walkthroughTestId,
    });
    await mergeMetadata(sessionId, {
      shareId: result.shareId,
      shareSlug: result.slug,
      shareUrl: result.url,
    });
    await setCompleted(sessionId, "qs_publish_share", {
      shareId: result.shareId,
      slug: result.slug,
      url: result.url,
      buildId: buildToShare,
    });
    emitActivity(
      teamId,
      repositoryId,
      sessionId,
      "session:complete",
      `Share published: ${result.url}`,
      {
        stepId: "qs_publish_share",
        detail: { shareId: result.shareId, url: result.url } as Record<
          string,
          unknown
        >,
      },
    );
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await setFailed(
      sessionId,
      "qs_publish_share",
      `Publish share failed: ${msg}`,
    );
    return false;
  }
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

type QsStepRunner = (
  sessionId: string,
  repositoryId: string,
  teamId: string,
  signal: AbortSignal,
) => Promise<boolean>;

const QS_RUNNERS: Record<AgentStepId, QsStepRunner | undefined> = {
  qs_preflight: runQsPreflight,
  qs_scout_public: runQsScoutPublic,
  qs_auth_setup: runQsAuthSetup,
  qs_scout_authed: runQsScoutAuthed,
  qs_generate: runQsGenerate,
  qs_run_and_notes: runQsRunAndNotes,
  qs_approve_baselines: runQsApproveBaselines,
  qs_rerun_after_approval: runQsRerunAfterApproval,
  qs_publish_share: runQsPublishShare,
} as Partial<Record<AgentStepId, QsStepRunner>> as Record<
  AgentStepId,
  QsStepRunner | undefined
>;

async function executeQuickstart(
  sessionId: string,
  repositoryId: string,
  teamId: string,
) {
  const ctrl = getOrCreateQsController(sessionId);
  const { signal } = ctrl;

  try {
    for (const stepId of QS_STEP_ORDER) {
      if (await isCancelled(sessionId, signal)) return;
      const runner = QS_RUNNERS[stepId];
      if (!runner) continue;

      const stepStart = Date.now();
      emitActivity(
        teamId,
        repositoryId,
        sessionId,
        "step:start",
        `${stepId} started`,
        { stepId },
      );
      const ok = await runner(sessionId, repositoryId, teamId, signal);
      if (!ok) {
        emitActivity(
          teamId,
          repositoryId,
          sessionId,
          "step:error",
          `${stepId} failed`,
          {
            stepId,
            durationMs: Date.now() - stepStart,
          },
        );
        return;
      }
      emitActivity(
        teamId,
        repositoryId,
        sessionId,
        "step:complete",
        `${stepId} done`,
        {
          stepId,
          durationMs: Date.now() - stepStart,
        },
      );
    }
    // All steps completed without bailing — mark the session done. Individual
    // step runners no longer set session.status; the orchestrator owns that
    // transition once the full pipeline (including publish_share) succeeds.
    const finalSession = await queries
      .getAgentSession(sessionId)
      .catch(() => null);
    if (finalSession && finalSession.status === "active") {
      await queries.updateAgentSession(sessionId, {
        status: "completed",
        completedAt: new Date(),
      });
      emitActivity(
        teamId,
        repositoryId,
        sessionId,
        "session:complete",
        finalSession.metadata.shareUrl
          ? `QuickStart complete: ${finalSession.metadata.shareUrl}`
          : "QuickStart complete",
        {
          detail: { shareUrl: finalSession.metadata.shareUrl } as Record<
            string,
            unknown
          >,
        },
      );
    }
    revalidatePath("/run");
  } finally {
    cleanupQsController(sessionId);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function startQuickstart(
  repositoryId: string,
  opts?: { emailTemplate?: string; appEmail?: string; appPassword?: string },
): Promise<{ sessionId: string }> {
  const { team } = await requireRepoAccess(repositoryId);

  const gate = await isQuickstartEnabled(repositoryId);
  if (!gate.enabled) {
    const reason = gate.reason ?? "no_repo";
    const err = new Error(`quickstart_disabled: ${reason}`);
    (err as Error & { code?: string; reason?: string }).code =
      "quickstart_disabled";
    (err as Error & { code?: string; reason?: string }).reason = reason;
    throw err;
  }

  // Optional user-supplied login credentials for their own app. Both or neither.
  const appEmail = opts?.appEmail?.trim();
  const appPassword = opts?.appPassword;
  const credsProvided = !!appEmail && !!appPassword;
  if ((appEmail && !appPassword) || (!appEmail && appPassword)) {
    throw new Error(
      "Provide both an email and a password to use your app login, or neither.",
    );
  }

  if (opts?.emailTemplate) {
    if (
      !opts.emailTemplate.includes("{slug}") ||
      !opts.emailTemplate.includes("{stamp}")
    ) {
      throw new Error(
        "emailTemplate must contain both {slug} and {stamp} tokens",
      );
    }
    // Persist on team for next time so the override is sticky.
    await queries.updateTeam(team.id, {
      quickstartEmailTemplate: opts.emailTemplate,
    });
  }

  const existing = await queries.getActiveAgentSession(
    repositoryId,
    "quickstart",
  );
  if (existing) {
    activeQuickstartControllers.get(existing.id)?.abort();
    cleanupQsController(existing.id);
    await queries.updateAgentSession(existing.id, {
      status: "cancelled",
      completedAt: new Date(),
    });
  }

  const session = await queries.createAgentSession({
    repositoryId,
    teamId: team.id,
    kind: "quickstart",
    status: "active",
    currentStepId: "qs_preflight",
    steps: buildInitialQsSteps(),
    // Seed user creds into metadata so preflight uses them for a LOGIN handshake.
    // quickstartPassword is never returned by the GET /quickstart API (curated).
    metadata: credsProvided
      ? {
          credsProvided: true,
          quickstartEmail: appEmail,
          quickstartPassword: appPassword,
        }
      : {},
  });

  emitActivity(
    team.id,
    repositoryId,
    session.id,
    "session:start",
    "QuickStart session started",
  );

  executeQuickstart(session.id, repositoryId, team.id).catch((err) => {
    console.error("[QuickStart] unhandled:", err);
    queries
      .updateAgentSession(session.id, {
        status: "failed",
        completedAt: new Date(),
      })
      .catch(() => {});
    emitActivity(
      team.id,
      repositoryId,
      session.id,
      "session:error",
      `Failed: ${String(err)}`,
    );
  });

  return { sessionId: session.id };
}

export async function cancelQuickstart(
  sessionId: string,
): Promise<{ success: boolean }> {
  const { team } = await requireTeamAccess();
  const session = await queries.getAgentSession(sessionId);
  if (!session) return { success: false };
  if (session.teamId && session.teamId !== team.id) return { success: false };

  activeQuickstartControllers.get(sessionId)?.abort();
  cleanupQsController(sessionId);
  await queries.updateAgentSession(sessionId, {
    status: "cancelled",
    completedAt: new Date(),
  });
  return { success: true };
}

export async function getQuickstartSession(
  sessionId: string,
): Promise<AgentSession | null> {
  const { team } = await requireTeamAccess();
  const session = await queries.getAgentSession(sessionId);
  if (!session) return null;
  if (session.teamId && session.teamId !== team.id) return null;
  return session;
}
