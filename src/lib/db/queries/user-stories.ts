import { db } from '../index';
import {
  userStories,
  tests,
  type UserStory,
  type NewUserStory,
  type AcceptanceCriterion,
} from '../schema';
import { and, eq, isNull, inArray } from 'drizzle-orm';

export interface UserStoryWithCoverage extends UserStory {
  coverage: Array<{
    acId: string;
    text: string;
    testCount: number;
    passingCount: number;
  }>;
}

export async function listUserStoriesByArea(areaId: string): Promise<UserStory[]> {
  return await db
    .select()
    .from(userStories)
    .where(eq(userStories.functionalAreaId, areaId))
    .orderBy(userStories.orderIndex, userStories.createdAt);
}

export async function listUserStoriesByRepo(repositoryId: string): Promise<UserStory[]> {
  return await db
    .select()
    .from(userStories)
    .where(eq(userStories.repositoryId, repositoryId))
    .orderBy(userStories.orderIndex, userStories.createdAt);
}

export async function getUserStory(id: string): Promise<UserStory | null> {
  const [row] = await db.select().from(userStories).where(eq(userStories.id, id));
  return row ?? null;
}

export async function createUserStory(data: NewUserStory): Promise<UserStory> {
  const id = data.id ?? crypto.randomUUID();
  const now = new Date();
  const values: NewUserStory = {
    ...data,
    id,
    createdAt: data.createdAt ?? now,
    updatedAt: data.updatedAt ?? now,
    acceptanceCriteria: data.acceptanceCriteria ?? [],
  };
  await db.insert(userStories).values(values);
  const [row] = await db.select().from(userStories).where(eq(userStories.id, id));
  return row;
}

export async function updateUserStory(
  id: string,
  patch: Partial<Omit<NewUserStory, 'id' | 'createdAt'>>,
): Promise<void> {
  await db
    .update(userStories)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(userStories.id, id));
}

export async function deleteUserStory(id: string): Promise<void> {
  await db.delete(userStories).where(eq(userStories.id, id));
}

export async function setStoryPlanStale(id: string, stale: boolean): Promise<void> {
  await db
    .update(userStories)
    .set({ planStale: stale, updatedAt: new Date() })
    .where(eq(userStories.id, id));
}

/**
 * Recompute coverage for every story attached to an area. For each AC, counts how many
 * tests in the area carry that AC's id in `acceptanceCriterionIds`. Returns the per-story
 * coverage rollups; does NOT mutate any AC.status (UI computes its own badge).
 */
export async function getAreaStoriesWithCoverage(areaId: string): Promise<UserStoryWithCoverage[]> {
  const stories = await listUserStoriesByArea(areaId);
  if (stories.length === 0) return [];

  const areaTests = await db
    .select({ id: tests.id, acIds: tests.acceptanceCriterionIds })
    .from(tests)
    .where(and(eq(tests.functionalAreaId, areaId), isNull(tests.deletedAt)));

  // Map ac id -> test count
  const counts = new Map<string, number>();
  for (const t of areaTests) {
    const ids = (t.acIds ?? []) as string[];
    for (const acId of ids) {
      counts.set(acId, (counts.get(acId) ?? 0) + 1);
    }
  }

  return stories.map(s => {
    const acs = (s.acceptanceCriteria ?? []) as AcceptanceCriterion[];
    return {
      ...s,
      coverage: acs.map(ac => ({
        acId: ac.id,
        text: ac.text,
        testCount: counts.get(ac.id) ?? 0,
        // Passing count is recomputed by the UI from the latest run status map
        // (we return 0 here so this query stays single-table fast).
        passingCount: 0,
      })),
    };
  });
}

/**
 * For a set of test ids, returns the AC ids each test currently covers.
 * Used by the Tests tab to render coverage chips per row.
 */
export async function getTestAcIdsMap(testIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (testIds.length === 0) return out;
  const rows = await db
    .select({ id: tests.id, acIds: tests.acceptanceCriterionIds })
    .from(tests)
    .where(inArray(tests.id, testIds));
  for (const r of rows) out.set(r.id, (r.acIds ?? []) as string[]);
  return out;
}

export async function setTestAcceptanceCriterionIds(testId: string, acIds: string[]): Promise<void> {
  await db
    .update(tests)
    .set({ acceptanceCriterionIds: acIds, updatedAt: new Date() })
    .where(eq(tests.id, testId));
}
