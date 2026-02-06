'use server';

import * as queries from '@/lib/db/queries';
import { analyzeDiff, type DiffingProviderConfig } from '@/lib/ai/diff-analyzer';
import type { AIDiffingProvider } from '@/lib/db/schema';

/**
 * Trigger AI diff analysis for a single visual diff.
 * Fire-and-forget — does not block test execution.
 */
export async function triggerAIDiffAnalysis(diffId: string, repositoryId?: string | null) {
  try {
    // Check if AI diffing is enabled
    const settings = await queries.getAISettings(repositoryId);
    if (!settings.aiDiffingEnabled) {
      await queries.updateVisualDiff(diffId, { aiAnalysisStatus: 'skipped' });
      return;
    }

    const provider = settings.aiDiffingProvider as AIDiffingProvider | null;
    const apiKey = settings.aiDiffingApiKey;
    const model = settings.aiDiffingModel || 'anthropic/claude-sonnet-4-5-20250929';

    if (!provider || !apiKey) {
      await queries.updateVisualDiff(diffId, { aiAnalysisStatus: 'skipped' });
      return;
    }

    // Set status to running
    await queries.updateVisualDiff(diffId, { aiAnalysisStatus: 'running' });

    // Get the diff details
    const diff = await queries.getVisualDiff(diffId);
    if (!diff || !diff.baselineImagePath || !diff.diffImagePath) {
      await queries.updateVisualDiff(diffId, { aiAnalysisStatus: 'skipped' });
      return;
    }

    // Get test name
    const test = await queries.getTest(diff.testId);
    const testName = test?.name || 'Unknown Test';

    const providerConfig: DiffingProviderConfig = { provider, apiKey, model };

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
  } catch (error) {
    console.error(`AI diff analysis failed for diff ${diffId}:`, error);
    await queries.updateVisualDiff(diffId, { aiAnalysisStatus: 'failed' });
  }
}
