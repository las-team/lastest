"use server";

import { revalidatePath } from "next/cache";

import type { PluginContext } from "@lastest/contracts";
import { resolveTestVideoUrl } from "@lastest/video-fallback";
import {
  renderAuthSetupCode,
  renderAuthLoginCode,
  renderWalkthroughCode,
  renderQuickstartEmail,
  renderQuickstartPassword,
  utcStamp,
  slugify,
  AUTH_CHAIN_FAILED_MARKER,
} from "@lastest/test-templates";

import { gateReasonHint, isQuickstartEnabled } from "./gating";
import type {
  QuickstartActivityEvent,
  QuickstartHost,
  QuickstartRunFacts as HostRunFacts,
} from "./host";
import { quickstartPlugin } from "./index";
import { runQuickstartScoutAuthed, runQuickstartScoutPublic } from "./scout";
import { describeScoutError } from "./scout-error";
import { buildInitialQsSteps, QS_STEP_ORDER } from "./step-definitions";
import type {
  QuickstartDemoNotes,
  QuickstartSessionMetadata,
  QuickstartSessionRow,
  QuickstartStepId,
  QuickstartStepState,
} from "./types";
import { quickstartWiring, type QuickstartRuntime } from "./wiring";

/**
 * The nine-step orchestrator. See `host.ts`'s header before reading this file
 * — most of what used to be inline here (raw EB claims, storage-state capture,
 * build execution, notes generation, sharing) now lives behind
 * `QuickstartHost`, and what is left is exactly the feature's own control
 * flow: the auth-mode decision tree, the credential-vs-throwaway branch, the
 * storage-state reuse window, the auth-chain-failure downgrade, and the
 * share-readiness quality gate.
 *
 * The two scout steps are the exception, and the only place `ctx` is read:
 * they claim through `ctx.browser.withBrowser(...)` and hand the resulting
 * session to `./scout.ts`, which drives the browser through
 * `ctx.ai.generate({ browserTools: session })`. That used to be five host
 * methods standing in for an unmigrated module — see `host.ts`'s header.
 */

/**
 * Wall-clock budget for one scout step, and how long to wait for a browser.
 *
 * Both are passed explicitly because the defaults are wrong here in opposite
 * directions. `DEFAULT_DEADLINE_MS` is 5 minutes for the whole `withBrowser`
 * callback, but a scout step is an agentic browsing loop that may make two
 * full AI calls (the initial one plus the JSON-parse retry), and the authed
 * walk replays a login through the model before it starts — the step this
 * migration replaced had no wall-clock bound on that work at all, only on the
 * claim. Taking the default would have converted a slow scout into a torn-down
 * session. `claimTimeoutMs` is passed at the same value the pre-migration
 * `claimEmbeddedBrowserForAgent(5 * 60 * 1000)` used, so the *waiting* half of
 * the old behaviour is preserved exactly rather than by coincidence.
 *
 * Core clamps the deadline to `maxHoldFor(plan)` regardless (holding shared
 * capacity is a money decision, not the plugin's), so on `free`/`demo` this
 * still resolves to 5 minutes. Asking for more is not an attempt to escape
 * that — it is what lets the larger plans, where the clamp is 15-60 minutes,
 * actually finish the step.
 */
const SCOUT_DEADLINE_MS = 12 * 60_000;
const SCOUT_CLAIM_TIMEOUT_MS = 5 * 60_000;

const BUILD_POLL_INTERVAL_MS = 4000;
const BUILD_POLL_TIMEOUT_MS = 8 * 60 * 1000;

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

type QuickstartCtx = PluginContext<"ai" | "browser">;

async function context(scope?: {
  repositoryId?: string;
  teamId?: string;
}): Promise<{
  runtime: QuickstartRuntime;
  host: QuickstartHost;
  ctx: QuickstartCtx;
}> {
  const { runtime, host } = quickstartWiring();
  // `contextFor` does the authorization work `requireRepoAccess`/
  // `requireTeamAccess` used to do inline. The returned `ctx` carries the two
  // declared capabilities (see index.ts) — only `./scout.ts` reads them.
  const ctx = await runtime.contextFor(quickstartPlugin, scope);
  return { runtime, host, ctx };
}

function emitActivity(
  host: QuickstartHost,
  teamId: string,
  repositoryId: string,
  sessionId: string,
  eventType: QuickstartActivityEvent["eventType"],
  summary: string,
  opts?: {
    stepId?: string;
    detail?: Record<string, unknown>;
    artifactType?: "test" | "build" | "area" | "baseline" | "score";
    artifactId?: string;
    artifactLabel?: string;
    durationMs?: number;
  },
) {
  host.emitActivity({
    teamId,
    repositoryId,
    sessionId,
    eventType,
    summary,
    ...opts,
  });
}

async function patchStep(
  host: QuickstartHost,
  sessionId: string,
  stepId: QuickstartStepId,
  patch: Partial<QuickstartStepState>,
) {
  const session = await host.getSession(sessionId);
  if (!session) return;
  const steps = [...session.steps];
  const idx = steps.findIndex((s) => s.id === stepId);
  if (idx === -1) return;
  steps[idx] = { ...steps[idx], ...patch };
  await host.updateSession(sessionId, {
    steps,
    currentStepId:
      patch.status === "active" ? stepId : (session.currentStepId ?? undefined),
  });
}

async function setActive(
  host: QuickstartHost,
  sessionId: string,
  stepId: QuickstartStepId,
) {
  await patchStep(host, sessionId, stepId, {
    status: "active",
    startedAt: new Date().toISOString(),
  });
  await host.updateSession(sessionId, { currentStepId: stepId });
}

async function setCompleted(
  host: QuickstartHost,
  sessionId: string,
  stepId: QuickstartStepId,
  result?: Record<string, unknown>,
) {
  await patchStep(host, sessionId, stepId, {
    status: "completed",
    completedAt: new Date().toISOString(),
    result,
  });
}

async function setFailed(
  host: QuickstartHost,
  sessionId: string,
  stepId: QuickstartStepId,
  error: string,
) {
  await patchStep(host, sessionId, stepId, {
    status: "failed",
    completedAt: new Date().toISOString(),
    error,
  });
  await host.updateSession(sessionId, {
    status: "failed",
    completedAt: new Date(),
  });
}

async function setSkipped(
  host: QuickstartHost,
  sessionId: string,
  stepId: QuickstartStepId,
  reason: string,
) {
  await patchStep(host, sessionId, stepId, {
    status: "skipped",
    completedAt: new Date().toISOString(),
    result: { skipped: true, reason },
  });
}

async function mergeMetadata(
  host: QuickstartHost,
  sessionId: string,
  patch: Partial<QuickstartSessionMetadata>,
) {
  const session = await host.getSession(sessionId);
  if (!session) return;
  await host.updateSession(sessionId, {
    metadata: { ...session.metadata, ...patch },
  });
}

async function isCancelled(
  host: QuickstartHost,
  sessionId: string,
  signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted) return true;
  const session = await host.getSession(sessionId);
  if (session?.status === "cancelled") {
    activeQuickstartControllers.get(sessionId)?.abort();
    return true;
  }
  return false;
}

async function runBuildAndWait(
  host: QuickstartHost,
  repositoryId: string,
  testIds: string[],
  sessionId: string,
  signal: AbortSignal,
): Promise<
  | {
      ok: true;
      buildId: string;
      summary: NonNullable<
        Awaited<ReturnType<QuickstartHost["getBuildSummary"]>>
      >;
    }
  | { ok: false; error: string }
> {
  const started_ = await host.startBuild(repositoryId, testIds);
  if (!started_.started) return { ok: false, error: started_.error };
  const buildId = started_.buildId;

  const started = Date.now();
  let summary = await host.getBuildSummary(buildId);
  while (!summary || !summary.completedAt) {
    if (Date.now() - started > BUILD_POLL_TIMEOUT_MS) {
      return { ok: false, error: "Build timed out (>8 min)." };
    }
    if (await isCancelled(host, sessionId, signal)) {
      return { ok: false, error: "cancelled" };
    }
    await new Promise((r) => setTimeout(r, BUILD_POLL_INTERVAL_MS));
    summary = await host.getBuildSummary(buildId);
  }
  return { ok: true, buildId, summary };
}

// ---------------------------------------------------------------------------
// Step runners
// ---------------------------------------------------------------------------

async function runQsPreflight(
  host: QuickstartHost,
  sessionId: string,
  repositoryId: string,
  teamId: string,
): Promise<boolean> {
  await setActive(host, sessionId, "qs_preflight");

  const gate = await isQuickstartEnabled(host, repositoryId);
  if (!gate.enabled || !gate.repo || !gate.teamId || !gate.baseUrl) {
    const reason = gate.reason ?? "no_repo";
    await mergeMetadata(host, sessionId, { disabledReason: reason });
    await setFailed(
      host,
      sessionId,
      "qs_preflight",
      `QuickStart disabled: ${gateReasonHint(reason)}`,
    );
    return false;
  }

  if (!(await host.hasAiProvider(repositoryId))) {
    await setFailed(
      host,
      sessionId,
      "qs_preflight",
      "No AI provider configured for this repo.",
    );
    return false;
  }

  const stamp = utcStamp();
  const slug = slugify(gate.repo.name);

  const preMeta = (await host.getSession(sessionId))?.metadata;
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
    const template = await host.getTeamEmailTemplate(gate.teamId);
    email = renderQuickstartEmail(template, slug, stamp);
    password = renderQuickstartPassword(stamp);
  }

  await mergeMetadata(host, sessionId, {
    quickstartEmail: email,
    quickstartPassword: password,
    quickstartSlug: slug,
    quickstartStamp: stamp,
    credsProvided,
  });

  // Force the repo's EB error gates to "warn" before the first run — see the
  // pre-migration comment in the result doc for why. Best-effort.
  const errorModesSet = await host
    .relaxErrorModesForDemo(repositoryId)
    .catch(() => false);

  await setCompleted(host, sessionId, "qs_preflight", {
    baseUrl: gate.baseUrl,
    slug,
    stamp,
    errorModesSet,
  });
  emitActivity(
    host,
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
  host: QuickstartHost,
  ctx: QuickstartCtx,
  sessionId: string,
  repositoryId: string,
  teamId: string,
): Promise<boolean> {
  await setActive(host, sessionId, "qs_scout_public");

  const session = await host.getSession(sessionId);
  const gate = await isQuickstartEnabled(host, repositoryId);
  if (!session || !gate.enabled || !gate.baseUrl) {
    await setFailed(
      host,
      sessionId,
      "qs_scout_public",
      "Repo or baseUrl missing.",
    );
    return false;
  }
  const baseUrl = gate.baseUrl;

  try {
    // `withBrowser` owns claim/release/teardown. It throws rather than falling
    // through to a host-process Chromium when no EB is available; while
    // waiting, `onQueued` surfaces back-pressure in the panel.
    const { data, promptLogId, retryCount } = await ctx.browser.withBrowser(
      {
        purpose: "interactive",
        claimTimeoutMs: SCOUT_CLAIM_TIMEOUT_MS,
        deadlineMs: SCOUT_DEADLINE_MS,
        onQueued: () => {
          mergeMetadata(host, sessionId, { queuedForBrowser: true }).catch(
            () => {},
          );
        },
      },
      async (browserSession) => {
        await mergeMetadata(host, sessionId, {
          streamUrl: browserSession.streamUrl ?? undefined,
          queuedForBrowser: false,
        });
        try {
          return await runQuickstartScoutPublic(
            ctx.ai,
            browserSession,
            repositoryId,
            baseUrl,
          );
        } finally {
          await mergeMetadata(host, sessionId, {
            streamUrl: undefined,
          }).catch(() => {});
        }
      },
    );
    await mergeMetadata(host, sessionId, { publicScout: data });

    if (data.classification === "unknown") {
      await setFailed(
        host,
        sessionId,
        "qs_scout_public",
        "Scout could not classify the sign-up flow. The browser may have failed or the landing page returned no actionable content. Retry by starting a new QuickStart session.",
      );
      return false;
    }

    await setCompleted(host, sessionId, "qs_scout_public", {
      classification: data.classification,
      authAutomatable: data.authAutomatable,
      navLinkCount: data.navLinks.length,
      productArchetype: data.productArchetype,
      scoutRetryCount: retryCount,
      promptLogId,
    });
    emitActivity(
      host,
      teamId,
      repositoryId,
      sessionId,
      "step:complete",
      `Public scout: ${data.classification} (${data.authAutomatable ? "automatable" : "manual"})`,
      { stepId: "qs_scout_public" },
    );
    return true;
  } catch (err) {
    await mergeMetadata(host, sessionId, { queuedForBrowser: false }).catch(
      () => {},
    );
    const { message } = await describeScoutError(host, err);
    await setFailed(
      host,
      sessionId,
      "qs_scout_public",
      `Public scout failed: ${message}`,
    );
    return false;
  }
}

/** Reuse window for a prior QuickStart auth capture. */
const QS_STORAGE_REUSE_WINDOW_MS = 24 * 60 * 60 * 1000;

async function findReusableQsStorageState(
  host: QuickstartHost,
  repositoryId: string,
  mode: "login" | "signup",
): Promise<{ id: string } | null> {
  const prefix = `QuickStart ${mode} `;
  const now = Date.now();
  const rows = await host.listStorageStates(repositoryId);
  const candidate = rows
    .filter((r) => r.name.startsWith(prefix))
    .filter((r) => !r.expiresAt || r.expiresAt.getTime() > now)
    .filter(
      (r) =>
        !!r.createdAt &&
        now - r.createdAt.getTime() < QS_STORAGE_REUSE_WINDOW_MS,
    )
    .sort(
      (a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0),
    )[0];
  return candidate ? { id: candidate.id } : null;
}

async function runQsAuthSetup(
  host: QuickstartHost,
  sessionId: string,
  repositoryId: string,
  teamId: string,
): Promise<boolean> {
  await setActive(host, sessionId, "qs_auth_setup");

  const session = await host.getSession(sessionId);
  const gate = await isQuickstartEnabled(host, repositoryId);
  if (!session || !gate.enabled || !gate.baseUrl) {
    await setFailed(
      host,
      sessionId,
      "qs_auth_setup",
      "Repo or baseUrl missing.",
    );
    return false;
  }

  const meta = session.metadata;
  const publicScout = meta.publicScout;
  if (!publicScout) {
    await setSkipped(
      host,
      sessionId,
      "qs_auth_setup",
      "no public scout output",
    );
    return true;
  }

  const email = meta.quickstartEmail!;
  const password = meta.quickstartPassword!;
  const stamp = meta.quickstartStamp!;
  const slug = meta.quickstartSlug!;
  const credsProvided = meta.credsProvided === true;

  let authMode: "login" | "signup";
  let code: string;
  let testName: string;
  if (credsProvided) {
    authMode = "login";
    const loginUrl = publicScout.loginPath || gate.baseUrl;
    code = renderAuthLoginCode({
      email,
      password,
      loginUrl,
      apiLoginEndpoint: publicScout.apiLoginEndpoint ?? undefined,
    });
    testName = `${slug} — auth login`;
  } else if (publicScout.authAutomatable && !!publicScout.registerPath) {
    authMode = "signup";
    code = renderAuthSetupCode({
      email,
      password,
      registerUrl: publicScout.registerPath!,
    });
    testName = `${slug} — auth setup`;
  } else {
    const reason = publicScout.authAutomatable
      ? "Scout did not observe a register URL in the page DOM — running public-only (no path guessing)."
      : "Sign-up is not automatable and no app login was provided — running public-only. Add your app login in QuickStart to capture an authenticated walkthrough.";
    await mergeMetadata(host, sessionId, { authMode: "public_only" });
    await setSkipped(host, sessionId, "qs_auth_setup", reason);
    return true;
  }

  const reusable = await findReusableQsStorageState(
    host,
    repositoryId,
    authMode,
  );
  if (reusable) {
    await mergeMetadata(host, sessionId, {
      authMode,
      authSetup: {
        storageStateId: reusable.id,
        captured: true,
        mode: authMode,
      },
    });
    await setCompleted(host, sessionId, "qs_auth_setup", {
      mode: authMode,
      captured: true,
      storageStateId: reusable.id,
      reused: true,
    });
    emitActivity(
      host,
      teamId,
      repositoryId,
      sessionId,
      "step:complete",
      `Auth setup reused (${authMode}, existing session)`,
      { stepId: "qs_auth_setup" },
    );
    return true;
  }

  const created = await host.createTest({ repositoryId, name: testName, code });
  const testId = created.id;

  const captured = await host.captureStorageState({
    repositoryId,
    baseUrl: gate.baseUrl,
    testCode: code,
    name: `QuickStart ${authMode} ${slug} ${stamp}`,
    tokenLocation: publicScout.tokenLocation,
    authFlavor: publicScout.authLibrary,
  });

  await mergeMetadata(host, sessionId, {
    authMode,
    authSetup: {
      testId,
      storageStateId: captured.storageStateId,
      captured: captured.captured,
      failureReason: captured.failureReason,
      mode: authMode,
    },
  });

  await setCompleted(host, sessionId, "qs_auth_setup", {
    testId,
    mode: authMode,
    captured: captured.captured,
    storageStateId: captured.storageStateId,
    failureReason: captured.failureReason,
    durationMs: captured.durationMs,
  });
  emitActivity(
    host,
    teamId,
    repositoryId,
    sessionId,
    "step:complete",
    captured.captured
      ? `Auth setup captured (${captured.durationMs}ms)`
      : `Auth setup failed: ${captured.failureReason ?? "unknown"}`,
    { stepId: "qs_auth_setup" },
  );
  return true;
}

async function runQsScoutAuthed(
  host: QuickstartHost,
  ctx: QuickstartCtx,
  sessionId: string,
  repositoryId: string,
  teamId: string,
): Promise<boolean> {
  await setActive(host, sessionId, "qs_scout_authed");

  const session = await host.getSession(sessionId);
  const gate = await isQuickstartEnabled(host, repositoryId);
  if (!session || !gate.enabled || !gate.baseUrl) {
    await setFailed(
      host,
      sessionId,
      "qs_scout_authed",
      "Repo or baseUrl missing.",
    );
    return false;
  }

  const meta = session.metadata;
  const authSetup = meta.authSetup;
  if (!authSetup || !authSetup.captured || !authSetup.testId) {
    await setSkipped(
      host,
      sessionId,
      "qs_scout_authed",
      "no captured auth setup",
    );
    return true;
  }

  const authTest = await host.getTest(authSetup.testId);
  if (!authTest?.code) {
    await setSkipped(
      host,
      sessionId,
      "qs_scout_authed",
      "auth setup test missing code",
    );
    return true;
  }

  const baseUrl = gate.baseUrl;
  const authTestCode = authTest.code;

  try {
    // Core resolves and injects the stored credential material from the id —
    // the plugin never reads the storage-state JSON. `authApplied` reports
    // back whether it actually landed, which is what decides between "you are
    // already signed in" and "replay the seed" in the scout prompt.
    const { data, promptLogId, retryCount } = await ctx.browser.withBrowser(
      {
        purpose: "interactive",
        claimTimeoutMs: SCOUT_CLAIM_TIMEOUT_MS,
        deadlineMs: SCOUT_DEADLINE_MS,
        storageStateId: authSetup.storageStateId,
        onQueued: () => {
          mergeMetadata(host, sessionId, { queuedForBrowser: true }).catch(
            () => {},
          );
        },
      },
      async (browserSession) => {
        await mergeMetadata(host, sessionId, {
          streamUrl: browserSession.streamUrl ?? undefined,
          queuedForBrowser: false,
        });
        try {
          return await runQuickstartScoutAuthed(
            ctx.ai,
            browserSession,
            repositoryId,
            baseUrl,
            authTestCode,
            { preAuthenticated: browserSession.authApplied },
          );
        } finally {
          await mergeMetadata(host, sessionId, {
            streamUrl: undefined,
          }).catch(() => {});
        }
      },
    );
    await mergeMetadata(host, sessionId, { authedScout: data });
    await setCompleted(host, sessionId, "qs_scout_authed", {
      navLinkCount: data.inAppNavLinks.length,
      ctaCount: data.safeCtaCandidates.length,
      scoutRetryCount: retryCount,
      promptLogId,
    });
    emitActivity(
      host,
      teamId,
      repositoryId,
      sessionId,
      "step:complete",
      `Authed scout: ${data.inAppNavLinks.length} in-app nav links`,
      { stepId: "qs_scout_authed" },
    );
    return true;
  } catch (err) {
    await mergeMetadata(host, sessionId, { queuedForBrowser: false }).catch(
      () => {},
    );
    const { kind, message } = await describeScoutError(host, err);
    // A scout that ran and failed is not fatal — we still ship a public-only
    // walk, which is the established behaviour. Never getting a browser is a
    // different thing and stays fatal, as it was before `withBrowser` folded
    // the claim into the same throw: it is an infrastructure fault with an
    // operator remediation, and swallowing it as a skip would silently degrade
    // every QuickStart run to public-only for as long as the pool is broken,
    // with the actionable message buried in a step detail nobody re-reads.
    if (kind === "no_browser") {
      await setFailed(host, sessionId, "qs_scout_authed", message);
      return false;
    }
    await setSkipped(
      host,
      sessionId,
      "qs_scout_authed",
      `authed scout error: ${message}`,
    );
    return true;
  }
}

async function runQsGenerate(
  host: QuickstartHost,
  sessionId: string,
  repositoryId: string,
  teamId: string,
): Promise<boolean> {
  await setActive(host, sessionId, "qs_generate");

  const session = await host.getSession(sessionId);
  if (!session) {
    await setFailed(host, sessionId, "qs_generate", "Session missing.");
    return false;
  }

  const meta = session.metadata;
  const publicScout = meta.publicScout;
  if (!publicScout) {
    await setFailed(
      host,
      sessionId,
      "qs_generate",
      "Public scout output missing.",
    );
    return false;
  }

  const slug = meta.quickstartSlug!;
  const authAutomatable =
    (meta.authSetup?.captured ?? false) && !!meta.authSetup?.storageStateId;

  const biz = publicScout.businessInteraction;
  const code = renderWalkthroughCode({
    authAutomatable,
    chainedAuth: authAutomatable,
    primaryInputLabel: biz?.primaryInputLabel,
    primaryCtaLabel: biz?.primaryCtaLabel,
    demoInputValue: biz?.demoInputValue,
    productArchetype: publicScout.productArchetype,
  });

  const setupOverrides =
    authAutomatable && meta.authSetup?.storageStateId
      ? {
          skippedDefaultStepIds: [],
          extraSteps: [
            {
              stepType: "storage_state" as const,
              storageStateId: meta.authSetup.storageStateId,
            },
          ],
        }
      : undefined;

  const created = await host.createTest({
    repositoryId,
    name: `${slug} — app walkthrough`,
    code,
    setupOverrides,
  });

  await mergeMetadata(host, sessionId, { walkthroughTestId: created.id });
  await setCompleted(host, sessionId, "qs_generate", {
    walkthroughTestId: created.id,
    authAutomatable,
    mode: authAutomatable ? "chained" : "public_only",
    businessInteractionBaked: !!(biz?.primaryInputLabel && biz?.demoInputValue),
    businessInteractionInput: biz?.primaryInputLabel,
    businessInteractionCta: biz?.primaryCtaLabel,
  });
  emitActivity(
    host,
    teamId,
    repositoryId,
    sessionId,
    "artifact:created",
    `Walkthrough test generated (${authAutomatable ? "authed" : "public-only"})`,
    { stepId: "qs_generate", artifactType: "test", artifactId: created.id },
  );
  return true;
}

function buildRunFactsInput(
  hostFacts: HostRunFacts,
  summary: NonNullable<Awaited<ReturnType<QuickstartHost["getBuildSummary"]>>>,
) {
  const runConsoleErrors = Array.from(
    new Set(hostFacts.testResults.flatMap((r) => r.consoleErrors ?? [])),
  ).slice(0, 10);
  return {
    passedCount: summary.passedCount,
    failedCount: summary.failedCount,
    changesDetected: summary.changesDetected,
    testNames: hostFacts.testResults.map((r) => r.testName ?? "test"),
    consoleErrors: runConsoleErrors,
    failedSteps: hostFacts.testResults
      .filter((r) => r.status === "failed" || r.status === "setup_failed")
      .slice(0, 5)
      .map((r) => ({
        test: r.testName ?? "test",
        step: "unknown",
        error: r.errorMessage ?? "unknown",
      })),
    a11yTopRules: hostFacts.a11yTopRules,
  };
}

async function runQsRunAndNotes(
  host: QuickstartHost,
  sessionId: string,
  repositoryId: string,
  teamId: string,
  signal: AbortSignal,
): Promise<boolean> {
  await setActive(host, sessionId, "qs_run_and_notes");

  const session = await host.getSession(sessionId);
  if (!session) {
    await setFailed(host, sessionId, "qs_run_and_notes", "Session missing.");
    return false;
  }

  const meta = session.metadata;
  const walkthroughTestId = meta.walkthroughTestId;
  if (!walkthroughTestId) {
    await setFailed(
      host,
      sessionId,
      "qs_run_and_notes",
      "No walkthrough test id.",
    );
    return false;
  }

  const repo = await host.getRepoGateInfo(repositoryId);
  const productName = repo?.name ?? meta.quickstartSlug ?? "Quickstart target";

  const authTestId = meta.authSetup?.testId;
  const chainedAuth = !!meta.authSetup?.storageStateId;
  const testIds =
    chainedAuth || !authTestId
      ? [walkthroughTestId]
      : [authTestId, walkthroughTestId];

  const started_ = await host.startBuild(repositoryId, testIds);
  if (!started_.started) {
    await setFailed(host, sessionId, "qs_run_and_notes", started_.error);
    return false;
  }
  let buildId = started_.buildId;

  await mergeMetadata(host, sessionId, { buildId });
  emitActivity(
    host,
    teamId,
    repositoryId,
    sessionId,
    "artifact:created",
    `Build queued: ${buildId.slice(0, 8)}`,
    { stepId: "qs_run_and_notes", artifactType: "build", artifactId: buildId },
  );

  const started = Date.now();
  let streamSurfaced = false;
  let summary = await host.getBuildSummary(buildId);
  while (!summary || !summary.completedAt) {
    if (Date.now() - started > BUILD_POLL_TIMEOUT_MS) {
      await setFailed(
        host,
        sessionId,
        "qs_run_and_notes",
        "Build timed out (>8 min).",
      );
      return false;
    }
    if (await isCancelled(host, sessionId, signal)) return false;
    if (!streamSurfaced) {
      const live = await host.getBuildStreamUrl(buildId).catch(() => undefined);
      if (live) {
        await mergeMetadata(host, sessionId, { streamUrl: live });
        streamSurfaced = true;
      }
    }
    await new Promise((r) => setTimeout(r, BUILD_POLL_INTERVAL_MS));
    summary = await host.getBuildSummary(buildId);
  }
  await mergeMetadata(host, sessionId, { streamUrl: undefined });
  if (!summary) {
    await setFailed(
      host,
      sessionId,
      "qs_run_and_notes",
      "Build summary unavailable after completion.",
    );
    return false;
  }

  let hostFacts = await host.getRunFactsForBuild(buildId);

  // ── Post-run auth verification ──
  const chainedAuth0 = !!meta.authSetup?.storageStateId;
  let authDowngraded = false;
  if (chainedAuth0) {
    const wt = hostFacts.testResults.find(
      (r) => r.testId === walkthroughTestId,
    );
    const wtFailed =
      !!wt && (wt.status === "failed" || wt.status === "setup_failed");
    const authChainFailed =
      wtFailed && (wt?.errorMessage ?? "").includes(AUTH_CHAIN_FAILED_MARKER);
    if (authChainFailed) {
      emitActivity(
        host,
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
        productArchetype: meta.publicScout?.productArchetype,
      });
      await host.updateTest(walkthroughTestId, {
        code: publicOnlyCode,
        setupOverrides: null,
      });
      const rerun = await runBuildAndWait(
        host,
        repositoryId,
        [walkthroughTestId],
        sessionId,
        signal,
      );
      if (rerun.ok) {
        buildId = rerun.buildId;
        summary = rerun.summary;
        hostFacts = await host.getRunFactsForBuild(buildId);
        authDowngraded = true;
        await mergeMetadata(host, sessionId, { buildId });
      } else {
        console.warn(
          "[QuickStart] public-only downgrade rerun failed:",
          rerun.error,
        );
      }
    }
  }

  const runFacts = buildRunFactsInput(hostFacts, summary);

  const publicScout = meta.publicScout!;
  let demoNotesPersisted = false;
  try {
    const notes = await host.generateNotes({
      repositoryId,
      productName,
      publicScout,
      authedScout: meta.authedScout,
      authSetup: meta.authSetup,
      runFacts,
      authVerificationFailed: authDowngraded,
    });
    await host.upsertBuildDemoNotes(buildId, notes);
    demoNotesPersisted = true;
  } catch (err) {
    console.error("[QuickStart] demo notes generation failed:", err);
  }

  await mergeMetadata(host, sessionId, {
    demoNotesId: demoNotesPersisted ? buildId : undefined,
  });
  await setCompleted(host, sessionId, "qs_run_and_notes", {
    buildId,
    passed: summary.passedCount,
    failed: summary.failedCount,
    changes: summary.changesDetected,
    demoNotesPersisted,
    authDowngraded,
  });

  emitActivity(
    host,
    teamId,
    repositoryId,
    sessionId,
    "step:complete",
    `Run + notes complete: ${summary.passedCount} passed, ${summary.failedCount} failed, ${summary.changesDetected} screenshots`,
    { stepId: "qs_run_and_notes", detail: { buildId, demoNotesPersisted } },
  );
  return true;
}

async function runQsApproveBaselines(
  host: QuickstartHost,
  sessionId: string,
  repositoryId: string,
  teamId: string,
): Promise<boolean> {
  await setActive(host, sessionId, "qs_approve_baselines");

  const session = await host.getSession(sessionId);
  const buildId = session?.metadata.buildId;
  if (!buildId) {
    await setFailed(
      host,
      sessionId,
      "qs_approve_baselines",
      "No build id on session.",
    );
    return false;
  }

  try {
    const { approvedCount } = await host.approveAllDiffs(
      buildId,
      "quickstart-agent",
    );
    let maskedRegions = 0;
    try {
      maskedRegions = await host.maskDemoNoiseRegions(buildId);
    } catch (err) {
      console.warn("[QuickStart] demo-noise masking failed:", err);
    }
    await setCompleted(host, sessionId, "qs_approve_baselines", {
      buildId,
      approvedCount,
    });
    emitActivity(
      host,
      teamId,
      repositoryId,
      sessionId,
      "step:complete",
      `Approved ${approvedCount} baselines${maskedRegions > 0 ? ` · masked ${maskedRegions} noise regions` : ""}`,
      { stepId: "qs_approve_baselines" },
    );
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await setFailed(
      host,
      sessionId,
      "qs_approve_baselines",
      `Approve all failed: ${msg}`,
    );
    return false;
  }
}

async function runQsRerunAfterApproval(
  host: QuickstartHost,
  sessionId: string,
  repositoryId: string,
  teamId: string,
  signal: AbortSignal,
): Promise<boolean> {
  await setActive(host, sessionId, "qs_rerun_after_approval");

  const session = await host.getSession(sessionId);
  if (!session) {
    await setFailed(
      host,
      sessionId,
      "qs_rerun_after_approval",
      "Session missing.",
    );
    return false;
  }

  const meta = session.metadata;
  const walkthroughTestId = meta.walkthroughTestId;
  if (!walkthroughTestId) {
    await setFailed(
      host,
      sessionId,
      "qs_rerun_after_approval",
      "No walkthrough test id.",
    );
    return false;
  }

  const started_ = await host.startBuild(repositoryId, [walkthroughTestId]);
  if (!started_.started) {
    await setFailed(host, sessionId, "qs_rerun_after_approval", started_.error);
    return false;
  }
  const rerunBuildId = started_.buildId;

  await mergeMetadata(host, sessionId, { rerunBuildId });
  emitActivity(
    host,
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
  let summary = await host.getBuildSummary(rerunBuildId);
  while (!summary || !summary.completedAt) {
    if (Date.now() - started > BUILD_POLL_TIMEOUT_MS) {
      await setFailed(
        host,
        sessionId,
        "qs_rerun_after_approval",
        "Rerun timed out (>8 min).",
      );
      return false;
    }
    if (await isCancelled(host, sessionId, signal)) return false;
    if (!rerunStreamSurfaced) {
      const live = await host
        .getBuildStreamUrl(rerunBuildId)
        .catch(() => undefined);
      if (live) {
        await mergeMetadata(host, sessionId, { streamUrl: live });
        rerunStreamSurfaced = true;
      }
    }
    await new Promise((r) => setTimeout(r, BUILD_POLL_INTERVAL_MS));
    summary = await host.getBuildSummary(rerunBuildId);
  }
  await mergeMetadata(host, sessionId, { streamUrl: undefined });

  await setCompleted(host, sessionId, "qs_rerun_after_approval", {
    rerunBuildId,
    passed: summary.passedCount,
    failed: summary.failedCount,
    changes: summary.changesDetected,
  });
  return true;
}

async function runQsPublishShare(
  host: QuickstartHost,
  sessionId: string,
  repositoryId: string,
  teamId: string,
): Promise<boolean> {
  await setActive(host, sessionId, "qs_publish_share");

  const session = await host.getSession(sessionId);
  if (!session) {
    await setFailed(host, sessionId, "qs_publish_share", "Session missing.");
    return false;
  }

  const meta = session.metadata;
  const walkthroughTestId = meta.walkthroughTestId;
  if (!walkthroughTestId) {
    await setFailed(
      host,
      sessionId,
      "qs_publish_share",
      "No walkthrough test id.",
    );
    return false;
  }

  const buildToShare = meta.rerunBuildId ?? meta.buildId;
  if (!buildToShare) {
    await setFailed(
      host,
      sessionId,
      "qs_publish_share",
      "No build id available to publish.",
    );
    return false;
  }

  const degradedReasons: string[] = [];
  let notes: QuickstartDemoNotes | null = null;
  try {
    const facts = await host.getRunFactsForBuild(buildToShare);
    const wt =
      facts.testResults.find((r) => r.testId === walkthroughTestId) ??
      facts.testResults[0];
    const hasVideo =
      !!wt?.hasVideo ||
      !!(await resolveTestVideoUrl(repositoryId, walkthroughTestId).catch(
        () => null,
      ));
    if (!hasVideo) degradedReasons.push("no run recording for the walkthrough");
    const screenshotCount = wt?.screenshotCount ?? 0;
    if (screenshotCount < 4)
      degradedReasons.push(`only ${screenshotCount} screenshots captured (<4)`);
    notes =
      (await host.getBuildDemoNotes(buildToShare).catch(() => null)) ??
      (await host.getLatestDemoNotesForRepo(repositoryId).catch(() => null));
    if (!notes) degradedReasons.push("demo notes missing");
    else if (notes.fallbackSummary)
      degradedReasons.push(
        "demo notes are the deterministic fallback (AI summary failed)",
      );
  } catch (err) {
    console.warn("[QuickStart] share-readiness check failed:", err);
  }
  const shareQuality = degradedReasons.length === 0 ? "ok" : "degraded";

  try {
    const result = await host.publishShare(buildToShare, {
      scopedTestId: walkthroughTestId,
      kind: "demo",
    });
    await mergeMetadata(host, sessionId, {
      shareId: result.shareId,
      shareSlug: result.slug,
      shareUrl: result.url,
    });
    await setCompleted(host, sessionId, "qs_publish_share", {
      shareId: result.shareId,
      slug: result.slug,
      url: result.url,
      buildId: buildToShare,
      shareQuality,
      degradedReasons: degradedReasons.length ? degradedReasons : undefined,
      testingStruggles: notes?.testingStruggles?.length
        ? notes.testingStruggles
        : undefined,
      outreachHook: notes?.outreachHook,
    });
    emitActivity(
      host,
      teamId,
      repositoryId,
      sessionId,
      "session:complete",
      shareQuality === "ok"
        ? `Share published: ${result.url}`
        : `Share published (degraded — ${degradedReasons.join("; ")}): ${result.url}`,
      {
        stepId: "qs_publish_share",
        detail: {
          shareId: result.shareId,
          url: result.url,
          shareQuality,
          degradedReasons,
          testingStruggles: notes?.testingStruggles ?? [],
          outreachHook: notes?.outreachHook ?? null,
        },
      },
    );
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await setFailed(
      host,
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
  host: QuickstartHost,
  ctx: QuickstartCtx,
  sessionId: string,
  repositoryId: string,
  teamId: string,
  signal: AbortSignal,
) => Promise<boolean>;

const QS_RUNNERS: Record<QuickstartStepId, QsStepRunner> = {
  qs_preflight: (h, _c, s, r, t) => runQsPreflight(h, s, r, t),
  qs_scout_public: (h, c, s, r, t) => runQsScoutPublic(h, c, s, r, t),
  qs_auth_setup: (h, _c, s, r, t) => runQsAuthSetup(h, s, r, t),
  qs_scout_authed: (h, c, s, r, t) => runQsScoutAuthed(h, c, s, r, t),
  qs_generate: (h, _c, s, r, t) => runQsGenerate(h, s, r, t),
  qs_run_and_notes: (h, _c, s, r, t, sig) => runQsRunAndNotes(h, s, r, t, sig),
  qs_approve_baselines: (h, _c, s, r, t) => runQsApproveBaselines(h, s, r, t),
  qs_rerun_after_approval: (h, _c, s, r, t, sig) =>
    runQsRerunAfterApproval(h, s, r, t, sig),
  qs_publish_share: (h, _c, s, r, t) => runQsPublishShare(h, s, r, t),
};

/**
 * Exported (visibility-only change, matches the pre-migration shape) so
 * integration tests can drive a quickstart run without a session — see
 * `quickstart.integration.test.ts`.
 */
export async function executeQuickstart(
  sessionId: string,
  repositoryId: string,
  teamId: string,
) {
  const { host, ctx } = await context({ repositoryId, teamId });
  const ctrl = getOrCreateQsController(sessionId);
  const { signal } = ctrl;

  try {
    for (const stepId of QS_STEP_ORDER) {
      if (await isCancelled(host, sessionId, signal)) return;
      const runner = QS_RUNNERS[stepId];

      const stepStart = Date.now();
      emitActivity(
        host,
        teamId,
        repositoryId,
        sessionId,
        "step:start",
        `${stepId} started`,
        {
          stepId,
        },
      );
      const ok = await runner(
        host,
        ctx,
        sessionId,
        repositoryId,
        teamId,
        signal,
      );
      if (!ok) {
        emitActivity(
          host,
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
        host,
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
    const finalSession = await host.getSession(sessionId).catch(() => null);
    if (finalSession && finalSession.status === "active") {
      await host.updateSession(sessionId, {
        status: "completed",
        completedAt: new Date(),
      });
      emitActivity(
        host,
        teamId,
        repositoryId,
        sessionId,
        "session:complete",
        finalSession.metadata.shareUrl
          ? `QuickStart complete: ${finalSession.metadata.shareUrl}`
          : "QuickStart complete",
        { detail: { shareUrl: finalSession.metadata.shareUrl } },
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
  const { host } = await context({ repositoryId });
  const gate = await isQuickstartEnabled(host, repositoryId);
  if (!gate.enabled || !gate.teamId) {
    const reason = gate.reason ?? "no_repo";
    const err = new Error(`quickstart_disabled: ${reason}`);
    (err as Error & { code?: string; reason?: string }).code =
      "quickstart_disabled";
    (err as Error & { code?: string; reason?: string }).reason = reason;
    throw err;
  }
  const teamId = gate.teamId;

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
    await host.setTeamEmailTemplate(teamId, opts.emailTemplate);
  }

  const existing = await host.getActiveSession(repositoryId);
  if (existing) {
    activeQuickstartControllers.get(existing.id)?.abort();
    cleanupQsController(existing.id);
    await host.updateSession(existing.id, {
      status: "cancelled",
      completedAt: new Date(),
    });
  }

  const session = await host.createSession({
    repositoryId,
    teamId,
    currentStepId: "qs_preflight",
    steps: buildInitialQsSteps(),
    metadata: credsProvided
      ? {
          credsProvided: true,
          quickstartEmail: appEmail,
          quickstartPassword: appPassword,
        }
      : {},
  });

  emitActivity(
    host,
    teamId,
    repositoryId,
    session.id,
    "session:start",
    "QuickStart session started",
  );

  executeQuickstart(session.id, repositoryId, teamId).catch((err) => {
    console.error("[QuickStart] unhandled:", err);
    host
      .updateSession(session.id, { status: "failed", completedAt: new Date() })
      .catch(() => {});
    emitActivity(
      host,
      teamId,
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
  const { runtime, host } = quickstartWiring();
  const ctx = await runtime.contextFor(quickstartPlugin);
  const session = await host.getSession(sessionId, ctx.team.id);
  if (!session) return { success: false };

  activeQuickstartControllers.get(sessionId)?.abort();
  cleanupQsController(sessionId);
  await host.updateSession(sessionId, {
    status: "cancelled",
    completedAt: new Date(),
  });
  return { success: true };
}

export async function getQuickstartSession(
  sessionId: string,
): Promise<QuickstartSessionRow | null> {
  const { runtime, host } = quickstartWiring();
  const ctx = await runtime.contextFor(quickstartPlugin);
  return host.getSession(sessionId, ctx.team.id);
}

/**
 * Thin wrapper so `ui/quickstart-panel.tsx`'s inline base-URL entry (the
 * no_base_url empty state) can save without importing
 * `@/server/actions/environment` directly, which a plugin may not do. Calls
 * the same generic, non-pseudo-plugin action other app surfaces already use.
 */
export async function saveQuickstartBranchBaseUrl(
  repositoryId: string,
  branch: string,
  baseUrl: string,
): Promise<void> {
  const { host } = await context({ repositoryId });
  await host.saveBranchBaseUrl(repositoryId, branch, baseUrl);
}

/**
 * Per-team email template for the demo user QuickStart registers (e.g.
 * `viktor+{slug}{stamp}@lastest.cloud`). Ported from
 * `src/server/actions/settings.ts`'s `updateQuickstartEmailTemplate` — it was
 * genuinely QuickStart's own code, just misfiled in a general settings-actions
 * grab-bag (see the migration result doc §1).
 */
export async function updateQuickstartEmailTemplate(template: string) {
  const { runtime, host } = quickstartWiring();
  const ctx = await runtime.contextFor(quickstartPlugin);
  const trimmed = template.trim();
  if (!trimmed) throw new Error("Template cannot be empty");
  if (!trimmed.includes("{slug}") || !trimmed.includes("{stamp}")) {
    throw new Error("Template must contain both {slug} and {stamp} tokens");
  }
  if (trimmed.length > 200)
    throw new Error("Template too long (max 200 chars)");
  await host.setTeamEmailTemplate(ctx.team.id, trimmed);
  revalidatePath("/settings");
}
