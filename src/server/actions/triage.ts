"use server";

import { revalidatePath } from "next/cache";
import { v4 as uuid } from "uuid";

import { requireRepoAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import * as queries from "@/lib/db/queries";
import { triageCaseVerdicts } from "@/lib/db/schema";
import type { TriageCase, TriageVerdict } from "@/lib/db/schema";
import { getLogger } from "@/lib/logger";
import { canRunTriage, triageAgentAvailable } from "@/lib/triage/gate";
import { runTriage } from "@/lib/triage/run";
import { createAndRunBuild } from "@/server/actions/builds";
import { approveDiff } from "@/server/actions/diffs";
import { confirmCase } from "@/server/actions/verify-issues";

/**
 * Triage agent server actions — the seam between the engine and the UI.
 *
 * Signatures are fixed by docs/architecture/triage-agent.md so the UI and the
 * engine can be built against each other. Bodies live in `src/lib/triage/`.
 */

const log = getLogger("Triage");

export interface TriageActionResult {
  ok: boolean;
  /** Why the action failed. Only ever set together with `ok: false`. */
  error?: string;
  /**
   * The verdict was recorded, but something it triggers afterwards was not —
   * a GitHub issue that never got filed, a baseline that never got approved.
   *
   * Deliberately a distinct field rather than `error` on an `ok: true` result:
   * every caller writes `if (!res.ok)`, so reusing `error` made a half-applied
   * decision read as a clean success. See `applyVerdictSideEffects`.
   */
  sideEffectError?: string;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Resolve a build's repository and enforce team ownership of it. */
async function authorizeBuild(buildId: string): Promise<{
  repositoryId: string;
  userId: string | null;
}> {
  const build = await queries.getBuild(buildId);
  if (!build) throw new Error("Build not found");
  const testRun = build.testRunId
    ? await queries.getTestRun(build.testRunId)
    : null;
  const repositoryId = testRun?.repositoryId ?? null;
  if (!repositoryId) throw new Error("Build has no repository");
  const session = await requireRepoAccess(repositoryId);
  return { repositoryId, userId: session.user?.id ?? null };
}

function snoozeUntil(days: number | undefined): Date | null {
  if (!days || days <= 0) return null;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function revalidateBuild(buildId: string): void {
  revalidatePath(`/triage-agent/${buildId}`);
  revalidatePath(`/builds/${buildId}`);
  revalidatePath(`/verify/${buildId}`);
}

/**
 * The side effects a verdict carries beyond recording it:
 *
 *   bug          → `confirmCase('regression')`  (typed GitHub issue, kind bugfix)
 *   improvement  → `confirmCase('improvement')` (typed GitHub issue)
 *   new_baseline → the existing approve-baseline path
 *   flaky_retry  → nothing; the retry is a separate explicit action
 *   false_positive / snoozed → nothing
 *
 * Best-effort: the verdict is already persisted by the time this runs, so a
 * failure here is reported but never rolls the decision back. It is reported
 * on `sideEffectError`, never on `error` — `ok: true` with `error` set reads
 * as success to every caller doing `if (!res.ok)`.
 */
async function applyVerdictSideEffects(
  verdict: TriageVerdict,
  triageCase: Pick<TriageCase, "stepComparisonId" | "visualDiffId"> | null,
  userId: string | null,
): Promise<string | undefined> {
  if (!triageCase) return undefined;
  try {
    if (verdict === "bug" && triageCase.stepComparisonId) {
      const res = await confirmCase(triageCase.stepComparisonId, "regression");
      return res.ok ? undefined : res.error;
    }
    if (verdict === "improvement" && triageCase.stepComparisonId) {
      const res = await confirmCase(triageCase.stepComparisonId, "improvement");
      return res.ok ? undefined : res.error;
    }
    if (verdict === "new_baseline" && triageCase.visualDiffId) {
      await approveDiff(triageCase.visualDiffId, userId ?? undefined);
      return undefined;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ err, verdict }, "triage verdict side effect failed");
    return message;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Run the classifier over a build.
 *
 * `force` defaults to FALSE — an existing triage run is reused. The classifier
 * is AI-backed, so a re-run is real spend, and a default the option cannot
 * express (`force: false` worked, omitting it did not) is a trap. The two UI
 * entry points ask for a re-run explicitly, because that is what their button
 * means; nothing else should pay for one by accident.
 */
export async function runTriageForBuild(
  buildId: string,
  opts?: { force?: boolean },
): Promise<TriageActionResult & { triageRunId?: string }> {
  try {
    const { repositoryId } = await authorizeBuild(buildId);
    const gate = await canRunTriage({ repositoryId });
    if (!gate.allowed) return { ok: false, error: gate.reason };

    const result = await runTriage(buildId, {
      force: opts?.force ?? false,
      skipGate: true,
    });
    revalidateBuild(buildId);
    return {
      ok: result.ok,
      triageRunId: result.triageRunId,
      error: result.error,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function recordTriageVerdict(input: {
  buildId: string;
  testId: string;
  stepLabel?: string | null;
  triageCaseId?: string;
  verdict: TriageVerdict;
  note?: string;
  snoozeDays?: number;
}): Promise<TriageActionResult> {
  try {
    const { repositoryId, userId } = await authorizeBuild(input.buildId);

    // The build is authorized, so the blast radius is already inside the
    // tenant — but a verdict row is keyed by `testId`, and an id that belongs
    // to no test on this repo just accumulates rows no case will ever match.
    const test = await queries.getTest(input.testId);
    if (!test || test.repositoryId !== repositoryId) {
      return { ok: false, error: "That test does not belong to this project" };
    }

    // Locate the case row so the verdict's side effects know which step
    // comparison / visual diff to act on.
    let triageCase: TriageCase | null = input.triageCaseId
      ? await queries.getTriageCase(input.triageCaseId)
      : null;
    if (!triageCase) {
      const view = await queries.getTriageRunForBuild(input.buildId);
      triageCase =
        view?.cases.find(
          (c) =>
            c.testId === input.testId &&
            (c.stepLabel ?? "") === (input.stepLabel ?? ""),
        ) ?? null;
    }
    // Never let a caller point a verdict at another build's case.
    if (triageCase && triageCase.buildId !== input.buildId) triageCase = null;

    await queries.setTriageVerdict({
      buildId: input.buildId,
      testId: input.testId,
      stepLabel: input.stepLabel ?? "",
      triageCaseId: triageCase?.id ?? null,
      verdict: input.verdict,
      note: input.note ?? null,
      snoozedUntil: snoozeUntil(input.snoozeDays),
      decidedBy: userId,
    });

    const sideEffectError = await applyVerdictSideEffects(
      input.verdict,
      triageCase,
      userId,
    );

    revalidateBuild(input.buildId);
    return { ok: true, sideEffectError };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function recordTriageGroupVerdict(input: {
  triageGroupId: string;
  verdict: TriageVerdict;
  note?: string;
}): Promise<TriageActionResult & { decided: number }> {
  try {
    const group = await queries.getTriageGroup(input.triageGroupId);
    if (!group) return { ok: false, decided: 0, error: "Group not found" };
    const { userId } = await authorizeBuild(group.buildId);

    const cases = await queries.getTriageCasesForGroup(group.id);
    if (cases.length === 0) return { ok: true, decided: 0 };

    const decidedAt = new Date();
    // One transaction: a bulk decision either lands for the whole cluster or
    // not at all, so the group header can never disagree with its cards.
    await db.transaction(async (tx) => {
      for (const c of cases) {
        await tx
          .insert(triageCaseVerdicts)
          .values({
            id: uuid(),
            buildId: group.buildId,
            testId: c.testId,
            stepLabel: c.stepLabel ?? "",
            triageCaseId: c.id,
            verdict: input.verdict,
            note: input.note ?? null,
            decidedBy: userId,
            decidedAt,
          })
          .onConflictDoUpdate({
            target: [
              triageCaseVerdicts.buildId,
              triageCaseVerdicts.testId,
              triageCaseVerdicts.stepLabel,
            ],
            set: {
              triageCaseId: c.id,
              verdict: input.verdict,
              note: input.note ?? null,
              decidedBy: userId,
              decidedAt,
            },
          });
      }
    });

    // Issue filing / baseline approval runs outside the transaction: those are
    // network + cross-table operations that must not hold a DB transaction
    // open, and each is independently retryable.
    let sideEffectError: string | undefined;
    for (const c of cases) {
      const err = await applyVerdictSideEffects(input.verdict, c, userId);
      if (err && !sideEffectError) sideEffectError = err;
    }

    revalidateBuild(group.buildId);
    return { ok: true, decided: cases.length, sideEffectError };
  } catch (err) {
    return {
      ok: false,
      decided: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function clearTriageVerdictAction(input: {
  buildId: string;
  testId: string;
  stepLabel?: string | null;
}): Promise<TriageActionResult> {
  try {
    await authorizeBuild(input.buildId);
    await queries.clearTriageVerdict({
      buildId: input.buildId,
      testId: input.testId,
      stepLabel: input.stepLabel ?? "",
    });
    revalidateBuild(input.buildId);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Re-run just the tests behind a set of flaky cases. Uses the same scoped
 * build path the UI's "run selected tests" uses — a new build over a testId
 * subset — so the retry is a first-class run with its own diffs and its own
 * triage, not a side channel.
 */
export async function retryFlakyCases(input: {
  buildId: string;
  testIds: string[];
}): Promise<TriageActionResult & { buildId?: string }> {
  try {
    const { repositoryId } = await authorizeBuild(input.buildId);
    const testIds = [...new Set(input.testIds.filter(Boolean))];
    if (testIds.length === 0) {
      return { ok: false, error: "No tests to retry" };
    }

    // Only retry tests that actually belong to this build's repo.
    const owned: string[] = [];
    for (const id of testIds) {
      const test = await queries.getTest(id);
      if (test && test.repositoryId === repositoryId && !test.deletedAt) {
        owned.push(id);
      }
    }
    if (owned.length === 0) {
      return { ok: false, error: "None of those tests belong to this project" };
    }

    const result = await createAndRunBuild("manual", owned, repositoryId);
    revalidateBuild(input.buildId);
    return { ok: true, buildId: result?.buildId ?? undefined };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function setTriageAgentEnabled(
  repositoryId: string,
  enabled: boolean,
): Promise<TriageActionResult> {
  try {
    const session = await requireRepoAccess(repositoryId);
    // Pro-gated: only teams that can see the Agents tab may switch the agent
    // on. A downgraded team keeps the stored value but can never flip it back.
    if (!triageAgentAvailable(session.team)) {
      const gate = await canRunTriage({ team: session.team, repositoryId });
      return {
        ok: false,
        error:
          gate.reason ??
          "The Triage agent requires a plan that includes the Agents console.",
      };
    }
    await queries.upsertAISettings(repositoryId, {
      triageAgentEnabled: enabled,
    });
    revalidatePath("/settings");
    revalidatePath("/agents");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
