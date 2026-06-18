import * as queries from "@/lib/db/queries";
import {
  findAffectedTests,
  type AffectedTest,
} from "@/lib/smart-selection/file-matcher";
import { createAndRunBuildCore } from "@/server/actions/builds";
import { compareBranches } from "@/lib/github/content";
import type { BuildStatus } from "@/lib/db/schema";

export interface ValidateDiffOptions {
  repositoryId: string;
  /** Unified git diff text. Changed file paths are extracted from the headers. */
  diff?: string;
  /** Base ref for compareBranches (GitHub repos) when no diff text is given. */
  baseBranch?: string;
  /** Head ref for compareBranches (GitHub repos). */
  headBranch?: string;
  /** Block until the scoped build finishes (default true). */
  wait?: boolean;
  /** Cap on how long to block when `wait` is true. */
  maxWaitMs?: number;
}

export type ValidateDiffVerdict = "pass" | "fail" | "review_required";

export interface ValidateDiffResult {
  status: ValidateDiffVerdict | "build_running" | "no_affected_tests";
  summary: string;
  buildId?: string;
  changedFiles: string[];
  affectedTests: AffectedTest[];
  scopedTestIds: string[];
  verdict?: ValidateDiffVerdict;
  verdictCounts?: { green: number; yellow: number; red: number };
  failingTests?: Array<{ testId: string; name: string; error: string | null }>;
  pendingVisualDiffs?: number;
  changeMap?: unknown;
}

const POLL_INTERVAL_MS = 2500;
const DEFAULT_MAX_WAIT_MS = 5 * 60_000;

/**
 * Request-safe ceiling for the synchronous wait when validate-diff is invoked
 * over HTTP (v1 route / MCP). Beyond this the handler returns a `build_running`
 * verdict + buildId for the caller to poll, rather than holding the connection
 * open past typical proxy/ingress timeouts.
 */
export const VALIDATE_DIFF_REQUEST_MAX_WAIT_MS = 90_000;

/**
 * Extract changed file paths from a unified git diff. Handles `diff --git`
 * headers plus `+++ b/` / `--- a/` lines, strips a/ b/ prefixes, and ignores
 * /dev/null (added/removed sentinels).
 */
export function parseChangedFilesFromDiff(diff: string): string[] {
  const files = new Set<string>();
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const m = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      if (m) {
        files.add(m[1]);
        files.add(m[2]);
      }
    } else if (line.startsWith("+++ ") || line.startsWith("--- ")) {
      const raw = line.slice(4).trim();
      if (raw && raw !== "/dev/null") {
        files.add(raw.replace(/^[ab]\//, ""));
      }
    }
  }
  return [...files];
}

function verdictFromBuildStatus(status: BuildStatus): ValidateDiffVerdict {
  if (status === "safe_to_merge") return "pass";
  if (status === "executor_failed" || status === "blocked") return "fail";
  return "review_required";
}

/**
 * Diff-scoped validation: map a code change → affected tests → run only those →
 * return a structured verdict. The composable core behind `lastest_validate_diff`.
 *
 * SECURITY: this module is intentionally NOT a `"use server"` boundary, so
 * `validateDiffCore` is never directly reachable from the client/network. Every
 * entry point authenticates and authorizes the `repositoryId` before calling in:
 *   - `POST /api/v1/validate-diff` runs `verifyAuth` + `verifyRepoOwnership`
 *     (401/404) before invoking this (see src/app/api/v1/[...slug]/route.ts).
 *   - `validateDiffAction` (server action) runs `requireRepoAccess` first
 *     (see src/server/actions/api-tests.ts).
 * Keep that invariant: any new caller MUST establish repo ownership first.
 */
export async function validateDiffCore(
  opts: ValidateDiffOptions,
): Promise<ValidateDiffResult> {
  const { repositoryId } = opts;
  const wait = opts.wait !== false;
  const maxWaitMs =
    opts.maxWaitMs && opts.maxWaitMs > 0 ? opts.maxWaitMs : DEFAULT_MAX_WAIT_MS;

  // 1. Resolve changed file paths — from the supplied diff text, or by comparing
  //    branches on a GitHub-connected repo.
  let changedFiles: string[] = [];
  if (opts.diff && opts.diff.trim()) {
    changedFiles = parseChangedFilesFromDiff(opts.diff);
  } else if (opts.baseBranch && opts.headBranch) {
    const repo = await queries.getRepository(repositoryId);
    if (!repo || repo.provider !== "github" || !repo.teamId) {
      return {
        status: "no_affected_tests",
        summary:
          "Branch-range mode requires a GitHub-connected repo. Pass `diff` text for local repos.",
        changedFiles: [],
        affectedTests: [],
        scopedTestIds: [],
      };
    }
    const account = await queries.getGithubAccountByTeam(repo.teamId);
    if (account?.accessToken) {
      const compareResult = await compareBranches(
        account.accessToken,
        repo.owner,
        repo.name,
        opts.baseBranch,
        opts.headBranch,
      ).catch(() => null);
      changedFiles = (compareResult?.files ?? [])
        .filter((f) =>
          ["added", "modified", "removed", "renamed", "changed"].includes(
            f.status,
          ),
        )
        .map((f) => f.filename);
    }
  }

  if (changedFiles.length === 0) {
    return {
      status: "no_affected_tests",
      summary: "No changed files could be resolved from the diff/branch range.",
      changedFiles: [],
      affectedTests: [],
      scopedTestIds: [],
    };
  }

  // 2. Map changed files → affected tests.
  const affectedTests = await findAffectedTests(changedFiles, repositoryId);
  const scopedTestIds = [...new Set(affectedTests.map((t) => t.testId))];

  if (scopedTestIds.length === 0) {
    return {
      status: "no_affected_tests",
      summary: `${changedFiles.length} file(s) changed but no tests mapped to them. Consider a full run if the change is high-risk.`,
      changedFiles,
      affectedTests,
      scopedTestIds: [],
    };
  }

  // 3. Run just the affected tests. If the runner pool is busy the build is
  //    queued (buildId null) — surface that so the agent retries/polls.
  const run = await createAndRunBuildCore(
    "manual",
    scopedTestIds,
    repositoryId,
  );
  if (!run.buildId) {
    return {
      status: "build_running",
      summary: `Scoped build for ${scopedTestIds.length} affected test(s) was queued (runner busy). Re-run lastest_validate_diff shortly or check active jobs.`,
      changedFiles,
      affectedTests,
      scopedTestIds,
    };
  }
  const buildId = run.buildId;

  // 4. Optionally wait for completion, then assemble the verdict.
  if (!wait) {
    return {
      status: "build_running",
      summary: `Scoped build started for ${scopedTestIds.length} affected test(s). Poll lastest_get_build_status with buildId ${buildId}.`,
      buildId,
      changedFiles,
      affectedTests,
      scopedTestIds,
    };
  }

  const deadline = Date.now() + maxWaitMs;
  let build = await queries.getBuild(buildId);
  while (build && !build.completedAt && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    build = await queries.getBuild(buildId);
  }

  if (!build || !build.completedAt) {
    return {
      status: "build_running",
      summary: `Scoped build ${buildId} did not finish within ${Math.round(maxWaitMs / 1000)}s. Poll lastest_get_build_status to continue.`,
      buildId,
      changedFiles,
      affectedTests,
      scopedTestIds,
    };
  }

  const [counts, diffs, changeMap, results] = await Promise.all([
    queries.countStepComparisonVerdicts(buildId),
    queries.getVisualDiffsByBuild(buildId),
    queries.getBuildChangeMap(buildId).catch(() => null),
    build.testRunId
      ? queries.getTestResultsByRun(build.testRunId)
      : Promise.resolve([]),
  ]);

  const verdict = verdictFromBuildStatus(build.overallStatus as BuildStatus);
  const failingResults = results.filter((r) => r.status === "failed");
  const failingTests = await Promise.all(
    failingResults.map(async (r) => {
      const t = r.testId
        ? await queries.getTest(r.testId).catch(() => null)
        : null;
      return {
        testId: r.testId ?? "",
        name: t?.name ?? "(unknown test)",
        error: r.errorMessage ?? null,
      };
    }),
  );
  const pendingVisualDiffs = diffs.filter((d) => d.status === "pending").length;

  return {
    status: verdict,
    summary:
      verdict === "pass"
        ? `All ${scopedTestIds.length} affected test(s) passed.`
        : verdict === "fail"
          ? `${failingTests.length} of ${scopedTestIds.length} affected test(s) failed.`
          : `${scopedTestIds.length} affected test(s) ran — ${pendingVisualDiffs} change(s) need review.`,
    buildId,
    changedFiles,
    affectedTests,
    scopedTestIds,
    verdict,
    verdictCounts: counts,
    failingTests,
    pendingVisualDiffs,
    changeMap,
  };
}
