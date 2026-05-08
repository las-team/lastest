/**
 * Activity Feed History
 *
 * GET /api/activity-feed/history?sessionId={id}&limit=200
 * GET /api/activity-feed/history?limit=50&cursor={iso}&source={sourceType}
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/auth';
import { verifyBearerToken } from '@/lib/auth/api-key';
import { getActivityEventsBySession, getRecentActivityEvents } from '@/lib/db/queries';
import { db } from '@/lib/db';
import { activityEvents } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

async function verifyAuth(request: NextRequest) {
  const session = await getCurrentSession();
  if (session) return session;

  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return verifyBearerToken(authHeader.slice(7));
  }

  return null;
}

export async function GET(request: NextRequest) {
  const session = await verifyAuth(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const teamId = session.team?.id;
  if (!teamId) return NextResponse.json({ error: 'No team' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('sessionId');
  const limit = Math.min(Number(searchParams.get('limit') || '50'), 500);

  if (sessionId) {
    // Confirm the session belongs to the caller's team before returning its
    // events. Without this scope, any authenticated user could pass an
    // arbitrary sessionId and read another team's activity stream.
    const [scoped] = await db
      .select({ teamId: activityEvents.teamId })
      .from(activityEvents)
      .where(and(eq(activityEvents.sessionId, sessionId), eq(activityEvents.teamId, teamId)))
      .limit(1);
    if (!scoped) {
      return NextResponse.json({ events: [] });
    }
    const events = await getActivityEventsBySession(sessionId, limit);
    return NextResponse.json({ events });
  }

  const cursor = searchParams.get('cursor') || undefined;
  const sourceType = searchParams.get('source') || undefined;
  const events = await getRecentActivityEvents(teamId, { limit, cursor, sourceType });
  return NextResponse.json({ events });
}
