import type {
  AIDiffAnalysis,
  A11yViolation,
  BugReportContext,
  BugReportSeverity,
  Test,
  VisualDiff,
} from '@/lib/db/schema';

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

// ===== Visual diff issue submission =====

export interface VisualDiffIssueInput {
  diff: VisualDiff & { errorMessage?: string | null; a11yViolations?: A11yViolation[] | null; consoleErrors?: string[] | null };
  test: Pick<Test, 'name'> | null;
  functionalAreaName?: string | null;
  build: { id: string };
  branch: string | null;
  commit: string | null;
  repoFullName: string;
  reporterEmail: string;
  /** Absolute origin (no trailing slash), used to build links to /api/media + the diff page. */
  baseUrl: string;
}

function shortSha(sha: string | null | undefined): string {
  if (!sha) return 'unknown';
  return sha.length > 8 ? sha.slice(0, 8) : sha;
}

function mediaUrl(baseUrl: string, relativePath: string | null | undefined): string | null {
  if (!relativePath) return null;
  const clean = relativePath.replace(/^\/+/, '');
  return `${baseUrl.replace(/\/+$/, '')}/api/media/${clean}`;
}

export function buildVisualDiffIssue(input: VisualDiffIssueInput): { title: string; body: string; labels: string[] } {
  const { diff, test, functionalAreaName, build, branch, commit, repoFullName, reporterEmail, baseUrl } = input;
  const trimmedBase = baseUrl.replace(/\/+$/, '');
  const testName = test?.name || 'Visual diff';
  const pct = diff.percentageDifference ? `${diff.percentageDifference}%` : '0%';
  const classification = diff.classification || 'changed';

  const title = `Visual diff: ${testName}${diff.stepLabel ? ` — ${diff.stepLabel}` : ''} (${pct})`;

  const lines: string[] = [];
  lines.push('## Visual diff review');
  lines.push('');
  lines.push(`**Test:** ${testName}${functionalAreaName ? ` _(area: ${functionalAreaName})_` : ''}`);
  if (diff.stepLabel) lines.push(`**Step:** \`${diff.stepLabel}\``);
  lines.push(`**Classification:** \`${classification}\``);
  lines.push(`**Difference:** ${pct} (${diff.pixelDifference ?? 0} px)`);
  lines.push(`**Browser:** ${diff.browser || 'chromium'}`);
  lines.push(`**Reporter:** ${reporterEmail}`);
  lines.push('');
  lines.push('### Build context');
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('|-------|-------|');
  lines.push(`| Repo | \`${repoFullName}\` |`);
  lines.push(`| Build | \`${build.id}\` |`);
  lines.push(`| Branch | \`${branch ?? 'unknown'}\` |`);
  lines.push(`| Commit | \`${shortSha(commit)}\` |`);
  lines.push('');

  if (diff.errorMessage) {
    lines.push('### Error');
    lines.push('');
    lines.push('```');
    lines.push(diff.errorMessage.slice(0, 4000));
    lines.push('```');
    lines.push('');
  }

  if (diff.consoleErrors && diff.consoleErrors.length > 0) {
    lines.push(`<details><summary>Console errors (${diff.consoleErrors.length})</summary>`);
    lines.push('');
    lines.push('```');
    lines.push(diff.consoleErrors.slice(0, 20).join('\n'));
    lines.push('```');
    lines.push('</details>');
    lines.push('');
  }

  if (diff.a11yViolations && diff.a11yViolations.length > 0) {
    lines.push(`<details><summary>Accessibility violations (${diff.a11yViolations.length})</summary>`);
    lines.push('');
    for (const v of diff.a11yViolations.slice(0, 10)) {
      lines.push(`- **${v.id}** (${v.impact ?? 'unknown'}) — ${v.help ?? v.description ?? ''}`);
    }
    lines.push('</details>');
    lines.push('');
  }

  const aiText = diff.aiRecommendation || (diff.aiAnalysis as AIDiffAnalysis | null | undefined)?.summary;
  if (aiText) {
    lines.push('### AI analysis');
    lines.push('');
    if (diff.aiRecommendation) lines.push(`**Recommendation:** \`${diff.aiRecommendation}\``);
    const summary = (diff.aiAnalysis as AIDiffAnalysis | null | undefined)?.summary;
    if (summary) {
      lines.push('');
      lines.push(summary);
    }
    lines.push('');
  }

  const diffImg = mediaUrl(trimmedBase, diff.diffImagePath);
  const baseImg = mediaUrl(trimmedBase, diff.baselineImagePath);
  const currImg = mediaUrl(trimmedBase, diff.currentImagePath);
  if (diffImg || baseImg || currImg) {
    lines.push('### Screenshots');
    lines.push('');
    lines.push('_Login to Lastest required to view._');
    lines.push('');
    if (diffImg) lines.push(`- [Diff](${diffImg})`);
    if (baseImg) lines.push(`- [Baseline](${baseImg})`);
    if (currImg) lines.push(`- [Current](${currImg})`);
    lines.push('');
  }

  lines.push('---');
  lines.push(`👉 [Open in Lastest](${trimmedBase}/builds/${build.id}/diff/${diff.id})`);

  return {
    title,
    body: lines.join('\n'),
    labels: ['lastest', 'visual-diff'],
  };
}

export async function createVisualDiffIssue(
  token: string,
  owner: string,
  repo: string,
  payload: { title: string; body: string; labels: string[] },
): Promise<{ success: boolean; issueUrl?: string; issueNumber?: number; error?: string }> {
  try {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify(payload),
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

export interface GitHubIssueListItem {
  number: number;
  title: string;
  state: 'open' | 'closed';
  url: string;
  labels: string[];
  updatedAt: string;
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
  state: 'open' | 'closed' | 'all' = 'open',
): Promise<{ success: boolean; issues?: GitHubIssueListItem[]; error?: string }> {
  try {
    const url = query && query.trim().length > 0
      ? `https://api.github.com/search/issues?q=${encodeURIComponent(`repo:${owner}/${repo} is:issue ${query} state:${state === 'all' ? 'open' : state}`)}&per_page=20`
      : `https://api.github.com/repos/${owner}/${repo}/issues?state=${state}&per_page=20&sort=updated&direction=desc`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: `GitHub API ${response.status}: ${text.slice(0, 200)}` };
    }
    const data = await response.json() as
      | Array<{ number: number; title: string; state: string; html_url: string; pull_request?: unknown; labels: Array<string | { name: string }>; updated_at: string }>
      | { items: Array<{ number: number; title: string; state: string; html_url: string; pull_request?: unknown; labels: Array<string | { name: string }>; updated_at: string }> };
    const items = Array.isArray(data) ? data : data.items;
    const issues: GitHubIssueListItem[] = items
      .filter((i) => !i.pull_request)
      .map((i) => ({
        number: i.number,
        title: i.title,
        state: (i.state === 'closed' ? 'closed' : 'open'),
        url: i.html_url,
        labels: i.labels.map((l) => (typeof l === 'string' ? l : l.name)),
        updatedAt: i.updated_at,
      }));
    return { success: true, issues };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
