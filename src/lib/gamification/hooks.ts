/**
 * Gamification hooks that need to run inside the query layer (e.g. after a test
 * is created) but can't be imported from there at module-eval time because of
 * the cycle: queries → hooks → auth → queries.
 *
 * The query layer imports from this file via `await import(...)` to break the
 * cycle. Keep this module's public functions async and side-effect-only.
 */

import { db } from '@/lib/db';
import { tests } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getCurrentSession } from '@/lib/auth';
import { awardScore } from '@/server/actions/gamification';

/**
 * Called right after a new row is inserted into `tests`.
 *  - If the row already has a creator stamp (bot or user) supplied by the
 *    caller, attributes the award accordingly.
 *  - Otherwise, infers the creator from the current session and also stamps
 *    the row with `createdByUserId` so future scoring (regression/flake) can
 *    find the author.
 *  - Swallows all errors — gamification must never break a real flow.
 */
export async function onTestCreated(
  testId: string,
  data: { createdByUserId?: string | null; createdByBotId?: string | null },
): Promise<void> {
  try {
    // Case 1: caller already said this is a bot-authored test.
    if (data.createdByBotId) {
      const session = await getCurrentSession();
      if (!session?.team) return;
      await awardScore({
        teamId: session.team.id,
        kind: 'test_created',
        actor: { kind: 'bot', id: data.createdByBotId },
        sourceType: 'test',
        sourceId: testId,
      });
      return;
    }

    // Case 2: caller already stamped a user. (rare — most paths don't)
    if (data.createdByUserId) {
      const session = await getCurrentSession();
      if (!session?.team) return;
      await awardScore({
        teamId: session.team.id,
        kind: 'test_created',
        actor: { kind: 'user', id: data.createdByUserId },
        sourceType: 'test',
        sourceId: testId,
      });
      return;
    }

    // Case 3: infer from the current session and stamp the row.
    const session = await getCurrentSession();
    if (!session?.user || !session?.team) return;

    await db.update(tests).set({ createdByUserId: session.user.id }).where(eq(tests.id, testId));

    await awardScore({
      teamId: session.team.id,
      kind: 'test_created',
      actor: { kind: 'user', id: session.user.id },
      sourceType: 'test',
      sourceId: testId,
    });
  } catch (err) {
    console.error('[gamification] onTestCreated failed', err);
  }
}
