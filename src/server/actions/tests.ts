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
  await queries.updateTestWithVersion(id, data, 'manual_edit');
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

export interface ScreenshotGroup {
  runId: string;
  startedAt: Date | null;
  screenshots: string[];
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

export async function getTestScreenshotsGrouped(
  testId: string,
  repositoryId?: string | null
): Promise<ScreenshotGroup[]> {
  const baseDir = './public/screenshots';
  const dir = repositoryId ? path.join(baseDir, repositoryId) : baseDir;

  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir);
  const testFiles = files
    .filter(f => f.includes(testId) && f.endsWith('.png'))
    .sort();

  const prefix = repositoryId ? `/screenshots/${repositoryId}` : '/screenshots';

  // Group screenshots by runId (first UUID in filename)
  const groups: Map<string, string[]> = new Map();
  for (const file of testFiles) {
    // Filename format: {runId}-{testId}-{label}.png
    const runId = file.split('-').slice(0, 5).join('-'); // UUID has 5 parts
    if (!groups.has(runId)) {
      groups.set(runId, []);
    }
    groups.get(runId)!.push(`${prefix}/${file}`);
  }

  // Get run timestamps from database
  const runIds = Array.from(groups.keys());
  const runs = await queries.getTestRunsByIds(runIds);
  const runMap = new Map(runs.map(r => [r.id, r.startedAt]));

  // Build result sorted by startedAt desc (newest first)
  const result: ScreenshotGroup[] = runIds.map(runId => ({
    runId,
    startedAt: runMap.get(runId) || null,
    screenshots: groups.get(runId) || [],
  }));

  // Sort by startedAt descending (newest first)
  result.sort((a, b) => {
    if (!a.startedAt && !b.startedAt) return 0;
    if (!a.startedAt) return 1;
    if (!b.startedAt) return -1;
    return b.startedAt.getTime() - a.startedAt.getTime();
  });

  return result;
}

// Test Version Actions
export async function getTestVersionHistory(testId: string) {
  return queries.getTestVersions(testId);
}

export async function restoreTestVersion(testId: string, version: number) {
  const versionData = await queries.getTestVersion(testId, version);
  if (!versionData) {
    throw new Error(`Version ${version} not found`);
  }

  // Update test with the version data, marking as restored
  await queries.updateTestWithVersion(
    testId,
    {
      code: versionData.code,
      name: versionData.name,
      targetUrl: versionData.targetUrl,
    },
    `restored_from_v${version}`
  );

  revalidatePath('/tests');
  revalidatePath(`/tests/${testId}`);
  return { success: true };
}
