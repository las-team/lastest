import { NextRequest, NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/auth';
import { verifyBearerToken } from '@/lib/auth/api-key';
import * as queries from '@/lib/db/queries';

async function verifyAuth(request: NextRequest) {
  const session = await getCurrentSession();
  if (session) return session;
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return verifyBearerToken(authHeader.slice(7));
  }
  return null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const session = await verifyAuth(request);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!session.team) {
    return NextResponse.json({ error: 'No team' }, { status: 403 });
  }

  const { jobId } = await params;
  const job = await queries.getBackgroundJob(jobId);
  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  // Repo-less jobs are allowed only if the job's metadata pins them to
  // the requesting team. URL Diff jobs (`type === 'url_diff'`) take this
  // path: `startUrlDiff` writes `metadata.teamId`. Repo-scoped jobs use
  // the standard repo→team check.
  if (!job.repositoryId) {
    const meta = (job.metadata ?? {}) as { teamId?: string };
    if (meta.teamId && meta.teamId === session.team.id) {
      return NextResponse.json(job);
    }
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const repo = await queries.getRepository(job.repositoryId);
  if (!repo || repo.teamId !== session.team.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json(job);
}
