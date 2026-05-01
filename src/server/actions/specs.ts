'use server';

import * as queries from '@/lib/db/queries';
import { requireRepoAccess, requireTeamAccess } from '@/lib/auth';
import {
  generateWithAI,
  SYSTEM_PROMPT,
  createTestPrompt,
  extractCodeFromResponse,
} from '@/lib/ai';
import type { AIProviderConfig, TestGenerationContext } from '@/lib/ai/types';
import { revalidatePath } from 'next/cache';
import { createHash } from 'crypto';
import { getCurrentBranchForRepo } from '@/lib/git-utils';
import { PLACEHOLDER_CODE } from '@/lib/constants/placeholder';

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

async function getAIConfig(repositoryId: string): Promise<AIProviderConfig> {
  const settings = await queries.getAISettings(repositoryId);
  return {
    provider: settings.provider as 'claude-cli' | 'openrouter' | 'claude-agent-sdk',
    openrouterApiKey: settings.openrouterApiKey,
    openrouterModel: settings.openrouterModel || 'anthropic/claude-sonnet-4',
    customInstructions: settings.customInstructions,
    agentSdkPermissionMode: settings.agentSdkPermissionMode as 'plan' | 'default' | 'acceptEdits' | undefined,
    agentSdkModel: settings.agentSdkModel || undefined,
    agentSdkWorkingDir: settings.agentSdkWorkingDir || undefined,
  };
}

/** Upsert a spec for an existing test */
export async function saveTestSpec(
  testId: string,
  title: string,
  spec: string,
  repositoryId: string,
  functionalAreaId?: string | null,
) {
  await requireRepoAccess(repositoryId);

  const existing = await queries.getTestSpec(testId);
  const test = await queries.getTest(testId);

  if (existing) {
    const isOutdated = test && existing.codeHash && hashCode(test.code) !== existing.codeHash;
    await queries.updateTestSpec(existing.id, {
      title,
      spec,
      status: isOutdated ? 'outdated' : (test ? 'has_test' : 'draft'),
    });
    revalidatePath(`/tests/${testId}`);
    return existing.id;
  }

  const specId = await queries.createTestSpec({
    repositoryId,
    testId,
    functionalAreaId: functionalAreaId ?? test?.functionalAreaId ?? null,
    title,
    spec,
    source: 'manual',
    status: test ? 'has_test' : 'draft',
    codeHash: test ? hashCode(test.code) : null,
  });

  // Back-link test to spec
  if (test) {
    await queries.linkSpecToTest(specId, testId);
  }

  revalidatePath(`/tests/${testId}`);
  return specId;
}

/** Create a standalone spec (no test yet) */
export async function createStandaloneSpec(
  repositoryId: string,
  functionalAreaId: string | null,
  title: string,
  spec: string,
) {
  await requireRepoAccess(repositoryId);

  const specId = await queries.createTestSpec({
    repositoryId,
    testId: null,
    functionalAreaId,
    title,
    spec,
    source: 'manual',
    status: 'draft',
    codeHash: null,
  });

  revalidatePath('/areas');
  return specId;
}

/** Create a placeholder test with a linked spec in one action.
 * `description` is no longer stored on the test directly — it lives on the linked test_specs row. */
export async function createPlaceholderTestCase(
  repositoryId: string,
  functionalAreaId: string,
  name: string,
  description: string | null,
): Promise<{ testId: string }> {
  await requireRepoAccess(repositoryId);

  const test = await queries.createTest({
    repositoryId,
    functionalAreaId,
    name,
    code: PLACEHOLDER_CODE,
    isPlaceholder: true,
  });

  const specId = await queries.createTestSpec({
    repositoryId,
    testId: test.id,
    functionalAreaId,
    title: name,
    spec: description || name,
    source: 'manual',
    status: 'has_test',
    codeHash: hashCode(PLACEHOLDER_CODE),
  });
  await queries.linkSpecToTest(specId, test.id);

  revalidatePath('/areas');
  revalidatePath('/tests');
  return { testId: test.id };
}

/** Generate test code from a spec using AI, create a new test, and link it */
export async function generateTestFromSpec(
  specId: string,
  repositoryId: string,
): Promise<{ success: boolean; testId?: string; error?: string }> {
  await requireRepoAccess(repositoryId);

  const spec = await queries.getSpecById(specId);
  if (!spec) return { success: false, error: 'Spec not found' };

  try {
    const config = await getAIConfig(repositoryId);
    const envConfig = await queries.getEnvironmentConfig(repositoryId);
    const baseUrl = envConfig?.baseUrl || 'http://localhost:3000';

    const context: TestGenerationContext = {
      targetUrl: baseUrl,
      userPrompt: `Create a Playwright test based on this specification:\n\nTitle: ${spec.title}\n\nSpec:\n${spec.spec}`,
    };

    const prompt = createTestPrompt(context);
    const response = await generateWithAI(config, prompt, SYSTEM_PROMPT, {
      actionType: 'create_test',
      repositoryId,
    });
    const code = extractCodeFromResponse(response);

    const testId = (await queries.createTest({
      repositoryId,
      functionalAreaId: spec.functionalAreaId,
      name: spec.title,
      code,
      targetUrl: baseUrl,
      specId,
    })).id;

    await queries.linkSpecToTest(specId, testId);
    await queries.updateTestSpec(specId, { codeHash: hashCode(code) });

    revalidatePath('/areas');
    revalidatePath(`/tests/${testId}`);
    return { success: true, testId };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate test';
    return { success: false, error: message };
  }
}

/** Regenerate test code from an updated spec, saving old code as a version */
export async function regenerateTestFromSpec(
  specId: string,
  repositoryId: string,
): Promise<{ success: boolean; error?: string }> {
  await requireRepoAccess(repositoryId);

  const spec = await queries.getSpecById(specId);
  if (!spec || !spec.testId) return { success: false, error: 'Spec not linked to a test' };

  const test = await queries.getTest(spec.testId);
  if (!test) return { success: false, error: 'Linked test not found' };

  try {
    const config = await getAIConfig(repositoryId);
    const envConfig = await queries.getEnvironmentConfig(repositoryId);
    const baseUrl = envConfig?.baseUrl || test.targetUrl || 'http://localhost:3000';

    const context: TestGenerationContext = {
      targetUrl: baseUrl,
      existingCode: test.code,
      userPrompt: `Regenerate this Playwright test to match the updated specification.\n\nSpec Title: ${spec.title}\n\nSpec:\n${spec.spec}`,
    };

    const prompt = createTestPrompt(context);
    const response = await generateWithAI(config, prompt, SYSTEM_PROMPT, {
      actionType: 'create_test',
      repositoryId,
    });
    const code = extractCodeFromResponse(response);
    const branch = await getCurrentBranchForRepo(repositoryId);

    await queries.updateTestWithVersion(
      spec.testId,
      { code },
      'spec_regeneration',
      branch ?? undefined,
    );

    await queries.updateTestSpec(specId, {
      status: 'has_test',
      codeHash: hashCode(code),
    });

    revalidatePath(`/tests/${spec.testId}`);
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to regenerate test';
    return { success: false, error: message };
  }
}

/** Parse an area's agentPlan markdown into individual specs */
export async function convertPlanToSpecs(
  functionalAreaId: string,
  repositoryId: string,
): Promise<{ created: number }> {
  await requireRepoAccess(repositoryId);

  const area = await queries.getFunctionalArea(functionalAreaId);
  if (!area?.agentPlan) return { created: 0 };

  // Parse bullets/numbered items from plan markdown
  const lines = area.agentPlan.split('\n');
  const specs: { title: string; body: string }[] = [];
  let currentTitle = '';
  let currentBody: string[] = [];

  for (const line of lines) {
    // Match numbered items or bullet points that look like test scenarios
    const match = line.match(/^(?:\d+[\.\)]\s*|\-\s+|\*\s+)\*{0,2}(.+?)\*{0,2}\s*$/);
    if (match) {
      // Save previous spec
      if (currentTitle) {
        specs.push({ title: currentTitle, body: currentBody.join('\n').trim() });
      }
      currentTitle = match[1].replace(/\*\*/g, '').trim();
      currentBody = [];
    } else if (currentTitle && line.trim()) {
      currentBody.push(line.trim());
    }
  }
  // Save last spec
  if (currentTitle) {
    specs.push({ title: currentTitle, body: currentBody.join('\n').trim() });
  }

  // Check existing specs for this area to avoid duplicates
  const existingSpecs = await queries.getSpecsForArea(functionalAreaId);
  const existingTitles = new Set(existingSpecs.map(s => s.title.toLowerCase()));

  let created = 0;
  for (const { title, body } of specs) {
    if (existingTitles.has(title.toLowerCase())) continue;

    await queries.createTestSpec({
      repositoryId,
      testId: null,
      functionalAreaId,
      title,
      spec: body || title,
      source: 'planner',
      status: 'draft',
      codeHash: null,
    });
    created++;
  }

  revalidatePath('/areas');
  return { created };
}

/** Parse an area's agentPlan markdown into individual placeholder tests */
export async function convertPlanToPlaceholders(
  functionalAreaId: string,
  repositoryId: string,
): Promise<{ created: number }> {
  await requireRepoAccess(repositoryId);

  const area = await queries.getFunctionalArea(functionalAreaId);
  if (!area?.agentPlan) return { created: 0 };

  // Parse bullets/numbered items from plan markdown
  const lines = area.agentPlan.split('\n');
  const items: { title: string; body: string }[] = [];
  let currentTitle = '';
  let currentBody: string[] = [];

  for (const line of lines) {
    const match = line.match(/^(?:\d+[\.\)]\s*|\-\s+|\*\s+)\*{0,2}(.+?)\*{0,2}\s*$/);
    if (match) {
      if (currentTitle) {
        items.push({ title: currentTitle, body: currentBody.join('\n').trim() });
      }
      currentTitle = match[1].replace(/\*\*/g, '').trim();
      currentBody = [];
    } else if (currentTitle && line.trim()) {
      currentBody.push(line.trim());
    }
  }
  if (currentTitle) {
    items.push({ title: currentTitle, body: currentBody.join('\n').trim() });
  }

  // Deduplicate against existing tests in this area
  const existingTests = await queries.getTestsByFunctionalArea(functionalAreaId);
  const existingNames = new Set(existingTests.map(t => t.name.toLowerCase()));

  // Build spec body with area context (area's full plan is the canonical source)
  const areaContext = [
    area.name ? `**Area:** ${area.name}` : '',
    area.agentPlan ? `**Plan:**\n${area.agentPlan}` : '',
  ].filter(Boolean).join('\n\n');

  let created = 0;
  for (const { title, body } of items) {
    if (existingNames.has(title.toLowerCase())) continue;

    const specBody = [areaContext, body || title].filter(Boolean).join('\n\n');

    const test = await queries.createTest({
      repositoryId,
      functionalAreaId,
      name: title,
      code: PLACEHOLDER_CODE,
      isPlaceholder: true,
    });

    // Create linked testSpec so the Spec tab is populated
    const specId = await queries.createTestSpec({
      repositoryId,
      testId: test.id,
      functionalAreaId,
      title,
      spec: specBody,
      source: 'planner',
      status: 'has_test',
      codeHash: hashCode(PLACEHOLDER_CODE),
    });
    await queries.linkSpecToTest(specId, test.id);

    created++;
  }

  revalidatePath('/areas');
  revalidatePath('/tests');
  return { created };
}

/** Reverse of convertPlanToSpecs: compose an area's `agentPlan` from its existing specs. */
export async function generatePlanFromSpecs(
  functionalAreaId: string,
  repositoryId: string,
): Promise<{ success: boolean; planLength?: number; error?: string }> {
  await requireRepoAccess(repositoryId);

  const area = await queries.getFunctionalArea(functionalAreaId);
  if (!area) return { success: false, error: 'Area not found' };

  const specs = await queries.getSpecsForArea(functionalAreaId);
  if (specs.length === 0) return { success: false, error: 'No specs to compose plan from' };

  const header = `## ${area.name}`;
  const scenarios = specs.map((s, idx) => {
    const body = s.spec?.trim() ? s.spec.trim() : s.title;
    return `### Scenario ${idx + 1}: ${s.title}\n${body}`;
  });
  const plan = `${header}\n\n${scenarios.join('\n\n')}`;

  await queries.updateFunctionalArea(functionalAreaId, {
    agentPlan: plan,
    planGeneratedAt: new Date(),
  });

  revalidatePath('/areas');
  revalidatePath('/tests');
  return { success: true, planLength: plan.length };
}

/** Given tests (optionally placeholder) in an area, create a linked spec for each one that lacks one. */
export async function generateSpecsFromTests(
  functionalAreaId: string,
  repositoryId: string,
  options?: { testIds?: string[] },
): Promise<{ created: number }> {
  await requireRepoAccess(repositoryId);

  const area = await queries.getFunctionalArea(functionalAreaId);
  if (!area) return { created: 0 };

  const allTests = await queries.getTestsByFunctionalArea(functionalAreaId);
  const targetTests = options?.testIds
    ? allTests.filter(t => options.testIds!.includes(t.id))
    : allTests;

  let created = 0;
  for (const test of targetTests) {
    const existing = await queries.getTestSpec(test.id);
    if (existing) continue;

    const specBody = [
      area.name ? `**Area:** ${area.name}` : '',
      area.agentPlan ? `**Plan:**\n${area.agentPlan}` : '',
    ].filter(Boolean).join('\n\n') || test.name;

    const specId = await queries.createTestSpec({
      repositoryId,
      testId: test.id,
      functionalAreaId,
      title: test.name,
      spec: specBody,
      source: 'manual',
      status: 'has_test',
      codeHash: hashCode(test.code),
    });
    await queries.linkSpecToTest(specId, test.id);
    created++;
  }

  if (created > 0) {
    revalidatePath('/areas');
    revalidatePath('/tests');
  }
  return { created };
}

/** Compose an area's `agentPlan` from its existing tests (name + description). */
export async function generatePlanFromTests(
  functionalAreaId: string,
  repositoryId: string,
  options?: { testIds?: string[] },
): Promise<{ success: boolean; planLength?: number; error?: string }> {
  await requireRepoAccess(repositoryId);

  const area = await queries.getFunctionalArea(functionalAreaId);
  if (!area) return { success: false, error: 'Area not found' };

  const allTests = await queries.getTestsByFunctionalArea(functionalAreaId);
  const targetTests = options?.testIds
    ? allTests.filter(t => options.testIds!.includes(t.id))
    : allTests;

  if (targetTests.length === 0) return { success: false, error: 'No tests to compose plan from' };

  // Pull spec markdown for each test (canonical "what does this test do" source)
  const specsByTestId = new Map<string, string>();
  for (const t of targetTests) {
    const s = await queries.getTestSpec(t.id);
    if (s?.spec?.trim()) specsByTestId.set(t.id, s.spec.trim());
  }

  const header = `## ${area.name}`;
  const scenarios = targetTests.map((t, idx) => {
    const body = specsByTestId.get(t.id) ?? t.name;
    return `### Scenario ${idx + 1}: ${t.name}\n${body}`;
  });
  const plan = `${header}\n\n${scenarios.join('\n\n')}`;

  await queries.updateFunctionalArea(functionalAreaId, {
    agentPlan: plan,
    planGeneratedAt: new Date(),
  });

  revalidatePath('/areas');
  revalidatePath('/tests');
  return { success: true, planLength: plan.length };
}

/**
 * Fill the missing half (plan or specs) of an area, using tests as a fallback.
 * Idempotent: safe to call after each of the generation paths (planner, generator, import).
 */
export async function syncAreaPlanAndSpecs(
  functionalAreaId: string,
  repositoryId: string,
): Promise<{ specsCreated: number; planCreated: boolean }> {
  await requireRepoAccess(repositoryId);

  const area = await queries.getFunctionalArea(functionalAreaId);
  if (!area) return { specsCreated: 0, planCreated: false };

  const specs = await queries.getSpecsForArea(functionalAreaId);
  const tests = await queries.getTestsByFunctionalArea(functionalAreaId);
  const hasPlan = !!area.agentPlan?.trim();

  let specsCreated = 0;
  let planCreated = false;

  // Fill specs side
  if (specs.length === 0) {
    if (hasPlan) {
      const result = await convertPlanToSpecs(functionalAreaId, repositoryId);
      specsCreated += result.created;
    } else if (tests.length > 0) {
      const result = await generateSpecsFromTests(functionalAreaId, repositoryId);
      specsCreated += result.created;
    }
  } else {
    // Back-fill specs for any tests missing one
    const result = await generateSpecsFromTests(functionalAreaId, repositoryId);
    specsCreated += result.created;
  }

  // Fill plan side
  if (!hasPlan) {
    const currentSpecs = specs.length > 0 ? specs : await queries.getSpecsForArea(functionalAreaId);
    if (currentSpecs.length > 0) {
      const result = await generatePlanFromSpecs(functionalAreaId, repositoryId);
      planCreated = result.success;
    } else if (tests.length > 0) {
      const result = await generatePlanFromTests(functionalAreaId, repositoryId);
      planCreated = result.success;
    }
  }

  return { specsCreated, planCreated };
}

/** Bulk: for a set of tests (possibly across areas), create missing specs and refresh plan per area. */
export async function bulkGenerateForTests(
  repositoryId: string,
  testIds: string[],
): Promise<{ specsCreated: number; areasUpdated: number }> {
  await requireRepoAccess(repositoryId);

  if (testIds.length === 0) return { specsCreated: 0, areasUpdated: 0 };

  // Group tests by area
  const testsById = await Promise.all(testIds.map(id => queries.getTest(id)));
  const areaGroups = new Map<string, string[]>();
  for (const t of testsById) {
    if (!t?.functionalAreaId) continue;
    const list = areaGroups.get(t.functionalAreaId) ?? [];
    list.push(t.id);
    areaGroups.set(t.functionalAreaId, list);
  }

  let specsCreated = 0;
  for (const [areaId, ids] of areaGroups) {
    const { created } = await generateSpecsFromTests(areaId, repositoryId, { testIds: ids });
    specsCreated += created;
    // Refresh the plan side so both halves stay in sync.
    await generatePlanFromTests(areaId, repositoryId);
  }

  revalidatePath('/areas');
  revalidatePath('/tests');
  return { specsCreated, areasUpdated: areaGroups.size };
}

/** Check if a test's code has drifted from its spec */
export async function detectSpecDrift(testId: string): Promise<{ isDrifted: boolean; specId?: string }> {
  await requireTeamAccess();

  const spec = await queries.getTestSpec(testId);
  if (!spec) return { isDrifted: false };

  const test = await queries.getTest(testId);
  if (!test) return { isDrifted: false };

  const currentHash = hashCode(test.code);
  const isDrifted = spec.codeHash !== null && spec.codeHash !== currentHash;

  if (isDrifted && spec.status !== 'outdated') {
    await queries.updateTestSpec(spec.id, { status: 'outdated' });
  }

  return { isDrifted, specId: spec.id };
}
