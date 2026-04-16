/**
 * SSE Endpoint for Background Job Events
 *
 * GET /api/jobs/events - Server-Sent Events stream for real-time job updates
 *
 * On connect: sends full snapshot of active jobs
 * Then streams individual job updates as they happen
 */

import { NextResponse } from 'next/server';
import * as queries from '@/lib/db/queries';
import { getCurrentSession } from '@/lib/auth';
import { subscribeToJobEvents, type JobEvent } from '@/lib/ws/job-events';
import { cleanupStaleJobs } from '@/server/actions/jobs';
import { processPoolQueue } from '@/server/actions/embedded-sessions';
import { ensureSchedulerStarted } from '@/lib/scheduling/scheduler';
import type { BackgroundJob } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

// Track last cleanup time (shared with /api/jobs/active)
let lastCleanupTime = 0;
const CLEANUP_INTERVAL_MS = 60000;

export type JobWithChildren = BackgroundJob & {
  _children?: BackgroundJob[];
  _childSummary?: { total: number; completed: number; failed: number; running: number; pending: number };
};

async function getEnrichedJobs(teamRepoIds: Set<string>): Promise<JobWithChildren[]> {
  const allJobs = await queries.getRecentBackgroundJobs(10000);
  const teamJobs = allJobs.filter(j => !j.repositoryId || teamRepoIds.has(j.repositoryId));

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

  return teamJobs.map((job) => {
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
}

export async function GET(request: Request) {
  ensureSchedulerStarted();

  const session = await getCurrentSession();
  if (!session?.team) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const teamId = session.team.id;
  const teamRepos = await queries.getRepositoriesByTeam(teamId);
  const teamRepoIds = new Set(teamRepos.map(r => r.id));

  // Run periodic cleanup
  const now = Date.now();
  if (now - lastCleanupTime > CLEANUP_INTERVAL_MS) {
    lastCleanupTime = now;
    cleanupStaleJobs(300000).catch(() => {});
    processPoolQueue().catch(() => {});
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      // Send initial snapshot of active jobs
      try {
        const jobs = await getEnrichedJobs(teamRepoIds);
        const snapshotData = { type: 'snapshot', jobs };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(snapshotData)}\n\n`));
      } catch (error) {
        console.error('[JobSSE] Failed to send snapshot:', error);
      }

      // Subscribe to job events
      unsubscribe = subscribeToJobEvents((event: JobEvent) => {
        // Filter by team — only send events for jobs in team's repos (or no repo)
        if (event.type === 'job:update' && event.repositoryId && !teamRepoIds.has(event.repositoryId)) {
          return;
        }

        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch (error) {
          console.error('[JobSSE] Failed to send event:', error);
        }
      });

      // Keepalive every 8 seconds (under Envoy's 10s idle timeout)
      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'));
        } catch {
          clearInterval(keepalive);
        }
      }, 8000);

      // Periodic cleanup while connected
      const cleanupTimer = setInterval(() => {
        const t = Date.now();
        if (t - lastCleanupTime > CLEANUP_INTERVAL_MS) {
          lastCleanupTime = t;
          cleanupStaleJobs(300000).catch(() => {});
          processPoolQueue().catch(() => {});
        }
      }, CLEANUP_INTERVAL_MS);

      request.signal.addEventListener('abort', () => {
        clearInterval(keepalive);
        clearInterval(cleanupTimer);
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
      });
    },
    cancel() {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
