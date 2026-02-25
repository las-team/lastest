import { db } from '../index';
import {
  suites,
  suiteTests,
  functionalAreas,
  tests,
} from '../schema';
import type {
  NewSuite,
} from '../schema';
import { getTestsByRepo, getTestResultsByTest } from './tests';
import { eq, desc, and, isNull } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

// Suites
export async function getSuites(repositoryId?: string | null) {
  if (repositoryId) {
    return db.select().from(suites).where(eq(suites.repositoryId, repositoryId)).orderBy(desc(suites.createdAt)).all();
  }
  return db.select().from(suites).orderBy(desc(suites.createdAt)).all();
}

export async function getSuite(id: string) {
  return db.select().from(suites).where(eq(suites.id, id)).get();
}

export async function createSuite(data: Omit<NewSuite, 'id' | 'createdAt' | 'updatedAt'>) {
  const id = uuid();
  const now = new Date();
  await db.insert(suites).values({ ...data, id, createdAt: now, updatedAt: now });
  return { id, ...data, createdAt: now, updatedAt: now };
}

export async function updateSuite(id: string, data: Partial<NewSuite>) {
  await db.update(suites).set({ ...data, updatedAt: new Date() }).where(eq(suites.id, id));
}

export async function deleteSuite(id: string) {
  // Suite tests are cascade deleted via FK
  await db.delete(suites).where(eq(suites.id, id));
}

// Suite Tests
export async function getSuiteTests(suiteId: string) {
  return db
    .select({
      id: suiteTests.id,
      suiteId: suiteTests.suiteId,
      testId: suiteTests.testId,
      orderIndex: suiteTests.orderIndex,
      createdAt: suiteTests.createdAt,
      testName: tests.name,
      testCode: tests.code,
      targetUrl: tests.targetUrl,
      functionalAreaId: tests.functionalAreaId,
    })
    .from(suiteTests)
    .innerJoin(tests, eq(suiteTests.testId, tests.id))
    .where(eq(suiteTests.suiteId, suiteId))
    .orderBy(suiteTests.orderIndex)
    .all();
}

export async function addTestToSuite(suiteId: string, testId: string, orderIndex?: number) {
  // Get current max order if not provided
  let order = orderIndex;
  if (order === undefined) {
    const existing = await db
      .select({ maxOrder: suiteTests.orderIndex })
      .from(suiteTests)
      .where(eq(suiteTests.suiteId, suiteId))
      .orderBy(desc(suiteTests.orderIndex))
      .limit(1)
      .get();
    order = (existing?.maxOrder ?? -1) + 1;
  }

  const id = uuid();
  await db.insert(suiteTests).values({
    id,
    suiteId,
    testId,
    orderIndex: order,
    createdAt: new Date(),
  });
  return { id, suiteId, testId, orderIndex: order };
}

export async function addTestsToSuite(suiteId: string, testIds: string[]) {
  // Get current max order
  const existing = await db
    .select({ maxOrder: suiteTests.orderIndex })
    .from(suiteTests)
    .where(eq(suiteTests.suiteId, suiteId))
    .orderBy(desc(suiteTests.orderIndex))
    .limit(1)
    .get();
  let order = (existing?.maxOrder ?? -1) + 1;

  const toInsert = testIds.map((testId) => ({
    id: uuid(),
    suiteId,
    testId,
    orderIndex: order++,
    createdAt: new Date(),
  }));

  if (toInsert.length > 0) {
    await db.insert(suiteTests).values(toInsert);
  }
  return toInsert;
}

export async function removeTestFromSuite(suiteId: string, testId: string) {
  await db
    .delete(suiteTests)
    .where(and(eq(suiteTests.suiteId, suiteId), eq(suiteTests.testId, testId)));
}

export async function reorderSuiteTests(suiteId: string, orderedTestIds: string[]) {
  // Update order for each test
  for (let i = 0; i < orderedTestIds.length; i++) {
    await db
      .update(suiteTests)
      .set({ orderIndex: i })
      .where(and(eq(suiteTests.suiteId, suiteId), eq(suiteTests.testId, orderedTestIds[i])));
  }
}

export async function getSuiteWithTests(id: string) {
  const suite = await getSuite(id);
  if (!suite) return null;
  const suiteTestList = await getSuiteTests(id);
  return { ...suite, tests: suiteTestList };
}

// Functional Areas Tree
export interface FunctionalAreaWithChildren {
  id: string;
  repositoryId: string | null;
  name: string;
  description: string | null;
  parentId: string | null;
  isRouteFolder: boolean | null;
  orderIndex: number | null;
  children: FunctionalAreaWithChildren[];
  tests: { id: string; name: string; latestStatus: string | null; isPlaceholder?: boolean }[];
  suites: { id: string; name: string; description: string | null; testCount: number }[];
}

export async function getFunctionalAreasTree(repositoryId: string): Promise<FunctionalAreaWithChildren[]> {
  const areas = await db
    .select()
    .from(functionalAreas)
    .where(and(eq(functionalAreas.repositoryId, repositoryId), isNull(functionalAreas.deletedAt)))
    .orderBy(functionalAreas.orderIndex)
    .all();

  const allTests = await getTestsByRepo(repositoryId);
  const testsByArea = new Map<string, typeof allTests>();

  for (const test of allTests) {
    if (test.functionalAreaId) {
      const existing = testsByArea.get(test.functionalAreaId) || [];
      existing.push(test);
      testsByArea.set(test.functionalAreaId, existing);
    }
  }

  // Get all suites with their test counts
  const allSuites = await getSuites(repositoryId);
  const suitesByArea = new Map<string, typeof allSuites>();

  for (const suite of allSuites) {
    if (suite.functionalAreaId) {
      const existing = suitesByArea.get(suite.functionalAreaId) || [];
      existing.push(suite);
      suitesByArea.set(suite.functionalAreaId, existing);
    }
  }

  // Get test counts for suites
  const suiteTestCounts = new Map<string, number>();
  for (const suite of allSuites) {
    const suiteTestList = await getSuiteTests(suite.id);
    suiteTestCounts.set(suite.id, suiteTestList.length);
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
    const areaSuites = suitesByArea.get(area.id) || [];
    areaMap.set(area.id, {
      ...area,
      children: [],
      tests: areaTests.map(t => ({ id: t.id, name: t.name, latestStatus: statusMap.get(t.id) || null, isPlaceholder: t.isPlaceholder ?? false })),
      suites: areaSuites.map(s => ({ id: s.id, name: s.name, description: s.description, testCount: suiteTestCounts.get(s.id) || 0 })),
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
  const existing = await db
    .select()
    .from(functionalAreas)
    .where(and(eq(functionalAreas.repositoryId, repositoryId), eq(functionalAreas.name, 'Routes'), eq(functionalAreas.isRouteFolder, true)))
    .get();

  if (existing) return existing;

  const id = uuid();
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

export async function moveSuiteToArea(suiteId: string, areaId: string | null) {
  await db.update(suites).set({ functionalAreaId: areaId, updatedAt: new Date() }).where(eq(suites.id, suiteId));
}

export async function getSuitesByArea(areaId: string) {
  return db.select().from(suites).where(eq(suites.functionalAreaId, areaId)).orderBy(suites.orderIndex).all();
}

export async function getUnsortedSuites(repositoryId: string) {
  return db
    .select()
    .from(suites)
    .where(and(eq(suites.repositoryId, repositoryId), isNull(suites.functionalAreaId)))
    .orderBy(suites.orderIndex)
    .all();
}
