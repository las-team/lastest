'use server';

import { revalidatePath } from 'next/cache';
import * as queries from '@/lib/db/queries';
import type { NewFunctionalArea } from '@/lib/db/schema';

export async function createArea(data: {
  name: string;
  description?: string;
  repositoryId?: string;
  parentId?: string;
}) {
  const result = await queries.createFunctionalArea({
    name: data.name,
    description: data.description,
    repositoryId: data.repositoryId,
    parentId: data.parentId,
  });
  revalidatePath('/areas');
  revalidatePath('/tests');
  return result;
}

export async function updateArea(id: string, data: Partial<Pick<NewFunctionalArea, 'name' | 'description' | 'parentId'>>) {
  await queries.updateFunctionalArea(id, data);
  revalidatePath('/areas');
  revalidatePath('/tests');
}

export async function deleteArea(id: string) {
  // Get all tests in this area and move them to uncategorized
  const tests = await queries.getTestsByFunctionalArea(id);
  for (const test of tests) {
    await queries.moveTestToArea(test.id, null);
  }

  // Get child areas and move them to root
  const allAreas = await queries.getFunctionalAreas();
  const childAreas = allAreas.filter(a => a.parentId === id);
  for (const child of childAreas) {
    await queries.updateFunctionalAreaParent(child.id, null);
  }

  await queries.deleteFunctionalArea(id);
  revalidatePath('/areas');
  revalidatePath('/tests');
}

export async function moveArea(id: string, newParentId: string | null) {
  // Prevent circular references
  if (newParentId) {
    const allAreas = await queries.getFunctionalAreas();
    const areaMap = new Map(allAreas.map(a => [a.id, a]));

    let current = newParentId;
    while (current) {
      if (current === id) {
        throw new Error('Cannot move area into its own descendant');
      }
      const parent = areaMap.get(current);
      current = parent?.parentId || '';
    }
  }

  await queries.updateFunctionalAreaParent(id, newParentId);
  revalidatePath('/areas');
  revalidatePath('/tests');
}

export async function moveTestToArea(testId: string, areaId: string | null) {
  await queries.moveTestToArea(testId, areaId);
  revalidatePath('/areas');
  revalidatePath('/tests');
  revalidatePath(`/tests/${testId}`);
}

export async function moveSuiteToArea(suiteId: string, areaId: string | null) {
  await queries.moveSuiteToArea(suiteId, areaId);
  revalidatePath('/areas');
  revalidatePath('/suites');
  revalidatePath(`/suites/${suiteId}`);
}

export async function reorderAreas(repositoryId: string, orderedIds: string[]) {
  await queries.reorderFunctionalAreas(repositoryId, orderedIds);
  revalidatePath('/areas');
}

export async function getAreasTree(repositoryId: string) {
  return queries.getFunctionalAreasTree(repositoryId);
}

export async function getArea(id: string) {
  return queries.getFunctionalArea(id);
}
