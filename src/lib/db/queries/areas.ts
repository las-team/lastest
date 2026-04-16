import { db } from '../index';
import {
  functionalAreas,
  tests,
} from '../schema';
import { getTestsByRepo, getTestResultsByTest } from './tests';
import { eq, and, isNull } from 'drizzle-orm';

// Functional Areas Tree
export interface FunctionalAreaWithChildren {
  id: string;
  repositoryId: string | null;
  name: string;
  description: string | null;
  parentId: string | null;
  isRouteFolder: boolean | null;
  orderIndex: number | null;
  agentPlan: string | null;
  planGeneratedAt: Date | null;
  planSnapshot: string | null;
  children: FunctionalAreaWithChildren[];
  tests: { id: string; name: string; description: string | null; latestStatus: string | null; isPlaceholder?: boolean }[];
}

export async function getFunctionalAreasTree(repositoryId: string): Promise<FunctionalAreaWithChildren[]> {
  const areas = await db
    .select()
    .from(functionalAreas)
    .where(and(eq(functionalAreas.repositoryId, repositoryId), isNull(functionalAreas.deletedAt)))
    .orderBy(functionalAreas.orderIndex)
    ;

  const allTests = await getTestsByRepo(repositoryId);
  const testsByArea = new Map<string, typeof allTests>();

  for (const test of allTests) {
    if (test.functionalAreaId) {
      const existing = testsByArea.get(test.functionalAreaId) || [];
      existing.push(test);
      testsByArea.set(test.functionalAreaId, existing);
    }
  }

  // Get latest status for each test
  const testsWithStatus = await Promise.all(
    allTests.map(async (test) => {
      const results = await getTestResultsByTest(test.id);
      return { id: test.id, name: test.name, latestStatus: results[0]?.status || null };
    })
  );
  const statusMap = new Map(testsWithStatus.map(t => [t.id, t.latestStatus]));

  // Build tree structure
  const areaMap = new Map<string, FunctionalAreaWithChildren>();
  const rootAreas: FunctionalAreaWithChildren[] = [];

  for (const area of areas) {
    const areaTests = testsByArea.get(area.id) || [];
    areaMap.set(area.id, {
      ...area,
      children: [],
      tests: areaTests.map(t => ({ id: t.id, name: t.name, description: t.description, latestStatus: statusMap.get(t.id) || null, isPlaceholder: t.isPlaceholder ?? false })),
    });
  }

  for (const area of areas) {
    const node = areaMap.get(area.id)!;
    if (area.parentId && areaMap.has(area.parentId)) {
      areaMap.get(area.parentId)!.children.push(node);
    } else {
      rootAreas.push(node);
    }
  }

  return rootAreas;
}

export async function updateFunctionalAreaParent(id: string, parentId: string | null) {
  await db.update(functionalAreas).set({ parentId }).where(eq(functionalAreas.id, id));
}

export async function reorderFunctionalAreas(repositoryId: string, orderedIds: string[]) {
  for (let i = 0; i < orderedIds.length; i++) {
    await db
      .update(functionalAreas)
      .set({ orderIndex: i })
      .where(and(eq(functionalAreas.id, orderedIds[i]), eq(functionalAreas.repositoryId, repositoryId)));
  }
}

export async function getOrCreateRoutesFolder(repositoryId: string) {
  const [existing] = await db
    .select()
    .from(functionalAreas)
    .where(and(eq(functionalAreas.repositoryId, repositoryId), eq(functionalAreas.name, 'Routes'), eq(functionalAreas.isRouteFolder, true)));

  if (existing) return existing;

  const id = crypto.randomUUID();
  await db.insert(functionalAreas).values({
    id,
    repositoryId,
    name: 'Routes',
    description: 'Auto-generated folder containing discovered routes',
    isRouteFolder: true,
    orderIndex: 0,
  });

  return { id, repositoryId, name: 'Routes', description: 'Auto-generated folder containing discovered routes', parentId: null, isRouteFolder: true, orderIndex: 0 };
}

export async function moveTestToArea(testId: string, areaId: string | null) {
  await db.update(tests).set({ functionalAreaId: areaId, updatedAt: new Date() }).where(eq(tests.id, testId));
}
