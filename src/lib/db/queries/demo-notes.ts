/**
 * Build-level demo notes — AI-generated UI/UX summary written at the end of
 * a /gtm-lastest-saas-demo run. One row per build; rendered on /r/<slug>.
 */

import { db } from '../index';
import { buildDemoNotes } from '../schema';
import type { DemoNotes } from '../schema';
import { eq } from 'drizzle-orm';

export async function getBuildDemoNotes(buildId: string): Promise<DemoNotes | null> {
  const [row] = await db
    .select()
    .from(buildDemoNotes)
    .where(eq(buildDemoNotes.buildId, buildId));
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
