"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { stepComparisons } from "@/lib/db/schema";
import * as queries from "@/lib/db/queries";
import { requireRepoAccess, getCurrentSession } from "@/lib/auth";
import type {
  EvidenceLayer,
  StepIssueKind,
  StepIssueState,
  TriageCase,
  TriageGroup,
} from "@/lib/db/schema";
import {
  searchGitHubIssues,
  type GitHubIssueListItem,
} from "@/lib/integrations/github-issues";
import { buildVerifyCaseBody } from "@/lib/integrations/github-issue-body";
import { githubNotConnected } from "@/lib/verify/github-connection";

// Marker for "this repo isn't on GitHub", so the UI can render a disabled
// explanation instead of a raw error toast. Not exported: a `"use server"`
// module may only export async functions. The client component declares the
// same literal.
const NOT_GITHUB = "not_github";

interface IssueResult {
  ok: boolean;
  issueUrl?: string;
  issueNumber?: number;
  state?: StepIssueState;
  kind?: StepIssueKind;
  error?: string;
  code?: string;
}

// ---------------------------------------------------------------------------
// Resolution — group → build → testRun → repository
// ---------------------------------------------------------------------------

interface GroupContext {
  group: TriageGroup;
  repoId: string;
  repo: NonNullable<Awaited<ReturnType<typeof queries.getRepository>>>;
}

/**
 * Resolve the repo behind a triage group and assert access. Walks the same
 * chain `createIssueForCase` does (build → testRun → repositoryId) so the two
 * surfaces can never disagree about which repo a case belongs to.
 */
async function resolveGroup(
  triageGroupId: string,
  opts: { requireGithub?: boolean } = {},
): Promise<{ ctx?: GroupContext; error?: IssueResult }> {
  const group = await queries.getTriageGroup(triageGroupId);
  if (!group) return { error: { ok: false, error: "Triage group not found" } };

  const build = await queries.getBuild(group.buildId);
  if (!build) return { error: { ok: false, error: "Build not found" } };
  const testRun = build.testRunId
    ? await queries.getTestRun(build.testRunId)
    : null;
  const repoId = testRun?.repositoryId ?? null;
  if (!repoId) return { error: { ok: false, error: "No repository on build" } };
  await requireRepoAccess(repoId);

  const repo = await queries.getRepository(repoId);
  if (!repo) return { error: { ok: false, error: "Repository not found" } };
  if (opts.requireGithub && repo.provider !== "github") {
    return {
      error: {
        ok: false,
        code: NOT_GITHUB,
        error:
          "Group-level issue filing needs a GitHub repository. This repo is connected to a different provider.",
      },
    };
  }
  return { ctx: { group, repoId, repo } };
}

async function tokenFor(
  repo: GroupContext["repo"],
): Promise<{ token?: string; error?: IssueResult }> {
  const account = repo.teamId
    ? await queries.getGithubAccountByTeam(repo.teamId)
    : null;
  if (!account?.accessToken) return { error: githubNotConnected };
  return { token: account.accessToken };
}

function revalidateGroup(buildId: string) {
  revalidatePath(`/triage-agent/${buildId}`);
  revalidatePath(`/builds/${buildId}`);
}

// ---------------------------------------------------------------------------
// Body composition — the whole cluster, not one case
// ---------------------------------------------------------------------------

function fmtPct(n: string | number | null | undefined): string {
  if (n == null) return "—";
  return `${n}%`;
}

/**
 * Compose the aggregated issue body server-side.
 *
 * Layout:
 *   1. group headline + agent note + the reviewer's own note
 *   2. an explicit "covers N cases" line — the point of group-level filing
 *   3. a compact table of the member cases (test, step, browser, diff)
 *   4. the shared evidence the clustering fused (regions, browsers, changed
 *      files, high-signal layers, age)
 *   5. the standard per-case detail + env/branch/commit/resources footer that
 *      `buildVerifyCaseBody` already produces, for the representative case
 *
 * The client cannot see (5) — the real network/console/DOM drill lives in
 * `stepComparisons.layers` and `test_results` — which is why the body is
 * never composed browser-side.
 */
async function composeGroupBody(input: {
  group: TriageGroup;
  cases: TriageCase[];
  repo: GroupContext["repo"];
  reviewerNote: string | null;
  includedLayers: EvidenceLayer[] | null;
  reporterEmail: string | null;
}): Promise<{ title: string; body: string }> {
  const { group, cases, repo, reviewerNote, includedLayers } = input;

  const build = await queries.getBuild(group.buildId);
  const testRun = build?.testRunId
    ? await queries.getTestRun(build.testRunId)
    : null;
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.BETTER_AUTH_BASE_URL ||
    "http://localhost:3000";

  // Per-case rows. One diff/test read per case — clusters are small (the
  // agent caps them well under the build's case count).
  const rows = await Promise.all(
    cases.map(async (c) => {
      const test = await queries.getTest(c.testId);
      const diff = c.visualDiffId
        ? ((await queries.getVisualDiff(c.visualDiffId)) ?? null)
        : null;
      const result = c.testResultId
        ? ((await queries.getTestResultById(c.testResultId)) ?? null)
        : null;
      return {
        case: c,
        testName: test?.name ?? c.testId,
        stepLabel: c.stepLabel,
        browser: diff?.browser ?? result?.browser ?? null,
        pct: diff?.percentageDifference ?? null,
        pixels: diff?.pixelDifference ?? null,
      };
    }),
  );

  const lines: string[] = [];
  lines.push(`## ${group.headline}`);
  lines.push("");
  if (group.note.trim()) {
    lines.push(group.note.trim());
    lines.push("");
  }
  lines.push(
    `**One issue for all ${cases.length} case${cases.length === 1 ? "" : "s"} in this cluster.** ` +
      `Triage grouped them under a single root cause (kind: \`${group.kind}\`, risk: \`${group.risk}\`, confidence: ${group.confidence}%).`,
  );
  lines.push("");

  if (reviewerNote) {
    lines.push("### Reviewer note");
    lines.push("");
    lines.push(reviewerNote);
    lines.push("");
  }

  if (rows.length > 0) {
    lines.push(`### Cases in this cluster (${rows.length})`);
    lines.push("");
    lines.push("| Test | Step | Browser | Diff | Status |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const r of rows) {
      const diffCell =
        r.pct != null
          ? `${fmtPct(r.pct)}${r.pixels != null ? ` (${r.pixels} px)` : ""}`
          : "—";
      lines.push(
        `| ${r.testName} | ${r.stepLabel ?? "—"} | ${r.browser ?? "—"} | ${diffCell} | ${r.case.status} |`,
      );
    }
    lines.push("");
  }

  const ev = group.evidence ?? {};
  const evidenceLines: string[] = [];
  if (ev.layers?.length)
    evidenceLines.push(`- **High-signal layers:** ${ev.layers.join(", ")}`);
  if (ev.browsers?.length)
    evidenceLines.push(`- **Browsers affected:** ${ev.browsers.join(", ")}`);
  if (ev.sharedRegions?.length) {
    const regions = ev.sharedRegions
      .slice(0, 6)
      .map((r) => `${r.width}×${r.height} at (${r.x}, ${r.y})`)
      .join("; ");
    evidenceLines.push(
      `- **Shared changed regions:** ${regions}${ev.sharedRegions.length > 6 ? ` … +${ev.sharedRegions.length - 6} more` : ""}`,
    );
  }
  if (ev.changedFiles?.length) {
    evidenceLines.push(
      `- **Suspected files:** ${ev.changedFiles.map((f) => `\`${f}\``).join(", ")}`,
    );
  }
  if (ev.age) evidenceLines.push(`- **Age:** ${ev.age}`);
  if (evidenceLines.length > 0) {
    lines.push("### Shared evidence");
    lines.push("");
    lines.push(...evidenceLines);
    lines.push("");
  }

  // Representative case: the first member with a step comparison (that's the
  // one carrying the full layer evidence). Its rendered detail also supplies
  // the standard env / branch / commit / resources footer.
  const rep = cases.find((c) => c.stepComparisonId) ?? cases[0] ?? null;
  const title = `[Triage] ${group.headline}`;

  if (rep?.stepComparisonId) {
    const [step] = await db
      .select()
      .from(stepComparisons)
      .where(eq(stepComparisons.id, rep.stepComparisonId));
    if (step) {
      const test = await queries.getTest(rep.testId);
      const area = test?.functionalAreaId
        ? await queries.getFunctionalArea(test.functionalAreaId)
        : null;
      const diff = step.visualDiffId
        ? ((await queries.getVisualDiff(step.visualDiffId)) ?? null)
        : null;
      const testResult = step.testResultId
        ? ((await queries.getTestResultById(step.testResultId)) ?? null)
        : null;
      const enriched = buildVerifyCaseBody({
        step,
        diff,
        test: test
          ? { id: test.id, name: test.name, targetUrl: test.targetUrl }
          : null,
        functionalAreaName: area?.name ?? null,
        build: { id: group.buildId },
        testRun: testRun
          ? { gitBranch: testRun.gitBranch, gitCommit: testRun.gitCommit }
          : null,
        testResult,
        repoFullName: repo.fullName,
        reporterEmail: input.reporterEmail,
        baseUrl,
        includedLayers,
        reviewerNote: null,
        titleHint: null,
      });
      lines.push("---");
      lines.push("");
      lines.push(
        `### Representative case — ${test?.name ?? rep.testId}${step.stepLabel ? ` · ${step.stepLabel}` : ""}`,
      );
      lines.push("");
      lines.push(enriched.body);
    }
  }

  const trimmed = baseUrl.replace(/\/+$/, "");
  lines.push("");
  lines.push(
    `[Open this cluster in Lastest](${trimmed}/triage-agent/${group.buildId}#${group.slug})`,
  );

  return { title, body: lines.join("\n") };
}

/** Mirrors `verify-issues.ts`: regression → bugfix, reviewer-chosen
 *  improvement → improvement, everything else → an ad-hoc verification file. */
function resolveKind(
  group: TriageGroup,
  explicit?: StepIssueKind,
): StepIssueKind {
  if (explicit) return explicit;
  if (group.suggestedVerdict === "improvement") return "improvement";
  if (group.kind === "regression" || group.suggestedVerdict === "bug")
    return "bugfix";
  return "verification";
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * File one GitHub issue covering an entire triage cluster and store the link
 * on the group row (`triage_groups.githubIssue*`, which mirrors the columns
 * on `stepComparisons`).
 */
export async function createIssueForTriageGroup(input: {
  triageGroupId: string;
  title?: string;
  reviewerNote?: string;
  includedLayers?: EvidenceLayer[];
  /** Override the derived typed-ticket kind (the reviewer picking
   *  "improvement" over the suggested "bugfix"). */
  kind?: StepIssueKind;
}): Promise<IssueResult> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "Not authenticated" };

  const resolved = await resolveGroup(input.triageGroupId, {
    requireGithub: true,
  });
  if (resolved.error) return resolved.error;
  const { group, repoId, repo } = resolved.ctx!;

  const auth = await tokenFor(repo);
  if (auth.error) return auth.error;

  const cases = await queries.getTriageCasesForGroup(group.id);
  const reviewerNote = input.reviewerNote?.trim() || null;

  const { title: derivedTitle, body } = await composeGroupBody({
    group,
    cases,
    repo,
    reviewerNote,
    includedLayers: input.includedLayers ?? null,
    reporterEmail: session.user?.email ?? null,
  });
  const title = input.title?.trim() || derivedTitle;

  const kind = resolveKind(group, input.kind);
  const labels = [
    "lastest",
    "triage",
    kind,
    ...(kind === "bugfix" ? ["regression"] : []),
  ];

  // Same auto-assignment the verify path uses (Settings → Notifications →
  // Issue Tracker), so a filed cluster is picked up without a dispatcher.
  const notif = await queries.getNotificationSettings(repoId);
  const assignees = notif.issueAssignee ? [notif.issueAssignee] : undefined;

  try {
    const response = await fetch(
      `https://api.github.com/repos/${repo.owner}/${repo.name}/issues`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth.token}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({ title, body, labels, assignees }),
      },
    );
    if (!response.ok) {
      const text = await response.text();
      // 410 = Issues disabled at the repo level; 404 = almost always a token
      // without issues:write (GitHub masks 403 as 404). Same wording as the
      // verify path so reviewers see one consistent instruction.
      if (response.status === 410) {
        return {
          ok: false,
          error: `Issues are disabled on ${repo.owner}/${repo.name}. Enable Issues in GitHub repo settings (Settings → Features → check "Issues").`,
        };
      }
      if (response.status === 404) {
        return {
          ok: false,
          error: `GitHub rejected the create-issue call with 404 for ${repo.owner}/${repo.name}. Verify the repo slug in Settings → Integrations → GitHub and that the connected token has the issues:write scope.`,
        };
      }
      return {
        ok: false,
        error: `GitHub API ${response.status}: ${text.slice(0, 200)}`,
      };
    }
    const issue = (await response.json()) as {
      html_url: string;
      number: number;
    };
    const state: StepIssueState = "auto";
    await queries.setTriageGroupIssue(group.id, {
      url: issue.html_url,
      number: issue.number,
      state,
      kind,
    });
    revalidateGroup(group.buildId);
    return {
      ok: true,
      issueUrl: issue.html_url,
      issueNumber: issue.number,
      state,
      kind,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "unknown" };
  }
}

/**
 * Attach an existing GitHub issue to a cluster. Records `state: "linked"` so
 * the chip reads differently from an auto-filed one — the same distinction
 * `linkIssueToCase` draws on the verify board.
 */
export async function linkIssueToTriageGroup(input: {
  triageGroupId: string;
  issueNumber: number;
}): Promise<IssueResult> {
  const resolved = await resolveGroup(input.triageGroupId, {
    requireGithub: true,
  });
  if (resolved.error) return resolved.error;
  const { group, repo } = resolved.ctx!;

  if (!Number.isInteger(input.issueNumber) || input.issueNumber <= 0) {
    return { ok: false, error: "Invalid issue number" };
  }
  const issueUrl = `https://github.com/${repo.owner}/${repo.name}/issues/${input.issueNumber}`;
  const kind = resolveKind(group);
  await queries.setTriageGroupIssue(group.id, {
    url: issueUrl,
    number: input.issueNumber,
    state: "linked",
    kind,
  });
  revalidateGroup(group.buildId);
  return {
    ok: true,
    issueUrl,
    issueNumber: input.issueNumber,
    state: "linked",
    kind,
  };
}

/**
 * Search the cluster's repo for existing issues. Backs the Browse tab of the
 * group issue dialog; slim rows (title + state + labels) for fast rendering.
 */
export async function searchIssuesForTriageGroup(
  triageGroupId: string,
  query: string,
): Promise<{
  ok: boolean;
  issues?: GitHubIssueListItem[];
  error?: string;
  code?: string;
}> {
  const resolved = await resolveGroup(triageGroupId, { requireGithub: true });
  if (resolved.error) return resolved.error;
  const { repo } = resolved.ctx!;

  const auth = await tokenFor(repo);
  if (auth.error) return auth.error;

  const result = await searchGitHubIssues(
    auth.token!,
    repo.owner,
    repo.name,
    query.trim() || undefined,
    "open",
  );
  if (!result.success) return { ok: false, error: result.error };
  return { ok: true, issues: result.issues };
}

/**
 * Drop the link without touching GitHub. The unlink half of the affordance
 * the verify chip offers.
 */
export async function unlinkIssueFromTriageGroup(
  triageGroupId: string,
): Promise<IssueResult> {
  const resolved = await resolveGroup(triageGroupId);
  if (resolved.error) return resolved.error;
  const { group } = resolved.ctx!;
  await queries.setTriageGroupIssue(group.id, {
    url: null,
    number: null,
    state: null,
    kind: null,
  });
  revalidateGroup(group.buildId);
  return { ok: true };
}

/** Close the linked issue on GitHub and mark the cluster's chip closed. */
export async function closeIssueForTriageGroup(
  triageGroupId: string,
): Promise<IssueResult> {
  const resolved = await resolveGroup(triageGroupId, { requireGithub: true });
  if (resolved.error) return resolved.error;
  const { group, repo } = resolved.ctx!;
  if (!group.githubIssueNumber) return { ok: false, error: "No issue linked" };

  const auth = await tokenFor(repo);
  if (auth.error) return auth.error;

  try {
    const response = await fetch(
      `https://api.github.com/repos/${repo.owner}/${repo.name}/issues/${group.githubIssueNumber}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${auth.token}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ state: "closed" }),
      },
    );
    if (!response.ok) {
      const text = await response.text();
      return {
        ok: false,
        error: `GitHub API ${response.status}: ${text.slice(0, 200)}`,
      };
    }
    await queries.setTriageGroupIssue(group.id, {
      url: group.githubIssueUrl,
      number: group.githubIssueNumber,
      state: "closed",
      kind: group.githubIssueKind,
    });
    revalidateGroup(group.buildId);
    return { ok: true, state: "closed" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "unknown" };
  }
}
