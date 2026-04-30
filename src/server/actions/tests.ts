'use server';

import { revalidatePath } from 'next/cache';
import fs from 'fs';
import path from 'path';
import * as queries from '@/lib/db/queries';
import { requireRepoAccess, requireTeamAccess } from '@/lib/auth';
import type { NewTest, NewFunctionalArea } from '@/lib/db/schema';
import { getCurrentBranchForRepo } from '@/lib/git-utils';
import { STORAGE_DIRS } from '@/lib/storage/paths';

/**
 * Fetch all selector_stats rows for a test so the UI can display per-step
 * fallback success rates on hover. Best-effort — returns [] on auth or DB
 * errors, since this is purely diagnostic information.
 */
export async function getSelectorStatsForTestAction(testId: string) {
  const test = await queries.getTest(testId);
  if (!test) return [];
  if (test.repositoryId) await requireRepoAccess(test.repositoryId);
  else await requireTeamAccess();
  return queries.getSelectorStatsForTest(testId);
}

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
      if (v.sourceType === 'ai-generated') {
        if (!v.aiPreset) {
          throw new Error(`AI variable "${v.name}" requires aiPreset`);
        }
        if (v.aiPreset === 'custom' && !v.aiCustomPrompt?.trim()) {
          throw new Error(`AI variable "${v.name}" with custom preset requires aiCustomPrompt`);
        }
        if (v.sourceRowMode === 'increment') {
          throw new Error(`AI variable "${v.name}" cannot use increment mode`);
        }
      }
    }
  }

  await queries.updateTest(testId, { variables });
  revalidatePath('/tests');
  revalidatePath(`/tests/${testId}`);
  return { success: true };
}

/**
 * Generate an AI value for a single variable on demand (used by the "Refresh
 * now" button in the variable editor) and persist it as the cached value on
 * the test. Returns the generated string. Throws clear errors when AI is
 * misconfigured / rate-limited so the caller can surface a useful toast.
 */
export async function generateAIVarValuePreview(
  testId: string,
  variable: import('@/lib/db/schema').TestVariable,
): Promise<{ value: string }> {
  const session = await requireTeamAccess();
  const test = await queries.getTest(testId);
  if (!test) throw new Error('Test not found');
  if (test.repositoryId) {
    const repo = await queries.getRepository(test.repositoryId);
    if (!repo || repo.teamId !== session.team.id) throw new Error('Forbidden');
  }
  if (variable.sourceType !== 'ai-generated') {
    throw new Error('Variable is not AI-generated');
  }

  // Lazy imports to keep the action file's bundle slim and avoid cycles.
  const { buildAIVarPrompt, sanitizeAIVarOutput } = await import('@/lib/vars/ai-presets');
  const { generateWithAI } = await import('@/lib/ai');
  const prompt = buildAIVarPrompt(variable);
  if (!prompt) throw new Error('AI variable has no prompt configured');

  const settings = await queries.getAISettings(test.repositoryId ?? undefined);
  if (!settings) throw new Error('AI provider not configured');
  const provider = settings.provider as import('@/lib/ai').AIProviderConfig['provider'];
  if (provider === 'claude-cli') throw new Error('AI provider not configured (CLI provider is not used for variable generation — pick a different provider in AI settings)');
  if (provider === 'openrouter' && !settings.openrouterApiKey) throw new Error('OpenRouter API key is missing');
  if (provider === 'anthropic' && !settings.anthropicApiKey) throw new Error('Anthropic API key is missing');
  if (provider === 'openai' && !settings.openaiApiKey) throw new Error('OpenAI API key is missing');
  if (provider === 'ollama' && !settings.ollamaModel) throw new Error('Ollama model is not set');

  const config: import('@/lib/ai').AIProviderConfig = {
    provider,
    openrouterApiKey: settings.openrouterApiKey ?? undefined,
    openrouterModel: settings.openrouterModel ?? undefined,
    agentSdkPermissionMode: (settings.agentSdkPermissionMode ?? undefined) as import('@/lib/ai').AIProviderConfig['agentSdkPermissionMode'],
    agentSdkModel: settings.agentSdkModel ?? undefined,
    agentSdkWorkingDir: settings.agentSdkWorkingDir ?? undefined,
    ollamaBaseUrl: settings.ollamaBaseUrl ?? undefined,
    ollamaModel: settings.ollamaModel ?? undefined,
    anthropicApiKey: settings.anthropicApiKey ?? undefined,
    anthropicModel: settings.anthropicModel ?? undefined,
    openaiApiKey: settings.openaiApiKey ?? undefined,
    openaiModel: settings.openaiModel ?? undefined,
    customInstructions: settings.customInstructions ?? undefined,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  let raw: string;
  try {
    raw = await generateWithAI(
      config,
      prompt,
      'You generate short, realistic test data values. Output the value verbatim — no quotes, no labels, no commentary.',
      {
        actionType: 'generate_var_value',
        repositoryId: test.repositoryId ?? undefined,
        signal: controller.signal,
      },
    );
  } finally {
    clearTimeout(timeout);
  }
  const value = sanitizeAIVarOutput(raw);
  if (!value) throw new Error('AI returned an empty value');

  // Persist into the test row's aiVarLastValues cache so subsequent runs
  // (and the editor preview) see it without another AI call.
  const merged = { ...(test.aiVarLastValues ?? {}), [variable.id]: value };
  await queries.updateTest(testId, { aiVarLastValues: merged });
  revalidatePath(`/tests/${testId}`);
  return { value };
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

  const escapeForSingleQuoted = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const escapedOld = escapeForSingleQuoted(oldValue);
  const escapedNew = escapeForSingleQuoted(newValue);

  // Patterns that mirror extractEditableValue() in src/lib/playwright/debug-parser.ts.
  // We replace whatever fillable value sits on the given lines, not relying on oldValue
  // matching exactly — debounced edits can race router.refresh() and pass stale oldValue.
  const VALUE_PATTERNS: RegExp[] = [
    /(locateWithFallback\s*\([\s\S]*?,\s*'fill'\s*,\s*')((?:[^'\\]|\\.)*)(')/,
    /(locateWithFallback\s*\([\s\S]*?,\s*'selectOption'\s*,\s*')((?:[^'\\]|\\.)*)(')/,
    /(\.fill\s*\(\s*')((?:[^'\\]|\\.)*)(')/,
    /(\.keyboard\.type\s*\(\s*')((?:[^'\\]|\\.)*)(')/,
    /(\.selectOption\s*\(\s*')((?:[^'\\]|\\.)*)(')/,
  ];

  const sliceStart = Math.max(0, lineStart - 1);
  const sliceEnd = Math.min(lineEnd, lines.length);
  const block = lines.slice(sliceStart, sliceEnd).join('\n');

  let replaced = false;
  let newBlock = block;
  for (const re of VALUE_PATTERNS) {
    if (re.test(newBlock)) {
      newBlock = newBlock.replace(re, (_m, prefix: string, _value: string, suffix: string) =>
        `${prefix}${escapedNew}${suffix}`,
      );
      replaced = true;
      break;
    }
  }

  // Fallback: literal old-value match (handles cases the patterns above miss)
  if (!replaced && escapedOld) {
    const idx = newBlock.indexOf(escapedOld);
    if (idx !== -1) {
      newBlock = newBlock.slice(0, idx) + escapedNew + newBlock.slice(idx + escapedOld.length);
      replaced = true;
    }
  }

  if (!replaced) throw new Error('Could not find value in code');

  lines.splice(sliceStart, sliceEnd - sliceStart, ...newBlock.split('\n'));
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
  const session = await requireTeamAccess();
  const test = await queries.getTest(testId);
  if (!test) return null;

  const repoId = test.repositoryId || repositoryId;
  const [results, screenshotGroups, plannedScreenshots, defaultSetupSteps, availableTests, setupScripts, sheetDataSources, csvDataSources, googleSheetsAccount, playwrightSettings, diffSettings, envConfig, testSpec, aiSettings] = await Promise.all([
    queries.getTestResultsByTest(testId),
    getTestScreenshotsGrouped(testId, repoId),
    queries.getPlannedScreenshotsByTest(testId),
    repoId ? queries.getDefaultSetupSteps(repoId) : Promise.resolve([]),
    repoId ? queries.getTestsByRepo(repoId) : Promise.resolve([]),
    repoId ? queries.getSetupScripts(repoId) : Promise.resolve([]),
    repoId ? queries.getGoogleSheetsDataSources(repoId) : Promise.resolve([]),
    repoId ? queries.getCsvDataSources(repoId) : Promise.resolve([]),
    queries.getGoogleSheetsAccount(session.team.id),
    repoId ? queries.getPlaywrightSettings(repoId) : Promise.resolve(null),
    repoId ? queries.getDiffSensitivitySettings(repoId) : Promise.resolve(null),
    repoId ? queries.getEnvironmentConfig(repoId) : Promise.resolve(null),
    queries.getTestSpec(testId),
    queries.getAISettings(repoId ?? undefined),
  ]);

  // AI is "available" for variable generation when a non-CLI provider is
  // chosen AND its credentials/model are present. Mirrors the gating in
  // executor.buildAIVarRuntime so the editor stays honest about whether the
  // Refresh-now button will work.
  const aiAvailable = !!aiSettings && (() => {
    const p = aiSettings.provider;
    if (!p || p === 'claude-cli') return false;
    if (p === 'openrouter') return !!aiSettings.openrouterApiKey;
    if (p === 'anthropic') return !!aiSettings.anthropicApiKey;
    if (p === 'openai') return !!aiSettings.openaiApiKey;
    if (p === 'ollama') return !!aiSettings.ollamaModel;
    if (p === 'claude-agent-sdk') return true;
    return false;
  })();

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
    googleSheetsAccount: googleSheetsAccount
      ? {
          id: googleSheetsAccount.id,
          googleEmail: googleSheetsAccount.googleEmail,
          googleName: googleSheetsAccount.googleName,
        }
      : null,
    stabilizationDefaults: playwrightSettings?.stabilization ?? null,
    diffDefaults: diffSettings,
    playwrightDefaults: playwrightSettings,
    envBaseUrl: envConfig?.baseUrl ?? null,
    testSpec,
    aiAvailable,
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
  // Baseline + diff lookup keyed by the captured screenshot path (matches
  // `currentImagePath` on visualDiffs). Lets the gallery viewer toggle to
  // "diff vs baseline" without an extra fetch on click.
  diffsByPath?: Record<string, { baselineImagePath: string | null; diffImagePath: string | null }>;
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
  const groups: Map<string, { startedAt: Date | null; screenshots: string[]; diffsByPath: Record<string, { baselineImagePath: string | null; diffImagePath: string | null }> }> = new Map();

  for (const result of testResults) {
    const runId = result.testRunId;
    if (!runId) continue;

    if (!groups.has(runId)) {
      groups.set(runId, { startedAt: null, screenshots: [], diffsByPath: {} });
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

    // Pair each captured screenshot with its visualDiff (if any) so the gallery
    // viewer can show "diff vs baseline" without an extra round-trip on click.
    const diffs = await queries.getVisualDiffsByTestResult(result.id);
    for (const d of diffs) {
      if (!d.currentImagePath) continue;
      group.diffsByPath[d.currentImagePath] = {
        baselineImagePath: d.baselineImagePath,
        diffImagePath: d.diffImagePath,
      };
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
    diffsByPath: groups.get(runId)?.diffsByPath ?? {},
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
