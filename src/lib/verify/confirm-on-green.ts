import * as queries from "@/lib/db/queries";

// NOTE: Plain module, NOT a `"use server"` file. This closes GitHub issues on
// behalf of the team without a user session — exposing it as a server action
// would let any caller close another team's tickets. It is called only from
// trusted build-finalization code (same convention as auto-approve.ts).

/**
 * Confirm-on-green — the closing arc of the diff→fix→re-run loop:
 *
 *   1. Lastest files an issue (evidence-packed, assigned to the AI engineer).
 *   2. The engineer lands a fix and closes the issue ("closes #N" on the PR).
 *   3. The issues webhook auto-reruns the linked tests.
 *   4. THIS runs when that build finalizes as `safe_to_merge`: every open
 *      Lastest-filed issue whose test came back fully green is closed with a
 *      comment linking the green build, and the case is marked closed on the
 *      verify board.
 *
 * It also covers the human path — an issue left open after someone shipped a
 * fix closes itself on the next green run, matching the product promise
 * "the issue closes itself once the re-run comes back safe_to_merge".
 *
 * Scope guards:
 *   - Only issues Lastest filed (state 'auto'/'open'). Manually 'linked'
 *     issues belong to someone else's workflow and are never auto-closed.
 *   - 'improvement' tickets are skipped: they track an intent gap, which a
 *     green-vs-baseline rerun cannot prove fixed.
 *   - Only tests whose EVERY step in this build has a green verdict.
 *
 * Idempotent: the state filter excludes already-closed links, and the DB is
 * flipped to 'closed' before the GitHub PATCH so the resulting issues-webhook
 * delivery finds nothing left to rerun.
 */
export async function closeIssuesOnGreen(
  buildId: string,
): Promise<{ closed: number }> {
  const build = await queries.getBuild(buildId);
  if (!build || build.overallStatus !== "safe_to_merge") return { closed: 0 };
  const testRun = build.testRunId
    ? await queries.getTestRun(build.testRunId)
    : null;
  const repositoryId = testRun?.repositoryId ?? null;
  if (!repositoryId) return { closed: 0 };

  // Tests where every step of this build is green — a single yellow/red step
  // means the fix isn't proven even if the build overall was approved green.
  const steps = await queries.getStepComparisonsByBuild(buildId);
  if (steps.length === 0) return { closed: 0 };
  const verdictsByTest = new Map<string, boolean>();
  for (const s of steps) {
    const prev = verdictsByTest.get(s.testId) ?? true;
    verdictsByTest.set(s.testId, prev && s.verdict === "green");
  }
  const greenTestIds = [...verdictsByTest.entries()]
    .filter(([, allGreen]) => allGreen)
    .map(([testId]) => testId);
  if (greenTestIds.length === 0) return { closed: 0 };

  const candidates = (
    await queries.getOpenIssueStepsForTests(repositoryId, greenTestIds)
  ).filter((s) => s.buildId !== buildId && s.githubIssueKind !== "improvement");
  if (candidates.length === 0) return { closed: 0 };

  const repo = await queries.getRepository(repositoryId);
  if (!repo || repo.provider !== "github" || !repo.owner || !repo.name)
    return { closed: 0 };
  const account = repo.teamId
    ? await queries.getGithubAccountByTeam(repo.teamId)
    : null;
  if (!account?.accessToken) return { closed: 0 };

  const baseUrl = (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.BETTER_AUTH_BASE_URL ||
    "http://localhost:3000"
  ).replace(/\/+$/, "");

  // One issue may back several step comparisons — close it once.
  const stepsByIssue = new Map<number, typeof candidates>();
  for (const s of candidates) {
    const n = s.githubIssueNumber!;
    stepsByIssue.set(n, [...(stepsByIssue.get(n) ?? []), s]);
  }

  let closed = 0;
  for (const [issueNumber, linkedSteps] of stepsByIssue) {
    // Flip the DB first so the issues-webhook fired by our own PATCH sees
    // state 'closed' and does not queue a redundant rerun.
    await Promise.all(
      linkedSteps.map((s) =>
        queries.updateStepComparisonIssueState(s.id, "closed"),
      ),
    );
    try {
      const headers = {
        Authorization: `Bearer ${account.accessToken}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      };
      const testNames = [
        ...new Set(linkedSteps.map((s) => s.stepLabel ?? s.testId)),
      ];
      await fetch(
        `https://api.github.com/repos/${repo.owner}/${repo.name}/issues/${issueNumber}/comments`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            body:
              `✅ Re-run came back **safe_to_merge** — closing.\n\n` +
              `Verified green: ${testNames.map((n) => `\`${n}\``).join(", ")}\n\n` +
              `👉 [Green build in Lastest](${baseUrl}/builds/${buildId})`,
          }),
        },
      );
      const res = await fetch(
        `https://api.github.com/repos/${repo.owner}/${repo.name}/issues/${issueNumber}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({ state: "closed", state_reason: "completed" }),
        },
      );
      if (res.ok) {
        closed++;
      } else {
        // GitHub rejected the close (revoked token, issue deleted…) — restore
        // the link state so the next green build retries instead of orphaning
        // an open issue that Lastest believes is closed.
        const text = await res.text().catch(() => "");
        console.error(
          `[confirm-on-green] failed to close #${issueNumber} on ${repo.fullName}: ${res.status} ${text.slice(0, 200)}`,
        );
        await Promise.all(
          linkedSteps.map((s) =>
            queries.updateStepComparisonIssueState(
              s.id,
              s.githubIssueState ?? "open",
            ),
          ),
        );
      }
    } catch (err) {
      console.error(
        `[confirm-on-green] error closing #${issueNumber} on ${repo.fullName}:`,
        err,
      );
      await Promise.all(
        linkedSteps.map((s) =>
          queries.updateStepComparisonIssueState(
            s.id,
            s.githubIssueState ?? "open",
          ),
        ),
      );
    }
  }
  return { closed };
}
