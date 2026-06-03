/**
 * SSE Endpoint for Background Job Events
 *
 * GET /api/jobs/events - Server-Sent Events stream for real-time job updates
 *
 * On connect: sends full snapshot of active jobs
 * Then streams individual job updates as they happen
 *
 * Auth: cookie session (normal) or ?token= query param (SSE / EventSource
 * cannot send custom headers, so the client passes the raw session token
 * as a query param. The main app forwards it to the cloud-auth sub-zone
 * for verification — never validates against the DB directly.)
 */

import { NextRequest, NextResponse } from 'next/server';
import * as queries from '@/lib/db/queries';
import { getCurrentSession } from '@/lib/auth';
import { subscribeToJobEvents, type JobEvent } from '@/lib/ws/job-events';
import { cleanupStaleJobs } from '@/server/actions/jobs';
import { processPoolQueue } from '@/server/actions/embedded-sessions';
import { ensureSchedulerStarted } from '@/lib/scheduling/scheduler';
import type { BackgroundJob } from '@/lib/db/schema';

function getAuthZoneUrl(): string {
  return (process.env.AUTH_ZONE || "http://localhost:3001").replace(/\/$/, "");
}

/**
 * Verify a raw session token by forwarding it to the cloud-auth sub-zone.
 * The sub-zone's /api/auth/session expects cookies, so we pass the token
 * as a cookie header — same mechanism getCurrentSession uses internally.
 */
async function verifySessionToken(token: string) {
  try {
    const res = await fetch(`${getAuthZoneUrl()}/api/auth/session`, {
      headers: { cookie: `better-auth.session_token=${token}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.session) return null;

    const user = await queries.getUserById(data.session.user.id);
    if (!user) return null;
    const team = user.teamId ? await queries.getTeam(user.teamId) : null;
    return { user, sessionId: data.session.sessionId, team: team ?? null };
  } catch {
    return null;
  }
}

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
  // Only the team's own repo-bound jobs. Repo-less ("global") jobs have no
  // team binding on the row, so we deliberately drop them here instead of
  // broadcasting them to every team.
  const teamJobs = allJobs.filter(j => j.repositoryId !== null && teamRepoIds.has(j.repositoryId));

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

export async function GET(request: NextRequest) {
  ensureSchedulerStarted();

  // Accept session token via query param for SSE (EventSource can't send headers)
  const token = request.nextUrl.searchParams.get('token');
  let session = await getCurrentSession();

  // Fallback: if no cookie session, verify token via cloud-auth sub-zone
  if (!session && token) {
    session = await verifySessionToken(token);
  }

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
  let keepalive: ReturnType<typeof setInterval> | null = null;
  let cleanupTimer: ReturnType<typeof setInterval> | null = null;
  let lifetimeCap: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const teardown = () => {
    if (closed) return;
    closed = true;
    if (keepalive) { clearInterval(keepalive); keepalive = null; }
    if (cleanupTimer) { clearInterval(cleanupTimer); cleanupTimer = null; }
    if (lifetimeCap) { clearTimeout(lifetimeCap); lifetimeCap = null; }
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  };

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
        if (closed) return;
        // Filter by team — only send events for jobs in this team's repos.
        // Repo-less ("global") jobs are intentionally dropped here too, so
        // they don't leak across teams via the live stream. Both update
        // and delete events carry repositoryId so we can scope identically.
        if (!event.repositoryId || !teamRepoIds.has(event.repositoryId)) {
          return;
        }

        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch (error) {
          // Controller was closed underneath us — drop the listener now.
          teardown();
          if ((error as { code?: string })?.code !== 'ERR_INVALID_STATE') {
            console.error('[JobSSE] Failed to send event:', error);
          }
        }
      });

      // Keepalive every 5 seconds (under Envoy's 10s idle timeout AND under
      // any 30s intermediary idle limit; previous 8s was too close to bound).
      keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'));
        } catch {
          teardown();
        }
      }, 5000);

      // Periodic cleanup while connected
      cleanupTimer = setInterval(() => {
        const t = Date.now();
        if (t - lastCleanupTime > CLEANUP_INTERVAL_MS) {
          lastCleanupTime = t;
          cleanupStaleJobs(300000).catch(() => {});
          processPoolQueue().catch(() => {});
        }
      }, CLEANUP_INTERVAL_MS);

      // Cloudflare 524 prevention — close the stream at 90s so we never hit CF's
      // ~100s hard request timeout. Browser EventSource auto-reconnects on close,
      // so the user sees no interruption. Emit an explicit reconnect event for
      // any client that wants to log the cycle.
      lifetimeCap = setTimeout(() => {
        try {
          controller.enqueue(encoder.encode('event: reconnect\ndata: {"reason":"lifetime-cap"}\n\n'));
          controller.close();
        } catch {
          // already closed
        }
        teardown();
      }, 90_000);

      request.signal.addEventListener('abort', teardown);
    },
    cancel() {
      teardown();
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
