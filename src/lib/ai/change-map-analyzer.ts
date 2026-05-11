/**
 * Change Map AI analyzer (Verify phase, v1.14+).
 *
 * Given a list of changed files + a list of candidate functional areas,
 * asks an LLM to produce:
 *   - per-area 3-bullet narrative + risk level
 *   - one-sentence build intent
 *   - one-sentence build risk
 *
 * Provider routing mirrors diff-analyzer.ts (uses aiDiffingProvider /
 * aiDiffingModel from settings).
 */

import type { ChangeRisk, ChangeMapFile, ChangeMapArea } from '@/lib/db/schema';
import { createOpenRouterProvider } from './openrouter';
import { createAnthropicDirectProvider } from './anthropic-direct';
import { ClaudeAgentSDKProvider } from './claude-agent-sdk';
import { createOllamaProvider } from './ollama';
import type { AIProvider } from './types';

export interface ChangeMapProviderConfig {
  provider: 'openrouter' | 'anthropic' | 'claude-agent-sdk' | 'ollama';
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export interface ChangeMapAIInput {
  branch: string;
  baseBranch: string;
  files: ChangeMapFile[];
  candidateAreas: Array<{
    areaId: string;
    areaName: string;
    sourceHints: string[];
    affectedFiles: string[];
  }>;
}

export interface ChangeMapAIResponse {
  intentSummary: string;
  riskSummary: string;
  areas: Array<Pick<ChangeMapArea, 'areaId' | 'risk' | 'aiNarrative'>>;
}

const SYSTEM_PROMPT = `You analyze a code-change map for a visual-regression review tool.
For each candidate functional area you receive, decide:
  - risk: "low" | "medium" | "high"
  - 3 short bullets explaining what changed, why it matters, and what to watch for.
Then write a single-sentence "intent summary" describing what the build is trying to deliver
and a single-sentence "risk summary" describing what could break.

Respond ONLY with a JSON object of this exact shape:
{
  "intentSummary": "...",
  "riskSummary": "...",
  "areas": [
    { "areaId": "<exact id>", "risk": "low" | "medium" | "high", "aiNarrative": ["...", "...", "..."] }
  ]
}
Do not include any prose outside the JSON.`;

function buildUserPrompt(input: ChangeMapAIInput): string {
  const fileLines = input.files.slice(0, 60).map((f) =>
    `  ${f.status} ${f.path}  (+${f.insertions}/-${f.deletions})`,
  ).join('\n');
  const areaLines = input.candidateAreas.map((a) =>
    `  - id: ${a.areaId}\n    name: ${a.areaName}\n    hints: ${a.sourceHints.join(', ') || '(none)'}\n    files: ${a.affectedFiles.slice(0, 8).join(', ') || '(none)'}`,
  ).join('\n');
  return [
    `branch: ${input.branch} (vs ${input.baseBranch})`,
    `\nchanged files (${input.files.length}):\n${fileLines}`,
    `\ncandidate areas (${input.candidateAreas.length}):\n${areaLines}`,
    `\nRespond with the JSON object described above. Use the exact area IDs as given.`,
  ].join('\n');
}

function createProvider(config: ChangeMapProviderConfig): AIProvider {
  if (config.provider === 'claude-agent-sdk') {
    const sdkModel = config.model?.replace(/^anthropic\//, '') || undefined;
    return new ClaudeAgentSDKProvider({ permissionMode: 'plan', model: sdkModel });
  }
  if (config.provider === 'ollama') {
    return createOllamaProvider({
      baseUrl: config.baseUrl || 'http://localhost:11434',
      model: config.model,
    });
  }
  if (config.provider === 'anthropic') {
    return createAnthropicDirectProvider({
      apiKey: config.apiKey,
      model: config.model,
    });
  }
  return createOpenRouterProvider({
    apiKey: config.apiKey,
    model: config.model,
  });
}

function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (escape) { escape = false; continue; }
    if (char === '\\' && inString) { escape = true; continue; }
    if (char === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (char === '{') depth++;
    else if (char === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null;
}

const VALID_RISKS: ReadonlySet<ChangeRisk> = new Set<ChangeRisk>(['low', 'medium', 'high']);

export async function analyzeChangeMap(
  input: ChangeMapAIInput,
  config: ChangeMapProviderConfig,
): Promise<ChangeMapAIResponse> {
  const userPrompt = buildUserPrompt(input);
  const provider = createProvider(config);
  const response = await provider.generate({
    prompt: userPrompt,
    systemPrompt: SYSTEM_PROMPT,
    maxTokens: 1500,
    temperature: 0.2,
    responseFormat: 'json_object',
  });
  const jsonStr = extractJsonObject(response);
  if (!jsonStr) {
    throw new Error(`AI response did not contain valid JSON. Response: ${response.slice(0, 500)}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    throw new Error(`Failed to parse change-map JSON: ${(e as Error).message}`);
  }

  // Defensive normalization — accept partial responses without crashing.
  const areas: ChangeMapAIResponse['areas'] = Array.isArray(parsed.areas)
    ? parsed.areas
        .map((raw: unknown): ChangeMapAIResponse['areas'][number] | null => {
          if (!raw || typeof raw !== 'object') return null;
          const r = raw as Record<string, unknown>;
          const areaId = typeof r.areaId === 'string' ? r.areaId : null;
          if (!areaId) return null;
          const risk = (typeof r.risk === 'string' && VALID_RISKS.has(r.risk as ChangeRisk)
            ? r.risk
            : 'medium') as ChangeRisk;
          const aiNarrative = Array.isArray(r.aiNarrative)
            ? r.aiNarrative.filter((b: unknown): b is string => typeof b === 'string').slice(0, 3)
            : [];
          return { areaId, risk, aiNarrative };
        })
        .filter((a: unknown): a is ChangeMapAIResponse['areas'][number] => a !== null)
    : [];

  return {
    intentSummary: typeof parsed.intentSummary === 'string' ? parsed.intentSummary : '',
    riskSummary: typeof parsed.riskSummary === 'string' ? parsed.riskSummary : '',
    areas,
  };
}
