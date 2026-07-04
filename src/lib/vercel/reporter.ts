/**
 * Reports a finished (or re-approved) Lastest build back to its Vercel check.
 *
 * Called from two places:
 *   1. build completion — src/server/actions/builds.ts (sendBuildNotifications)
 *   2. diff approval flip — src/server/actions/diffs.ts, when approving diffs
 *      moves the build to safe_to_merge and the (previously failed) check should
 *      turn green.
 *
 * No import of builds.ts here, so it stays free of the notification-dispatcher
 * → reporter → builds import cycle.
 */
import * as queries from "@/lib/db/queries";
import { updateCheck, conclusionForBuildStatus } from "./checks";
import { stopHeartbeat } from "./heartbeat";
import type { BuildStatus } from "@/lib/db/schema";

function buildResultsUrl(buildId: string): string {
  const base = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  return `${base}/builds/${buildId}`;
}

/**
 * Conclude the Vercel check for a build. Idempotent-ish: safe to call on
 * completion and again on every subsequent approval — each call re-PATCHes the
 * check to reflect the build's current status. No-ops when the build has no
 * associated Vercel check.
 */
export async function reportVercelCheckForBuild(
  buildId: string,
  statusOverride?: BuildStatus,
): Promise<void> {
  try {
    const check = await queries.getVercelCheckByBuildId(buildId);
    if (!check || !check.vercelCheckId) return;

    const build = await queries.getBuild(buildId);
    if (!build) return;

    const status = (statusOverride ??
      (build.overallStatus as BuildStatus)) as BuildStatus;
    const conclusion = conclusionForBuildStatus(status);

    const config = await queries.getVercelProjectConfigById(
      check.vercelProjectConfigId,
    );
    if (!config) return;
    const account = await queries.getVercelAccountById(config.vercelAccountId);
    if (!account) return;

    // The build's async run is over (or the diffs were just approved): stop any
    // running heartbeat before concluding so it can't re-flip us to `running`.
    stopHeartbeat(check.id);

    const ok = await updateCheck(
      account.accessToken,
      check.vercelDeploymentId,
      check.vercelCheckId,
      account.vercelTeamId ?? null,
      {
        status: "completed",
        conclusion,
        detailsUrl: buildResultsUrl(buildId),
        output: {
          summary: summarizeBuild(status, build),
        },
      },
    );

    await queries.updateVercelCheck(check.id, {
      status: "completed",
      conclusion,
    });

    if (!ok) {
      // Vercel can reject updates to an already-concluded check. The rerun
      // button (rerequestable: true) remains the user's escape hatch; log so
      // the fallback is visible.
      console.warn(
        `[vercel] check ${check.vercelCheckId} update returned non-OK; ` +
          `a rerequest may be required to reflect status ${status}.`,
      );
    }
  } catch (error) {
    console.error("[vercel] reportVercelCheckForBuild error:", error);
  }
}

function summarizeBuild(
  status: BuildStatus,
  build: { changesDetected?: number | null; totalTests?: number | null },
): string {
  const changes = build.changesDetected ?? 0;
  const total = build.totalTests ?? 0;
  switch (status) {
    case "safe_to_merge":
      return `Lastest: no unapproved visual changes across ${total} test(s).`;
    case "review_required":
      return `Lastest: ${changes} visual change(s) need review before this deploy is safe.`;
    case "blocked":
      return `Lastest: build blocked — ${changes} change(s) require attention.`;
    case "has_todos":
      return "Lastest: build has open todos (informational).";
    case "executor_failed":
      return "Lastest: test run infrastructure failed (not blocking your deploy).";
    default:
      return "Lastest build complete.";
  }
}
