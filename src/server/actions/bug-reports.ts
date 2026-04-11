'use server';

import crypto from 'crypto';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { STORAGE_DIRS } from '@/lib/storage/paths';
import * as queries from '@/lib/db/queries';
import { requireTeamAccess } from '@/lib/auth';
import type { BugReportContext, BugReportSeverity } from '@/lib/db/schema';
import { createGitHubIssue } from '@/lib/integrations/github-issues';
import { sendDiscordBugReport } from '@/lib/integrations/discord';

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export async function submitBugReport(data: {
  description: string;
  severity: BugReportSeverity;
  context: BugReportContext;
  screenshotBase64?: string | null;
}): Promise<{ success: boolean; reportId?: string; error?: string; forwardingErrors?: string[] }> {
  const session = await requireTeamAccess();

  // Rate limit
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
  const recentCount = await queries.countRecentBugReports(session.user.id, since);
  if (recentCount >= RATE_LIMIT_MAX) {
    return { success: false, error: 'Rate limit exceeded. Please try again later.' };
  }

  // Content hash for dedup
  const contentHash = crypto
    .createHash('sha256')
    .update(data.description.trim().toLowerCase())
    .digest('hex');

  const existing = await queries.getBugReportByHash(session.team.id, contentHash);
  if (existing) {
    return { success: false, error: 'A similar bug report has already been submitted.' };
  }

  // Save screenshot if provided
  let screenshotPath: string | null = null;
  const reportId = crypto.randomUUID();
  if (data.screenshotBase64) {
    const dir = STORAGE_DIRS['bug-reports'];
    await mkdir(dir, { recursive: true });
    const fileName = `${reportId}.png`;
    const filePath = path.join(dir, fileName);
    const buffer = Buffer.from(data.screenshotBase64, 'base64');
    await writeFile(filePath, buffer);
    screenshotPath = `/bug-reports/${fileName}`;
  }

  // Insert report
  await queries.createBugReport({
    id: reportId,
    teamId: session.team.id,
    reportedById: session.user.id,
    description: data.description,
    severity: data.severity,
    context: data.context,
    screenshotPath,
    contentHash,
  });

  // Build public screenshot URL from the request origin
  let screenshotUrl: string | null = null;
  if (screenshotPath) {
    try {
      const origin = new URL(data.context.url).origin;
      screenshotUrl = `${origin}${screenshotPath}`;
    } catch {}
  }

  // Await forwarding so failures are surfaced to the user
  let forwardingErrors: string[] = [];
  try {
    forwardingErrors = await forwardBugReport({
      reportId,
      description: data.description,
      severity: data.severity,
      reporterEmail: session.user.email,
      context: data.context,
      contentHash,
      screenshotUrl,
      screenshotBuffer: data.screenshotBase64 ? Buffer.from(data.screenshotBase64, 'base64') : null,
    });
  } catch (err) {
    console.error('[BugReport] forwarding failed:', err);
    forwardingErrors = ['Notification forwarding failed unexpectedly'];
  }

  return {
    success: true,
    reportId,
    ...(forwardingErrors.length > 0 ? { forwardingErrors } : {}),
  };
}

async function forwardBugReport(data: {
  reportId: string;
  description: string;
  severity: BugReportSeverity;
  reporterEmail: string;
  context: BugReportContext;
  contentHash: string;
  screenshotUrl: string | null;
  screenshotBuffer: Buffer | null;
}): Promise<string[]> {
  const errors: string[] = [];

  // GitHub Issues
  const githubToken = process.env.BUG_REPORT_GITHUB_TOKEN;
  const githubRepo = process.env.BUG_REPORT_GITHUB_REPO;
  if (githubToken && githubRepo) {
    const [owner, repo] = githubRepo.split('/');
    if (owner && repo) {
      try {
        const result = await createGitHubIssue(githubToken, owner, repo, {
          description: data.description,
          severity: data.severity,
          reporterEmail: data.reporterEmail,
          context: data.context,
          contentHash: data.contentHash,
          reportId: data.reportId,
          screenshotUrl: data.screenshotUrl,
        });
        if (result.success && result.issueUrl && result.issueNumber) {
          await queries.updateBugReport(data.reportId, {
            githubIssueUrl: result.issueUrl,
            githubIssueNumber: result.issueNumber,
          });
        } else if (!result.success) {
          errors.push(`GitHub: ${result.error ?? 'unknown error'}`);
        }
      } catch (err) {
        console.error('[BugReport] GitHub forwarding error:', err);
        errors.push(`GitHub: ${err instanceof Error ? err.message : 'unknown error'}`);
      }
    }
  }

  // Discord
  const discordWebhook = process.env.BUG_REPORT_DISCORD_WEBHOOK_URL;
  if (discordWebhook) {
    try {
      const result = await sendDiscordBugReport(discordWebhook, {
        description: data.description,
        severity: data.severity,
        reporterEmail: data.reporterEmail,
        url: data.context.url,
        appVersion: data.context.appVersion,
        gitHash: data.context.gitHash,
        reportId: data.reportId,
        screenshotBuffer: data.screenshotBuffer,
      });
      if (!result.success) {
        errors.push(`Discord: ${result.error ?? 'unknown error'}`);
      }
    } catch (err) {
      console.error('[BugReport] Discord forwarding error:', err);
      errors.push(`Discord: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }

  return errors;
}
