import { db } from '../index';
import { testFixtures } from '../schema';
import type { NewTestFixture } from '../schema';
import { eq } from 'drizzle-orm';

export async function createTestFixture(data: NewTestFixture) {
  const [fixture] = await db.insert(testFixtures).values(data).returning();
  return fixture;
}

export async function getTestFixtures(testId: string) {
  return db.select().from(testFixtures).where(eq(testFixtures.testId, testId));
}

export async function getTestFixturesByRepo(repositoryId: string) {
  return db.select().from(testFixtures).where(eq(testFixtures.repositoryId, repositoryId));
}

export async function getTestFixture(id: string) {
  const [fixture] = await db.select().from(testFixtures).where(eq(testFixtures.id, id));
  return fixture ?? null;
}

export async function deleteTestFixture(id: string) {
  await db.delete(testFixtures).where(eq(testFixtures.id, id));
}

export async function deleteTestFixturesByTest(testId: string) {
  await db.delete(testFixtures).where(eq(testFixtures.testId, testId));
}
