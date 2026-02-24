'use server';

import * as queries from '@/lib/db/queries';

import { analyzeDiff, type DiffingProviderConfig } from '@/lib/ai/diff-analyzer';
import type { AIDiffingProvider } from '@/lib/db/schema';
import { createChildJob, completeJob, failJob } from './jobs';

const MAX_CONCURRENT_AI = 10;
let activeAI = 0;
const waitingAI: (() => void)[] = [];

async function withAILimit<T>(fn: () => Promise<T>): Promise<T> {
  if (activeAI >= MAX_CONCURRENT_AI) {
    await new Promise<void>(r => waitingAI.push(r));
  }
  activeAI++;
  try { return await fn(); }
  finally { activeAI--; if (waitingAI.length > 0) waitingAI.shift()!(); }
}

/**
 * Trigger AI diff analysis for a single visual diff.
 * Fire-and-forget — does not block test execution.
 * Capped at 10 concurrent analyses via semaphore.
 */
export async function triggerAIDiffAnalysis(diffId: string, repositoryId?: string | null, parentJobId?: string | null) {
  return withAILimit(async () => {
  let childJobId: string | undefined;
  try {
    // Check if AI diffing is enabled
    const settings = await queries.getAISettings(repositoryId);
    if (!settings.aiDiffingEnabled) {
      await queries.updateVisualDiff(diffId, { aiAnalysisStatus: 'skipped' });
      return;
    }

    const rawProvider = (settings.aiDiffingProvider as AIDiffingProvider) || null;
    const rawApiKey = settings.aiDiffingApiKey;
    const rawModel = settings.aiDiffingModel || 'anthropic/claude-sonnet-4-5-20250929';

    // Resolve effective provider config
    let effectiveProvider: string;
    let effectiveApiKey: string;
    let effectiveModel: string;
    let effectiveBaseUrl: string | undefined;

    if (rawProvider === 'same-as-test-gen') {
      // Inherit from test generation settings
      if (settings.provider === 'claude-cli') {
        // CLI has no vision API — skip
        await queries.updateVisualDiff(diffId, { aiAnalysisStatus: 'skipped' });
        return;
      }
      if (settings.provider === 'ollama') {
        effectiveProvider = 'ollama';
        effectiveApiKey = '';
        effectiveModel = settings.ollamaModel || '';
        effectiveBaseUrl = settings.ollamaBaseUrl || 'http://localhost:11434';
      } else {
        effectiveProvider = settings.provider === 'claude-agent-sdk' ? 'claude-agent-sdk' : settings.provider;
        effectiveApiKey = settings.provider === 'claude-agent-sdk' ? '' : (settings.openrouterApiKey || '');
        effectiveModel = settings.provider === 'claude-agent-sdk'
          ? (settings.agentSdkModel || '')
          : (settings.openrouterModel || 'anthropic/claude-sonnet-4-5-20250929');
      }
    } else if (rawProvider === 'ollama') {
      effectiveProvider = 'ollama';
      effectiveApiKey = '';
      effectiveModel = settings.aiDiffingOllamaModel || '';
      effectiveBaseUrl = settings.aiDiffingOllamaBaseUrl || 'http://localhost:11434';
    } else if (rawProvider === 'claude-agent-sdk') {
      effectiveProvider = 'claude-agent-sdk';
      effectiveApiKey = '';
      effectiveModel = rawModel;
    } else if (rawProvider) {
      effectiveProvider = rawProvider;
      effectiveApiKey = rawApiKey || '';
      effectiveModel = rawModel;
    } else {
      await queries.updateVisualDiff(diffId, { aiAnalysisStatus: 'skipped' });
      return;
    }

    // Only require API key for providers that need one
    if (effectiveProvider !== 'claude-agent-sdk' && effectiveProvider !== 'ollama' && !effectiveApiKey) {
      await queries.updateVisualDiff(diffId, { aiAnalysisStatus: 'skipped' });
      return;
    }

    // Set status to running
    await queries.updateVisualDiff(diffId, { aiAnalysisStatus: 'running' });

    // Get the diff details
    const diff = await queries.getVisualDiff(diffId);
    if (!diff || !diff.baselineImagePath || !diff.currentImagePath || !diff.diffImagePath) {
      await queries.updateVisualDiff(diffId, { aiAnalysisStatus: 'skipped' });
      return;
    }

    // Get test name
    const test = await queries.getTest(diff.testId);
    const testName = test?.name || 'Unknown Test';

    // Create child job if parent exists
    if (parentJobId) {
      childJobId = await createChildJob('ai_diff', `AI Diff: ${testName}`, parentJobId, repositoryId, { diffId });
    }

    const providerConfig: DiffingProviderConfig = {
      provider: effectiveProvider as DiffingProviderConfig['provider'],
      apiKey: effectiveApiKey,
      model: effectiveModel,
      baseUrl: effectiveBaseUrl,
    };

    const analysis = await analyzeDiff(
      {
        baselineImagePath: diff.baselineImagePath,
        currentImagePath: diff.currentImagePath,
        diffImagePath: diff.diffImagePath,
        metadata: diff.metadata ?? undefined,
        percentageDifference: diff.percentageDifference || '0',
        testName,
      },
      providerConfig
    );

    // Update diff with analysis results
    await queries.updateVisualDiff(diffId, {
      aiAnalysis: analysis,
      aiRecommendation: analysis.recommendation,
      aiAnalysisStatus: 'completed',
    });
    if (childJobId) await completeJob(childJobId);
  } catch (error) {
    console.error(`AI diff analysis failed for diff ${diffId}:`, error);
    await queries.updateVisualDiff(diffId, { aiAnalysisStatus: 'failed' });
    if (childJobId) await failJob(childJobId, error instanceof Error ? error.message : 'AI diff analysis failed');
  }
  });
}
