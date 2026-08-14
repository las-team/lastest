import type { BugReportContext, BugReportSeverity } from "@/lib/db/schema";

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
    case "high":
      return "🔴 High";
    case "medium":
      return "🟡 Medium";
    case "low":
      return "🔵 Low";
  }
}

function buildIssueBody(data: BugReportIssueData): string {
  const ctx = data.context;
  let body = `## Bug Report\n\n**Severity:** ${severityBadge(data.severity)}\n**Reporter:** ${data.reporterEmail}\n**Report ID:** \`${data.reportId}\`\n\n### Description\n\n${data.description}\n`;

  if (data.screenshotUrl) {
    body += `\n### Screenshot\n\n![Screenshot](${data.screenshotUrl})\n`;
  }

  if (ctx) {
    body += `\n### Environment\n\n| Field | Value |\n|-------|-------|\n| URL | ${ctx.url} |\n| Viewport | ${ctx.viewport.width}x${ctx.viewport.height} |\n| User Agent | ${ctx.userAgent} |\n| App Version | ${ctx.appVersion ?? "unknown"} |\n| Git Hash | \`${ctx.gitHash ?? "unknown"}\` |\n| Build Date | ${ctx.buildDate ?? "unknown"} |\n`;

    if (ctx.consoleErrors.length > 0) {
      body += `\n<details><summary>Console Errors (${ctx.consoleErrors.length})</summary>\n\n\`\`\`\n${ctx.consoleErrors.map((e) => `[${new Date(e.timestamp).toISOString()}] ${e.message}`).join("\n")}\n\`\`\`\n</details>\n`;
    }

    if (ctx.failedRequests.length > 0) {
      body += `\n<details><summary>Failed Requests (${ctx.failedRequests.length})</summary>\n\n| Method | URL | Status |\n|--------|-----|--------|\n${ctx.failedRequests.map((r) => `| ${r.method} | ${r.url} | ${r.status} |`).join("\n")}\n</details>\n`;
    }

    if (ctx.breadcrumbs.length > 0) {
      body += `\n<details><summary>Breadcrumbs (${ctx.breadcrumbs.length})</summary>\n\n${ctx.breadcrumbs.map((b) => `- \`${b.action}\` on \`${b.target}\` at ${new Date(b.timestamp).toISOString()}`).join("\n")}\n</details>\n`;
    }
  }

  if (data.contentHash) {
    body += `\n---\n_Content Hash: \`${data.contentHash}\`_\n`;
  }

  return body;
}

// ===== Visual diff issue submission =====
//
// The issue body is composed by `buildVisualDiffBody` in
// `@/lib/integrations/github-issue-body` (the shared enriched composer).
// The legacy thin composer that used to live here was removed — every
// Lastest-filed issue must carry the full snapshot evidence trail.

export async function createVisualDiffIssue(
  token: string,
  owner: string,
  repo: string,
  payload: {
    title: string;
    body: string;
    labels: string[];
    /** GitHub logins to auto-assign (e.g. the team's AI engineer bot).
     *  Invalid/non-collaborator logins are silently dropped by GitHub. */
    assignees?: string[];
  },
): Promise<{
  success: boolean;
  issueUrl?: string;
  issueNumber?: number;
  error?: string;
}> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify(payload),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      // 410 = Issues feature disabled on the repo. Translate to a one-line
      // actionable hint so the toast on the diff page tells the reviewer what
      // to do instead of dumping the raw JSON.
      if (response.status === 410) {
        return {
          success: false,
          error: `Issues are disabled on ${owner}/${repo}. Enable Issues in GitHub repo settings (Settings → Features → check "Issues"), or pick a different repo in Lastest Settings → Integrations → GitHub.`,
        };
      }
      return {
        success: false,
        error: `GitHub API error: ${response.status} ${text}`,
      };
    }

    const issue = (await response.json()) as {
      html_url: string;
      number: number;
    };
    return {
      success: true,
      issueUrl: issue.html_url,
      issueNumber: issue.number,
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown error creating GitHub issue",
    };
  }
}

export async function createGitHubIssue(
  token: string,
  owner: string,
  repo: string,
  data: BugReportIssueData,
): Promise<{
  success: boolean;
  issueUrl?: string;
  issueNumber?: number;
  error?: string;
}> {
  const body = buildIssueBody(data);
  const labels = ["bug", "user-reported", `priority:${data.severity}`];

  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({
          title: `[Bug Report] ${data.description.slice(0, 80)}${data.description.length > 80 ? "..." : ""}`,
          body,
          labels,
        }),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      if (response.status === 410) {
        return {
          success: false,
          error: `Issues are disabled on ${owner}/${repo}. Enable Issues in GitHub repo settings (Settings → Features → check "Issues"), or pick a different repo in Lastest Settings → Integrations → GitHub.`,
        };
      }
      return {
        success: false,
        error: `GitHub API error: ${response.status} ${text}`,
      };
    }

    const issue = (await response.json()) as {
      html_url: string;
      number: number;
    };
    return {
      success: true,
      issueUrl: issue.html_url,
      issueNumber: issue.number,
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown error creating GitHub issue",
    };
  }
}

export interface GitHubIssueListItem {
  number: number;
  title: string;
  state: "open" | "closed";
  url: string;
  labels: string[];
  updatedAt: string;
}

export interface GitHubIssueDetail extends GitHubIssueListItem {
  body: string;
}

/** Fetch full title + body + state for a single issue. Used by the verify
 *  IntentPanel to render the linked issue description inline. */
export async function getGitHubIssueDetail(
  token: string,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<{ success: boolean; issue?: GitHubIssueDetail; error?: string }> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
    if (!response.ok) {
      const text = await response.text();
      return {
        success: false,
        error: `GitHub API ${response.status}: ${text.slice(0, 200)}`,
      };
    }
    const i = (await response.json()) as {
      number: number;
      title: string;
      state: string;
      html_url: string;
      body: string | null;
      labels: Array<string | { name: string }>;
      updated_at: string;
    };
    return {
      success: true,
      issue: {
        number: i.number,
        title: i.title,
        state: i.state === "closed" ? "closed" : "open",
        url: i.html_url,
        labels: i.labels.map((l) => (typeof l === "string" ? l : l.name)),
        updatedAt: i.updated_at,
        body: i.body ?? "",
      },
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Unknown error fetching issue",
    };
  }
}

/**
 * List recent issues on a repo, optionally filtered by free-text. Used by the
 * Verify "Browse issues" picker. Pull-requests are filtered out since the
 * GitHub /issues endpoint mixes them in by default.
 */
export async function searchGitHubIssues(
  token: string,
  owner: string,
  repo: string,
  query?: string,
  state: "open" | "closed" | "all" = "open",
): Promise<{
  success: boolean;
  issues?: GitHubIssueListItem[];
  error?: string;
}> {
  try {
    const url =
      query && query.trim().length > 0
        ? `https://api.github.com/search/issues?q=${encodeURIComponent(`repo:${owner}/${repo} is:issue ${query} state:${state === "all" ? "open" : state}`)}&per_page=20`
        : `https://api.github.com/repos/${owner}/${repo}/issues?state=${state}&per_page=20&sort=updated&direction=desc`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!response.ok) {
      const text = await response.text();
      return {
        success: false,
        error: `GitHub API ${response.status}: ${text.slice(0, 200)}`,
      };
    }
    const data = (await response.json()) as
      | Array<{
          number: number;
          title: string;
          state: string;
          html_url: string;
          pull_request?: unknown;
          labels: Array<string | { name: string }>;
          updated_at: string;
        }>
      | {
          items: Array<{
            number: number;
            title: string;
            state: string;
            html_url: string;
            pull_request?: unknown;
            labels: Array<string | { name: string }>;
            updated_at: string;
          }>;
        };
    const items = Array.isArray(data) ? data : data.items;
    const issues: GitHubIssueListItem[] = items
      .filter((i) => !i.pull_request)
      .map((i) => ({
        number: i.number,
        title: i.title,
        state: i.state === "closed" ? "closed" : "open",
        url: i.html_url,
        labels: i.labels.map((l) => (typeof l === "string" ? l : l.name)),
        updatedAt: i.updated_at,
      }));
    return { success: true, issues };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
