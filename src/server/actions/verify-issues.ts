'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { stepComparisons } from '@/lib/db/schema';
import * as queries from '@/lib/db/queries';
import { requireRepoAccess, getCurrentSession } from '@/lib/auth';
import { eq } from 'drizzle-orm';
import type { EvidenceLayer, StepIssueKind, StepIssueState } from '@/lib/db/schema';
import { searchGitHubIssues, getGitHubIssueDetail, type GitHubIssueListItem, type GitHubIssueDetail } from '@/lib/integrations/github-issues';
import { decideLayer } from './layer-feedback';

interface CreateIssueInput {
  stepComparisonId: string;
  title?: string;
  body?: string;
  /** Whether the case is a regression (auto state) or manual link. */
  state?: 'auto' | 'open';
  /** Typed-ticket kind. Persisted on stepComparisons.githubIssueKind so the
   *  board can filter and the webhook can interpret close events correctly.
   *  Defaults to 'verification' for the legacy manual-file path. */
  kind?: StepIssueKind;
}

interface IssueResult {
  ok: boolean;
  issueUrl?: string;
  issueNumber?: number;
  state?: StepIssueState;
  error?: string;
}

/**
 * Create a GitHub issue for a verification case and store the link on the
 * step comparison row.
 */
export async function createIssueForCase(input: CreateIssueInput): Promise<IssueResult> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: 'Not authenticated' };

  const step = await getStep(input.stepComparisonId);
  if (!step) return { ok: false, error: 'Step not found' };

  const build = await queries.getBuild(step.buildId);
  if (!build) return { ok: false, error: 'Build not found' };
  const testRun = build.testRunId ? await queries.getTestRun(build.testRunId) : null;
  const repoId = testRun?.repositoryId ?? null;
  if (!repoId) return { ok: false, error: 'No repository on build' };
  await requireRepoAccess(repoId);

  const repo = await queries.getRepository(repoId);
  if (!repo || repo.provider !== 'github') {
    return { ok: false, error: 'Repository is not a GitHub repository' };
  }
  const account = repo.teamId ? await queries.getGithubAccountByTeam(repo.teamId) : null;
  if (!account?.accessToken) return { ok: false, error: 'GitHub not connected for this team' };

  const test = await queries.getTest(step.testId);
  const title = input.title ?? `[Verify] ${test?.name ?? 'case'} — ${step.stepLabel ?? 'step'}`;
  const body = input.body ?? buildIssueBody({
    reviewerNote: step.reviewerNote ?? null,
    branch: testRun?.gitBranch ?? null,
    commit: testRun?.gitCommit ?? null,
    buildId: build.id,
    testName: test?.name ?? null,
    stepLabel: step.stepLabel ?? null,
    verdict: step.verdict,
    evidence: step.evidence ?? [],
  });

  // Always tag with the typed kind so the webhook can match on close. Falls
  // back to verdict-based label so the legacy manual flow stays useful.
  const kind: StepIssueKind = input.kind ?? (step.verdict === 'red' ? 'bugfix' : 'verification');
  const labels = ['verify', kind, ...(kind === 'bugfix' ? ['regression'] : [])];

  try {
    const response = await fetch(
      `https://api.github.com/repos/${repo.owner}/${repo.name}/issues`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${account.accessToken}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({ title, body, labels }),
      }
    );
    if (!response.ok) {
      const text = await response.text();
      // A 404 from POST /repos/:o/:r/issues almost always means the token
      // lacks `issues:write` (GitHub returns 404 instead of 403 for
      // permission failures as a security measure). Probe a read endpoint
      // to tell the user whether the repo is reachable at all and surface
      // a more actionable hint than the raw GitHub body.
      if (response.status === 404) {
        const probe = await fetch(
          `https://api.github.com/repos/${repo.owner}/${repo.name}`,
          {
            headers: {
              Authorization: `Bearer ${account.accessToken}`,
              Accept: 'application/vnd.github.v3+json',
            },
          },
        );
        if (probe.status === 404) {
          return {
            ok: false,
            error: `GitHub couldn't find ${repo.owner}/${repo.name}. Verify the repo slug in Settings → Integrations → GitHub and that the connected account has access.`,
          };
        }
        if (probe.ok) {
          const meta = await probe.json().catch(() => null) as { has_issues?: boolean } | null;
          if (meta?.has_issues === false) {
            return {
              ok: false,
              error: `Issues are disabled on ${repo.owner}/${repo.name}. Enable Issues in the GitHub repo settings.`,
            };
          }
          return {
            ok: false,
            error: `GitHub rejected the create-issue call with 404. The connected token can read ${repo.owner}/${repo.name} but can't write issues — re-authorize the GitHub integration with the issues:write scope (or install the app with that permission).`,
          };
        }
      }
      return { ok: false, error: `GitHub API ${response.status}: ${text.slice(0, 200)}` };
    }
    const issue = (await response.json()) as { html_url: string; number: number };
    const state: StepIssueState = input.state ?? 'auto';
    await db
      .update(stepComparisons)
      .set({
        githubIssueUrl: issue.html_url,
        githubIssueNumber: issue.number,
        githubIssueState: state,
        githubIssueKind: kind,
      })
      .where(eq(stepComparisons.id, input.stepComparisonId));
    revalidatePath(`/verify/${step.buildId}`);
    return { ok: true, issueUrl: issue.html_url, issueNumber: issue.number, state };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown' };
  }
}

interface LinkIssueInput {
  stepComparisonId: string;
  /** GitHub issue URL like https://github.com/owner/repo/issues/123 */
  issueUrl: string;
}

export async function linkIssueToCase(input: LinkIssueInput): Promise<IssueResult> {
  const step = await getStep(input.stepComparisonId);
  if (!step) return { ok: false, error: 'Step not found' };

  const build = await queries.getBuild(step.buildId);
  const testRun = build?.testRunId ? await queries.getTestRun(build.testRunId) : null;
  const repoId = testRun?.repositoryId ?? null;
  if (!repoId) return { ok: false, error: 'No repository on build' };
  await requireRepoAccess(repoId);

  const match = input.issueUrl.match(/\/issues\/(\d+)(?:[/?#]|$)/);
  if (!match) return { ok: false, error: 'Could not parse issue number from URL' };
  const issueNumber = parseInt(match[1], 10);

  await db
    .update(stepComparisons)
    .set({ githubIssueUrl: input.issueUrl, githubIssueNumber: issueNumber, githubIssueState: 'linked' })
    .where(eq(stepComparisons.id, input.stepComparisonId));
  revalidatePath(`/verify/${step.buildId}`);
  return { ok: true, issueUrl: input.issueUrl, issueNumber, state: 'linked' };
}

export async function closeIssueForCase(stepComparisonId: string): Promise<IssueResult> {
  const step = await getStep(stepComparisonId);
  if (!step?.githubIssueNumber) return { ok: false, error: 'No issue linked' };

  const build = await queries.getBuild(step.buildId);
  const testRun = build?.testRunId ? await queries.getTestRun(build.testRunId) : null;
  const repoId = testRun?.repositoryId ?? null;
  if (!repoId) return { ok: false, error: 'No repository on build' };
  await requireRepoAccess(repoId);
  const repo = await queries.getRepository(repoId);
  if (!repo) return { ok: false, error: 'Repository not found' };
  const account = repo.teamId ? await queries.getGithubAccountByTeam(repo.teamId) : null;
  if (!account?.accessToken) return { ok: false, error: 'GitHub not connected for this team' };

  try {
    const response = await fetch(
      `https://api.github.com/repos/${repo.owner}/${repo.name}/issues/${step.githubIssueNumber}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${account.accessToken}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ state: 'closed' }),
      }
    );
    if (!response.ok) {
      const text = await response.text();
      return { ok: false, error: `GitHub API ${response.status}: ${text.slice(0, 200)}` };
    }
    await db
      .update(stepComparisons)
      .set({ githubIssueState: 'closed' })
      .where(eq(stepComparisons.id, stepComparisonId));
    revalidatePath(`/verify/${step.buildId}`);
    return { ok: true, state: 'closed' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown' };
  }
}

async function getStep(stepComparisonId: string) {
  const [row] = await db
    .select()
    .from(stepComparisons)
    .where(eq(stepComparisons.id, stepComparisonId));
  return row;
}

interface IssueBodyInput {
  reviewerNote: string | null;
  branch: string | null;
  commit: string | null;
  buildId: string;
  testName: string | null;
  stepLabel: string | null;
  verdict: string;
  evidence: Array<{ layer: string; signal: string; summary: string }>;
}

function buildIssueBody(input: IssueBodyInput): string {
  const lines: string[] = [];
  // Reviewer's note leads — that's the human framing of what's wrong.
  if (input.reviewerNote && input.reviewerNote.trim().length > 0) {
    lines.push(input.reviewerNote.trim(), '', '---', '');
  }
  lines.push(
    `**Branch:** \`${input.branch ?? 'unknown'}\`${input.commit ? ` @ \`${input.commit.slice(0, 7)}\`` : ''}`,
    `**Build:** \`${input.buildId.slice(0, 8)}\``,
    `**Test:** ${input.testName ?? 'unknown'}`,
    `**Step:** ${input.stepLabel ?? 'unspecified'}`,
    `**Verdict:** \`${input.verdict}\``,
    '',
    '## Evidence',
    '',
  );
  for (const e of input.evidence) {
    lines.push(`- **${e.layer}** (${e.signal}): ${e.summary}`);
  }
  lines.push('', '_Filed automatically by Lastest Verify_');
  return lines.join('\n');
}

/**
 * Search the case's repo for existing GitHub issues. Used by the Browse tab
 * of the issue picker dialog. Returns a slim list — no body, just titles +
 * state + labels — for fast rendering.
 */
export async function searchIssuesForCase(
  stepComparisonId: string,
  query?: string,
  state: 'open' | 'closed' | 'all' = 'open',
): Promise<{ ok: boolean; issues?: GitHubIssueListItem[]; error?: string }> {
  const step = await getStep(stepComparisonId);
  if (!step) return { ok: false, error: 'Step not found' };
  const build = await queries.getBuild(step.buildId);
  const testRun = build?.testRunId ? await queries.getTestRun(build.testRunId) : null;
  const repoId = testRun?.repositoryId ?? null;
  if (!repoId) return { ok: false, error: 'No repository on build' };
  await requireRepoAccess(repoId);
  const repo = await queries.getRepository(repoId);
  if (!repo || repo.provider !== 'github') return { ok: false, error: 'Not a GitHub repository' };
  const account = repo.teamId ? await queries.getGithubAccountByTeam(repo.teamId) : null;
  if (!account?.accessToken) return { ok: false, error: 'GitHub not connected for this team' };
  const result = await searchGitHubIssues(account.accessToken, repo.owner, repo.name, query, state);
  if (!result.success) return { ok: false, error: result.error };
  return { ok: true, issues: result.issues };
}

/**
 * Fetch the full title + body + state for the GitHub issue currently linked
 * to this case. Returns null if no issue is linked. Used by the verify
 * IntentPanel to render the issue description inline so reviewers don't have
 * to round-trip to GitHub for context.
 */
export async function fetchLinkedIssueForCase(
  stepComparisonId: string,
): Promise<{ ok: boolean; issue?: GitHubIssueDetail | null; error?: string }> {
  const step = await getStep(stepComparisonId);
  if (!step) return { ok: false, error: 'Step not found' };
  if (!step.githubIssueNumber) return { ok: true, issue: null };
  const build = await queries.getBuild(step.buildId);
  const testRun = build?.testRunId ? await queries.getTestRun(build.testRunId) : null;
  const repoId = testRun?.repositoryId ?? null;
  if (!repoId) return { ok: false, error: 'No repository on build' };
  await requireRepoAccess(repoId);
  const repo = await queries.getRepository(repoId);
  if (!repo || repo.provider !== 'github') return { ok: false, error: 'Not a GitHub repository' };
  const account = repo.teamId ? await queries.getGithubAccountByTeam(repo.teamId) : null;
  if (!account?.accessToken) return { ok: false, error: 'GitHub not connected for this team' };
  const result = await getGitHubIssueDetail(account.accessToken, repo.owner, repo.name, step.githubIssueNumber);
  if (!result.success) return { ok: false, error: result.error };
  return { ok: true, issue: result.issue ?? null };
}

// ---------------------------------------------------------------------------
// Typed-ticket confirmation (v1.14+)
// ---------------------------------------------------------------------------
//
// The verify board's three "settled" columns map to three reviewer verdicts:
//   - done        → close ticket (no regression, no gap)
//   - missed      → improvement ticket (intent gap — area's agent plan was wrong)
//   - regression  → bugfix ticket (code shipped broke something tracked)
//
// confirmCase is the single entry-point invoked by the board drop handler. It
// (1) records confirmedBy/confirmedAt on the step, (2) writes the matching
// per-layer feedback so deriveCaseStatus produces the right column on the
// next poll, and (3) creates/closes the GitHub issue with the typed kind.

export type ConfirmKind = 'done' | 'improvement' | 'regression';

export interface ConfirmCaseResult {
  ok: boolean;
  issueUrl?: string;
  issueNumber?: number;
  issueState?: StepIssueState;
  issueKind?: StepIssueKind;
  /** True if an issue was filed/closed as part of this confirmation. */
  ticketChanged: boolean;
  error?: string;
}

const KIND_TO_ISSUE: Record<ConfirmKind, StepIssueKind | null> = {
  done: null,
  improvement: 'improvement',
  regression: 'bugfix',
};

const KIND_TO_DECISION: Record<ConfirmKind, 'approved' | 'rejected' | 'snoozed'> = {
  done: 'approved',
  improvement: 'snoozed',
  regression: 'rejected',
};

export async function confirmCase(
  stepComparisonId: string,
  kind: ConfirmKind,
): Promise<ConfirmCaseResult> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, ticketChanged: false, error: 'Not authenticated' };
  const userId = session.user?.id ?? null;

  const step = await getStep(stepComparisonId);
  if (!step) return { ok: false, ticketChanged: false, error: 'Step not found' };

  const build = await queries.getBuild(step.buildId);
  if (!build) return { ok: false, ticketChanged: false, error: 'Build not found' };
  const testRun = build.testRunId ? await queries.getTestRun(build.testRunId) : null;
  const repoId = testRun?.repositoryId ?? null;
  if (repoId) await requireRepoAccess(repoId);

  // 1. Stamp the confirmation. Always overwrites — re-confirmation with a
  //    different kind reuses the same row (e.g. user changes mind from
  //    improvement → regression).
  await db
    .update(stepComparisons)
    .set({ confirmedBy: userId, confirmedAt: new Date() })
    .where(eq(stepComparisons.id, stepComparisonId));

  // 2. Mirror the decision into per-layer feedback so deriveCaseStatus
  //    pins the card to the right column even before the issue round-trip
  //    lands. Reuses the per-layer baseline / review-todo side effects
  //    that already power the existing approve/reject flow.
  const decision = KIND_TO_DECISION[kind];
  const evidenceLayers: EvidenceLayer[] = step.evidence.length > 0
    ? Array.from(new Set(step.evidence.map((e) => e.layer)))
    : ['visual'];
  await Promise.all(
    evidenceLayers.map((layer) =>
      decideLayer({
        stepComparisonId,
        buildId: step.buildId,
        layer,
        status: decision,
      }).catch(() => null),
    ),
  );

  // 3. Ticket lifecycle. The three kinds map to different GH actions:
  //    - regression  → file a bugfix issue (if not already linked)
  //    - improvement → file an improvement issue (if not already linked)
  //    - done        → close any linked issue (no-op if none)
  let ticketChanged = false;
  let issueUrl: string | undefined;
  let issueNumber: number | undefined;
  let issueState: StepIssueState | undefined;
  let issueKind: StepIssueKind | undefined;

  const targetKind = KIND_TO_ISSUE[kind];

  if (targetKind && !step.githubIssueNumber) {
    // No issue yet → file one of the correct kind.
    const result = await createIssueForCase({
      stepComparisonId,
      state: 'auto',
      kind: targetKind,
    });
    if (result.ok) {
      ticketChanged = true;
      issueUrl = result.issueUrl;
      issueNumber = result.issueNumber;
      issueState = result.state;
      issueKind = targetKind;
    }
    // Silent on failure — the confirmation itself still landed. The board
    // can surface the GH error via a follow-up "File ticket" affordance.
  } else if (targetKind && step.githubIssueNumber) {
    // Already linked — just retag the kind so the row is queryable.
    await db
      .update(stepComparisons)
      .set({ githubIssueKind: targetKind })
      .where(eq(stepComparisons.id, stepComparisonId));
    issueKind = targetKind;
  } else if (kind === 'done' && step.githubIssueNumber) {
    const result = await closeIssueForCase(stepComparisonId);
    if (result.ok) {
      ticketChanged = true;
      issueState = result.state;
    }
  }

  // 4. Activity event so the audit log + notifications fire. Best-effort.
  const eventTypeMap: Record<ConfirmKind, 'verify:case_confirmed' | 'verify:bugfix_filed' | 'verify:improvement_filed'> = {
    done: 'verify:case_confirmed',
    improvement: 'verify:improvement_filed',
    regression: 'verify:bugfix_filed',
  };
  const teamIdForEvent = session.team?.id;
  if (teamIdForEvent) {
    queries.emitAndPersistActivityEvent({
      teamId: teamIdForEvent,
      repositoryId: repoId,
      sourceType: 'mcp_server',
      eventType: eventTypeMap[kind],
      summary: `Verify case ${kind} — ${step.stepLabel ?? 'step'}`,
      detail: { stepComparisonId, buildId: step.buildId, kind, issueUrl, issueKind },
      artifactType: 'build',
      artifactId: step.buildId,
      artifactLabel: step.buildId.slice(0, 8),
    }).catch(() => {});
  }

  revalidatePath(`/verify/${step.buildId}`);
  return { ok: true, ticketChanged, issueUrl, issueNumber, issueState, issueKind };
}

/**
 * Save a reviewer note on a step comparison. Surfaces as the lead paragraph
 * of any issue subsequently created from this case.
 */
export async function setReviewerNote(stepComparisonId: string, note: string): Promise<{ ok: boolean; error?: string }> {
  const step = await getStep(stepComparisonId);
  if (!step) return { ok: false, error: 'Step not found' };
  const build = await queries.getBuild(step.buildId);
  if (!build) return { ok: false, error: 'Build not found' };
  const testRun = build.testRunId ? await queries.getTestRun(build.testRunId) : null;
  const repoId = testRun?.repositoryId ?? null;
  if (repoId) await requireRepoAccess(repoId);
  await db
    .update(stepComparisons)
    .set({ reviewerNote: note.trim().length === 0 ? null : note })
    .where(eq(stepComparisons.id, stepComparisonId));
  // No revalidatePath — typing a note shouldn't trigger a server re-render
  // mid-keystroke; the client owns the optimistic state.
  return { ok: true };
}
