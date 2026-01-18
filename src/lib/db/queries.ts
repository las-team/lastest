import { db } from './index';
import { functionalAreas, tests, testRuns, testResults } from './schema';
import type { NewFunctionalArea, NewTest, NewTestRun, NewTestResult } from './schema';
import { eq, desc } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

// Functional Areas
export async function getFunctionalAreas() {
  return db.select().from(functionalAreas).all();
}

export async function getFunctionalArea(id: string) {
  return db.select().from(functionalAreas).where(eq(functionalAreas.id, id)).get();
}

export async function createFunctionalArea(data: Omit<NewFunctionalArea, 'id'>) {
  const id = uuid();
  await db.insert(functionalAreas).values({ ...data, id });
  return { id, ...data };
}

export async function updateFunctionalArea(id: string, data: Partial<NewFunctionalArea>) {
  await db.update(functionalAreas).set(data).where(eq(functionalAreas.id, id));
}

export async function deleteFunctionalArea(id: string) {
  await db.delete(functionalAreas).where(eq(functionalAreas.id, id));
}

// Tests
export async function getTests() {
  return db.select().from(tests).orderBy(desc(tests.createdAt)).all();
}

export async function getTestsByFunctionalArea(functionalAreaId: string) {
  return db.select().from(tests).where(eq(tests.functionalAreaId, functionalAreaId)).all();
}

export async function getTest(id: string) {
  return db.select().from(tests).where(eq(tests.id, id)).get();
}

export async function createTest(data: Omit<NewTest, 'id' | 'createdAt' | 'updatedAt'>) {
  const id = uuid();
  const now = new Date();
  await db.insert(tests).values({ ...data, id, createdAt: now, updatedAt: now });
  return { id, ...data, createdAt: now, updatedAt: now };
}

export async function updateTest(id: string, data: Partial<NewTest>) {
  await db.update(tests).set({ ...data, updatedAt: new Date() }).where(eq(tests.id, id));
}

export async function deleteTest(id: string) {
  await db.delete(tests).where(eq(tests.id, id));
}

// Test Runs
export async function getTestRuns() {
  return db.select().from(testRuns).orderBy(desc(testRuns.startedAt)).all();
}

export async function getTestRun(id: string) {
  return db.select().from(testRuns).where(eq(testRuns.id, id)).get();
}

export async function createTestRun(data: Omit<NewTestRun, 'id'>) {
  const id = uuid();
  await db.insert(testRuns).values({ ...data, id });
  return { id, ...data };
}

export async function updateTestRun(id: string, data: Partial<NewTestRun>) {
  await db.update(testRuns).set(data).where(eq(testRuns.id, id));
}

// Test Results
export async function getTestResultsByRun(testRunId: string) {
  return db.select().from(testResults).where(eq(testResults.testRunId, testRunId)).all();
}

export async function getTestResultsByTest(testId: string) {
  return db.select().from(testResults).where(eq(testResults.testId, testId)).all();
}

export async function createTestResult(data: Omit<NewTestResult, 'id'>) {
  const id = uuid();
  await db.insert(testResults).values({ ...data, id });
  return { id, ...data };
}

export async function updateTestResult(id: string, data: Partial<NewTestResult>) {
  await db.update(testResults).set(data).where(eq(testResults.id, id));
}

// Get tests with their latest result status
export async function getTestsWithStatus() {
  const allTests = await getTests();
  const areas = await getFunctionalAreas();
  const areaMap = new Map(areas.map(a => [a.id, a]));

  return Promise.all(
    allTests.map(async (test) => {
      const results = await getTestResultsByTest(test.id);
      const latestResult = results.sort((a, b) =>
        (b.durationMs || 0) - (a.durationMs || 0)
      )[0];

      return {
        ...test,
        area: test.functionalAreaId ? areaMap.get(test.functionalAreaId) : null,
        latestStatus: latestResult?.status || null,
      };
    })
  );
}
