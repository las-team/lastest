import fs from 'fs';
import path from 'path';
import type { AIDiffAnalysis, DiffMetadata } from '@/lib/db/schema';
import { DIFF_ANALYSIS_SYSTEM_PROMPT, buildDiffAnalysisPrompt, buildDiffAnalysisPromptWithPaths } from './diff-prompts';
import { createOpenRouterProvider } from './openrouter';
import { createAnthropicDirectProvider } from './anthropic-direct';
import { ClaudeAgentSDKProvider } from './claude-agent-sdk';
import type { AIProvider } from './types';

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

interface AnalyzeDiffInput {
  baselineImagePath: string;
  currentImagePath: string;
  diffImagePath: string;
  metadata?: DiffMetadata;
  percentageDifference: string;
  testName: string;
}

export interface DiffingProviderConfig {
  provider: 'openrouter' | 'anthropic' | 'claude-agent-sdk';
  apiKey: string;
  model: string;
}

function readImageAsBase64(imagePath: string): { base64: string; mediaType: string } {
  const fullPath = imagePath.startsWith(process.cwd())
    ? imagePath
    : path.join(process.cwd(), 'public', imagePath);

  const buffer = fs.readFileSync(fullPath);

  return {
    base64: buffer.toString('base64'),
    mediaType: 'image/png',
  };
}

function createDiffingProvider(config: DiffingProviderConfig): AIProvider {
  if (config.provider === 'claude-agent-sdk') {
    // SDK expects bare model IDs (e.g. "claude-sonnet-4-5-20250929"), strip vendor prefix
    const sdkModel = config.model?.replace(/^anthropic\//, '') || undefined;
    return new ClaudeAgentSDKProvider({ permissionMode: 'plan', model: sdkModel });
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

function resolveAbsPath(imagePath: string): string {
  if (imagePath.startsWith(process.cwd())) return imagePath;
  return path.join(process.cwd(), 'public', imagePath);
}

export async function analyzeDiff(
  input: AnalyzeDiffInput,
  providerConfig: DiffingProviderConfig
): Promise<AIDiffAnalysis> {
  let response: string;

  if (providerConfig.provider === 'claude-agent-sdk') {
    // Agent SDK reads images from disk via file paths
    const sdkPrompt = buildDiffAnalysisPromptWithPaths({
      testName: input.testName,
      percentageDifference: input.percentageDifference,
      changedRegions: input.metadata?.changedRegions?.length,
      changeCategories: input.metadata?.changeCategories,
      pageShift: input.metadata?.pageShift,
      baselinePath: resolveAbsPath(input.baselineImagePath),
      currentPath: resolveAbsPath(input.currentImagePath),
      diffPath: resolveAbsPath(input.diffImagePath),
    });

    const provider = createDiffingProvider(providerConfig);
    response = await provider.generate({
      prompt: sdkPrompt,
      systemPrompt: DIFF_ANALYSIS_SYSTEM_PROMPT,
    });
  } else {
    // OpenRouter / Anthropic Direct: send base64 images
    const baselineImage = readImageAsBase64(input.baselineImagePath);
    const currentImage = readImageAsBase64(input.currentImagePath);
    const diffImage = readImageAsBase64(input.diffImagePath);

    const userPrompt = buildDiffAnalysisPrompt({
      testName: input.testName,
      percentageDifference: input.percentageDifference,
      changedRegions: input.metadata?.changedRegions?.length,
      changeCategories: input.metadata?.changeCategories,
      pageShift: input.metadata?.pageShift,
    });

    const provider = createDiffingProvider(providerConfig);
    response = await provider.generate({
      prompt: userPrompt,
      systemPrompt: DIFF_ANALYSIS_SYSTEM_PROMPT,
      maxTokens: 1024,
      temperature: 0.2,
      images: [baselineImage, currentImage, diffImage],
    });
  }

  // Parse JSON response
  const jsonStr = extractJsonObject(response);
  if (!jsonStr) {
    throw new Error(`AI response did not contain valid JSON. Response: ${response.slice(0, 500)}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    throw new Error(`Failed to parse extracted JSON: ${(e as Error).message}. Extracted: ${jsonStr.slice(0, 500)}`);
  }

  // Validate and normalize
  const classification = ['insignificant', 'meaningful', 'noise'].includes(parsed.classification)
    ? parsed.classification
    : 'meaningful';

  const recommendation = ['approve', 'review', 'flag'].includes(parsed.recommendation)
    ? parsed.recommendation
    : 'review';

  const confidence = typeof parsed.confidence === 'number'
    ? Math.max(0, Math.min(1, parsed.confidence))
    : 0.5;

  return {
    classification,
    recommendation,
    summary: parsed.summary || 'Unable to generate summary',
    confidence,
    categories: Array.isArray(parsed.categories) ? parsed.categories : [],
    analyzedAt: new Date().toISOString(),
  };
}
