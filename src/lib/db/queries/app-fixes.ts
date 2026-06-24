/**
 * App-fix suggestions — "Fix the app" loop (E5). One row per generated
 * suggestion; the latest for a (build, test) pair is surfaced to the agent.
 */

import { db } from "../index";
import { appFixSuggestions } from "../schema";
import type { AppFixSuggestion } from "../schema";
import { and, eq, desc } from "drizzle-orm";
import { v4 as uuid } from "uuid";

export async function insertAppFixSuggestion(
  buildId: string | null,
  testId: string,
  payload: AppFixSuggestion,
): Promise<string> {
  const id = uuid();
  await db.insert(appFixSuggestions).values({
    id,
    buildId,
    testId,
    payload,
    createdAt: new Date(),
  });
  return id;
}

export async function getLatestAppFixSuggestion(
  testId: string,
  buildId?: string | null,
): Promise<AppFixSuggestion | null> {
  const where = buildId
    ? and(
        eq(appFixSuggestions.testId, testId),
        eq(appFixSuggestions.buildId, buildId),
      )
    : eq(appFixSuggestions.testId, testId);
  const [row] = await db
    .select({ payload: appFixSuggestions.payload })
    .from(appFixSuggestions)
    .where(where)
    .orderBy(desc(appFixSuggestions.createdAt))
    .limit(1);
  return row?.payload ?? null;
}
