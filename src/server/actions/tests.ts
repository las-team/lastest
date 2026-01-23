'use server';

import { revalidatePath } from 'next/cache';
import fs from 'fs';
import path from 'path';
import * as queries from '@/lib/db/queries';
import type { NewTest, NewFunctionalArea } from '@/lib/db/schema';

export async function createFunctionalArea(data: Omit<NewFunctionalArea, 'id'>) {
  const result = await queries.createFunctionalArea(data);
  revalidatePath('/tests');
  revalidatePath('/');
  return result;
}

export async function updateFunctionalArea(id: string, data: Partial<NewFunctionalArea>) {
  await queries.updateFunctionalArea(id, data);
  revalidatePath('/tests');
  revalidatePath('/');
}

export async function deleteFunctionalArea(id: string) {
  await queries.deleteFunctionalArea(id);
  revalidatePath('/tests');
  revalidatePath('/');
}

export async function createTest(data: Omit<NewTest, 'id' | 'createdAt' | 'updatedAt'>) {
  const result = await queries.createTest(data);
  revalidatePath('/tests');
  revalidatePath('/');
  return result;
}

export async function updateTest(id: string, data: Partial<NewTest>) {
  await queries.updateTest(id, data);
  revalidatePath('/tests');
  revalidatePath(`/tests/${id}`);
}

export async function deleteTest(id: string) {
  await queries.deleteTest(id);
  revalidatePath('/tests');
  revalidatePath('/');
}

export async function getTest(id: string) {
  return queries.getTest(id);
}

export async function getTests() {
  return queries.getTests();
}

export async function getTestsByArea(areaId: string) {
  return queries.getTestsByFunctionalArea(areaId);
}

export async function getFunctionalAreas() {
  return queries.getFunctionalAreas();
}

export async function getTestScreenshots(
  testId: string,
  repositoryId?: string | null
): Promise<string[]> {
  const baseDir = './public/screenshots';
  const dir = repositoryId ? path.join(baseDir, repositoryId) : baseDir;

  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir);
  const testFiles = files
    .filter(f => f.includes(testId) && f.endsWith('.png'))
    .sort();

  const prefix = repositoryId ? `/screenshots/${repositoryId}` : '/screenshots';
  return testFiles.map(f => `${prefix}/${f}`);
}
