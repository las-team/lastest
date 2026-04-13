/**
 * Activity Event Ingest Endpoint (for MCP server)
 *
 * POST /api/v1/activity — accepts activity events from external processes
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/auth';
import { verifyBearerToken } from '@/lib/auth/api-key';
import { emitAndPersistActivityEvent } from '@/lib/db/queries';
import type { ActivityEventType } from '@/lib/db/schema';

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

export async function POST(request: NextRequest) {
  const session = await verifyAuth(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const teamId = session.team?.id;
  if (!teamId) return NextResponse.json({ error: 'No team' }, { status: 403 });

  const body = await request.json();
  const {
    eventType,
    summary,
    detail,
    sessionId,
    repositoryId,
    artifactType,
    artifactId,
    artifactLabel,
    toolName,
    durationMs,
  } = body as {
    eventType: ActivityEventType;
    summary: string;
    detail?: Record<string, unknown>;
    sessionId?: string;
    repositoryId?: string;
    artifactType?: string;
    artifactId?: string;
    artifactLabel?: string;
    toolName?: string;
    durationMs?: number;
  };

  if (!eventType || !summary) {
    return NextResponse.json({ error: 'eventType and summary required' }, { status: 400 });
  }

  const event = await emitAndPersistActivityEvent({
    teamId,
    repositoryId: repositoryId || null,
    sessionId: sessionId || null,
    sourceType: 'mcp_server',
    eventType,
    summary,
    detail: detail ? { ...detail, toolName } : toolName ? { toolName } : null,
    artifactType: (artifactType as 'test' | 'build' | 'area' | 'baseline' | 'score') || null,
    artifactId: artifactId || null,
    artifactLabel: artifactLabel || null,
    durationMs: durationMs || null,
  });

  return NextResponse.json({ ok: true, eventId: event.id });
}
