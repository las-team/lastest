/**
 * Agent Sessions List
 *
 * GET /api/activity-feed/sessions — returns recent agent sessions (active first)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { agentSessions } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const teamId = session.team?.id;
  if (!teamId) return NextResponse.json({ error: 'No team' }, { status: 403 });

  // Get active/paused sessions first, then recent completed ones
  const sessions = await db
    .select({
      id: agentSessions.id,
      repositoryId: agentSessions.repositoryId,
      status: agentSessions.status,
      currentStepId: agentSessions.currentStepId,
      createdAt: agentSessions.createdAt,
      completedAt: agentSessions.completedAt,
    })
    .from(agentSessions)
    .where(eq(agentSessions.teamId, teamId))
    .orderBy(desc(agentSessions.createdAt))
    .limit(10);

  // Sort: active/paused first, then by recency
  const sorted = sessions.sort((a, b) => {
    const activeStatuses = ['active', 'paused'];
    const aActive = activeStatuses.includes(a.status);
    const bActive = activeStatuses.includes(b.status);
    if (aActive && !bActive) return -1;
    if (!aActive && bActive) return 1;
    return 0;
  });

  return NextResponse.json({ sessions: sorted });
}
