import type { BuildStatus, BugReportSeverity } from "@/lib/db/schema";
import { assertSafeOutboundUrl } from "@/lib/security/outbound-url";

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
  notification: DiscordBuildNotification,
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
        name: "Branch",
        value: `\`${notification.gitBranch}\``,
        inline: true,
      },
      {
        name: "Commit",
        value: `\`${notification.gitCommit}\``,
        inline: true,
      },
      {
        name: "Total Tests",
        value: `${notification.totalTests}`,
        inline: true,
      },
      {
        name: "Passed",
        value: `${notification.passedCount}`,
        inline: true,
      },
      {
        name: "Failed",
        value: `${notification.failedCount}`,
        inline: true,
      },
      {
        name: "Changes",
        value: `${notification.changesDetected}`,
        inline: true,
      },
    ],
    timestamp: new Date().toISOString(),
  };

  try {
    await assertSafeOutboundUrl(webhookUrl);
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: `Visual Test Build ${statusText}: ${notification.passedCount}/${notification.totalTests} passed, ${notification.changesDetected} changes detected`,
        embeds: [embed],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return {
        success: false,
        error: `Discord webhook failed: ${response.status} ${text}`,
      };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown error sending Discord notification",
    };
  }
}

// Bug Report Notification

export interface DiscordBugReportNotification {
  description: string;
  severity: BugReportSeverity;
  reporterEmail: string;
  url: string;
  appVersion: string | null;
  gitHash: string | null;
  reportId: string;
  screenshotBuffer: Buffer | null;
}

function getBugSeverityColor(severity: BugReportSeverity): number {
  switch (severity) {
    case "high":
      return 0xef4444;
    case "medium":
      return 0xeab308;
    case "low":
      return 0x3b82f6;
  }
}

export async function sendDiscordBugReport(
  webhookUrl: string,
  notification: DiscordBugReportNotification,
): Promise<{ success: boolean; error?: string }> {
  const embed: Record<string, unknown> = {
    title: `🐛 Bug Report — ${notification.severity.toUpperCase()}`,
    color: getBugSeverityColor(notification.severity),
    fields: [
      { name: "Description", value: notification.description.slice(0, 1024) },
      { name: "Severity", value: notification.severity, inline: true },
      { name: "Reporter", value: notification.reporterEmail, inline: true },
      { name: "URL", value: notification.url, inline: false },
      {
        name: "Version",
        value: `${notification.appVersion ?? "?"} (${notification.gitHash ?? "?"})`,
        inline: true,
      },
      {
        name: "Report ID",
        value: `\`${notification.reportId}\``,
        inline: true,
      },
    ],
    timestamp: new Date().toISOString(),
  };

  if (notification.screenshotBuffer) {
    embed.image = { url: "attachment://screenshot.png" };
  }

  try {
    await assertSafeOutboundUrl(webhookUrl);
    let response: Response;

    if (notification.screenshotBuffer) {
      const payload = JSON.stringify({
        embeds: [embed],
        allowed_mentions: { parse: [] },
      });
      const buf = Buffer.isBuffer(notification.screenshotBuffer)
        ? notification.screenshotBuffer
        : Buffer.from(notification.screenshotBuffer);
      const file = new File([buf as unknown as BlobPart], "screenshot.png", {
        type: "image/png",
      });
      const formData = new FormData();
      formData.append("payload_json", payload);
      formData.append("files[0]", file);
      const url = webhookUrl.includes("?")
        ? `${webhookUrl}&wait=true`
        : `${webhookUrl}?wait=true`;
      response = await fetch(url, {
        method: "POST",
        body: formData,
      });
    } else {
      response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          embeds: [embed],
          allowed_mentions: { parse: [] },
        }),
      });
    }

    if (!response.ok) {
      const text = await response.text();
      console.error(
        "[BugReport] Discord webhook error:",
        response.status,
        text,
      );
      return {
        success: false,
        error: `Discord webhook failed: ${response.status} ${text}`,
      };
    }
    return { success: true };
  } catch (error) {
    console.error("[BugReport] Discord send error:", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown error sending Discord bug report",
    };
  }
}

// Public Share Notification (internal Lastest activity firehose)

export interface DiscordShareNotification {
  shareUrl: string;
  slug: string;
  targetDomain: string | null;
  repoName: string;
  publishedByEmail: string;
  teamName: string;
  scopedTestName?: string | null;
}

export async function sendDiscordShareNotification(
  webhookUrl: string,
  notification: DiscordShareNotification,
): Promise<{ success: boolean; error?: string }> {
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    { name: "Target", value: notification.targetDomain || "—", inline: true },
    { name: "Repo", value: notification.repoName, inline: true },
    { name: "Team", value: notification.teamName, inline: true },
  ];
  if (notification.scopedTestName) {
    fields.push({
      name: "Scoped test",
      value: notification.scopedTestName,
      inline: true,
    });
  }
  fields.push({
    name: "Slug",
    value: `\`${notification.slug}\``,
    inline: true,
  });

  const embed = {
    title: "🚀 Fresh share dropped in the wild",
    url: notification.shareUrl,
    description:
      "Someone just pinned a baseline to the public internet. Click before they change their mind.",
    color: 0x8b5cf6,
    fields,
    timestamp: new Date().toISOString(),
  };

  try {
    await assertSafeOutboundUrl(webhookUrl);
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [embed],
        allowed_mentions: { parse: [] },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return {
        success: false,
        error: `Discord webhook failed: ${response.status} ${text}`,
      };
    }
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown error sending Discord share notification",
    };
  }
}

function getStatusColor(status: BuildStatus): number {
  switch (status) {
    case "safe_to_merge":
      return 0x22c55e; // green-500
    case "review_required":
      return 0xeab308; // yellow-500
    case "blocked":
      return 0xef4444; // red-500
    default:
      return 0x6b7280; // gray-500
  }
}

function getStatusEmoji(status: BuildStatus): string {
  switch (status) {
    case "safe_to_merge":
      return "✅";
    case "review_required":
      return "⚠️";
    case "blocked":
      return "❌";
    default:
      return "📋";
  }
}

function getStatusText(status: BuildStatus): string {
  switch (status) {
    case "safe_to_merge":
      return "Passed";
    case "review_required":
      return "Review Required";
    case "blocked":
      return "Blocked";
    default:
      return "Complete";
  }
}
