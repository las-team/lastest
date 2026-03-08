'use server';

import { requireRepoAccess } from '@/lib/auth';
import * as queries from '@/lib/db/queries';
import { syncGithubIssues } from '@/lib/integrations/github-issues-sync';
import { revalidatePath } from 'next/cache';

export async function getImpactTimelineData(
  repositoryId: string,
  author?: string,
) {
  const session = await requireRepoAccess(repositoryId);

  // Auto-sync issues if GitHub account is connected
  const githubAccount = await queries.getGithubAccountByTeam(session.team.id);
  if (githubAccount) {
    try {
      await syncGithubIssues(repositoryId, githubAccount.accessToken);
    } catch (error) {
      console.error('[analytics] Failed to sync GitHub issues:', error);
    }
  }

  const [timeline, mergedPRs, authors, summary] = await Promise.all([
    queries.getIssueTimeline(repositoryId),
    queries.getMergedPRs(repositoryId, author),
    queries.getPRAuthors(repositoryId),
    queries.getImpactSummary(repositoryId, author),
  ]);

  return { timeline, mergedPRs, authors, summary };
}

export async function syncIssuesManual(repositoryId: string) {
  const session = await requireRepoAccess(repositoryId);

  const githubAccount = await queries.getGithubAccountByTeam(session.team.id);
  if (!githubAccount) {
    throw new Error('No GitHub account connected');
  }

  const result = await syncGithubIssues(repositoryId, githubAccount.accessToken, true);
  revalidatePath('/analytics/impact');
  return result;
}
