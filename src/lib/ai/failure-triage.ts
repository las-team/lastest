/**
 * Autonomous Failure Triage (Auto TFA)
 *
 * Classifies test failures into categories and routes them to appropriate actions:
 * - real_regression → create GitHub issue
 * - flaky_test → mark as flaky, consider quarantine
 * - environment_issue → log warning
 * - test_maintenance → trigger healer agent
 */

import { generateWithAI } from '@/lib/ai';
import type { AIProviderConfig } from '@/lib/ai/types';
import * as queries from '@/lib/db/queries';
import type { TriageResult, TriageClassification } from '@/lib/db/schema';

interface TriageInput {
  testId: string;
  testName: string;
  errorMessage: string | null;
  consoleErrors: string[] | null;
  durationMs: number | null;
  recentHistory: Array<{ status: string | null; errorMessage: string | null }>;
  diffAnalysis?: { classification?: string; aiRecommendation?: string } | null;
  domDiffSummary?: string | null;
}

const TRIAGE_SYSTEM_PROMPT = `You are a QA failure triage specialist. Classify test failures into one of these categories:

1. **real_regression** — A genuine bug in the application. The test correctly detected a problem.
   Indicators: new error message, consistent failure, error in application logic, HTTP errors, assertion failures on expected behavior.

2. **flaky_test** — The test is unreliable and fails intermittently without a real app issue.
   Indicators: passes sometimes/fails sometimes in recent history, timeout errors, timing-sensitive assertions, race conditions.

3. **environment_issue** — The test environment is misconfigured or unavailable.
   Indicators: connection refused, DNS resolution failure, server not responding, authentication token expired, missing environment variables.

4. **test_maintenance** — The test code needs updating due to UI changes (not a bug).
   Indicators: selector not found, element not visible, text changed, layout shifted, new UI flow.

5. **unknown** — Cannot determine the cause with available information.

Respond with ONLY a JSON object (no markdown fencing):
{
  "classification": "<category>",
  "confidence": <0.0-1.0>,
  "reasoning": "<1-2 sentence explanation>"
}`;

export async function triageTestFailure(
  repositoryId: string,
  input: TriageInput,
): Promise<TriageResult> {
  try {
    const settings = await queries.getAISettings(repositoryId);

    // Skip triage if AI is not configured or is CLI-only
    if (settings.provider === 'claude-cli') {
      return { classification: 'unknown', confidence: 0, reasoning: 'AI triage skipped (CLI provider)' };
    }

    const config: AIProviderConfig = {
      provider: settings.provider as AIProviderConfig['provider'],
      openrouterApiKey: settings.openrouterApiKey,
      openrouterModel: settings.openrouterModel ?? undefined,
      anthropicApiKey: settings.anthropicApiKey,
      anthropicModel: settings.anthropicModel ?? undefined,
      ollamaBaseUrl: settings.ollamaBaseUrl ?? undefined,
      ollamaModel: settings.ollamaModel ?? undefined,
      openaiApiKey: settings.openaiApiKey,
      openaiModel: settings.openaiModel ?? undefined,
    };

    const historyDesc = input.recentHistory.length > 0
      ? input.recentHistory.map((r, i) => `Run ${i + 1}: ${r.status}${r.errorMessage ? ` — ${r.errorMessage.slice(0, 200)}` : ''}`).join('\n')
      : 'No recent history available';

    const domDiffSection = input.domDiffSummary
      ? `**DOM Changes (recording → failure):**\n${input.domDiffSummary}`
      : 'No DOM diff data';

    const prompt = `Classify this test failure:

**Test:** ${input.testName}
**Error:** ${input.errorMessage ?? 'No error message'}
**Duration:** ${input.durationMs ? `${input.durationMs}ms` : 'Unknown'}
**Console Errors:** ${input.consoleErrors?.length ? input.consoleErrors.slice(0, 5).join('\n') : 'None'}
**Visual Diff:** ${input.diffAnalysis ? `Classification: ${input.diffAnalysis.classification}, AI Recommendation: ${input.diffAnalysis.aiRecommendation}` : 'No visual diff data'}
**${domDiffSection}**

**Recent History (last 5 runs):**
${historyDesc}`;

    const response = await generateWithAI(config, prompt, TRIAGE_SYSTEM_PROMPT, {
      actionType: 'triage',
    });

    // Parse JSON response
    const cleaned = response.replace(/```json\n?|\n?```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    const validClassifications: TriageClassification[] = ['real_regression', 'flaky_test', 'environment_issue', 'test_maintenance', 'unknown'];
    const classification = validClassifications.includes(parsed.classification)
      ? parsed.classification as TriageClassification
      : 'unknown';

    return {
      classification,
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
      reasoning: String(parsed.reasoning || 'No reasoning provided'),
    };
  } catch (error) {
    console.error(`[triage] Failed to triage test ${input.testName}:`, error);
    return {
      classification: 'unknown',
      confidence: 0,
      reasoning: `Triage error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Run triage on all failed tests in a build. Fire-and-forget.
 */
export async function triageBuildFailures(buildId: string, repositoryId: string): Promise<void> {
  try {
    // Only run triage if AI Diff Analysis is enabled
    const settings = await queries.getAISettings(repositoryId);
    if (!settings.aiDiffingEnabled) {
      console.log(`[triage] Skipping triage for build ${buildId} — AI Diff Analysis is disabled`);
      return;
    }

    const build = await queries.getBuild(buildId);
    if (!build?.testRunId) return;

    const results = await queries.getTestResultsByRun(build.testRunId);
    const failed = results.filter(r => r.status === 'failed');

    if (failed.length === 0) return;

    console.log(`[triage] Triaging ${failed.length} failed test(s) for build ${buildId}`);

    for (const result of failed) {
      if (!result.testId) continue;

      const test = await queries.getTest(result.testId);
      if (!test) continue;

      // Get recent history for this test
      const history = await queries.getTestResultsByTest(result.testId);
      const recentHistory = history.slice(0, 5).map(h => ({
        status: h.status,
        errorMessage: h.errorMessage,
      }));

      // Get diff analysis if available
      const diffs = await queries.getVisualDiffsByBuild(buildId);
      const testDiff = diffs.find(d => d.testId === result.testId);

      // Compute DOM diff summary if snapshots available
      let domDiffSummary: string | null = null;
      if (test.domSnapshot && result.domSnapshot) {
        try {
          const { computeDomDiff, summarizeDomDiff } = await import('@/lib/diff/dom-diff');
          const domDiff = computeDomDiff(test.domSnapshot, result.domSnapshot);
          if (domDiff.added.length > 0 || domDiff.removed.length > 0 || domDiff.changed.length > 0) {
            domDiffSummary = summarizeDomDiff(domDiff);
          }
        } catch {
          // Non-critical
        }
      }

      const triageResult = await triageTestFailure(repositoryId, {
        testId: result.testId,
        testName: test.name,
        errorMessage: result.errorMessage,
        consoleErrors: result.consoleErrors,
        durationMs: result.durationMs,
        recentHistory,
        diffAnalysis: testDiff ? {
          classification: testDiff.classification ?? undefined,
          aiRecommendation: testDiff.aiRecommendation ?? undefined,
        } : null,
        domDiffSummary,
      });

      // Save triage result
      await queries.updateTestResult(result.id, { triage: triageResult });

      console.log(`[triage] ${test.name}: ${triageResult.classification} (${Math.round(triageResult.confidence * 100)}%) — ${triageResult.reasoning}`);
    }
  } catch (error) {
    console.error(`[triage] Failed to triage build ${buildId}:`, error);
  }
}
