import { NextResponse } from 'next/server';
import * as queries from '@/lib/db/queries';
import { getCurrentSession } from '@/lib/auth';
import { cleanupStaleJobs } from '@/server/actions/jobs';

// Track last cleanup time to avoid running too frequently
let lastCleanupTime = 0;
const CLEANUP_INTERVAL_MS = 60000; // Run cleanup at most once per minute

export async function GET() {
  const session = await getCurrentSession();
  if (!session?.team) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Periodically clean up stale jobs (5 min timeout) and reset stuck runners
  const now = Date.now();
  if (now - lastCleanupTime > CLEANUP_INTERVAL_MS) {
    lastCleanupTime = now;
    // Run cleanup async - don't block the response
    cleanupStaleJobs(300000).catch(() => {});
  }

  // Get team's repos to filter jobs
  const teamRepos = await queries.getRepositoriesByTeam(session.team.id);
  const teamRepoIds = new Set(teamRepos.map(r => r.id));

  const allJobs = await queries.getRecentBackgroundJobs(10000);
  const teamJobs = allJobs.filter(j => !j.repositoryId || teamRepoIds.has(j.repositoryId));

  return NextResponse.json(teamJobs);
}
