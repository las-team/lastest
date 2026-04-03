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
      description: spec.spec.split('\n')[0],
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
