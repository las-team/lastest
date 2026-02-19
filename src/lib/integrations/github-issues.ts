import type { BugReportContext, BugReportSeverity } from '@/lib/db/schema';

export interface BugReportIssueData {
  description: string;
  severity: BugReportSeverity;
  reporterEmail: string;
  context: BugReportContext | null;
  contentHash: string | null;
  reportId: string;
  screenshotUrl: string | null;
}

function severityBadge(severity: BugReportSeverity): string {
  switch (severity) {
    case 'high': return '🔴 High';
    case 'medium': return '🟡 Medium';
    case 'low': return '🔵 Low';
  }
}

function buildIssueBody(data: BugReportIssueData): string {
  const ctx = data.context;
  let body = `## Bug Report\n\n**Severity:** ${severityBadge(data.severity)}\n**Reporter:** ${data.reporterEmail}\n**Report ID:** \`${data.reportId}\`\n\n### Description\n\n${data.description}\n`;

  if (data.screenshotUrl) {
    body += `\n### Screenshot\n\n![Screenshot](${data.screenshotUrl})\n`;
  }

  if (ctx) {
    body += `\n### Environment\n\n| Field | Value |\n|-------|-------|\n| URL | ${ctx.url} |\n| Viewport | ${ctx.viewport.width}x${ctx.viewport.height} |\n| User Agent | ${ctx.userAgent} |\n| App Version | ${ctx.appVersion ?? 'unknown'} |\n| Git Hash | \`${ctx.gitHash ?? 'unknown'}\` |\n| Build Date | ${ctx.buildDate ?? 'unknown'} |\n`;

    if (ctx.consoleErrors.length > 0) {
      body += `\n<details><summary>Console Errors (${ctx.consoleErrors.length})</summary>\n\n\`\`\`\n${ctx.consoleErrors.map(e => `[${new Date(e.timestamp).toISOString()}] ${e.message}`).join('\n')}\n\`\`\`\n</details>\n`;
    }

    if (ctx.failedRequests.length > 0) {
      body += `\n<details><summary>Failed Requests (${ctx.failedRequests.length})</summary>\n\n| Method | URL | Status |\n|--------|-----|--------|\n${ctx.failedRequests.map(r => `| ${r.method} | ${r.url} | ${r.status} |`).join('\n')}\n</details>\n`;
    }

    if (ctx.breadcrumbs.length > 0) {
      body += `\n<details><summary>Breadcrumbs (${ctx.breadcrumbs.length})</summary>\n\n${ctx.breadcrumbs.map(b => `- \`${b.action}\` on \`${b.target}\` at ${new Date(b.timestamp).toISOString()}`).join('\n')}\n</details>\n`;
    }
  }

  if (data.contentHash) {
    body += `\n---\n_Content Hash: \`${data.contentHash}\`_\n`;
  }

  return body;
}

export async function createGitHubIssue(
  token: string,
  owner: string,
  repo: string,
  data: BugReportIssueData,
): Promise<{ success: boolean; issueUrl?: string; issueNumber?: number; error?: string }> {
  const body = buildIssueBody(data);
  const labels = ['bug', 'user-reported', `priority:${data.severity}`];

  try {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        title: `[Bug Report] ${data.description.slice(0, 80)}${data.description.length > 80 ? '...' : ''}`,
        body,
        labels,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: `GitHub API error: ${response.status} ${text}` };
    }

    const issue = await response.json() as { html_url: string; number: number };
    return { success: true, issueUrl: issue.html_url, issueNumber: issue.number };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error creating GitHub issue',
    };
  }
}
