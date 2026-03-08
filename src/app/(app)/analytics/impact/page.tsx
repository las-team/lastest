import { ImpactTimelineClient } from '@/components/analytics/impact-timeline-client';
import { getCurrentSession } from '@/lib/auth';
import {
  getSelectedRepository,
  getIssueTimeline,
  getMergedPRs,
  getPRAuthors,
  getImpactSummary,
  getGithubAccountByTeam,
} from '@/lib/db/queries';
import { syncGithubIssues } from '@/lib/integrations/github-issues-sync';

export const dynamic = 'force-dynamic';

export default async function ImpactPage() {
  const session = await getCurrentSession();
  const teamId = session?.team?.id;
  const selectedRepo = teamId ? await getSelectedRepository(teamId) : null;

  let initialData = null;
  if (selectedRepo && teamId) {
    try {
      // Auto-sync issues if GitHub account is connected
      const githubAccount = await getGithubAccountByTeam(teamId);
      if (githubAccount) {
        try {
          await syncGithubIssues(selectedRepo.id, githubAccount.accessToken);
        } catch (syncError) {
          console.error('[impact] Issue sync failed:', syncError);
        }
      }

      const [timeline, mergedPRs, authors, summary] = await Promise.all([
        getIssueTimeline(selectedRepo.id),
        getMergedPRs(selectedRepo.id),
        getPRAuthors(selectedRepo.id),
        getImpactSummary(selectedRepo.id),
      ]);

      initialData = { timeline, mergedPRs, authors, summary };
    } catch (error) {
      console.error('[impact] Failed to load initial data:', error);
    }
  }

  return (
    <div className="flex flex-col h-full p-6">
      <ImpactTimelineClient
        repositoryId={selectedRepo?.id ?? null}
        initialData={initialData}
      />
    </div>
  );
}
