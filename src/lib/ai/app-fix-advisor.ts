/**
 * "Fix the app" advisor (E5).
 *
 * When a test failure is classified `real_regression`, produce a structured
 * application-code fix recommendation (file/snippet/rationale) and return it to
 * the calling coding agent. NEVER auto-applies — distinct from the test healer
 * (`src/lib/playwright/healer-agent.ts`), which patches test code.
 */

import { generateWithAI } from '@/lib/ai';
import type { AIProviderConfig } from '@/lib/ai/types';
import { parseAiJson } from '@/lib/ai/json-parse';
import * as queries from '@/lib/db/queries';
import type { AppFixSuggestion, AppFixSuggestionFile } from '@/lib/db/schema';

export interface SuggestAppFixResult {
  status: 'app_fix_suggested' | 'not_a_regression' | 'no_suggestion' | 'ai_unavailable';
  summary: string;
  suggestion?: AppFixSuggestion;
}

const SYSTEM_PROMPT = `You are a senior engineer diagnosing why an end-to-end test started failing after a code change. You suggest a fix to the APPLICATION code (not the test). You never have write access — you only describe the change.

Use the failing test's error, console errors, and the list of recently changed files to localize the most likely root cause. Prefer pointing at the changed files. If you cannot identify exact line numbers, omit them and describe the change with a snippet.

Respond with ONLY a JSON object (no markdown fencing):
{
  "summary": "<one sentence: what's broken and the fix>",
  "confidence": <0.0-1.0>,
  "files": [
    {
      "path": "<repo-relative file path>",
      "startLine": <number, optional>,
      "endLine": <number, optional>,
      "currentSnippet": "<the likely-broken code, optional>",
      "suggestedSnippet": "<the corrected code, optional>",
      "rationale": "<why this change fixes the failure>"
    }
  ]
}`;

function buildConfig(settings: Awaited<ReturnType<typeof queries.getAISettings>>): AIProviderConfig {
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
  // Read-only guard: even though we don't enable MCP/tools, force plan mode and
  // disallow any file-mutating tools for the agent-SDK provider.
  config.agentSdkPermissionMode = 'plan';
  config.agentSdkDisallowedTools = ['Bash', 'Write', 'Edit', 'NotebookEdit'];
  return config;
}

function modelIdFor(config: AIProviderConfig): string {
  switch (config.provider) {
    case 'openrouter': return `openrouter:${config.openrouterModel ?? 'default'}`;
    case 'anthropic': return `anthropic:${config.anthropicModel ?? 'default'}`;
    case 'openai': return `openai:${config.openaiModel ?? 'default'}`;
    case 'ollama': return `ollama:${config.ollamaModel ?? 'default'}`;
    default: return config.provider;
  }
}

export async function suggestAppFix(opts: {
  repositoryId: string;
  testId: string;
  buildId?: string;
}): Promise<SuggestAppFixResult> {
  const { repositoryId, testId } = opts;

  const test = await queries.getTest(testId);
  if (!test) return { status: 'no_suggestion', summary: 'Test not found.' };

  // Locate the latest failing result (full row carries triage/console/network).
  const history = await queries.getTestResultsByTest(testId);
  const failingMeta = history.find((r) => r.status === 'failed');
  if (!failingMeta?.testRunId) {
    return { status: 'no_suggestion', summary: 'No failing result found for this test.' };
  }
  const fullResults = await queries.getTestResultsByRun(failingMeta.testRunId);
  const failing = fullResults.find((r) => r.id === failingMeta.id) ?? null;
  if (!failing) return { status: 'no_suggestion', summary: 'Failing result could not be loaded.' };

  // Gate strictly on a real_regression classification when triage is present.
  const triage = failing.triage;
  if (triage?.classification && triage.classification !== 'real_regression') {
    return {
      status: 'not_a_regression',
      summary: `Failure classified as ${triage.classification} — an app-code fix is not applicable. Consider lastest_heal_test instead.`,
    };
  }

  // Resolve build + change map (the files that likely introduced the regression).
  const build = opts.buildId
    ? await queries.getBuild(opts.buildId)
    : await queries.getBuildByTestRun(failingMeta.testRunId);
  const changeMap = build ? await queries.getBuildChangeMap(build.id).catch(() => null) : null;
  const changedFiles: string[] = Array.isArray((changeMap as { files?: Array<{ path?: string }> } | null)?.files)
    ? ((changeMap as { files: Array<{ path?: string }> }).files.map((f) => f.path).filter((p): p is string => !!p))
    : [];

  const settings = await queries.getAISettings(repositoryId);
  if (settings.provider === 'claude-cli') {
    return { status: 'ai_unavailable', summary: 'App-fix suggestions require a JSON-capable AI provider (not claude-cli).' };
  }

  const config = buildConfig(settings);

  const consoleErrors = (failing.consoleErrors ?? []).slice(0, 8).join('\n') || 'None';
  const prompt = `A previously passing end-to-end test is now failing. Suggest an application-code fix.

**Test:** ${test.name}
**Target URL:** ${test.targetUrl ?? 'unknown'}
**Error:** ${failing.errorMessage ?? 'No error message'}
**Console errors:**
${consoleErrors}

**Recently changed files (most likely root cause):**
${changedFiles.length ? changedFiles.map((f) => `- ${f}`).join('\n') : '(no change map available — infer from the error)'}

**Test code (for context on what the user flow expects):**
\`\`\`
${test.code.slice(0, 4000)}
\`\`\``;

  let response: string;
  try {
    response = await generateWithAI(config, prompt, SYSTEM_PROMPT, {
      actionType: 'suggest_app_fix',
      repositoryId,
      responseFormat: 'json_object',
    });
  } catch (error) {
    return {
      status: 'ai_unavailable',
      summary: `AI call failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const isShape = (v: unknown): v is { summary?: unknown; confidence?: unknown; files?: unknown } =>
    typeof v === 'object' && v !== null;
  const parsed = parseAiJson(response, isShape, { source: 'suggest_app_fix' });
  if (!parsed) {
    return { status: 'no_suggestion', summary: 'AI response was not parseable as JSON.' };
  }

  const rawFiles = Array.isArray(parsed.files) ? parsed.files : [];
  const files: AppFixSuggestionFile[] = rawFiles
    .filter((f): f is Record<string, unknown> => typeof f === 'object' && f !== null && typeof (f as { path?: unknown }).path === 'string')
    .map((f) => ({
      path: String(f.path),
      startLine: typeof f.startLine === 'number' ? f.startLine : undefined,
      endLine: typeof f.endLine === 'number' ? f.endLine : undefined,
      currentSnippet: typeof f.currentSnippet === 'string' ? f.currentSnippet : undefined,
      suggestedSnippet: typeof f.suggestedSnippet === 'string' ? f.suggestedSnippet : undefined,
      rationale: typeof f.rationale === 'string' ? f.rationale : '',
    }));

  if (files.length === 0) {
    return { status: 'no_suggestion', summary: 'The model did not identify a concrete file to change.' };
  }

  const suggestion: AppFixSuggestion = {
    summary: String(parsed.summary || 'Suggested application fix').slice(0, 500),
    classification: 'real_regression',
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
    files,
    relatedChangeMapFiles: changedFiles.length ? changedFiles : undefined,
    generatedAt: new Date().toISOString(),
    modelId: modelIdFor(config),
  };

  await queries.insertAppFixSuggestion(build?.id ?? null, testId, suggestion).catch(() => {});

  return {
    status: 'app_fix_suggested',
    summary: suggestion.summary,
    suggestion,
  };
}
