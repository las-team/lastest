'use server';

import { revalidatePath } from 'next/cache';
import * as queries from '@/lib/db/queries';
import { createAndRunBuild } from './builds';
import type { NewSuite } from '@/lib/db/schema';

export async function createSuite(data: { name: string; description?: string; repositoryId?: string }) {
  const result = await queries.createSuite(data);
  revalidatePath('/suites');
  return result;
}

export async function updateSuite(id: string, data: Partial<Pick<NewSuite, 'name' | 'description'>>) {
  await queries.updateSuite(id, data);
  revalidatePath('/suites');
  revalidatePath(`/suites/${id}`);
}

export async function deleteSuite(id: string) {
  await queries.deleteSuite(id);
  revalidatePath('/suites');
}

export async function getSuites(repositoryId?: string | null) {
  return queries.getSuites(repositoryId);
}

export async function getSuite(id: string) {
  return queries.getSuite(id);
}

export async function getSuiteWithTests(id: string) {
  return queries.getSuiteWithTests(id);
}

export async function addTestsToSuite(suiteId: string, testIds: string[]) {
  const result = await queries.addTestsToSuite(suiteId, testIds);
  revalidatePath(`/suites/${suiteId}`);
  return result;
}

export async function removeTestFromSuite(suiteId: string, testId: string) {
  await queries.removeTestFromSuite(suiteId, testId);
  revalidatePath(`/suites/${suiteId}`);
}

export async function reorderSuiteTests(suiteId: string, orderedTestIds: string[]) {
  await queries.reorderSuiteTests(suiteId, orderedTestIds);
  revalidatePath(`/suites/${suiteId}`);
}

export async function runSuite(suiteId: string) {
  const suiteWithTests = await queries.getSuiteWithTests(suiteId);
  if (!suiteWithTests) {
    throw new Error('Suite not found');
  }

  if (suiteWithTests.tests.length === 0) {
    throw new Error('Suite has no tests');
  }

  // Get ordered test IDs
  const testIds = suiteWithTests.tests.map((t) => t.testId);

  // Create and run build with the suite's tests in order
  return createAndRunBuild('manual', testIds, suiteWithTests.repositoryId);
}
