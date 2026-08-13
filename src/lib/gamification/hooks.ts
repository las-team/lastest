/**
 * The `tests` domain-notification listener.
 *
 * Was called *by* the query layer via `await import("@/lib/gamification/hooks")`
 * — core reaching into a feature, which §3 of the core/plugin RFC forbids and
 * which `pnpm arch` never counted because it walks plugin imports, not core's.
 * The dependency is now inverted: `src/lib/db/test-hooks.ts` declares the port,
 * `src/lib/core/runtime.ts` registers this function into it at boot, and
 * `createTest` just raises the event.
 *
 * Keep this module's public functions async and side-effect-only.
 */

import { db } from "@/lib/db";
import { tests } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentSession } from "@/lib/auth";
import type { TestCreatedEvent } from "@/lib/db/test-hooks";
import { awardScore, resolveBotIdByKind } from "@/server/actions/gamification";

/**
 * Called right after a new row is inserted into `tests`.
 *  - If the event carries a creator stamp (bot or user) supplied by the
 *    caller, attributes the award accordingly.
 *  - If it carries an *agent kind* instead, resolves that team's bot row and
 *    stamps `created_by_bot_id` before awarding. Callers that know which agent
 *    they are should use this rather than reading the bots table themselves.
 *  - Otherwise, infers the creator from the current session and also stamps
 *    the row with `createdByUserId` so future scoring (regression/flake) can
 *    find the author.
 *  - Swallows all errors — gamification must never break a real flow.
 */
export async function onTestCreated(event: TestCreatedEvent): Promise<void> {
  const { testId, createdByUserId, createdByBotId, createdByAgent } = event;
  try {
    // Case 1: caller already said this is a bot-authored test.
    if (createdByBotId) {
      const session = await getCurrentSession();
      if (!session?.team) return;
      await awardScore({
        teamId: session.team.id,
        kind: "test_created",
        actor: { kind: "bot", id: createdByBotId },
        sourceType: "test",
        sourceId: testId,
      });
      return;
    }

    // Case 2: caller named an agent kind. Resolve it to this team's bot row
    // and stamp the column the caller could not fill itself.
    if (createdByAgent) {
      const session = await getCurrentSession();
      if (!session?.team) return;
      const botId = await resolveBotIdByKind(session.team.id, createdByAgent);
      if (!botId) return;
      await db
        .update(tests)
        .set({ createdByBotId: botId })
        .where(eq(tests.id, testId));
      await awardScore({
        teamId: session.team.id,
        kind: "test_created",
        actor: { kind: "bot", id: botId },
        sourceType: "test",
        sourceId: testId,
      });
      return;
    }

    // Case 3: caller already stamped a user. (rare — most paths don't)
    if (createdByUserId) {
      const session = await getCurrentSession();
      if (!session?.team) return;
      await awardScore({
        teamId: session.team.id,
        kind: "test_created",
        actor: { kind: "user", id: createdByUserId },
        sourceType: "test",
        sourceId: testId,
      });
      return;
    }

    // Case 4: infer from the current session and stamp the row.
    const session = await getCurrentSession();
    if (!session?.user || !session?.team) return;

    await db
      .update(tests)
      .set({ createdByUserId: session.user.id })
      .where(eq(tests.id, testId));

    await awardScore({
      teamId: session.team.id,
      kind: "test_created",
      actor: { kind: "user", id: session.user.id },
      sourceType: "test",
      sourceId: testId,
    });
  } catch (err) {
    console.error("[gamification] onTestCreated failed", err);
  }
}
