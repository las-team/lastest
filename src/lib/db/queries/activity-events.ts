import { db } from '../index';
import { activityEvents } from '../schema';
import type { NewActivityEvent, ActivityEvent } from '../schema';
import { eq, desc, and, lt, asc } from 'drizzle-orm';
import { emitActivityEvent, type ActivityFeedEvent } from '@/lib/ws/activity-events';

/**
 * Insert an activity event and broadcast it to live SSE listeners.
 */
export async function emitAndPersistActivityEvent(
  data: Omit<NewActivityEvent, 'id' | 'createdAt'>,
): Promise<ActivityEvent> {
  const now = new Date();
  const id = crypto.randomUUID();

  const [event] = await db
    .insert(activityEvents)
    .values({ ...data, id, createdAt: now })
    .returning();

  // Broadcast to in-memory listeners for SSE
  emitActivityEvent(event as ActivityFeedEvent);

  return event;
}

/**
 * Get events for a specific session (for replay).
 */
export async function getActivityEventsBySession(
  sessionId: string,
  limit = 500,
): Promise<ActivityEvent[]> {
  return db
    .select()
    .from(activityEvents)
    .where(eq(activityEvents.sessionId, sessionId))
    .orderBy(asc(activityEvents.createdAt))
    .limit(limit);
}

/**
 * Get recent activity events for a team (for live feed).
 */
export async function getRecentActivityEvents(
  teamId: string,
  opts: { limit?: number; cursor?: string; sourceType?: string } = {},
): Promise<ActivityEvent[]> {
  const { limit = 50, cursor, sourceType } = opts;

  const conditions = [eq(activityEvents.teamId, teamId)];

  if (sourceType) {
    conditions.push(eq(activityEvents.sourceType, sourceType as 'play_agent' | 'mcp_server'));
  }

  if (cursor) {
    // cursor is a createdAt ISO string
    conditions.push(lt(activityEvents.createdAt, new Date(cursor)));
  }

  return db
    .select()
    .from(activityEvents)
    .where(and(...conditions))
    .orderBy(desc(activityEvents.createdAt))
    .limit(limit);
}
