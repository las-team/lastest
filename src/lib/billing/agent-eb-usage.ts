import "server-only";
import * as queries from "@/lib/db/queries";

/**
 * Metering for AGENT-held embedded-browser time.
 *
 * Test runs record their own minutes when the run completes
 * (`recordTeamRunCompletion` from runs.ts / builds.ts). Agent sessions — QA
 * agent, Explorer, the App Map "Explore" swarm — instead hold an EB directly
 * across a claim→release window, which was previously invisible to billing:
 * the browser time was neither metered nor quota'd.
 *
 * The pool EB's `runners` row belongs to the internal *system* team (see
 * `getOrCreateSystemTeam` in the auto-register route), so the release path
 * cannot work out who to bill on its own. The claiming caller is the only
 * place that knows the real team, so it registers the attribution here and the
 * release path settles it.
 *
 * Only claims made through `claimEmbeddedBrowserForAgent` with an explicit
 * `teamId` are tracked, so EBs claimed by the test executor (which meters
 * separately) are never double-counted.
 *
 * State is in-process and deliberately best-effort: a server restart mid-session
 * drops the pending entry, which under-counts rather than double-charges. The
 * boot-time orphan reconciliation in `embedded-sessions.ts` releases leaked EBs,
 * and an entry with no start record simply records nothing.
 */
const pending = new Map<string, { teamId: string; startedAt: number }>();

/** Record that `teamId` has taken hold of `runnerId`, starting the clock. */
export function beginAgentEbUsage(runnerId: string, teamId: string): void {
  pending.set(runnerId, { teamId, startedAt: Date.now() });
}

/**
 * Settle the claim→release window for `runnerId` and bill the elapsed time.
 *
 * No-op when the runner was not claimed through the attributed agent path.
 * Never throws — metering must not be able to break EB release, or a failed
 * billing write would leak the browser.
 */
export async function endAgentEbUsage(runnerId: string): Promise<void> {
  const entry = pending.get(runnerId);
  if (!entry) return;
  // Drop first: release can be retried (orphan reconciliation), and the window
  // must only ever be billed once.
  pending.delete(runnerId);
  try {
    await queries.recordTeamAgentMinutes(
      entry.teamId,
      Date.now() - entry.startedAt,
    );
  } catch (err) {
    console.error("[billing] agent EB usage record failed:", err);
  }
}

/**
 * Throw when the team has already burned its monthly run-minutes.
 *
 * Mirrors the test-run gate in `runs.ts`: enforcement is opt-in via
 * `ENFORCE_RUN_LIMITS` so existing deployments keep the counters advisory
 * until they choose to enforce them. A quota of 0 means "unlimited".
 */
export async function assertAgentRunMinutesAvailable(
  teamId: string,
): Promise<void> {
  if (process.env.ENFORCE_RUN_LIMITS !== "true") return;
  const usage = await queries.getTeamRunUsage(teamId).catch(() => null);
  if (
    usage &&
    usage.monthlyRunQuota > 0 &&
    usage.runMinutesThisMonth >= usage.monthlyRunQuota
  ) {
    throw new Error(
      "Monthly run-minute quota exceeded. Upgrade your plan or wait for the next billing cycle.",
    );
  }
}
