import type { TestingTemplateId } from './testing-templates';
import { getRepoTree, getFileContent } from '@/lib/github/content';
import { getAISettings } from '@/lib/db/queries';
import { generateWithAI } from '@/lib/ai';
import type { AIProviderConfig } from '@/lib/ai/types';

export interface ClassificationResult {
  templateId: TestingTemplateId;
  confidence: number;
  reasoning: string;
}

const VALID_TEMPLATES = ['saas', 'marketing', 'canvas', 'ecommerce', 'documentation', 'mobile-first', 'spa', 'cms'] as const;

/**
 * Classify a repository into a testing template using AI with heuristic fallback.
 */
export async function classifyTemplate(
  repositoryId: string,
  framework: string,
  routePaths: string[],
  githubToken: string,
  owner: string,
  repoName: string,
  branch: string,
): Promise<ClassificationResult> {
  // Try AI classification first
  if (githubToken && owner && repoName) {
    try {
      const result = await classifyWithAI(
        repositoryId, framework, routePaths, githubToken, owner, repoName, branch,
      );
      if (result) return result;
    } catch {
      // Fall through to heuristic
    }
  }

  return classifyWithHeuristics(framework, routePaths);
}

async function gatherCodebaseSignals(
  githubToken: string,
  owner: string,
  repoName: string,
  branch: string,
): Promise<{ deps: string[]; readme: string; directories: string[] }> {
  const [packageJsonContent, tree, readmeContent] = await Promise.all([
    getFileContent(githubToken, owner, repoName, 'package.json', branch),
    getRepoTree(githubToken, owner, repoName, branch),
    getFileContent(githubToken, owner, repoName, 'README.md', branch),
  ]);

  // Parse dependencies from package.json
  let deps: string[] = [];
  if (packageJsonContent) {
    try {
      const pkg = JSON.parse(packageJsonContent);
      deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).slice(0, 30);
    } catch {
      // Invalid JSON
    }
  }

  // Extract key directory names from tree
  const directories: string[] = [];
  if (tree?.tree) {
    const dirSet = new Set<string>();
    for (const entry of tree.tree) {
      if (entry.type === 'tree') {
        // Only top-level and second-level dirs
        const parts = entry.path.split('/');
        if (parts.length <= 2) {
          dirSet.add(entry.path);
        }
      }
    }
    directories.push(...Array.from(dirSet).slice(0, 50));
  }

  const readme = readmeContent ? readmeContent.slice(0, 1500) : '';

  return { deps, readme, directories };
}

async function classifyWithAI(
  repositoryId: string,
  framework: string,
  routePaths: string[],
  githubToken: string,
  owner: string,
  repoName: string,
  branch: string,
): Promise<ClassificationResult | null> {
  const settings = await getAISettings(repositoryId);
  // claude-cli and claude-agent-sdk are too heavyweight for simple classification
  // (they spawn full subprocesses). Skip unless a lighter provider is available.
  const heavyProviders = ['claude-cli', 'claude-agent-sdk'];
  if (!settings?.provider || heavyProviders.includes(settings.provider)) {
    if (!settings.openrouterApiKey && !settings.anthropicApiKey && !settings.openaiApiKey) {
      return null;
    }
    // Fall through with a lighter provider override
  }

  const { deps, readme, directories } = await gatherCodebaseSignals(
    githubToken, owner, repoName, branch,
  );

  // Don't call AI if we have no useful signals
  if (deps.length === 0 && !readme && directories.length === 0) {
    return null;
  }

  const prompt = `Classify this web application into exactly ONE template type.

Available types: saas, marketing, canvas, ecommerce, documentation, mobile-first, spa, cms

Context:
- Framework: ${framework}
- Dependencies: ${deps.join(', ') || 'unknown'}
- Routes: ${routePaths.slice(0, 30).join(', ') || 'none discovered'}
- README excerpt: ${readme || 'not available'}
- Key directories: ${directories.join(', ') || 'unknown'}

Respond with JSON only, no markdown fences: {"template": "...", "confidence": 0-100, "reasoning": "one sentence"}`;

  // For heavy providers, pick the best available lightweight alternative
  let effectiveProvider = settings.provider as AIProviderConfig['provider'];
  if (heavyProviders.includes(settings.provider)) {
    if (settings.anthropicApiKey) effectiveProvider = 'anthropic';
    else if (settings.openrouterApiKey) effectiveProvider = 'openrouter';
    else if (settings.openaiApiKey) effectiveProvider = 'openai';
  }

  const config: AIProviderConfig = {
    provider: effectiveProvider,
    openrouterApiKey: settings.openrouterApiKey,
    openrouterModel: settings.openrouterModel || undefined,
    anthropicApiKey: settings.anthropicApiKey,
    anthropicModel: settings.anthropicModel || undefined,
    openaiApiKey: settings.openaiApiKey,
    openaiModel: settings.openaiModel || undefined,
    customInstructions: settings.customInstructions,
    ollamaBaseUrl: settings.ollamaBaseUrl || undefined,
    ollamaModel: settings.ollamaModel || undefined,
  };

  const response = await generateWithAI(config, prompt, 'You are a web application classifier. Respond with valid JSON only.', {
    actionType: 'classify_template',
    repositoryId,
  });

  return parseAIResponse(response);
}

function parseAIResponse(response: string): ClassificationResult | null {
  try {
    // Strip markdown fences if present
    const cleaned = response.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleaned);

    const template = parsed.template?.toLowerCase();
    if (!VALID_TEMPLATES.includes(template)) return null;

    return {
      templateId: template as TestingTemplateId,
      confidence: Math.max(0, Math.min(100, Number(parsed.confidence) || 50)),
      reasoning: String(parsed.reasoning || '').slice(0, 200),
    };
  } catch {
    return null;
  }
}

// Dependency-based heuristic fallback
const DEP_RULES: Array<{ deps: string[]; template: TestingTemplateId }> = [
  { deps: ['payload', '@payloadcms', 'strapi', '@strapi', 'sanity', '@sanity', 'contentful', '@keystonejs'], template: 'cms' },
  { deps: ['@shopify', 'shopify-api', '@medusajs', 'medusa', 'saleor', 'snipcart', '@snipcart'], template: 'ecommerce' },
  { deps: ['docusaurus', '@docusaurus', 'mkdocs', 'vitepress', 'nextra', '@nextra'], template: 'documentation' },
  { deps: ['three', '@pixi', 'pixi.js', 'fabric', 'konva'], template: 'canvas' },
  { deps: ['react-native', 'expo', '@expo', 'capacitor', '@capacitor', '@ionic'], template: 'mobile-first' },
];

function classifyWithHeuristics(framework: string, routePaths: string[]): ClassificationResult {
  const fw = framework.toLowerCase();

  // Check route patterns for hints
  const routeStr = routePaths.join(' ').toLowerCase();
  if (routeStr.includes('/admin') && (routeStr.includes('/content') || routeStr.includes('/collections'))) {
    return { templateId: 'cms', confidence: 60, reasoning: 'Route patterns suggest CMS (admin + content routes)' };
  }
  if (routeStr.includes('/products') || routeStr.includes('/cart') || routeStr.includes('/checkout')) {
    return { templateId: 'ecommerce', confidence: 60, reasoning: 'Route patterns suggest ecommerce (product/cart/checkout routes)' };
  }

  // Framework-based defaults
  if (fw.includes('docs') || fw.includes('docusaurus') || fw.includes('mkdocs') || fw.includes('vitepress')) {
    return { templateId: 'documentation', confidence: 70, reasoning: `Documentation framework detected: ${framework}` };
  }
  if (fw.includes('vue') || fw.includes('nuxt')) {
    return { templateId: 'spa', confidence: 50, reasoning: `SPA framework detected: ${framework}` };
  }

  return { templateId: 'saas', confidence: 40, reasoning: `Default template for ${framework || 'unknown'} framework` };
}

/**
 * Classify using dependency list (used when GitHub data is available but AI is not).
 * Exported for use in classifyTemplate when deps are pre-fetched.
 */
export function classifyFromDeps(deps: string[]): TestingTemplateId | null {
  const depStr = deps.join(' ').toLowerCase();
  for (const rule of DEP_RULES) {
    if (rule.deps.some(d => depStr.includes(d))) {
      return rule.template;
    }
  }
  return null;
}
