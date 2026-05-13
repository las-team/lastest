/**
 * Build-level demo notes — AI-generated UI/UX summary written at the end of
 * a /gtm-lastest-saas-demo run. One row per build; rendered on /r/<slug>.
 */

import { db } from '../index';
import { buildDemoNotes, builds, testRuns } from '../schema';
import type { DemoNotes } from '../schema';
import { eq, desc } from 'drizzle-orm';

export async function getBuildDemoNotes(buildId: string): Promise<DemoNotes | null> {
  const [row] = await db
    .select()
    .from(buildDemoNotes)
    .where(eq(buildDemoNotes.buildId, buildId));
  return row?.payload ?? null;
}

/**
 * Latest demo-notes payload for any build in `repositoryId`, regardless of
 * which build the share is pinned to. Lets a /gtm-lastest-saas-demo re-run
 * surface its fresh UI/UX summary on every existing share for the same
 * target site without re-creating shares. Joins via builds → test_runs so
 * we can filter on the repo even though `build_demo_notes` itself only
 * keys on buildId.
 */
export async function getLatestDemoNotesForRepo(
  repositoryId: string,
): Promise<DemoNotes | null> {
  const [row] = await db
    .select({ payload: buildDemoNotes.payload })
    .from(buildDemoNotes)
    .innerJoin(builds, eq(builds.id, buildDemoNotes.buildId))
    .innerJoin(testRuns, eq(testRuns.id, builds.testRunId))
    .where(eq(testRuns.repositoryId, repositoryId))
    .orderBy(desc(buildDemoNotes.createdAt))
    .limit(1);
  return row?.payload ?? null;
}

export async function upsertBuildDemoNotes(buildId: string, payload: DemoNotes): Promise<void> {
  const createdAt = new Date();
  await db
    .insert(buildDemoNotes)
    .values({ buildId, payload, createdAt })
    .onConflictDoUpdate({
      target: buildDemoNotes.buildId,
      set: { payload, createdAt },
    });
}

export async function deleteBuildDemoNotes(buildId: string): Promise<void> {
  await db.delete(buildDemoNotes).where(eq(buildDemoNotes.buildId, buildId));
}
