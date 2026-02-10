import type { BuildStatus } from '@/lib/db/schema';

export interface PRCommentData {
  buildId: string;
  status: BuildStatus;
  totalTests: number;
  passedCount: number;
  changesDetected: number;
  flakyCount: number;
  failedCount: number;
  buildUrl: string;
  comparisonMode?: string | null;
  mainDriftCount?: number; // Number of tests that have drifted from main baseline
  branchAcceptedCount?: number; // Number of tests approved during branch lifecycle
}

/**
 * Post or update a PR comment with build results
 */
export async function postPRComment(
  accessToken: string,
  owner: string,
  repo: string,
  prNumber: number,
  data: PRCommentData
): Promise<{ success: boolean; commentId?: number; error?: string }> {
  const statusEmoji = getStatusEmoji(data.status);
  const statusText = getStatusText(data.status);

  const baselineCount = data.totalTests - (data.changesDetected + data.flakyCount + data.failedCount);
  const modeLabel = data.comparisonMode ? getComparisonModeLabel(data.comparisonMode) : '';

  let body = `## ${statusEmoji} Visual Test Results${modeLabel ? ` (${modeLabel})` : ''}

| Baseline | Branch Accepted | New Changes | Flaky | Failed |
|----------|-----------------|-------------|-------|--------|
| ${baselineCount} | ${data.branchAcceptedCount ?? 0} | ${data.changesDetected} | ${data.flakyCount} | ${data.failedCount} |`;

  if (data.mainDriftCount && data.mainDriftCount > 0) {
    body += `\n\n> **vs Main drift:** ${data.mainDriftCount} test${data.mainDriftCount !== 1 ? 's' : ''} have drifted from the main baseline`;
  }

  body += `\n\n[View Build](${data.buildUrl})\n\n---\n*Posted by Lastest Visual Regression*`;

  try {
    // First, try to find an existing comment from our bot
    const existingCommentId = await findExistingComment(accessToken, owner, repo, prNumber);

    if (existingCommentId) {
      // Update existing comment
      const response = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/issues/comments/${existingCommentId}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ body }),
        }
      );

      if (!response.ok) {
        const text = await response.text();
        return { success: false, error: `Failed to update PR comment: ${response.status} ${text}` };
      }

      return { success: true, commentId: existingCommentId };
    }

    // Create new comment
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body }),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: `Failed to post PR comment: ${response.status} ${text}` };
    }

    const result = await response.json();
    return { success: true, commentId: result.id };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error posting PR comment',
    };
  }
}

/**
 * Find an existing comment from our bot on a PR
 */
async function findExistingComment(
  accessToken: string,
  owner: string,
  repo: string,
  prNumber: number
): Promise<number | null> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github.v3+json',
        },
      }
    );

    if (!response.ok) return null;

    const comments = await response.json();
    const ourComment = comments.find((comment: { body: string; id: number }) =>
      comment.body.includes('*Posted by Lastest Visual Regression*')
    );

    return ourComment?.id || null;
  } catch {
    return null;
  }
}

function getStatusEmoji(status: BuildStatus): string {
  switch (status) {
    case 'safe_to_merge':
      return '✅';
    case 'review_required':
      return '⚠️';
    case 'blocked':
      return '❌';
    default:
      return '📋';
  }
}

function getStatusText(status: BuildStatus): string {
  switch (status) {
    case 'safe_to_merge':
      return 'Passed';
    case 'review_required':
      return 'Review Required';
    case 'blocked':
      return 'Blocked';
    default:
      return 'Complete';
  }
}

function getComparisonModeLabel(mode: string): string {
  switch (mode) {
    case 'vs_main': return 'vs Main';
    case 'vs_branch': return 'vs Branch';
    case 'vs_both': return 'vs Both';
    case 'vs_previous': return 'vs Previous';
    case 'vs_planned': return 'vs Design';
    default: return '';
  }
}
