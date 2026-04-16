import { NextResponse } from 'next/server';
import * as queries from '@/lib/db/queries';
import { getCurrentSession } from '@/lib/auth';
import { cleanupStaleJobs } from '@/server/actions/jobs';
import { processPoolQueue } from '@/server/actions/embedded-sessions';
import { ensureSchedulerStarted } from '@/lib/scheduling/scheduler';
import type { BackgroundJob } from '@/lib/db/schema';

// Track last cleanup time to avoid running too frequently
let lastCleanupTime = 0;
const CLEANUP_INTERVAL_MS = 60000; // Run cleanup at most once per minute

export type JobWithChildren = BackgroundJob & {
  _children?: BackgroundJob[];
  _childSummary?: { total: number; completed: number; failed: number; running: number; pending: number };
};

export async function GET() {
  // Start the build scheduler if not already running
  ensureSchedulerStarted();

  const session = await getCurrentSession();
  if (!session?.team) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Periodically clean up stale jobs (5 min timeout) and reset stuck runners
  const now = Date.now();
  if (now - lastCleanupTime > CLEANUP_INTERVAL_MS) {
    lastCleanupTime = now;
    // Run cleanup + queue processing async - don't block the response
    cleanupStaleJobs(300000).catch(() => {});
    processPoolQueue().catch(() => {});
  }

  // Get team's repos to filter jobs
  const teamRepos = await queries.getRepositoriesByTeam(session.team.id);
  const teamRepoIds = new Set(teamRepos.map(r => r.id));

  const allJobs = await queries.getRecentBackgroundJobs(10000);
  const teamJobs = allJobs.filter(j => !j.repositoryId || teamRepoIds.has(j.repositoryId));

  // Batch-fetch children for active parent jobs (single query instead of N+1)
  const activeParentIds = teamJobs
    .filter(j => j.status === 'running' || j.status === 'pending')
    .map(j => j.id);
  const allChildren = await queries.getChildJobsByParentIds(activeParentIds);
  const childrenByParent = new Map<string, typeof allChildren>();
  for (const child of allChildren) {
    const parentId = child.parentJobId!;
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId)!.push(child);
  }

  const enrichedJobs: JobWithChildren[] = teamJobs.map((job) => {
    const children = childrenByParent.get(job.id);
    if (children && children.length > 0) {
      const summary = {
        total: children.length,
        completed: children.filter(c => c.status === 'completed').length,
        failed: children.filter(c => c.status === 'failed').length,
        running: children.filter(c => c.status === 'running').length,
        pending: children.filter(c => c.status === 'pending').length,
      };
      return { ...job, _children: children, _childSummary: summary };
    }
    return job;
  });

  return NextResponse.json(enrichedJobs);
}
