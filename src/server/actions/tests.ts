'use server';

import { revalidatePath } from 'next/cache';
import fs from 'fs';
import path from 'path';
import * as queries from '@/lib/db/queries';
import { requireRepoAccess, requireTeamAccess } from '@/lib/auth';
import type { NewTest, NewFunctionalArea } from '@/lib/db/schema';
import { getCurrentBranchForRepo } from '@/lib/git-utils';
import { STORAGE_DIRS } from '@/lib/storage/paths';

export async function createFunctionalArea(data: Omit<NewFunctionalArea, 'id'>) {
  if (data.repositoryId) await requireRepoAccess(data.repositoryId);
  else await requireTeamAccess();
  const result = await queries.createFunctionalArea(data);
  revalidatePath('/tests');
  revalidatePath('/');
  return result;
}

export async function updateFunctionalArea(id: string, data: Partial<NewFunctionalArea>) {
  await requireTeamAccess();
  await queries.updateFunctionalArea(id, data);
  revalidatePath('/tests');
  revalidatePath('/');
}

export async function deleteFunctionalArea(id: string) {
  await requireTeamAccess();
  await queries.deleteFunctionalArea(id);
  revalidatePath('/tests');
  revalidatePath('/');
}

export async function createTest(data: Omit<NewTest, 'id' | 'createdAt' | 'updatedAt'>) {
  if (data.repositoryId) await requireRepoAccess(data.repositoryId);
  else await requireTeamAccess();
  const result = await queries.createTest(data);
  revalidatePath('/tests');
  revalidatePath('/');
  return result;
}

export async function updateTest(id: string, data: Partial<NewTest>) {
  const session = await requireTeamAccess();
  const test = await queries.getTest(id);
  if (!test) throw new Error('Test not found');
  if (test.repositoryId) {
    const repo = await queries.getRepository(test.repositoryId);
    if (!repo || repo.teamId !== session.team.id) throw new Error('Forbidden');
  }
  const branch = await getCurrentBranchForRepo(test?.repositoryId);
  await queries.updateTestWithVersion(id, data, 'manual_edit', branch ?? undefined);
  revalidatePath('/tests');
  revalidatePath(`/tests/${id}`);
}

async function verifyTestOwnership(testId: string, teamId: string) {
  const test = await queries.getTest(testId);
  if (!test) throw new Error('Test not found');
  if (test.repositoryId) {
    const repo = await queries.getRepository(test.repositoryId);
    if (!repo || repo.teamId !== teamId) throw new Error('Forbidden');
  }
}

export async function deleteTest(id: string) {
  const session = await requireTeamAccess();
  await verifyTestOwnership(id, session.team.id);
  await queries.softDeleteTest(id);
  revalidatePath('/tests');
  revalidatePath(`/tests/${id}`);
  revalidatePath('/');
}

export async function deleteTests(testIds: string[]) {
  const session = await requireTeamAccess();
  for (const id of testIds) {
    await verifyTestOwnership(id, session.team.id);
    await queries.softDeleteTest(id);
  }
  revalidatePath('/tests');
  revalidatePath('/');
}

export async function restoreTest(id: string) {
  const session = await requireTeamAccess();
  await verifyTestOwnership(id, session.team.id);
  await queries.restoreTest(id);
  revalidatePath('/tests');
  revalidatePath(`/tests/${id}`);
  revalidatePath('/');
}

export async function restoreTests(testIds: string[]) {
  const session = await requireTeamAccess();
  for (const id of testIds) {
    await verifyTestOwnership(id, session.team.id);
    await queries.restoreTest(id);
  }
  revalidatePath('/tests');
  revalidatePath('/');
}

export async function permanentlyDeleteTest(id: string) {
  const session = await requireTeamAccess();
  await verifyTestOwnership(id, session.team.id);
  await queries.permanentlyDeleteTest(id);
  revalidatePath('/tests');
  revalidatePath('/');
}

export async function permanentlyDeleteTests(testIds: string[]) {
  const session = await requireTeamAccess();
  for (const id of testIds) {
    await verifyTestOwnership(id, session.team.id);
    await queries.permanentlyDeleteTest(id);
  }
  revalidatePath('/tests');
  revalidatePath('/');
}

export async function getDeletedTests(repositoryId?: string) {
  await requireTeamAccess();
  return queries.getDeletedTests(repositoryId);
}

export async function getTest(id: string) {
  await requireTeamAccess();
  return queries.getTest(id);
}

export async function getTests() {
  await requireTeamAccess();
  return queries.getTests();
}

export async function getTestsByArea(areaId: string) {
  await requireTeamAccess();
  return queries.getTestsByFunctionalArea(areaId);
}

export async function getFunctionalAreas() {
  await requireTeamAccess();
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
  const baseDir = STORAGE_DIRS.screenshots;
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
  // Primary: Get screenshots from database (stored in test results)
  const testResults = await queries.getTestResultsByTest(testId);
  const groups: Map<string, { startedAt: Date | null; screenshots: string[] }> = new Map();

  for (const result of testResults) {
    const runId = result.testRunId;
    if (!runId) continue;

    if (!groups.has(runId)) {
      groups.set(runId, { startedAt: null, screenshots: [] });
    }
    const group = groups.get(runId)!;

    // Add screenshots from the JSON array
    if (result.screenshots && Array.isArray(result.screenshots)) {
      for (const s of result.screenshots) {
        if (s.path && !group.screenshots.includes(s.path)) {
          group.screenshots.push(s.path);
        }
      }
    }

    // Fallback to single screenshotPath if no array
    if (result.screenshotPath && !group.screenshots.includes(result.screenshotPath)) {
      group.screenshots.push(result.screenshotPath);
    }
  }

  // Get run timestamps
  const runIds = Array.from(groups.keys());
  const runs = await queries.getTestRunsByIds(runIds);
  const runMap = new Map(runs.map(r => [r.id, r.startedAt]));

  // Build result
  const result: ScreenshotGroup[] = runIds.map(runId => ({
    runId,
    startedAt: runMap.get(runId) || null,
    screenshots: groups.get(runId)?.screenshots || [],
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
  await requireTeamAccess();
  return queries.getTestVersions(testId);
}

export async function restoreTestVersion(testId: string, version: number) {
  await requireTeamAccess();
  const versionData = await queries.getTestVersion(testId, version);
  if (!versionData) {
    throw new Error(`Version ${version} not found`);
  }

  const test = await queries.getTest(testId);
  const branch = await getCurrentBranchForRepo(test?.repositoryId);

  // Update test with the version data, marking as restored
  await queries.updateTestWithVersion(
    testId,
    {
      code: versionData.code,
      name: versionData.name,
      targetUrl: versionData.targetUrl,
    },
    `restored_from_v${version}`,
    branch ?? undefined
  );

  revalidatePath('/tests');
  revalidatePath(`/tests/${testId}`);
  return { success: true };
}

// Get visual diffs for a specific test result (step-level diffs)
export async function getVisualDiffsForTestResult(testResultId: string) {
  await requireTeamAccess();
  return queries.getVisualDiffsByTestResult(testResultId);
}

// Clean up orphaned setup references (tests/scripts that no longer exist)
export async function cleanupOrphanedSetupReferences() {
  await requireTeamAccess();
  const result = await queries.cleanupOrphanedSetupReferences();
  revalidatePath('/tests');
  revalidatePath('/settings');
  revalidatePath('/');
  return result;
}
