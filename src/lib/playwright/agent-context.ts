/**
 * Agent Context — shared helpers for PW agents (Planner, Generator, Healer).
 * Builds seed fixture prompts from env config, setup steps, and known routes.
 */

import * as queries from '@/lib/db/queries';
import type { AIProviderConfig, CodebaseIntelligenceContext } from '@/lib/ai/types';

// ---------------------------------------------------------------------------
// AI config builder (shared by all agents)
// ---------------------------------------------------------------------------

export function getAIConfig(settings: Awaited<ReturnType<typeof queries.getAISettings>>): AIProviderConfig {
  return {
    provider: settings.provider as AIProviderConfig['provider'],
    openrouterApiKey: settings.openrouterApiKey,
    openrouterModel: settings.openrouterModel || 'anthropic/claude-sonnet-4',
    customInstructions: settings.customInstructions,
    agentSdkPermissionMode: settings.agentSdkPermissionMode as 'plan' | 'default' | 'acceptEdits' | undefined,
    agentSdkModel: settings.agentSdkModel || undefined,
    agentSdkWorkingDir: settings.agentSdkWorkingDir || undefined,
    anthropicApiKey: settings.anthropicApiKey,
    anthropicModel: settings.anthropicModel || undefined,
    openaiApiKey: settings.openaiApiKey,
    openaiModel: settings.openaiModel || undefined,
  };
}

// ---------------------------------------------------------------------------
// Seed fixture builder
// ---------------------------------------------------------------------------

export interface SeedFixture {
  /** The seed test code block for agents to use as a starting point */
  seedPrompt: string;
  /** Base URL from env config */
  baseUrl: string;
  /** Whether the seed includes a login/auth setup step */
  hasLoginSetup: boolean;
}

/**
 * Build a seed fixture prompt from the repository's env config, setup steps,
 * known routes, and codebase intelligence. This gives PW agents the context
 * they need to explore the app effectively without starting from scratch.
 */
export async function buildSeedFixture(repositoryId: string): Promise<SeedFixture> {
  const parts: string[] = [];
  let hasLoginSetup = false;

  // 1. Environment config — fail loudly if missing rather than masking with a
  //    localhost default, which silently sends MCP exploration at the wrong URL.
  const envConfig = await queries.getEnvironmentConfig(repositoryId);
  if (!envConfig?.baseUrl) {
    throw new Error(`Base URL not configured for repository ${repositoryId}. Complete env setup first.`);
  }
  const baseUrl = envConfig.baseUrl;

  parts.push(`## Environment`);
  parts.push(`- Base URL: ${baseUrl}`);

  // 2. Setup steps (login, auth, initialization) — the "seed test"
  const setupSteps = await queries.getDefaultSetupSteps(repositoryId);
  if (setupSteps.length > 0) {
    const seedParts: string[] = [];
    for (const step of setupSteps) {
      const code = step.code || step.scriptCode || '';
      const name = step.testName || step.scriptName || `Step ${step.orderIndex}`;
      if (code) {
        seedParts.push(`// ${name}\n${code}`);
      }
      if (step.storageStateName) {
        seedParts.push(`// Storage state: ${step.storageStateName} (pre-authenticated browser state)`);
      }
    }

    if (seedParts.length > 0) {
      // Detect if any setup step involves login/auth
      hasLoginSetup = setupSteps.some(s => {
        const code = (s.code || s.scriptCode || '').toLowerCase();
        const name = (s.testName || s.scriptName || '').toLowerCase();
        return code.includes('login') || code.includes('password') || code.includes('sign in')
          || name.includes('login') || name.includes('auth') || name.includes('setup');
      });

      parts.push('');
      parts.push(`## Seed Test (run this FIRST before exploring)`);
      parts.push(`This seed test sets up the environment (e.g. login, authentication).`);
      parts.push(`Execute these steps using MCP browser tools before exploring the app.`);
      if (hasLoginSetup) {
        parts.push(`**IMPORTANT: Do NOT include these login/setup steps in your generated test code. A separate setup script runs them automatically before each test at runtime. Your test should assume the user is already logged in.**`);
      }
      parts.push('```javascript');
      parts.push(seedParts.join('\n\n'));
      parts.push('```');
    }
  }

  // 3. Known routes from previous scans
  const routes = await queries.getRoutesByRepo(repositoryId);
  if (routes.length > 0) {
    const staticRoutes = routes.filter(r => !r.path.includes('[') && !r.path.includes(':'));
    const dynamicRoutes = routes.filter(r => r.path.includes('[') || r.path.includes(':'));

    parts.push('');
    parts.push(`## Known Routes (${routes.length} total)`);
    parts.push(`These routes were discovered from the codebase. Use them as starting points for exploration.`);

    if (staticRoutes.length > 0) {
      parts.push(`\nStatic routes:`);
      for (const r of staticRoutes.slice(0, 30)) {
        parts.push(`- ${r.path}`);
      }
    }
    if (dynamicRoutes.length > 0) {
      parts.push(`\nDynamic routes (navigate to parent page first to find real IDs):`);
      for (const r of dynamicRoutes.slice(0, 15)) {
        parts.push(`- ${r.path}`);
      }
    }
  }

  // 4. Codebase intelligence (framework, selectors, auth)
  // Try to get from the active agent session metadata
  const activeSession = await queries.getActiveAgentSession(repositoryId);
  const intelligence = activeSession?.metadata?.codebaseIntelligence as CodebaseIntelligenceContext | undefined;

  if (intelligence) {
    parts.push('');
    parts.push(`## Codebase Intelligence`);
    if (intelligence.framework) parts.push(`- Framework: ${intelligence.framework}`);
    if (intelligence.cssFramework) parts.push(`- CSS: ${intelligence.cssFramework}`);
    if (intelligence.selectorStrategy) parts.push(`- Selector strategy: ${intelligence.selectorStrategy}`);
    if (intelligence.authMechanism && intelligence.authMechanism !== 'none detected') {
      parts.push(`- Auth: ${intelligence.authMechanism}`);
    }
    if (intelligence.testingRecommendations?.length) {
      parts.push(`- Testing tips:`);
      for (const tip of intelligence.testingRecommendations.slice(0, 5)) {
        parts.push(`  - ${tip}`);
      }
    }
  }

  return {
    seedPrompt: parts.join('\n'),
    baseUrl,
    hasLoginSetup,
  };
}
