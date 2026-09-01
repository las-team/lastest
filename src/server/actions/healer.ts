"use server";

import { revalidatePath } from "next/cache";

import { requireRepoAccess } from "@/lib/auth";
import * as queries from "@/lib/db/queries";
import { getLogger } from "@/lib/logger";
import { canRunHealer, healerAgentAvailable } from "@/lib/healer/gate";
import { HEALER_LIMITS } from "@/lib/healer/limits";
import { runHealer } from "@/lib/healer/run";

/**
 * Healer agent server actions — the seam between the engine in
 * `src/lib/healer/` and the `/healer-agent` page.
 */

const log = getLogger("Healer");

export interface HealerActionResult {
  ok: boolean;
  error?: string;
  sessionId?: string;
}

async function authorizeBuild(buildId: string): Promise<{
  repositoryId: string;
  team: Awaited<ReturnType<typeof requireRepoAccess>>["team"];
}> {
  const build = await queries.getBuild(buildId);
  if (!build) throw new Error("Build not found");
  const testRun = build.testRunId
    ? await queries.getTestRun(build.testRunId)
    : null;
  const repositoryId = testRun?.repositoryId ?? null;
  if (!repositoryId) throw new Error("Build has no repository");
  const session = await requireRepoAccess(repositoryId);
  return { repositoryId, team: session.team };
}

/**
 * Start a healing campaign for a build by hand. Fire-and-forget: the page
 * polls the session. `force` lifts the auto-run toggle only — plan, triage
 * and in-product AI still gate inside `runHealer`.
 */
export async function runHealerForBuild(
  buildId: string,
): Promise<HealerActionResult> {
  try {
    const { repositoryId, team } = await authorizeBuild(buildId);
    const gate = await canRunHealer({ team, repositoryId, force: true });
    if (!gate.allowed) return { ok: false, error: gate.reason };
    const existing = await queries.getLatestAgentSession(
      repositoryId,
      "healer",
    );
    if (existing?.status === "active") {
      return {
        ok: false,
        error: "A healing campaign is already running on this repository.",
      };
    }
    runHealer(buildId, { force: true }).catch((e) => {
      log.error({ err: e, buildId }, "manual healer run failed");
    });
    revalidatePath("/healer-agent");
    revalidatePath("/agents");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Pause a running campaign. The engine checks the session status between
 *  tests and rounds and stops at the next check. */
export async function stopHealerCampaign(
  sessionId: string,
): Promise<HealerActionResult> {
  try {
    const session = await queries.getAgentSession(sessionId);
    if (!session || session.kind !== "healer") {
      return { ok: false, error: "Session not found" };
    }
    await requireRepoAccess(session.repositoryId);
    if (session.status === "active") {
      await queries.updateAgentSession(sessionId, { status: "paused" });
    }
    revalidatePath("/healer-agent");
    revalidatePath("/agents");
    return { ok: true, sessionId };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function setHealerAgentEnabled(
  repositoryId: string,
  enabled: boolean,
): Promise<HealerActionResult> {
  try {
    const session = await requireRepoAccess(repositoryId);
    if (!healerAgentAvailable(session.team)) {
      const gate = await canRunHealer({ team: session.team, repositoryId });
      return {
        ok: false,
        error:
          gate.reason ??
          "The Healer requires a plan that includes the Agents console.",
      };
    }
    await queries.upsertAISettings(repositoryId, {
      healerAgentEnabled: enabled,
    });
    revalidatePath("/settings");
    revalidatePath("/healer-agent");
    revalidatePath("/agents");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function setHealerLimits(
  repositoryId: string,
  limits: { maxAttemptsPerTest: number; maxTestsPerBuild: number },
): Promise<HealerActionResult> {
  try {
    const session = await requireRepoAccess(repositoryId);
    if (!healerAgentAvailable(session.team)) {
      return {
        ok: false,
        error: "The Healer requires a plan that includes the Agents console.",
      };
    }
    const clamp = (n: number, { min, max }: { min: number; max: number }) =>
      Math.min(max, Math.max(min, Math.floor(Number.isFinite(n) ? n : min)));
    await queries.upsertAISettings(repositoryId, {
      healerMaxAttemptsPerTest: clamp(
        limits.maxAttemptsPerTest,
        HEALER_LIMITS.attempts,
      ),
      healerMaxTestsPerBuild: clamp(
        limits.maxTestsPerBuild,
        HEALER_LIMITS.tests,
      ),
    });
    revalidatePath("/healer-agent");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
