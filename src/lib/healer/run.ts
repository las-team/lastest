/**
 * `runHealer` — the Healer agent's orchestration: one healing *campaign* per
 * build.
 *
 *   collect  every failed test in the build
 *   gate     keep only what Triage classified as a test problem
 *            (`test_maintenance` / `flaky_test`), that no reviewer has
 *            decided, and that still has heal budget; cap the batch
 *   heal     patch each on one claimed embedded browser (`agentHealTest`)
 *   verify   re-run the patched tests and read the results
 *   ⟲        while something still fails, has budget, and the error moved:
 *            heal again — that is the "continuous loop"
 *   report   write a per-test ledger the page and the roster render
 *
 * Guardrails, all hard stops rather than heuristics:
 *
 *  - **Never a real bug.** `real_regression` and `environment_issue` are
 *    skipped with the reason recorded; `unknown`/unclassified too — absence of
 *    a classification is not evidence of a test problem.
 *  - **Budget per test** (`healerMaxAttemptsPerTest`) counted from `ai_fix`
 *    test versions since the test last passed or was hand-edited, so the
 *    budget persists across builds and campaigns and a human edit resets it.
 *  - **Cap per campaign** (`healerMaxTestsPerBuild`).
 *  - **No-progress guard**: a round that reproduces the identical error ends
 *    the campaign for that test.
 *  - **Single flight per repo**: a campaign already running means this build
 *    is ignored — the verify runs it launches complete builds of their own,
 *    and this is what stops them from re-triggering the healer.
 *  - **Wall clock**: a per-heal timeout and a per-verify deadline.
 *
 * The healer's own prompt refuses to loosen assertions (see
 * `plugins/authoring-ai/src/healer-agent.ts`), and every heal is a versioned
 * `ai_fix` edit, so a reviewer can always see, and revert, what it did.
 */

import * as queries from "@/lib/db/queries";
import { emitAndPersistActivityEvent } from "@/lib/db/queries/activity-events";
import { getCurrentBranchForRepo } from "@/lib/git-utils";
import { getLogger } from "@/lib/logger";
import type {
  AgentSubstep,
  HealerOutcome,
  TriageClassification,
} from "@/lib/db/schema";
import { withAuthoringAiSession } from "@lastest/plugin-authoring-ai/actions";
import { runTestsCore } from "@/server/actions/runs";

import { canRunHealer } from "./gate";
import {
  capCandidates,
  countHealAttempts,
  decideHeal,
  sameFailure,
} from "./decide";
import {
  closeHealerSession,
  createHealerSession,
  failHealerStep,
  finishHealerStep,
  healerStopped,
  mergeHealerMetadata,
  setHealerSubsteps,
  startHealerStep,
} from "./session";

const log = getLogger("Healer");

/** One heal (LLM + live-browser inspection + validation retries). */
const HEAL_TIMEOUT_MS = 10 * 60 * 1000;
/** Waiting for a verify run to settle. */
const VERIFY_DEADLINE_MS = 20 * 60 * 1000;
const VERIFY_POLL_MS = 5000;

export interface RunHealerOptions {
  /** Lift the `healerAgentEnabled` toggle only — the "Heal latest build"
   *  button. Plan, triage and in-product AI still gate. */
  force?: boolean;
  signal?: AbortSignal;
}

export interface RunHealerResult {
  ok: boolean;
  sessionId?: string;
  /** Why nothing ran. Only set with `ok: false`. */
  reason?: string;
  outcomes?: HealerOutcome[];
}

interface Candidate {
  testId: string;
  testName: string;
  classification: TriageClassification | null;
  errorMessage: string | null;
  attempts: number;
}

function summarise(outcomes: HealerOutcome[]) {
  const by = (k: HealerOutcome["outcome"]) =>
    outcomes.filter((o) => o.outcome === k).length;
  return {
    healed: by("healed"),
    stillFailing: by("still_failing") + by("heal_failed"),
    skippedBugs: by("skipped_real_bug") + by("skipped_environment"),
    skippedOther:
      by("skipped_unclassified") +
      by("skipped_human_verdict") +
      by("skipped_budget") +
      by("skipped_cap"),
  };
}

export async function runHealer(
  buildId: string,
  opts: RunHealerOptions = {},
): Promise<RunHealerResult> {
  const build = await queries.getBuild(buildId);
  if (!build) return { ok: false, reason: "Build not found" };
  const testRun = build.testRunId
    ? await queries.getTestRun(build.testRunId)
    : null;
  const repositoryId = testRun?.repositoryId ?? null;
  if (!repositoryId || !testRun) {
    return { ok: false, reason: "Build has no repository" };
  }

  const gate = await canRunHealer({ repositoryId, force: opts.force });
  if (!gate.allowed) {
    log.info({ buildId, reason: gate.reason }, "healer gated off");
    return { ok: false, reason: gate.reason };
  }

  // Single flight per repo. The verify runs a campaign launches finish as
  // builds of their own and re-enter here; this is what keeps them from
  // spawning a second campaign on top of the first.
  const existing = await queries.getLatestAgentSession(repositoryId, "healer");
  if (existing && existing.status === "active") {
    return {
      ok: false,
      reason: "A healing campaign is already running on this repository.",
    };
  }

  const repo = await queries.getRepository(repositoryId);
  const teamId = repo?.teamId ?? null;
  const settings = await queries.getAISettings(repositoryId);
  const maxAttempts = Math.max(1, settings.healerMaxAttemptsPerTest ?? 2);
  const maxTests = Math.max(1, settings.healerMaxTestsPerBuild ?? 5);

  const session = await createHealerSession({ repositoryId, teamId, buildId });
  const sessionId = session?.id ?? null;
  const startedAt = Date.now();
  const emit = (
    eventType: "session:start" | "session:complete" | "session:error",
    summary: string,
  ) =>
    emitAndPersistActivityEvent({
      teamId: teamId ?? "",
      repositoryId,
      sessionId,
      sourceType: "heal_agent",
      eventType,
      summary,
      stepId: null,
      agentType: "healer",
      detail: null,
      artifactType: null,
      artifactId: null,
      artifactLabel: null,
      durationMs: eventType === "session:start" ? null : Date.now() - startedAt,
      promptLogId: null,
    }).catch(() => {});

  emit(
    "session:start",
    `Healer campaign started for build ${buildId.slice(0, 8)}`,
  );

  const outcomes: HealerOutcome[] = [];
  try {
    // ── collect ────────────────────────────────────────────────────────────
    await startHealerStep(sessionId, "healer_collect");
    const results = await queries.getTestResultsByRun(testRun.id);
    const failedByTest = new Map<string, (typeof results)[number]>();
    for (const r of results) {
      if (r.status !== "failed" || !r.testId) continue;
      // Multi-browser builds carry one row per browser; keep the one Triage
      // classified, else the first.
      const prev = failedByTest.get(r.testId);
      if (!prev || (!prev.triage && r.triage)) failedByTest.set(r.testId, r);
    }
    const candidates: Candidate[] = [];
    for (const [testId, r] of failedByTest) {
      const test = await queries.getTest(testId);
      if (!test || test.deletedAt) continue;
      const [versions, history] = await Promise.all([
        queries.getTestVersions(testId),
        queries.getTestResultsByTest(testId),
      ]);
      const lastPassedAt =
        history.find((h) => h.status === "passed")?.startedAt ?? null;
      candidates.push({
        testId,
        testName: test.name,
        classification: r.triage?.classification ?? null,
        errorMessage: r.errorMessage ?? null,
        attempts: countHealAttempts(versions, lastPassedAt),
      });
    }
    await finishHealerStep(sessionId, "healer_collect", {
      failed: candidates.length,
    });

    if (candidates.length === 0) {
      await finishHealerStep(sessionId, "healer_gate", {}, "skipped");
      await finishHealerStep(sessionId, "healer_heal", {}, "skipped");
      await finishHealerStep(sessionId, "healer_verify", {}, "skipped");
      await finishHealerStep(sessionId, "healer_report", { healed: 0 });
      await closeHealerSession(sessionId, "completed");
      emit(
        "session:complete",
        "Nothing to heal — no failed tests in the build",
      );
      return { ok: true, sessionId: sessionId ?? undefined, outcomes };
    }

    // ── gate ───────────────────────────────────────────────────────────────
    await startHealerStep(sessionId, "healer_gate");
    const verdicts = await queries.getTriageVerdicts(buildId);
    const decided = new Set(
      Object.keys(verdicts).map((k) => k.split("::")[0] ?? k),
    );
    const healable: Candidate[] = [];
    for (const c of candidates) {
      const d = decideHeal({
        classification: c.classification,
        hasHumanVerdict: decided.has(c.testId),
        attempts: c.attempts,
        maxAttempts,
      });
      if (d.heal) healable.push(c);
      else
        outcomes.push({
          testId: c.testId,
          testName: c.testName,
          outcome: d.outcome,
          attempts: c.attempts,
          detail: d.detail,
        });
    }
    const { selected, overflow } = capCandidates(healable, maxTests);
    for (const c of overflow) {
      outcomes.push({
        testId: c.testId,
        testName: c.testName,
        outcome: "skipped_cap",
        attempts: c.attempts,
        detail: `Over the per-build cap of ${maxTests} — left for the next build.`,
      });
    }
    await mergeHealerMetadata(sessionId, { healerOutcomes: [...outcomes] });
    await finishHealerStep(sessionId, "healer_gate", {
      healable: selected.length,
      skipped: outcomes.length,
    });

    if (selected.length === 0) {
      await finishHealerStep(sessionId, "healer_heal", {}, "skipped");
      await finishHealerStep(sessionId, "healer_verify", {}, "skipped");
      await finishHealerStep(sessionId, "healer_report", summarise(outcomes));
      await closeHealerSession(sessionId, "completed");
      emit(
        "session:complete",
        `Nothing healable — ${outcomes.length} failure(s) are bugs, decided, unclassified or over budget`,
      );
      return { ok: true, sessionId: sessionId ?? undefined, outcomes };
    }

    // ── heal ⟲ verify ──────────────────────────────────────────────────────
    const branch = await getCurrentBranchForRepo(repositoryId);
    let active = [...selected];
    let rounds = 0;
    const finalFor = (
      c: Candidate,
      outcome: HealerOutcome["outcome"],
      detail?: string,
    ) =>
      outcomes.push({
        testId: c.testId,
        testName: c.testName,
        outcome,
        attempts: c.attempts,
        detail,
      });

    while (active.length > 0) {
      rounds += 1;
      await mergeHealerMetadata(sessionId, { healerRounds: rounds });
      if (await healerStopped(sessionId, opts.signal)) {
        for (const c of active)
          finalFor(c, "still_failing", "Campaign stopped.");
        break;
      }

      // heal
      const substeps: AgentSubstep[] = active.map((c) => ({
        label: `Round ${rounds}: healing "${c.testName}"`,
        status: "pending",
        agent: "healer",
      }));
      await startHealerStep(sessionId, "healer_heal", substeps);
      const healed: Candidate[] = [];
      await withAuthoringAiSession(
        repositoryId,
        {
          onQueued: () =>
            void mergeHealerMetadata(sessionId, { queuedForBrowser: true }),
          onSessionReady: (streamUrl) =>
            void mergeHealerMetadata(sessionId, {
              queuedForBrowser: false,
              streamUrl: streamUrl ?? undefined,
            }),
        },
        async (browser) => {
          for (let i = 0; i < active.length; i++) {
            const c = active[i];
            if (await healerStopped(sessionId, opts.signal)) return;
            substeps[i] = { ...substeps[i], status: "running" };
            await setHealerSubsteps(sessionId, "healer_heal", substeps);
            const t0 = Date.now();
            try {
              const spec = await queries.getTestSpec(c.testId);
              const intent = spec
                ? `${spec.title}\n${spec.spec}`.slice(0, 2000)
                : undefined;
              const timeout = AbortSignal.timeout(HEAL_TIMEOUT_MS);
              const res = await browser.healTest(c.testId, {
                intent,
                signal: opts.signal
                  ? AbortSignal.any([opts.signal, timeout])
                  : timeout,
              });
              if (res.success && res.code) {
                await queries.updateTestWithVersion(
                  c.testId,
                  { code: res.code },
                  "ai_fix",
                  branch ?? undefined,
                );
                c.attempts += 1;
                healed.push(c);
                substeps[i] = {
                  ...substeps[i],
                  status: "done",
                  durationMs: Date.now() - t0,
                };
              } else {
                c.attempts += 1;
                finalFor(c, "heal_failed", res.error?.slice(0, 300));
                substeps[i] = {
                  ...substeps[i],
                  status: "error",
                  detail: res.error?.slice(0, 200),
                  durationMs: Date.now() - t0,
                };
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              finalFor(c, "heal_failed", msg.slice(0, 300));
              substeps[i] = {
                ...substeps[i],
                status: "error",
                detail: msg.slice(0, 200),
                durationMs: Date.now() - t0,
              };
            }
            await setHealerSubsteps(sessionId, "healer_heal", substeps);
          }
        },
      ).catch(async (err) => {
        const msg =
          err instanceof Error ? err.message : "No embedded browser available";
        for (const c of active) {
          if (!healed.includes(c))
            finalFor(c, "heal_failed", msg.slice(0, 300));
        }
        for (let i = 0; i < substeps.length; i++) {
          if (substeps[i].status !== "done")
            substeps[i] = { ...substeps[i], status: "error", detail: msg };
        }
        await setHealerSubsteps(sessionId, "healer_heal", substeps);
      });
      await mergeHealerMetadata(sessionId, {
        streamUrl: undefined,
        queuedForBrowser: false,
        healerOutcomes: [...outcomes],
      });
      await finishHealerStep(sessionId, "healer_heal", {
        round: rounds,
        patched: healed.length,
      });

      if (healed.length === 0) break;

      // verify
      await startHealerStep(sessionId, "healer_verify");
      const statuses = await verify(
        repositoryId,
        healed.map((c) => c.testId),
        sessionId,
        opts.signal,
      );
      const next: Candidate[] = [];
      for (const c of healed) {
        const s = statuses.get(c.testId);
        if (s?.status === "passed") {
          finalFor(
            c,
            "healed",
            `Passed on verify after ${c.attempts} attempt(s).`,
          );
          continue;
        }
        if (s === undefined) {
          finalFor(c, "still_failing", "Verify run did not settle in time.");
          continue;
        }
        if (c.attempts >= maxAttempts) {
          finalFor(
            c,
            "still_failing",
            `Still failing after ${c.attempts}/${maxAttempts} attempts — needs a human.`,
          );
          continue;
        }
        if (sameFailure(c.errorMessage, s.errorMessage)) {
          finalFor(
            c,
            "still_failing",
            "The heal reproduced the identical error — not converging, stopped early.",
          );
          continue;
        }
        c.errorMessage = s.errorMessage;
        next.push(c);
      }
      await mergeHealerMetadata(sessionId, { healerOutcomes: [...outcomes] });
      await finishHealerStep(sessionId, "healer_verify", {
        round: rounds,
        passed: healed.length - next.length - 0,
        retrying: next.length,
      });
      active = next;
    }

    // ── report ─────────────────────────────────────────────────────────────
    await startHealerStep(sessionId, "healer_report");
    const s = summarise(outcomes);
    await mergeHealerMetadata(sessionId, {
      healerOutcomes: [...outcomes],
      healerRounds: rounds,
    });
    await finishHealerStep(sessionId, "healer_report", { ...s, rounds });
    await closeHealerSession(sessionId, "completed");
    emit(
      "session:complete",
      `Healed ${s.healed}, still failing ${s.stillFailing}, skipped ${s.skippedBugs} bug(s) and ${s.skippedOther} other — ${rounds} round(s)`,
    );
    log.info({ buildId, sessionId, ...s, rounds }, "healer campaign done");
    return { ok: true, sessionId: sessionId ?? undefined, outcomes };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err, buildId, sessionId }, "healer campaign failed");
    await failHealerStep(sessionId, "healer_report", msg);
    await mergeHealerMetadata(sessionId, { healerOutcomes: [...outcomes] });
    await closeHealerSession(sessionId, "failed");
    emit("session:error", `Healer campaign failed: ${msg.slice(0, 200)}`);
    return {
      ok: false,
      sessionId: sessionId ?? undefined,
      reason: msg,
      outcomes,
    };
  }
}

/**
 * Run the patched tests and wait for the run to settle. Returns the latest
 * status per test; a test missing from the map means the run never settled
 * inside the deadline.
 */
async function verify(
  repositoryId: string,
  testIds: string[],
  sessionId: string | null,
  signal?: AbortSignal,
): Promise<Map<string, { status: string; errorMessage: string | null }>> {
  const out = new Map<
    string,
    { status: string; errorMessage: string | null }
  >();
  const verifyStartedAt = Date.now();
  const run = await runTestsCore(testIds, repositoryId, true);
  const runId = "runId" in run ? (run.runId ?? null) : null;
  const jobId = run.jobId ?? null;
  await mergeHealerMetadata(sessionId, { verifyRunId: runId ?? undefined });

  // Wait for the run row to settle — or, when the pool was busy and the run
  // was queued instead, for the queued job. A queued job re-enters
  // `runTestsCore` with a fresh run id it does not report back, so the
  // per-test read below goes by time rather than by run id.
  const deadline = Date.now() + VERIFY_DEADLINE_MS;
  let settled = false;
  while (Date.now() < deadline) {
    if (await healerStopped(sessionId, signal)) return out;
    if (runId) {
      const row = await queries.getTestRun(runId);
      if (row?.status && row.status !== "running") {
        settled = true;
        break;
      }
    } else if (jobId) {
      const job = await queries.getBackgroundJob(jobId);
      if (!job) return out;
      if (job.status !== "pending" && job.status !== "running") {
        settled = true;
        break;
      }
    } else {
      return out;
    }
    await new Promise((r) => setTimeout(r, VERIFY_POLL_MS));
  }
  if (!settled) return out;

  for (const id of testIds) {
    const history = await queries.getTestResultsByTest(id);
    const fresh = history.filter(
      (h) =>
        (runId ? h.testRunId === runId : true) &&
        h.startedAt !== null &&
        h.startedAt.getTime() >= verifyStartedAt - VERIFY_POLL_MS,
    );
    if (fresh.length === 0) continue;
    // Multi-browser: healed only if every browser passed.
    const failed = fresh.find((r) => r.status !== "passed");
    out.set(id, {
      status: failed ? (failed.status ?? "failed") : "passed",
      errorMessage: failed?.errorMessage ?? null,
    });
  }
  return out;
}
