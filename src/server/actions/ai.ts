'use server';

import * as queries from '@/lib/db/queries';
import { requireTeamAccess, requireRepoAccess } from '@/lib/auth';
import {
  generateWithAI,
  SYSTEM_PROMPT,
  createFixPrompt,
  extractCodeFromResponse,
} from '@/lib/ai';
import type { AIProviderConfig, TestGenerationContext, CodebaseIntelligenceContext } from '@/lib/ai/types';
import { revalidatePath } from 'next/cache';
import { getCurrentBranchForRepo } from '@/lib/git-utils';
import { agentCreateTest } from '@/lib/playwright/generator-agent';
import { emitAndPersistActivityEvent } from '@/lib/db/queries/activity-events';
import { awardScore } from '@/server/actions/gamification';
import type { AgentStepState } from '@/lib/db/schema';
import { db } from '@/lib/db';
import { embeddedSessions } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

/** Find a ready embedded browser's CDP + stream URLs for MCP integration */
async function findAvailableEmbeddedBrowser(): Promise<{ cdpUrl: string; streamUrl: string } | undefined> {
  const [session] = await db
    .select({ cdpUrl: embeddedSessions.cdpUrl, streamUrl: embeddedSessions.streamUrl })
    .from(embeddedSessions)
    .where(eq(embeddedSessions.status, 'ready'))
    .limit(1);
  if (session?.cdpUrl && session?.streamUrl) {
    return { cdpUrl: session.cdpUrl, streamUrl: session.streamUrl };
  }
  return undefined;
}

async function getAIConfig(repositoryId?: string | null): Promise<AIProviderConfig> {
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

export async function aiFixTest(
  repositoryId: string,
  testId: string,
  errorMessage: string,
  codebaseIntelligence?: CodebaseIntelligenceContext,
): Promise<{ success: boolean; code?: string; error?: string }> {
  await requireRepoAccess(repositoryId);
  try {
    const test = await queries.getTest(testId);
    if (!test) {
      return { success: false, error: 'Test not found' };
    }

    const config = await getAIConfig(repositoryId);
    const prompt = createFixPrompt({
      existingCode: test.code,
      errorMessage,
      codebaseIntelligence,
    });
    const response = await generateWithAI(config, prompt, SYSTEM_PROMPT, {
      actionType: 'fix_test',
      repositoryId,
    });
    const code = extractCodeFromResponse(response);

    return { success: true, code };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fix test';
    return { success: false, error: message };
  }
}

/**
 * Enhance test: uses agentic browser inspection to improve test with verified selectors.
 */
export async function aiEnhanceTest(
  repositoryId: string,
  testId: string,
  userPrompt?: string
): Promise<{ success: boolean; code?: string; error?: string }> {
  const { agentEnhanceTest } = await import('@/lib/playwright/enhancer-agent');
  return agentEnhanceTest(repositoryId, testId, userPrompt);
}

export async function saveGeneratedTest(data: {
  repositoryId: string;
  functionalAreaId?: string;
  name: string;
  code: string;
  targetUrl?: string;
  description?: string;
}): Promise<{ success: boolean; testId?: string; error?: string }> {
  await requireRepoAccess(data.repositoryId);
  try {
    const test = await queries.createTest({
      repositoryId: data.repositoryId,
      functionalAreaId: data.functionalAreaId || null,
      name: data.name,
      code: data.code,
      targetUrl: data.targetUrl || null,
      description: data.description || null,
    });

    revalidatePath('/tests');

    return { success: true, testId: test.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save test';
    return { success: false, error: message };
  }
}

export async function startGenerateTestAgent(data: {
  repositoryId: string;
  userPrompt: string;
  targetUrl?: string;
  testName: string;
  functionalAreaId?: string;
  headless?: boolean;
}): Promise<{ success: boolean; sessionId?: string; error?: string }> {
  const { team } = await requireRepoAccess(data.repositoryId);
  const teamId = team?.id ?? '';

  try {
    const steps: AgentStepState[] = [{
      id: 'generate',
      status: 'active',
      label: 'Generate Test',
      description: `Generating "${data.testName}" via MCP exploration`,
      startedAt: new Date().toISOString(),
    }];

    const session = await queries.createAgentSession({
      repositoryId: data.repositoryId,
      teamId: teamId || null,
      status: 'active',
      currentStepId: 'generate',
      steps,
      metadata: { testName: data.testName, userPrompt: data.userPrompt, streamUrl: null } as Record<string, unknown>,
    });

    emitAndPersistActivityEvent({
      teamId,
      repositoryId: data.repositoryId,
      sessionId: session.id,
      sourceType: 'generate_agent',
      eventType: 'session:start',
      summary: `Generating test "${data.testName}"`,
      stepId: null, agentType: 'generator', detail: null,
      artifactType: null, artifactId: null, artifactLabel: null,
      durationMs: null, promptLogId: null,
    }).catch(() => {});

    // Fire-and-forget background execution
    (async () => {
      const startTime = Date.now();
      try {
        // Try to use an embedded browser's CDP endpoint for live streaming
        const eb = await findAvailableEmbeddedBrowser();
        if (eb) {
          console.log(`[GenerateTestAgent] Using embedded browser CDP: ${eb.cdpUrl}, stream: ${eb.streamUrl}`);
          // Store stream URL in session metadata so the UI can show the viewer
          await queries.updateAgentSession(session.id, {
            metadata: { ...session.metadata, streamUrl: eb.streamUrl } as Record<string, unknown>,
          }).catch(() => {});
        }

        const result = await agentCreateTest(data.repositoryId, {
          userPrompt: data.userPrompt,
          targetUrl: data.targetUrl,
          routePath: data.targetUrl,
        }, { headless: data.headless, cdpEndpoint: eb?.cdpUrl });

        if (!result.success || !result.code) {
          throw new Error(result.error || 'Generator agent produced no test code');
        }

        const generateBot = await queries.getBotByKind(teamId, 'generate_agent');
        const test = await queries.createTest({
          repositoryId: data.repositoryId,
          functionalAreaId: data.functionalAreaId || null,
          name: data.testName,
          code: result.code,
          targetUrl: data.targetUrl || null,
          ...(generateBot ? { createdByBotId: generateBot.id } : {}),
        });

        await queries.updateAgentSession(session.id, {
          status: 'completed',
          completedAt: new Date(),
          steps: [{
            ...steps[0],
            status: 'completed',
            completedAt: new Date().toISOString(),
            result: { testId: test.id },
          }],
        });

        emitAndPersistActivityEvent({
          teamId,
          repositoryId: data.repositoryId,
          sessionId: session.id,
          sourceType: 'generate_agent',
          eventType: 'artifact:created',
          summary: `Created test "${data.testName}"`,
          stepId: 'generate', agentType: 'generator', detail: null,
          artifactType: 'test', artifactId: test.id, artifactLabel: data.testName,
          durationMs: Date.now() - startTime, promptLogId: null,
        }).catch(() => {});

        emitAndPersistActivityEvent({
          teamId,
          repositoryId: data.repositoryId,
          sessionId: session.id,
          sourceType: 'generate_agent',
          eventType: 'session:complete',
          summary: `Test "${data.testName}" generated successfully`,
          stepId: null, agentType: null, detail: null,
          artifactType: null, artifactId: null, artifactLabel: null,
          durationMs: Date.now() - startTime, promptLogId: null,
        }).catch(() => {});

        revalidatePath('/tests');
      } catch (err) {
        console.error('[GenerateTestAgent] Error:', err);
        await queries.updateAgentSession(session.id, {
          status: 'failed',
          completedAt: new Date(),
          steps: [{
            ...steps[0],
            status: 'failed',
            completedAt: new Date().toISOString(),
            error: err instanceof Error ? err.message : String(err),
          }],
        }).catch(() => {});

        emitAndPersistActivityEvent({
          teamId,
          repositoryId: data.repositoryId,
          sessionId: session.id,
          sourceType: 'generate_agent',
          eventType: 'session:error',
          summary: `Failed to generate test "${data.testName}": ${err instanceof Error ? err.message : String(err)}`,
          stepId: null, agentType: null, detail: null,
          artifactType: null, artifactId: null, artifactLabel: null,
          durationMs: Date.now() - startTime, promptLogId: null,
        }).catch(() => {});
      }
    })();

    return { success: true, sessionId: session.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to start test generation';
    return { success: false, error: message };
  }
}

export async function startGeneratePlaceholderTestAgent(data: {
  testId: string;
  repositoryId: string;
}): Promise<{ success: boolean; sessionId?: string; error?: string }> {
  const { team } = await requireRepoAccess(data.repositoryId);
  const teamId = team?.id ?? '';

  try {
    const test = await queries.getTest(data.testId);
    if (!test) return { success: false, error: 'Test not found' };

    // Build prompt from test description + area context
    const promptParts: string[] = [];
    if (test.description) promptParts.push(test.description);

    if (test.functionalAreaId) {
      const area = await queries.getFunctionalArea(test.functionalAreaId);
      if (area?.description) promptParts.push(`Area: ${area.name}\nArea Description: ${area.description}`);
      if (area?.agentPlan) promptParts.push(`Test Plan:\n${area.agentPlan}`);
    }

    if (promptParts.length === 0) promptParts.push(`Generate a test for: ${test.name}`);
    const userPrompt = promptParts.join('\n\n');

    const steps: AgentStepState[] = [{
      id: 'generate',
      status: 'active',
      label: 'Generate Test',
      description: `Generating "${test.name}" from placeholder via MCP exploration`,
      startedAt: new Date().toISOString(),
    }];

    const session = await queries.createAgentSession({
      repositoryId: data.repositoryId,
      teamId: teamId || null,
      status: 'active',
      currentStepId: 'generate',
      steps,
      metadata: { testName: test.name, testId: data.testId, userPrompt, streamUrl: null } as Record<string, unknown>,
    });

    emitAndPersistActivityEvent({
      teamId,
      repositoryId: data.repositoryId,
      sessionId: session.id,
      sourceType: 'generate_agent',
      eventType: 'session:start',
      summary: `Generating placeholder test "${test.name}"`,
      stepId: null, agentType: 'generator', detail: null,
      artifactType: null, artifactId: null, artifactLabel: null,
      durationMs: null, promptLogId: null,
    }).catch(() => {});

    // Fire-and-forget background execution
    (async () => {
      const startTime = Date.now();
      try {
        const eb = await findAvailableEmbeddedBrowser();
        if (eb) {
          console.log(`[GeneratePlaceholderAgent] Using embedded browser CDP: ${eb.cdpUrl}, stream: ${eb.streamUrl}`);
          await queries.updateAgentSession(session.id, {
            metadata: { ...session.metadata, streamUrl: eb.streamUrl } as Record<string, unknown>,
          }).catch(() => {});
        }

        const result = await agentCreateTest(data.repositoryId, {
          userPrompt,
          testName: test.name,
          targetUrl: test.targetUrl ?? undefined,
          routePath: test.targetUrl ?? undefined,
          functionalAreaId: test.functionalAreaId ?? undefined,
        }, { cdpEndpoint: eb?.cdpUrl });

        if (!result.success || !result.code) {
          throw new Error(result.error || 'Generator agent produced no test code');
        }

        // Update existing test instead of creating a new one
        await queries.updateTestWithVersion(data.testId, {
          code: result.code,
          isPlaceholder: false,
        }, 'ai_generated');

        // Award test_created points to generate_agent bot
        const generateBot = await queries.getBotByKind(teamId, 'generate_agent');
        if (generateBot && teamId) {
          awardScore({
            teamId,
            kind: 'test_created',
            actor: { kind: 'bot', id: generateBot.id },
            sourceType: 'test',
            sourceId: data.testId,
          }).catch(() => {});
        }

        await queries.updateAgentSession(session.id, {
          status: 'completed',
          completedAt: new Date(),
          steps: [{
            ...steps[0],
            status: 'completed',
            completedAt: new Date().toISOString(),
            result: { testId: data.testId },
          }],
        });

        emitAndPersistActivityEvent({
          teamId,
          repositoryId: data.repositoryId,
          sessionId: session.id,
          sourceType: 'generate_agent',
          eventType: 'artifact:created',
          summary: `Generated test "${test.name}" from placeholder`,
          stepId: 'generate', agentType: 'generator', detail: null,
          artifactType: 'test', artifactId: data.testId, artifactLabel: test.name,
          durationMs: Date.now() - startTime, promptLogId: null,
        }).catch(() => {});

        emitAndPersistActivityEvent({
          teamId,
          repositoryId: data.repositoryId,
          sessionId: session.id,
          sourceType: 'generate_agent',
          eventType: 'session:complete',
          summary: `Placeholder test "${test.name}" generated successfully`,
          stepId: null, agentType: null, detail: null,
          artifactType: null, artifactId: null, artifactLabel: null,
          durationMs: Date.now() - startTime, promptLogId: null,
        }).catch(() => {});

        revalidatePath('/tests');
      } catch (err) {
        console.error('[GeneratePlaceholderAgent] Error:', err);
        await queries.updateAgentSession(session.id, {
          status: 'failed',
          completedAt: new Date(),
          steps: [{
            ...steps[0],
            status: 'failed',
            completedAt: new Date().toISOString(),
            error: err instanceof Error ? err.message : String(err),
          }],
        }).catch(() => {});

        emitAndPersistActivityEvent({
          teamId,
          repositoryId: data.repositoryId,
          sessionId: session.id,
          sourceType: 'generate_agent',
          eventType: 'session:error',
          summary: `Failed to generate placeholder test "${test.name}": ${err instanceof Error ? err.message : String(err)}`,
          stepId: null, agentType: null, detail: null,
          artifactType: null, artifactId: null, artifactLabel: null,
          durationMs: Date.now() - startTime, promptLogId: null,
        }).catch(() => {});
      }
    })();

    return { success: true, sessionId: session.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to start test generation';
    return { success: false, error: message };
  }
}

export async function aiFixAllFailedTests(
  repositoryId: string,
): Promise<{ success: boolean; fixed: number; failed: number; errors: string[] }> {
  await requireRepoAccess(repositoryId);
  const allTests = await queries.getTestsByRepo(repositoryId);
  const branch = await getCurrentBranchForRepo(repositoryId);
  const errors: string[] = [];
  let fixed = 0;
  let failed = 0;

  for (const test of allTests) {
    const results = await queries.getTestResultsByTest(test.id);
    const latestResult = results[results.length - 1];

    if (latestResult?.status !== 'failed') continue;

    const errorMessage = latestResult.errorMessage || 'Test failed with unknown error';
    const result = await aiFixTest(repositoryId, test.id, errorMessage);

    if (result.success && result.code) {
      await queries.updateTestWithVersion(test.id, { code: result.code }, 'ai_fix', branch ?? undefined);
      fixed++;
    } else {
      failed++;
      errors.push(`${test.name}: ${result.error || 'Unknown error'}`);
    }
  }

  revalidatePath('/tests');
  return { success: true, fixed, failed, errors };
}

export async function updateTestCode(
  testId: string,
  code: string,
  changeReason: 'ai_fix' | 'ai_enhance' = 'ai_fix'
): Promise<{ success: boolean; error?: string }> {
  await requireTeamAccess();
  try {
    const test = await queries.getTest(testId);
    const branch = await getCurrentBranchForRepo(test?.repositoryId);
    await queries.updateTestWithVersion(testId, { code }, changeReason, branch ?? undefined);
    revalidatePath('/tests');
    revalidatePath(`/tests/${testId}`);
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update test';
    return { success: false, error: message };
  }
}

export async function aiFixTests(
  testIds: string[],
  repositoryId: string
): Promise<{ success: boolean; fixed: number; failed: number; errors: string[] }> {
  await requireRepoAccess(repositoryId);
  const branch = await getCurrentBranchForRepo(repositoryId);
  const errors: string[] = [];
  let fixed = 0;
  let failed = 0;

  for (const testId of testIds) {
    const test = await queries.getTest(testId);
    if (!test) {
      failed++;
      errors.push(`Test ${testId}: Not found`);
      continue;
    }

    const results = await queries.getTestResultsByTest(testId);
    const latestResult = results[results.length - 1];

    if (latestResult?.status !== 'failed') {
      continue;
    }

    const errorMessage = latestResult.errorMessage || 'Test failed with unknown error';
    const result = await aiFixTest(repositoryId, testId, errorMessage);

    if (result.success && result.code) {
      await queries.updateTestWithVersion(testId, { code: result.code }, 'ai_fix', branch ?? undefined);
      fixed++;
    } else {
      failed++;
      errors.push(`${test.name}: ${result.error || 'Unknown error'}`);
    }
  }

  revalidatePath('/tests');
  return { success: true, fixed, failed, errors };
}

/**
 * Heal test: full agentic browser inspection to diagnose and fix complex failures.
 */
export async function healTest(
  repositoryId: string,
  testId: string,
): Promise<{ success: boolean; code?: string; error?: string }> {
  const { agentHealTest } = await import('@/lib/playwright/healer-agent');
  return agentHealTest(repositoryId, testId);
}

/**
 * Heal tests in bulk: agentic browser inspection for each test.
 */
export async function healTests(
  testIds: string[],
  repositoryId: string
): Promise<{ success: boolean; fixed: number; failed: number; errors: string[] }> {
  const { agentHealTests } = await import('@/lib/playwright/healer-agent');
  return agentHealTests(testIds, repositoryId);
}

/**
 * Create test: always uses agentic MCP-based generation with live browser verification.
 */
export async function createTest(
  repositoryId: string,
  context: TestGenerationContext,
): Promise<{ success: boolean; code?: string; error?: string }> {
  const { agentCreateTest } = await import('@/lib/playwright/generator-agent');
  return agentCreateTest(repositoryId, context);
}
