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

export async function cloneTest(id: string) {
  await requireTeamAccess();
  const test = await queries.getTest(id);
  if (!test) throw new Error('Test not found');
  if (test.repositoryId) {
    await requireRepoAccess(test.repositoryId);
  }
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, deletedAt: _deletedAt, ...data } = test;
  const result = await queries.createTest({
    ...data,
    name: `${test.name} (copy)`,
  });
  revalidatePath('/tests');
  revalidatePath('/');
  return result;
}

export async function createTest(data: Omit<NewTest, 'id' | 'createdAt' | 'updatedAt'>) {
  if (data.repositoryId) await requireRepoAccess(data.repositoryId);
  else await requireTeamAccess();
  // Gamification stamping + awarding happens inside queries.createTest via
  // the onTestCreated hook — it handles every caller, not just this one.
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

// Updates only the parsed assertions metadata — no version history entry
export async function syncTestAssertions(id: string, assertions: import('@/lib/db/schema').TestAssertion[]) {
  const session = await requireTeamAccess();
  const test = await queries.getTest(id);
  if (!test) throw new Error('Test not found');
  if (test.repositoryId) {
    const repo = await queries.getRepository(test.repositoryId);
    if (!repo || repo.teamId !== session.team.id) throw new Error('Forbidden');
  }
  await queries.updateTest(id, { assertions });
  revalidatePath(`/tests/${id}`);
}

export async function saveStepCriteria(
  testId: string,
  stepLabel: string,
  rules: import('@/lib/db/schema').StepRule[],
) {
  const session = await requireTeamAccess();
  const test = await queries.getTest(testId);
  if (!test) throw new Error('Test not found');
  if (test.repositoryId) {
    const repo = await queries.getRepository(test.repositoryId);
    if (!repo || repo.teamId !== session.team.id) throw new Error('Forbidden');
  }
  const next = await queries.updateStepCriteria(testId, stepLabel, rules);
  revalidatePath(`/tests/${testId}`);
  return next;
}

export async function saveTestVariables(
  testId: string,
  variables: import('@/lib/db/schema').TestVariable[],
) {
  const session = await requireTeamAccess();
  const test = await queries.getTest(testId);
  if (!test) throw new Error('Test not found');
  if (test.repositoryId) {
    const repo = await queries.getRepository(test.repositoryId);
    if (!repo || repo.teamId !== session.team.id) throw new Error('Forbidden');
  }

  // Validate
  const seen = new Set<string>();
  for (const v of variables) {
    if (!v.name || !/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(v.name)) {
      throw new Error(`Variable name "${v.name}" is invalid (letters/digits/underscore/hyphen, must start with a letter)`);
    }
    if (seen.has(v.name)) throw new Error(`Duplicate variable name: ${v.name}`);
    seen.add(v.name);
    if (v.mode !== 'extract' && v.mode !== 'assign') {
      throw new Error(`Variable "${v.name}" has invalid mode`);
    }
    if (v.mode === 'extract' && !v.targetSelector) {
      throw new Error(`Extract-mode variable "${v.name}" requires a targetSelector`);
    }
    if (v.mode === 'assign') {
      if (v.sourceType === 'static' && v.staticValue === undefined) {
        throw new Error(`Static variable "${v.name}" requires a staticValue`);
      }
      if ((v.sourceType === 'gsheet' || v.sourceType === 'csv') && (!v.sourceAlias || !v.sourceColumn)) {
        throw new Error(`${v.sourceType} variable "${v.name}" requires sourceAlias and sourceColumn`);
      }
    }
  }

  await queries.updateTest(testId, { variables });
  revalidatePath('/tests');
  revalidatePath(`/tests/${testId}`);
  return { success: true };
}

export async function toggleAssertionSoftness(testId: string, assertionId: string, makeSoft: boolean) {
  const session = await requireTeamAccess();
  const test = await queries.getTest(testId);
  if (!test) throw new Error('Test not found');
  if (test.repositoryId) {
    const repo = await queries.getRepository(test.repositoryId);
    if (!repo || repo.teamId !== session.team.id) throw new Error('Forbidden');
  }

  // Parse assertions fresh from code — DB assertions may be stale
  const { parseAssertions } = await import('@/lib/playwright/assertion-parser');
  let code = test.code || '';
  const currentAssertions = parseAssertions(code);

  // Find assertion in fresh parse first, then fall back to DB
  const dbAssertions = test.assertions as import('@/lib/db/schema').TestAssertion[] | null;
  const assertion = currentAssertions.find(a => a.id === assertionId)
    ?? dbAssertions?.find(a => a.id === assertionId);
  if (!assertion) throw new Error('Assertion not found');

  // Update assertion metadata
  assertion.isSoft = makeSoft;

  // Update the test code to keep in sync with the metadata
  const lines = code.split('\n');

  if (assertion.codeLineStart != null) {
    const lineIdx = assertion.codeLineStart - 1; // 0-based
    const codeLine = lines[lineIdx]?.trim() ?? '';

    // Pattern 1: Element/Hard assertion block comments
    if (/^\/\/ (Element|Hard) assertion:/.test(codeLine)) {
      if (makeSoft) {
        lines[lineIdx] = lines[lineIdx].replace(/\/\/ Hard assertion:/, '// Element assertion:');
      } else {
        lines[lineIdx] = lines[lineIdx].replace(/\/\/ Element assertion:/, '// Hard assertion:');
      }
    } else {
      // Patterns 2-5: check for existing hard marker on previous line
      const prevIdx = lineIdx - 1;
      const prevLine = prevIdx >= 0 ? lines[prevIdx].trim() : '';
      const hasHardMarker = /^\/\/ Hard assertion/.test(prevLine);

      if (makeSoft && hasHardMarker) {
        // Remove the hard marker line
        lines.splice(prevIdx, 1);
      } else if (!makeSoft && !hasHardMarker) {
        // Insert hard marker line before the assertion
        const indent = lines[lineIdx].match(/^(\s*)/)?.[1] ?? '';
        lines.splice(lineIdx, 0, `${indent}// Hard assertion`);
      }
    }

    code = lines.join('\n');
  }

  // Re-parse assertions from the updated code to keep line numbers consistent
  const updatedAssertions = parseAssertions(code);

  const branch = await getCurrentBranchForRepo(test.repositoryId);
  await queries.updateTestWithVersion(
    testId,
    { code, assertions: updatedAssertions.length > 0 ? updatedAssertions : currentAssertions },
    'manual_edit',
    branch ?? undefined,
  );
  revalidatePath('/tests');
  revalidatePath(`/tests/${testId}`);
}

export async function updateStepValue(testId: string, lineStart: number, lineEnd: number, oldValue: string, newValue: string) {
  const session = await requireTeamAccess();
  const test = await queries.getTest(testId);
  if (!test) throw new Error('Test not found');
  if (test.repositoryId) {
    const repo = await queries.getRepository(test.repositoryId);
    if (!repo || repo.teamId !== session.team.id) throw new Error('Forbidden');
  }

  let code = test.code || '';
  const lines = code.split('\n');

  // Escape the values for string replacement in code
  const escapedOld = oldValue.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const escapedNew = newValue.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  // Replace the value in the relevant lines
  let replaced = false;
  for (let i = lineStart - 1; i < Math.min(lineEnd, lines.length); i++) {
    if (lines[i].includes(escapedOld)) {
      lines[i] = lines[i].replace(escapedOld, escapedNew);
      replaced = true;
      break;
    }
  }

  if (!replaced) throw new Error('Could not find value in code');

  code = lines.join('\n');

  const { parseAssertions } = await import('@/lib/playwright/assertion-parser');
  const updatedAssertions = parseAssertions(code);

  const branch = await getCurrentBranchForRepo(test.repositoryId);
  await queries.updateTestWithVersion(
    testId,
    { code, assertions: updatedAssertions.length > 0 ? updatedAssertions : undefined },
    'manual_edit',
    branch ?? undefined,
  );
  revalidatePath('/tests');
  revalidatePath(`/tests/${testId}`);
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

export async function getTestDetailData(testId: string, repositoryId?: string | null) {
  await requireTeamAccess();
  const test = await queries.getTest(testId);
  if (!test) return null;

  const repoId = test.repositoryId || repositoryId;
  const [results, screenshotGroups, plannedScreenshots, defaultSetupSteps, availableTests, setupScripts, sheetDataSources, csvDataSources, playwrightSettings, diffSettings, envConfig, testSpec] = await Promise.all([
    queries.getTestResultsByTest(testId),
    getTestScreenshotsGrouped(testId, repoId),
    queries.getPlannedScreenshotsByTest(testId),
    repoId ? queries.getDefaultSetupSteps(repoId) : Promise.resolve([]),
    repoId ? queries.getTestsByRepo(repoId) : Promise.resolve([]),
    repoId ? queries.getSetupScripts(repoId) : Promise.resolve([]),
    repoId ? queries.getGoogleSheetsDataSources(repoId) : Promise.resolve([]),
    repoId ? queries.getCsvDataSources(repoId) : Promise.resolve([]),
    repoId ? queries.getPlaywrightSettings(repoId) : Promise.resolve(null),
    repoId ? queries.getDiffSensitivitySettings(repoId) : Promise.resolve(null),
    repoId ? queries.getEnvironmentConfig(repoId) : Promise.resolve(null),
    queries.getTestSpec(testId),
  ]);

  return {
    test,
    results,
    repositoryId: repoId,
    screenshotGroups,
    plannedScreenshots,
    defaultSetupSteps,
    availableTests,
    availableScripts: setupScripts,
    sheetDataSources,
    csvDataSources,
    stabilizationDefaults: playwrightSettings?.stabilization ?? null,
    diffDefaults: diffSettings,
    playwrightDefaults: playwrightSettings,
    envBaseUrl: envConfig?.baseUrl ?? null,
    testSpec,
  };
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
  _repositoryId?: string | null
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

  // Natural sort for filenames like step_1, step_2, ..., step_10
  const naturalCompare = (a: string, b: string) => {
    const nameA = a.split('/').pop() || '';
    const nameB = b.split('/').pop() || '';
    return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
  };

  // Build result
  const result: ScreenshotGroup[] = runIds.map(runId => ({
    runId,
    startedAt: runMap.get(runId) || null,
    screenshots: (groups.get(runId)?.screenshots || []).sort(naturalCompare),
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
