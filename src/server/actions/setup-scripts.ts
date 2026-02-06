'use server';

import { revalidatePath } from 'next/cache';
import * as queries from '@/lib/db/queries';
import { requireRepoAccess, requireTeamAccess } from '@/lib/auth';
import type { SetupScriptType } from '@/lib/db/schema';
import { validateApiScript } from '@/lib/setup/api-seeder';
import { chromium } from 'playwright';
import { runPlaywrightSetup } from '@/lib/setup/script-runner';
import type { SetupScript, SetupContext } from '@/lib/setup/types';

export interface CreateSetupScriptInput {
  repositoryId: string;
  name: string;
  type: SetupScriptType;
  code: string;
  description?: string;
}

export interface UpdateSetupScriptInput {
  name?: string;
  type?: SetupScriptType;
  code?: string;
  description?: string;
}

/**
 * Get all setup scripts for a repository
 */
export async function getSetupScripts(repositoryId: string) {
  return queries.getSetupScripts(repositoryId);
}

/**
 * Get a single setup script by ID
 */
export async function getSetupScript(id: string) {
  return queries.getSetupScript(id);
}

/**
 * Create a new setup script
 */
export async function createSetupScript(data: CreateSetupScriptInput) {
  await requireRepoAccess(data.repositoryId);
  // Validate API scripts
  if (data.type === 'api') {
    const validation = validateApiScript(data.code);
    if (!validation.valid) {
      throw new Error(`Invalid API script: ${validation.error}`);
    }
  }

  const result = await queries.createSetupScript({
    repositoryId: data.repositoryId,
    name: data.name,
    type: data.type,
    code: data.code,
    description: data.description,
  });

  revalidatePath('/settings/setup');
  return result;
}

/**
 * Update a setup script
 */
export async function updateSetupScript(id: string, data: UpdateSetupScriptInput) {
  await requireTeamAccess();
  // Validate API scripts if code is being updated
  if (data.type === 'api' && data.code) {
    const validation = validateApiScript(data.code);
    if (!validation.valid) {
      throw new Error(`Invalid API script: ${validation.error}`);
    }
  }

  await queries.updateSetupScript(id, data);
  revalidatePath('/settings/setup');
  return { success: true };
}

/**
 * Delete a setup script
 */
export async function deleteSetupScript(id: string) {
  await requireTeamAccess();
  // Check if script is in use
  const testsUsing = await queries.getTestsUsingSetupScript(id);
  const suitesUsing = await queries.getSuitesUsingSetupScript(id);

  if (testsUsing.length > 0 || suitesUsing.length > 0) {
    throw new Error(
      `Cannot delete: script is used by ${testsUsing.length} test(s) and ${suitesUsing.length} suite(s)`
    );
  }

  await queries.deleteSetupScript(id);
  revalidatePath('/settings/setup');
  return { success: true };
}

/**
 * Duplicate a setup script
 */
export async function duplicateSetupScript(id: string) {
  await requireTeamAccess();
  const result = await queries.duplicateSetupScript(id);
  if (!result) {
    throw new Error('Setup script not found');
  }

  revalidatePath('/settings/setup');
  return result;
}

/**
 * Test a setup script by running it in a temporary browser
 */
export async function testSetupScript(
  id: string,
  targetUrl: string
): Promise<{ success: boolean; duration: number; error?: string; variables?: Record<string, unknown> }> {
  await requireTeamAccess();
  const script = await queries.getSetupScript(id);
  if (!script) {
    return { success: false, duration: 0, error: 'Setup script not found' };
  }

  // Only test Playwright scripts directly
  // API scripts need a config and actual API endpoint
  if (script.type !== 'playwright') {
    return {
      success: false,
      duration: 0,
      error: 'Only Playwright scripts can be tested directly. API scripts require a configured endpoint.',
    };
  }

  let browser = null;
  let page = null;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    page = await context.newPage();

    const setupContext: SetupContext = {
      baseUrl: targetUrl,
      page,
      variables: {},
      repositoryId: script.repositoryId,
    };

    const result = await runPlaywrightSetup(page, script as SetupScript, setupContext);

    return {
      success: result.success,
      duration: result.duration,
      error: result.error,
      variables: result.variables,
    };
  } catch (error) {
    return {
      success: false,
      duration: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

/**
 * Assign a setup script to a test
 */
export async function assignSetupScriptToTest(testId: string, setupScriptId: string | null) {
  await requireTeamAccess();
  await queries.updateTestSetup(testId, null, setupScriptId);
  revalidatePath('/tests');
  return { success: true };
}

/**
 * Assign a setup test to a test
 */
export async function assignSetupTestToTest(testId: string, setupTestId: string | null) {
  await requireTeamAccess();
  await queries.updateTestSetup(testId, setupTestId, null);
  revalidatePath('/tests');
  return { success: true };
}

/**
 * Clear setup from a test
 */
export async function clearTestSetup(testId: string) {
  await requireTeamAccess();
  await queries.updateTestSetup(testId, null, null);
  revalidatePath('/tests');
  return { success: true };
}

/**
 * Assign a setup script to a suite
 */
export async function assignSetupScriptToSuite(suiteId: string, setupScriptId: string | null) {
  await requireTeamAccess();
  await queries.updateSuiteSetup(suiteId, null, setupScriptId);
  revalidatePath('/suites');
  return { success: true };
}

/**
 * Assign a setup test to a suite
 */
export async function assignSetupTestToSuite(suiteId: string, setupTestId: string | null) {
  await requireTeamAccess();
  await queries.updateSuiteSetup(suiteId, setupTestId, null);
  revalidatePath('/suites');
  return { success: true };
}

/**
 * Clear setup from a suite
 */
export async function clearSuiteSetup(suiteId: string) {
  await requireTeamAccess();
  await queries.updateSuiteSetup(suiteId, null, null);
  revalidatePath('/suites');
  return { success: true };
}

/**
 * Update repository default setup
 */
export async function updateRepositoryDefaultSetup(
  repositoryId: string,
  setupType: 'test' | 'script' | 'none',
  setupId: string | null
) {
  await requireRepoAccess(repositoryId);
  if (setupType === 'test') {
    await queries.updateRepositoryDefaultSetup(repositoryId, setupId, null);
  } else if (setupType === 'script') {
    await queries.updateRepositoryDefaultSetup(repositoryId, null, setupId);
  } else {
    await queries.updateRepositoryDefaultSetup(repositoryId, null, null);
  }

  revalidatePath('/settings');
  return { success: true };
}

/**
 * Get tests that can be used as setup (excludes self-references)
 */
export async function getAvailableSetupTests(repositoryId: string, excludeTestId?: string) {
  const tests = await queries.getTestsByRepo(repositoryId);
  return tests.filter(t => t.id !== excludeTestId);
}

/**
 * Get usage info for a setup script
 */
export async function getSetupScriptUsage(scriptId: string) {
  const testsUsing = await queries.getTestsUsingSetupScript(scriptId);
  const suitesUsing = await queries.getSuitesUsingSetupScript(scriptId);

  return {
    testCount: testsUsing.length,
    suiteCount: suitesUsing.length,
    tests: testsUsing.map(t => ({ id: t.id, name: t.name })),
    suites: suitesUsing.map(s => ({ id: s.id, name: s.name })),
  };
}

/**
 * Get usage info for a test used as setup
 */
export async function getSetupTestUsage(testId: string) {
  const testsUsing = await queries.getTestsUsingSetupTest(testId);
  const suitesUsing = await queries.getSuitesUsingSetupTest(testId);

  return {
    testCount: testsUsing.length,
    suiteCount: suitesUsing.length,
    tests: testsUsing.map(t => ({ id: t.id, name: t.name })),
    suites: suitesUsing.map(s => ({ id: s.id, name: s.name })),
  };
}
