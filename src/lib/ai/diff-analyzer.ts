import fs from 'fs';
import path from 'path';
import type { AIDiffAnalysis, DiffMetadata } from '@/lib/db/schema';
import { DIFF_ANALYSIS_SYSTEM_PROMPT, buildDiffAnalysisPrompt } from './diff-prompts';
import { createOpenRouterProvider } from './openrouter';
import { createAnthropicDirectProvider } from './anthropic-direct';
import type { AIProvider } from './types';

interface AnalyzeDiffInput {
  baselineImagePath: string;
  currentImagePath: string;
  diffImagePath: string;
  metadata?: DiffMetadata;
  percentageDifference: string;
  testName: string;
}

export interface DiffingProviderConfig {
  provider: 'openrouter' | 'anthropic';
  apiKey: string;
  model: string;
}

function readImageAsBase64(imagePath: string): { base64: string; mediaType: string } {
  const fullPath = imagePath.startsWith('/')
    ? imagePath
    : path.join(process.cwd(), 'public', imagePath);

  const buffer = fs.readFileSync(fullPath);

  return {
    base64: buffer.toString('base64'),
    mediaType: 'image/png',
  };
}

function createDiffingProvider(config: DiffingProviderConfig): AIProvider {
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

export async function analyzeDiff(
  input: AnalyzeDiffInput,
  providerConfig: DiffingProviderConfig
): Promise<AIDiffAnalysis> {
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

  const response = await provider.generate({
    prompt: userPrompt,
    systemPrompt: DIFF_ANALYSIS_SYSTEM_PROMPT,
    maxTokens: 1024,
    temperature: 0.2,
    images: [baselineImage, currentImage, diffImage],
  });

  // Parse JSON response
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('AI response did not contain valid JSON');
  }

  const parsed = JSON.parse(jsonMatch[0]);

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
