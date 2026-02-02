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

  const body = `## ${statusEmoji} Visual Test Results

| Status | Tests | Passed | Changes | Flaky | Failed |
|--------|-------|--------|---------|-------|--------|
| ${statusText} | ${data.totalTests} | ${data.passedCount} | ${data.changesDetected} | ${data.flakyCount} | ${data.failedCount} |

[View Build](${data.buildUrl})

---
*Posted by Lastest Visual Regression*`;

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
