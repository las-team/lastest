import type { BuildStatus } from '@/lib/db/schema';

export interface DiscordBuildNotification {
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
 * Send build completion notification to Discord via webhook
 */
export async function sendDiscordNotification(
  webhookUrl: string,
  notification: DiscordBuildNotification
): Promise<{ success: boolean; error?: string }> {
  const color = getStatusColor(notification.status);
  const statusText = getStatusText(notification.status);
  const statusEmoji = getStatusEmoji(notification.status);

  const embed = {
    title: `${statusEmoji} Visual Test Build ${statusText}`,
    url: notification.buildUrl,
    color,
    fields: [
      {
        name: 'Branch',
        value: `\`${notification.gitBranch}\``,
        inline: true,
      },
      {
        name: 'Commit',
        value: `\`${notification.gitCommit}\``,
        inline: true,
      },
      {
        name: 'Total Tests',
        value: `${notification.totalTests}`,
        inline: true,
      },
      {
        name: 'Passed',
        value: `${notification.passedCount}`,
        inline: true,
      },
      {
        name: 'Failed',
        value: `${notification.failedCount}`,
        inline: true,
      },
      {
        name: 'Changes',
        value: `${notification.changesDetected}`,
        inline: true,
      },
    ],
    timestamp: new Date().toISOString(),
  };

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `Visual Test Build ${statusText}: ${notification.passedCount}/${notification.totalTests} passed, ${notification.changesDetected} changes detected`,
        embeds: [embed],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: `Discord webhook failed: ${response.status} ${text}` };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error sending Discord notification',
    };
  }
}

function getStatusColor(status: BuildStatus): number {
  switch (status) {
    case 'safe_to_merge':
      return 0x22c55e; // green-500
    case 'review_required':
      return 0xeab308; // yellow-500
    case 'blocked':
      return 0xef4444; // red-500
    default:
      return 0x6b7280; // gray-500
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
