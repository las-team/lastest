import type { BuildStatus } from '@/lib/db/schema';

const DEFAULT_GITLAB_INSTANCE = process.env.GITLAB_INSTANCE_URL || 'https://gitlab.com';

export interface MRCommentData {
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
 * Post or update a MR note (comment) with build results
 */
export async function postMRComment(
  accessToken: string,
  projectId: number,
  mrIid: number,
  data: MRCommentData,
  instanceUrl?: string
): Promise<{ success: boolean; noteId?: number; error?: string }> {
  const baseUrl = instanceUrl || DEFAULT_GITLAB_INSTANCE;
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
    // First, try to find an existing note from our bot
    const existingNoteId = await findExistingNote(accessToken, projectId, mrIid, instanceUrl);

    if (existingNoteId) {
      // Update existing note
      const response = await fetch(
        `${baseUrl}/api/v4/projects/${projectId}/merge_requests/${mrIid}/notes/${existingNoteId}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ body }),
        }
      );

      if (!response.ok) {
        const text = await response.text();
        return { success: false, error: `Failed to update MR note: ${response.status} ${text}` };
      }

      return { success: true, noteId: existingNoteId };
    }

    // Create new note
    const response = await fetch(
      `${baseUrl}/api/v4/projects/${projectId}/merge_requests/${mrIid}/notes`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body }),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: `Failed to post MR note: ${response.status} ${text}` };
    }

    const result = await response.json();
    return { success: true, noteId: result.id };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error posting MR note',
    };
  }
}

/**
 * Find an existing note from our bot on a MR
 */
async function findExistingNote(
  accessToken: string,
  projectId: number,
  mrIid: number,
  instanceUrl?: string
): Promise<number | null> {
  const baseUrl = instanceUrl || DEFAULT_GITLAB_INSTANCE;

  try {
    const response = await fetch(
      `${baseUrl}/api/v4/projects/${projectId}/merge_requests/${mrIid}/notes`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!response.ok) return null;

    const notes = await response.json();
    const ourNote = notes.find((note: { body: string; id: number }) =>
      note.body.includes('*Posted by Lastest Visual Regression*')
    );

    return ourNote?.id || null;
  } catch {
    return null;
  }
}

function getStatusEmoji(status: BuildStatus): string {
  switch (status) {
    case 'safe_to_merge':
      return '\u2705'; // checkmark
    case 'review_required':
      return '\u26A0\uFE0F'; // warning
    case 'blocked':
      return '\u274C'; // x
    default:
      return '\uD83D\uDCCB'; // clipboard
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
