import type { BuildStatus } from '@/lib/db/schema';

export interface SlackBuildNotification {
  buildId: string;
  status: BuildStatus;
  totalTests: number;
  passedCount: number;
  changesDetected: number;
  flakyCount: number;
  failedCount: number;
  gitBranch: string;
  gitCommit: string;
  buildUrl: string;
}

/**
 * Send build completion notification to Slack via webhook
 */
export async function sendSlackNotification(
  webhookUrl: string,
  notification: SlackBuildNotification
): Promise<{ success: boolean; error?: string }> {
  const statusEmoji = getStatusEmoji(notification.status);
  const statusText = getStatusText(notification.status);

  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${statusEmoji} Visual Test Build ${statusText}`,
        emoji: true,
      },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Branch:*\n\`${notification.gitBranch}\``,
        },
        {
          type: 'mrkdwn',
          text: `*Commit:*\n\`${notification.gitCommit}\``,
        },
      ],
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Total Tests:*\n${notification.totalTests}`,
        },
        {
          type: 'mrkdwn',
          text: `*Passed:*\n${notification.passedCount}`,
        },
        {
          type: 'mrkdwn',
          text: `*Changes:*\n${notification.changesDetected}`,
        },
        {
          type: 'mrkdwn',
          text: `*Failed:*\n${notification.failedCount}`,
        },
      ],
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'View Build',
            emoji: true,
          },
          url: notification.buildUrl,
        },
      ],
    },
  ];

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `Visual Test Build ${statusText}: ${notification.passedCount}/${notification.totalTests} passed, ${notification.changesDetected} changes detected`,
        blocks,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: `Slack webhook failed: ${response.status} ${text}` };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error sending Slack notification',
    };
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
