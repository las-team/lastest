/**
 * Generator Agent — generates Playwright test code from specs/plans
 * using Playwright's built-in Generator agent.
 */

import * as queries from '@/lib/db/queries';
import { requireRepoAccess } from '@/lib/auth';
import {
  spawnAgentProcess,
  createTempSpecDir,
  createTempTestDir,
  parseGeneratorOutput,
  writeSpecFile,
  writeSeedTest,
  cleanupTempDir,
  type ParsedGeneratorTest,
} from './agent-bridge';
import type { TestGenerationContext } from '@/lib/ai/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GeneratorResult {
  tests: ParsedGeneratorTest[];
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

/**
 * Run the Playwright Generator agent to produce test files from a spec.
 */
export async function runGeneratorAgent(
  specMarkdown: string,
  options?: {
    seedTestCode?: string;
    baseUrl?: string;
    timeout?: number;
    stepLogger?: (line: string) => void;
    signal?: AbortSignal;
  },
): Promise<GeneratorResult> {
  const specsDir = await createTempSpecDir('generator');
  const testsDir = await createTempTestDir('generator');

  try {
    // Write the spec for the Generator to consume
    await writeSpecFile(specsDir, specMarkdown);

    // Write seed test if provided
    if (options?.seedTestCode) {
      await writeSeedTest(specsDir, options.seedTestCode, 'seed.spec.ts');
    }

    const extraArgs: string[] = [
      `--specs=${specsDir}`,
      `--output=${testsDir}`,
    ];

    if (options?.baseUrl) {
      extraArgs.push(`--base-url=${options.baseUrl}`);
    }

    const result = await spawnAgentProcess('generator', extraArgs, {
      timeout: options?.timeout ?? 300_000,
      stepLogger: options?.stepLogger,
      signal: options?.signal,
    });

    if (result.exitCode !== 0 && result.exitCode !== null) {
      const tests = await parseGeneratorOutput(testsDir);
      if (tests.length > 0) {
        return { tests };
      }
      throw new Error(`Generator agent exited with code ${result.exitCode}: ${result.stderr.slice(0, 500)}`);
    }

    const tests = await parseGeneratorOutput(testsDir);
    return { tests };
  } finally {
    await cleanupTempDir(specsDir);
    await cleanupTempDir(testsDir);
  }
}

// ---------------------------------------------------------------------------
// Server-action-compatible wrapper
// ---------------------------------------------------------------------------

/**
 * Generate a test using the PW Generator agent.
 * Called from the unified `createTest()` in ai.ts when agents are enabled.
 */
export async function agentCreateTest(
  repositoryId: string,
  context: TestGenerationContext,
): Promise<{ success: boolean; code?: string; error?: string }> {
  await requireRepoAccess(repositoryId);

  try {
    const settings = await queries.getAISettings(repositoryId);

    // Build spec markdown from context
    let specMarkdown = '';

    // Check if there's an agent plan from the functional area
    if (context.functionalAreaId) {
      const area = await queries.getFunctionalArea(context.functionalAreaId);
      if (area?.agentPlan) {
        specMarkdown = area.agentPlan;
      }
    }

    // Fall back to constructing spec from context fields
    if (!specMarkdown) {
      const parts: string[] = [];
      if (context.testName) parts.push(`# Test: ${context.testName}`);
      if (context.routePath) parts.push(`## Route: ${context.routePath}`);
      if (context.targetUrl) parts.push(`## Target URL: ${context.targetUrl}`);
      if (context.userPrompt) parts.push(`\n${context.userPrompt}`);
      if (context.scanContext?.specDescription) {
        parts.push(`\n## Spec Description\n${context.scanContext.specDescription}`);
      }
      if (context.scanContext?.testSuggestions?.length) {
        parts.push(`\n## Test Suggestions\n${context.scanContext.testSuggestions.map(s => `- ${s}`).join('\n')}`);
      }
      specMarkdown = parts.join('\n') || 'Generate a comprehensive test for this page.';
    }

    // Get base URL from environment config
    const envConfig = await queries.getEnvironmentConfig(repositoryId);
    const baseUrl = context.targetUrl || context.baseUrl || envConfig?.baseUrl || 'http://localhost:3000';

    const result = await runGeneratorAgent(specMarkdown, {
      baseUrl,
      timeout: settings.pwAgentTimeout ?? 300_000,
    });

    if (result.tests.length === 0) {
      return { success: false, error: 'Generator agent produced no tests' };
    }

    // Return the first generated test
    return { success: true, code: result.tests[0].code };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Generator agent failed';
    return { success: false, error: message };
  }
}
