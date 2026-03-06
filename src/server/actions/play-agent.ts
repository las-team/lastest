'use server';

import * as queries from '@/lib/db/queries';
import { requireTeamAccess, requireRepoAccess } from '@/lib/auth';
import { revalidatePath } from 'next/cache';
import type {
  AgentStepState,
  AgentStepId,
} from '@/lib/db/schema';
import { createAndRunBuild } from './builds';
import { getCurrentBranchForRepo } from '@/lib/git-utils';
import { getBuildSummary } from './builds';
import { startRemoteRouteScan, generateBasicTests } from './scanner';
import { applyTestingTemplate } from './repos';
import { aiScanRoutes, saveDiscoveredRoutes } from './ai-routes';
import { discoverSpecFiles, extractUserStoriesFromFiles, generateTestsFromStories } from './spec-import';
import { testServerConnection } from './environment';
import { aiFixTest } from './ai';
import { getAISettings } from './ai-settings';
import { getEnvironmentConfig } from './environment';
import { addDefaultSetupStep } from './setup-steps';
import { createHash } from 'crypto';
import { generateWithAI, extractCodeFromResponse } from '@/lib/ai';
import type { AIProviderConfig } from '@/lib/ai/types';
import { chromium } from 'playwright';
import type { SetupContext, SetupScript } from '@/lib/setup/types';
import { runPlaywrightSetup } from '@/lib/setup/script-runner';
import { classifyTemplate } from '@/lib/templates/classifier';
import { gatherCodebaseIntelligence } from '@/lib/ai/codebase-intelligence';
import type { CodebaseIntelligence } from '@/lib/ai/codebase-intelligence';
import type { CodebaseIntelligenceContext } from '@/lib/ai/types';

// ============================================
// Constants
// ============================================

const STEP_DEFINITIONS: Array<{ id: AgentStepId; label: string; description: string }> = [
  { id: 'settings_check', label: 'Settings Check', description: 'Verify GitHub, AI, and environment configuration' },
  { id: 'select_repo', label: 'Select Repository', description: 'Ensure a repository is selected' },
  { id: 'scan_and_template', label: 'Scan & Template', description: 'Scan routes and apply testing template' },
  { id: 'discover', label: 'Discover Tests', description: 'Find specs, scan routes, or generate smoke tests' },
  { id: 'env_setup', label: 'Env Setup', description: 'Verify server, detect login, configure setup' },
  { id: 'run_tests', label: 'Run Tests', description: 'Create and run initial build' },
  { id: 'fix_tests', label: 'Fix Failing Tests', description: 'AI-fix failing tests (max 3 attempts each)' },
  { id: 'rerun_tests', label: 'Re-run Tests', description: 'Re-run build after fixes' },
  { id: 'summary', label: 'Summary', description: 'Show results and pass/fail delta' },
];

const MAX_FIX_ATTEMPTS = 3;
const BUILD_POLL_INTERVAL_MS = 3000;

function buildInitialSteps(): AgentStepState[] {
  return STEP_DEFINITIONS.map((def) => ({
    id: def.id,
    status: 'pending' as const,
    label: def.label,
    description: def.description,
  }));
}

// ============================================
// Helpers
// ============================================

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex').slice(0, 16);
}

async function updateStep(
  sessionId: string,
  stepId: AgentStepId,
  update: Partial<AgentStepState>,
) {
  const session = await queries.getAgentSession(sessionId);
  if (!session) return;
  const steps = [...session.steps];
  const idx = steps.findIndex((s) => s.id === stepId);
  if (idx === -1) return;
  steps[idx] = { ...steps[idx], ...update };
  await queries.updateAgentSession(sessionId, {
    steps,
    currentStepId: update.status === 'active' ? stepId : session.currentStepId ?? undefined,
  });
}

async function setStepActive(sessionId: string, stepId: AgentStepId) {
  await updateStep(sessionId, stepId, {
    status: 'active',
    startedAt: new Date().toISOString(),
  });
  await queries.updateAgentSession(sessionId, { currentStepId: stepId });
}

async function setStepCompleted(sessionId: string, stepId: AgentStepId, result?: Record<string, unknown>) {
  await updateStep(sessionId, stepId, {
    status: 'completed',
    completedAt: new Date().toISOString(),
    result,
  });
}

async function setStepFailed(sessionId: string, stepId: AgentStepId, error: string) {
  await updateStep(sessionId, stepId, {
    status: 'failed',
    completedAt: new Date().toISOString(),
    error,
  });
  await queries.updateAgentSession(sessionId, { status: 'failed' });
}

async function setStepWaitingUser(sessionId: string, stepId: AgentStepId, userAction: string) {
  await updateStep(sessionId, stepId, {
    status: 'waiting_user',
    userAction,
  });
  await queries.updateAgentSession(sessionId, { status: 'paused' });
}

async function updateSubsteps(sessionId: string, stepId: AgentStepId, substeps: AgentStepState['substeps']) {
  await updateStep(sessionId, stepId, { substeps });
}

async function isCancelled(sessionId: string): Promise<boolean> {
  const session = await queries.getAgentSession(sessionId);
  return !session || session.status === 'cancelled';
}

async function waitForBuild(buildId: string): Promise<Awaited<ReturnType<typeof getBuildSummary>>> {
  for (;;) {
    const summary = await getBuildSummary(buildId);
    if (!summary) return null;
    if (summary.completedAt) return summary;
    await new Promise((r) => setTimeout(r, BUILD_POLL_INTERVAL_MS));
  }
}

// ============================================
// Step Implementations
// ============================================

async function runSettingsCheck(sessionId: string, repositoryId: string, teamId: string) {
  await setStepActive(sessionId, 'settings_check');

  const missing: string[] = [];

  // Check GitHub
  const ghAccount = await queries.getGithubAccountByTeam(teamId);
  if (!ghAccount) missing.push('GitHub account');

  // Check AI settings
  const aiSettings = await getAISettings(repositoryId);
  const hasAI = aiSettings.provider && aiSettings.provider !== 'none';
  if (!hasAI) missing.push('AI provider');

  if (missing.length > 0) {
    // Map missing items to settings page element IDs for highlight navigation
    const highlightIds: string[] = [];
    if (!ghAccount) highlightIds.push('github');
    if (!hasAI) highlightIds.push('ai-settings');

    await updateStep(sessionId, 'settings_check', {
      status: 'waiting_user',
      userAction: `Configure: ${missing.join(', ')}`,
      result: { highlight: highlightIds },
    });
    await queries.updateAgentSession(sessionId, { status: 'paused' });
    return false;
  }

  await setStepCompleted(sessionId, 'settings_check', {
    ghAccount: ghAccount?.githubUsername || 'Connected',
    aiProvider: aiSettings.provider,
  });
  return true;
}

async function runSelectRepo(sessionId: string, repositoryId: string) {
  await setStepActive(sessionId, 'select_repo');

  const repo = await queries.getRepository(repositoryId);
  if (!repo) {
    await setStepWaitingUser(sessionId, 'select_repo', 'Select a repository in the sidebar');
    return false;
  }

  await setStepCompleted(sessionId, 'select_repo', {
    repoFullName: repo.owner ? `${repo.owner}/${repo.name}` : repo.name,
    branch: repo.selectedBranch || repo.defaultBranch || 'main',
  });
  return true;
}

/** Convert full CodebaseIntelligence to the lighter context type for prompts */
function toIntelligenceContext(intel: CodebaseIntelligence): CodebaseIntelligenceContext {
  return {
    framework: intel.framework,
    cssFramework: intel.cssFramework,
    selectorStrategy: intel.selectorStrategy,
    authMechanism: intel.authMechanism,
    projectDescription: intel.projectDescription,
    testingRecommendations: intel.testingRecommendations,
    stateManagement: intel.stateManagement,
    apiLayer: intel.apiLayer,
  };
}

/** Build a human-readable intelligence brief for metadata */
function buildIntelligenceBrief(intel: CodebaseIntelligence, routeCount: number): Record<string, unknown> {
  const staticRoutes = routeCount; // We'll get exact counts from route data later
  return {
    framework: intel.framework,
    auth: intel.authMechanism,
    css: intel.cssFramework,
    stateManagement: intel.stateManagement,
    apiLayer: intel.apiLayer,
    keyDeps: intel.keyDeps.map(d => d.name),
    selectorStrategy: intel.selectorStrategy,
    projectDescription: intel.projectDescription || undefined,
    testingRecommendations: intel.testingRecommendations,
    routeCount: staticRoutes,
  };
}

async function runScanAndTemplate(sessionId: string, repositoryId: string) {
  await setStepActive(sessionId, 'scan_and_template');
  if (await isCancelled(sessionId)) return false;

  const repo = await queries.getRepository(repositoryId);
  if (!repo) {
    await setStepFailed(sessionId, 'scan_and_template', 'Repository not found');
    return false;
  }

  const branch = repo.selectedBranch || repo.defaultBranch || 'main';
  const account = repo.teamId ? await queries.getGithubAccountByTeam(repo.teamId) : null;

  // Run route scanning AND codebase intelligence gathering in parallel
  await updateSubsteps(sessionId, 'scan_and_template', [
    { label: 'Scanning routes', status: 'running' },
    { label: 'Analyzing codebase', status: 'running' },
    { label: 'Applying template', status: 'pending' },
  ]);

  const [scanResult, intelligence] = await Promise.all([
    startRemoteRouteScan(repositoryId, branch),
    account
      ? gatherCodebaseIntelligence(account.accessToken, repo.owner || '', repo.name, branch).catch(() => null)
      : Promise.resolve(null),
  ]);

  if (!scanResult.success) {
    await updateSubsteps(sessionId, 'scan_and_template', [
      { label: 'Scanning routes', status: 'error', detail: scanResult.error },
      { label: 'Analyzing codebase', status: intelligence ? 'done' : 'error' },
      { label: 'Applying template', status: 'pending' },
    ]);
    await setStepFailed(sessionId, 'scan_and_template', scanResult.error || 'Scan failed');
    return false;
  }

  if (await isCancelled(sessionId)) return false;

  // Store intelligence in session metadata for later steps
  if (intelligence) {
    const session = await queries.getAgentSession(sessionId);
    if (session) {
      await queries.updateAgentSession(sessionId, {
        metadata: {
          ...session.metadata,
          codebaseIntelligence: toIntelligenceContext(intelligence),
          intelligenceBrief: buildIntelligenceBrief(intelligence, scanResult.routesFound || 0),
        },
      });
    }
  }

  const intelDetail = intelligence
    ? `${intelligence.framework}, ${intelligence.keyDeps.length} key deps`
    : 'Skipped (no GitHub access)';

  // Template classification (uses scan results)
  await updateSubsteps(sessionId, 'scan_and_template', [
    { label: 'Scanning routes', status: 'done', detail: `${scanResult.routesFound} routes found` },
    { label: 'Analyzing codebase', status: 'done', detail: intelDetail },
    { label: 'Applying template', status: 'running' },
  ]);

  const repoRoutes = await queries.getRoutesByRepo(repositoryId);
  const routePaths = repoRoutes.map(r => r.path);

  const classification = await classifyTemplate(
    repositoryId,
    intelligence?.framework || scanResult.framework || 'unknown',
    routePaths,
    account?.accessToken || '',
    repo.owner || '',
    repo.name,
    branch,
  );
  const templateId = classification.templateId;

  // Only apply if no template currently set
  if (!repo.testingTemplate) {
    await applyTestingTemplate(repositoryId, templateId);
  }

  await updateSubsteps(sessionId, 'scan_and_template', [
    { label: 'Scanning routes', status: 'done', detail: `${scanResult.routesFound} routes found` },
    { label: 'Analyzing codebase', status: 'done', detail: intelDetail },
    { label: 'Applying template', status: 'done', detail: `${templateId} (${classification.confidence}%)` },
  ]);

  await setStepCompleted(sessionId, 'scan_and_template', {
    routesFound: scanResult.routesFound,
    framework: intelligence?.framework || scanResult.framework,
    templateApplied: templateId,
    hasIntelligence: !!intelligence,
    ...(intelligence ? { intelligenceBrief: buildIntelligenceBrief(intelligence, scanResult.routesFound || 0) } : {}),
  });
  return true;
}

const DISCOVER_POLL_INTERVAL_MS = 2000;

async function tryFallbackDiscovery(
  sessionId: string,
  repositoryId: string,
  branch: string,
  specDetail?: string,
): Promise<boolean> {
  const specLabel = specDetail || 'No spec files found';
  const envConfig = await getEnvironmentConfig(repositoryId);
  const baseUrl = envConfig?.baseUrl || 'http://localhost:3000';

  // Retrieve codebase intelligence from session metadata (gathered in scan_and_template)
  const session = await queries.getAgentSession(sessionId);
  const intelligence = session?.metadata?.codebaseIntelligence as CodebaseIntelligenceContext | undefined;

  // Fallback 1: AI route scan
  await updateSubsteps(sessionId, 'discover', [
    { label: 'Finding spec files', status: 'done', detail: specLabel },
    { label: 'AI route scan', status: 'running' },
    { label: 'Generating tests', status: 'pending' },
  ]);

  try {
    const scanResult = await aiScanRoutes(repositoryId, branch, intelligence);

    if (scanResult.success && scanResult.functionalAreas && scanResult.functionalAreas.length > 0) {
      const saveResult = await saveDiscoveredRoutes(repositoryId, scanResult.functionalAreas);

      if (saveResult.success && saveResult.savedRoutes && saveResult.savedRoutes.length > 0) {
        const totalRoutes = saveResult.savedRoutes.length;
        const areaCount = new Set(saveResult.savedRoutes.map((r) => r.areaName)).size;

        await updateSubsteps(sessionId, 'discover', [
          { label: 'Finding spec files', status: 'done', detail: specLabel },
          { label: 'AI route scan', status: 'done', detail: `${areaCount} areas, ${totalRoutes} routes` },
          { label: 'Generating tests', status: 'running' },
        ]);

        if (await isCancelled(sessionId)) return false;

        const routeIds = saveResult.savedRoutes.map((r) => r.routeId);
        const genResult = await generateBasicTests(repositoryId, routeIds, baseUrl);

        const testsCreated = genResult.testsCreated + genResult.testsUpdated;

        const session = await queries.getAgentSession(sessionId);
        if (session) {
          await queries.updateAgentSession(sessionId, {
            metadata: { ...session.metadata, testsCreated },
          });
        }

        await updateSubsteps(sessionId, 'discover', [
          { label: 'Finding spec files', status: 'done', detail: specLabel },
          { label: 'AI route scan', status: 'done', detail: `${areaCount} areas, ${totalRoutes} routes` },
          { label: 'Generating tests', status: 'done', detail: `${testsCreated} tests` },
        ]);

        await setStepCompleted(sessionId, 'discover', {
          method: 'ai_scan',
          areasFound: areaCount,
          routesFound: totalRoutes,
          testsCreated,
        });
        return true;
      }
    }
  } catch {
    // AI scan failed, continue to next fallback
  }

  if (await isCancelled(sessionId)) return false;

  // Fallback 2: Smoke tests from already-scanned routes
  await updateSubsteps(sessionId, 'discover', [
    { label: 'Finding spec files', status: 'done', detail: specLabel },
    { label: 'AI route scan', status: 'done', detail: 'No routes discovered' },
    { label: 'Generating smoke tests', status: 'running' },
  ]);

  const existingRoutes = await queries.getRoutesByRepo(repositoryId);

  if (existingRoutes.length > 0) {
    const routeIds = existingRoutes.map((r) => r.id);
    const genResult = await generateBasicTests(repositoryId, routeIds, baseUrl);
    const testsCreated = genResult.testsCreated + genResult.testsUpdated;

    if (testsCreated > 0) {
      const session = await queries.getAgentSession(sessionId);
      if (session) {
        await queries.updateAgentSession(sessionId, {
          metadata: { ...session.metadata, testsCreated },
        });
      }

      await updateSubsteps(sessionId, 'discover', [
        { label: 'Finding spec files', status: 'done', detail: specLabel },
        { label: 'AI route scan', status: 'done', detail: 'No routes discovered' },
        { label: 'Generating smoke tests', status: 'done', detail: `${testsCreated} tests` },
      ]);

      await setStepCompleted(sessionId, 'discover', {
        method: 'smoke_tests',
        routesUsed: existingRoutes.length,
        testsCreated,
      });
      return true;
    }
  }

  // All fallbacks exhausted
  await updateSubsteps(sessionId, 'discover', [
    { label: 'Finding spec files', status: 'done', detail: specLabel },
    { label: 'AI route scan', status: 'done', detail: 'No routes discovered' },
    { label: 'Generating smoke tests', status: 'done', detail: 'No routes available' },
  ]);

  await setStepCompleted(sessionId, 'discover', { skipped: true, reason: 'No tests could be generated' });
  return true;
}

async function runDiscover(sessionId: string, repositoryId: string) {
  await setStepActive(sessionId, 'discover');
  if (await isCancelled(sessionId)) return false;

  // Retrieve codebase intelligence from session metadata
  const discoverSession = await queries.getAgentSession(sessionId);
  const discoverIntelligence = discoverSession?.metadata?.codebaseIntelligence as CodebaseIntelligenceContext | undefined;

  const repo = await queries.getRepository(repositoryId);
  if (!repo) {
    await setStepFailed(sessionId, 'discover', 'Repository not found');
    return false;
  }

  const branch = repo.selectedBranch || repo.defaultBranch || 'main';

  // Cache: if repo already has tests in non-deleted areas, skip discovery
  const existingAreas = await queries.getFunctionalAreasByRepo(repositoryId);
  const areaIds = new Set(existingAreas.map(a => a.id));
  const existingTests = (await queries.getTestsByRepo(repositoryId)).filter(t => t.functionalAreaId && areaIds.has(t.functionalAreaId));
  if (existingTests.length > 0) {
    await updateSubsteps(sessionId, 'discover', [
      { label: 'Using existing tests', status: 'done', detail: `${existingTests.length} tests in ${existingAreas.length} areas` },
    ]);

    const session = await queries.getAgentSession(sessionId);
    if (session) {
      await queries.updateAgentSession(sessionId, {
        metadata: { ...session.metadata, testsCreated: existingTests.length },
      });
    }

    await setStepCompleted(sessionId, 'discover', {
      testsCreated: existingTests.length,
      areasCreated: existingAreas.length,
      cached: true,
    });
    return true;
  }

  // Substep 1: Discover spec files
  await updateSubsteps(sessionId, 'discover', [
    { label: 'Finding spec files', status: 'running' },
    { label: 'Extracting user stories', status: 'pending' },
    { label: 'Generating tests', status: 'pending' },
  ]);

  const specResult = await discoverSpecFiles(repositoryId, branch);

  if (!specResult.success || !specResult.files || specResult.files.length === 0) {
    return tryFallbackDiscovery(sessionId, repositoryId, branch);
  }

  if (await isCancelled(sessionId)) return false;

  // Substep 2: Extract user stories
  await updateSubsteps(sessionId, 'discover', [
    { label: 'Finding spec files', status: 'done', detail: `${specResult.files.length} files` },
    { label: 'Extracting user stories', status: 'running' },
    { label: 'Generating tests', status: 'pending' },
  ]);

  const filePaths = specResult.files.map((f) => f.path);
  const storiesResult = await extractUserStoriesFromFiles(repositoryId, branch, filePaths);

  if (!storiesResult.success || !storiesResult.stories || storiesResult.stories.length === 0) {
    // No stories from specs — fall through to AI scan / smoke test fallbacks
    return tryFallbackDiscovery(
      sessionId, repositoryId, branch,
      `${specResult.files.length} files (no stories extracted)`,
    );
  }

  if (await isCancelled(sessionId)) return false;

  // Count total tests to generate
  let totalTests = 0;
  for (const story of storiesResult.stories) {
    if (!story.acceptanceCriteria) continue;
    const grouped = new Set<string>();
    for (const ac of story.acceptanceCriteria) {
      if (ac.groupedWith && grouped.has(ac.groupedWith)) continue;
      grouped.add(ac.id);
      totalTests++;
    }
  }

  // Snapshot initial test count before generation
  const initialTestCount = (await queries.getTestsByRepo(repositoryId)).length;

  // Substep 3: Generate tests — fire off in background
  await updateSubsteps(sessionId, 'discover', [
    { label: 'Finding spec files', status: 'done', detail: `${specResult.files.length} files` },
    { label: 'Extracting user stories', status: 'done', detail: `${storiesResult.stories.length} stories` },
    { label: `Generating tests (0/${totalTests})`, status: 'running' },
  ]);

  const envConfig = await getEnvironmentConfig(repositoryId);

  let genDone = false;
  let genError: string | null = null;

  const genPromise = generateTestsFromStories(
    repositoryId,
    storiesResult.importId ?? null,
    storiesResult.stories,
    branch,
    { targetUrl: envConfig?.baseUrl || undefined, codebaseIntelligence: discoverIntelligence },
  );

  genPromise
    .then(() => { genDone = true; })
    .catch((err) => {
      genError = err instanceof Error ? err.message : 'Generation failed';
      genDone = true;
    });

  // Poll progress until generation completes or user skips
  while (!genDone) {
    await new Promise((r) => setTimeout(r, DISCOVER_POLL_INTERVAL_MS));

    if (await isCancelled(sessionId)) return false;

    const currentTestCount = (await queries.getTestsByRepo(repositoryId)).length;
    const generated = Math.max(0, currentTestCount - initialTestCount);

    await updateSubsteps(sessionId, 'discover', [
      { label: 'Finding spec files', status: 'done', detail: `${specResult.files.length} files` },
      { label: 'Extracting user stories', status: 'done', detail: `${storiesResult.stories.length} stories` },
      { label: `Generating tests (${generated}/${totalTests})`, status: 'running' },
    ]);

    // Check for skip flag
    const sess = await queries.getAgentSession(sessionId);
    if (sess?.metadata.skipDiscovery && generated >= 1) {
      const remaining = totalTests - generated;
      await updateSubsteps(sessionId, 'discover', [
        { label: 'Finding spec files', status: 'done', detail: `${specResult.files.length} files` },
        { label: 'Extracting user stories', status: 'done', detail: `${storiesResult.stories.length} stories` },
        { label: `Generated ${generated} tests`, status: 'done', detail: remaining > 0 ? `+${remaining} in background` : undefined },
      ]);

      await queries.updateAgentSession(sessionId, {
        metadata: { ...sess.metadata, testsCreated: generated },
      });

      await setStepCompleted(sessionId, 'discover', {
        specsFound: specResult.files.length,
        storiesExtracted: storiesResult.stories.length,
        testsCreated: generated,
        areasCreated: 0,
        ...(remaining > 0 ? { skippedRemaining: remaining } : {}),
      });
      // Generation continues in background — we proceed with onboarding
      return true;
    }
  }

  // Generation completed normally
  if (genError) {
    await setStepFailed(sessionId, 'discover', genError);
    return false;
  }

  // Re-await to get typed result (already resolved at this point)
  let finalResult: { testsCreated: number; areasCreated: number };
  try {
    const r = await genPromise;
    finalResult = { testsCreated: r.testsCreated, areasCreated: r.areasCreated };
  } catch {
    await setStepFailed(sessionId, 'discover', 'Generation failed');
    return false;
  }

  const session = await queries.getAgentSession(sessionId);
  if (session) {
    await queries.updateAgentSession(sessionId, {
      metadata: { ...session.metadata, testsCreated: finalResult.testsCreated },
    });
  }

  await updateSubsteps(sessionId, 'discover', [
    { label: 'Finding spec files', status: 'done', detail: `${specResult.files.length} files` },
    { label: 'Extracting user stories', status: 'done', detail: `${storiesResult.stories.length} stories` },
    { label: 'Generating tests', status: 'done', detail: `${finalResult.testsCreated} tests` },
  ]);

  await setStepCompleted(sessionId, 'discover', {
    specsFound: specResult.files.length,
    storiesExtracted: storiesResult.stories.length,
    testsCreated: finalResult.testsCreated,
    areasCreated: finalResult.areasCreated,
  });
  return true;
}

async function getAIConfig(repositoryId?: string | null): Promise<AIProviderConfig> {
  const settings = await queries.getAISettings(repositoryId);
  return {
    provider: settings.provider as 'claude-cli' | 'openrouter' | 'claude-agent-sdk',
    openrouterApiKey: settings.openrouterApiKey,
    openrouterModel: settings.openrouterModel || 'anthropic/claude-sonnet-4',
    customInstructions: settings.customInstructions,
    agentSdkPermissionMode: settings.agentSdkPermissionMode as 'plan' | 'default' | 'acceptEdits' | undefined,
    agentSdkModel: settings.agentSdkModel || undefined,
    agentSdkWorkingDir: settings.agentSdkWorkingDir || undefined,
  };
}

const LOGIN_SCRIPT_SYSTEM_PROMPT = `You are an expert Playwright setup script engineer.

FUNCTION SIGNATURE (required):
export async function setup(page, baseUrl, screenshotPath, stepLogger) { ... }

PARAMETERS:
- page: Playwright Page object
- baseUrl: Application base URL
- screenshotPath: unused (can ignore)
- stepLogger: { log(msg) } for status messages

CONSTRAINTS:
- Use baseUrl for navigation (not hardcoded URLs)
- Export async function "setup" with exact signature above
- Return an object with variables for tests (e.g., { loggedIn: true })
- Handle loading states with waitForLoadState or waitForSelector
- Use realistic test data (test@example.com, Password123!, etc.)
- page.waitForURL() predicates receive a URL object, not a string. Use url.href or url.toString() for string operations`;

function normalizeUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    parsed.pathname = parsed.pathname.replace(/\/{2,}/g, '/');
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

/**
 * Detect if a page at the given URL requires login by checking page content.
 */
async function detectLoginRequired(
  baseUrl: string,
): Promise<{ needsLogin: boolean; loginUrl?: string; hasRegisterLink?: boolean; registerUrl?: string; pageContent: string }> {
  let browser = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
    await page.waitForLoadState('domcontentloaded').catch(() => {});

    // Get page content for AI analysis
    const url = normalizeUrl(page.url());
    const title = await page.title();
    const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 3000) || '');
    const forms = await page.evaluate(() => {
      const formEls = document.querySelectorAll('form');
      return Array.from(formEls).map(f => ({
        action: f.action,
        inputs: Array.from(f.querySelectorAll('input')).map(i => ({
          type: i.type, name: i.name, placeholder: i.placeholder,
        })),
      }));
    });
    const links = (await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a')).map(a => ({
        href: a.href, text: a.textContent?.trim().slice(0, 50),
      })).filter(l => l.text && l.text.length > 0).slice(0, 30);
    })).map(l => ({ ...l, href: normalizeUrl(l.href) }));

    const pageContent = JSON.stringify({ url, title, bodyText: bodyText.slice(0, 2000), forms, links }, null, 2);

    // Quick heuristic before AI — check for obvious login indicators
    const hasPasswordField = forms.some(f => f.inputs.some(i => i.type === 'password'));
    const loginSegments = new Set(['login', 'signin', 'sign-in', 'auth', 'sign_in']);
    const pathSegments = new URL(url).pathname.split('/').map(s => s.toLowerCase());
    const isLoginPage = pathSegments.some(s => loginSegments.has(s));

    if (hasPasswordField || isLoginPage) {
      // Check for register link
      const registerLink = links.find(l => {
        const t = (l.text || '').toLowerCase();
        const h = (l.href || '').toLowerCase();
        return t.includes('register') || t.includes('sign up') || t.includes('create account')
          || h.includes('/register') || h.includes('/signup');
      });

      return {
        needsLogin: true,
        loginUrl: isLoginPage ? url : undefined,
        hasRegisterLink: !!registerLink,
        registerUrl: registerLink?.href ? normalizeUrl(registerLink.href) : undefined,
        pageContent,
      };
    }

    return { needsLogin: false, pageContent };
  } catch {
    return { needsLogin: false, pageContent: '' };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

/**
 * Generate a register+login setup script using AI, given page context.
 */
async function aiGenerateLoginScript(
  repositoryId: string,
  baseUrl: string,
  pageContext: string,
  hasRegister: boolean,
  registerUrl?: string,
  loginUrl?: string,
): Promise<{ success: boolean; code?: string; error?: string }> {
  try {
    const config = await getAIConfig(repositoryId);
    const prompt = `Generate a Playwright setup script for this web application at ${baseUrl}.

${hasRegister ? `The app has a registration page${registerUrl ? ` at ${registerUrl}` : ''}.
First register a new test account, then log in with it.` : `The app requires login${loginUrl ? ` at ${loginUrl}` : ''}.
Generate a login script using test credentials (test@example.com / Password123!).`}

PAGE CONTEXT:
${pageContext}

The script should:
1. ${hasRegister ? 'Navigate to the register page and create a test account with realistic data' : 'Navigate to the login page'}
2. Fill in the ${hasRegister ? 'registration' : 'login'} form and submit
3. Wait for successful ${hasRegister ? 'registration and then log in' : 'login'} (check for redirect or dashboard content)
4. Return { loggedIn: true } on success

Use stepLogger.log() to report progress.`;

    const response = await generateWithAI(config, prompt, LOGIN_SCRIPT_SYSTEM_PROMPT, {
      actionType: 'create_test',
      repositoryId,
    });
    const code = extractCodeFromResponse(response);
    return { success: true, code };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate login script';
    return { success: false, error: message };
  }
}

/**
 * Test a login script by running it in a temporary browser.
 */
async function testLoginScript(
  code: string,
  baseUrl: string,
  repositoryId: string,
): Promise<{ success: boolean; error?: string; duration: number }> {
  let browser = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();

    const script: SetupScript = {
      id: 'temp-login-test',
      repositoryId,
      name: 'Login Test',
      type: 'playwright',
      code,
      createdAt: null,
      updatedAt: null,
    };

    const setupContext: SetupContext = {
      baseUrl,
      page,
      variables: {},
      repositoryId,
    };

    const result = await runPlaywrightSetup(page, script, setupContext);
    return { success: result.success, error: result.error, duration: result.duration };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Script execution failed';
    return { success: false, error: message, duration: 0 };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

async function runEnvSetup(sessionId: string, repositoryId: string) {
  await setStepActive(sessionId, 'env_setup');
  if (await isCancelled(sessionId)) return false;

  const envConfig = await getEnvironmentConfig(repositoryId);
  const baseUrl = envConfig?.baseUrl;

  // Substep 1: Check base URL
  await updateSubsteps(sessionId, 'env_setup', [
    { label: 'Checking base URL', status: 'running' },
    { label: 'Detecting login', status: 'pending' },
    { label: 'Login setup', status: 'pending' },
  ]);

  if (!baseUrl) {
    await updateSubsteps(sessionId, 'env_setup', [
      { label: 'Checking base URL', status: 'error', detail: 'Not configured' },
      { label: 'Detecting login', status: 'pending' },
      { label: 'Login setup', status: 'pending' },
    ]);
    await updateStep(sessionId, 'env_setup', {
      status: 'waiting_user',
      userAction: 'No Base URL configured',
      result: { highlight: ['environment'] },
    });
    await queries.updateAgentSession(sessionId, { status: 'paused' });
    return false;
  }

  const connResult = await testServerConnection(baseUrl);
  if (!connResult.success) {
    await updateSubsteps(sessionId, 'env_setup', [
      { label: 'Checking base URL', status: 'error', detail: `Unreachable (${connResult.statusCode || 'timeout'})` },
      { label: 'Detecting login', status: 'pending' },
      { label: 'Login setup', status: 'pending' },
    ]);
    await setStepWaitingUser(
      sessionId,
      'env_setup',
      `Server unreachable at ${baseUrl}. Start your app and retry.`,
    );
    return false;
  }

  if (await isCancelled(sessionId)) return false;

  // Substep 2: Detect login
  await updateSubsteps(sessionId, 'env_setup', [
    { label: 'Checking base URL', status: 'done', detail: `${connResult.responseTime}ms` },
    { label: 'Detecting login', status: 'running' },
    { label: 'Login setup', status: 'pending' },
  ]);

  const loginDetection = await detectLoginRequired(baseUrl);

  // Check if setup steps already exist — skip login generation to avoid duplicates
  if (loginDetection.needsLogin) {
    const existingSteps = await queries.getDefaultSetupSteps(repositoryId);
    const hasScriptStep = existingSteps.some(s => s.stepType === 'script');
    if (hasScriptStep) {
      await updateSubsteps(sessionId, 'env_setup', [
        { label: 'Checking base URL', status: 'done', detail: `${connResult.responseTime}ms` },
        { label: 'Detecting login', status: 'done', detail: 'Login required' },
        { label: 'Login setup', status: 'done', detail: 'Already configured' },
      ]);
      await setStepCompleted(sessionId, 'env_setup', {
        url: baseUrl,
        responseTime: connResult.responseTime,
        loginRequired: true,
        loginSetup: true,
        existingSetup: true,
      });
      return true;
    }
  }

  if (!loginDetection.needsLogin) {
    // No login needed — done
    await updateSubsteps(sessionId, 'env_setup', [
      { label: 'Checking base URL', status: 'done', detail: `${connResult.responseTime}ms` },
      { label: 'Detecting login', status: 'done', detail: 'Not required' },
      { label: 'Login setup', status: 'done', detail: 'Skipped' },
    ]);
    await setStepCompleted(sessionId, 'env_setup', {
      url: baseUrl,
      responseTime: connResult.responseTime,
      loginRequired: false,
    });
    return true;
  }

  if (await isCancelled(sessionId)) return false;

  // Substep 3: Generate and test login script
  await updateSubsteps(sessionId, 'env_setup', [
    { label: 'Checking base URL', status: 'done', detail: `${connResult.responseTime}ms` },
    { label: 'Detecting login', status: 'done', detail: loginDetection.hasRegisterLink ? 'Register + Login' : 'Login required' },
    { label: 'Generating login script', status: 'running' },
  ]);

  const scriptResult = await aiGenerateLoginScript(
    repositoryId,
    baseUrl,
    loginDetection.pageContent,
    loginDetection.hasRegisterLink ?? false,
    loginDetection.registerUrl,
    loginDetection.loginUrl,
  );

  if (!scriptResult.success || !scriptResult.code) {
    await updateSubsteps(sessionId, 'env_setup', [
      { label: 'Checking base URL', status: 'done', detail: `${connResult.responseTime}ms` },
      { label: 'Detecting login', status: 'done', detail: 'Login required' },
      { label: 'Generating login script', status: 'error', detail: 'AI generation failed' },
    ]);
    await setStepFailed(sessionId, 'env_setup', scriptResult.error || 'Failed to generate login script');
    return false;
  }

  if (await isCancelled(sessionId)) return false;

  // Test the generated script
  await updateSubsteps(sessionId, 'env_setup', [
    { label: 'Checking base URL', status: 'done', detail: `${connResult.responseTime}ms` },
    { label: 'Detecting login', status: 'done', detail: loginDetection.hasRegisterLink ? 'Register + Login' : 'Login required' },
    { label: 'Testing login script', status: 'running' },
  ]);

  const testResult = await testLoginScript(scriptResult.code, baseUrl, repositoryId);

  if (!testResult.success) {
    // Script failed — save it as draft so user can fix, then pause
    const savedScript = await queries.createSetupScript({
      repositoryId,
      name: 'Auto-generated Login (needs fix)',
      type: 'playwright',
      code: scriptResult.code,
      description: `Auto-generated by onboarding agent. Error: ${testResult.error}`,
    });

    await updateSubsteps(sessionId, 'env_setup', [
      { label: 'Checking base URL', status: 'done', detail: `${connResult.responseTime}ms` },
      { label: 'Detecting login', status: 'done', detail: 'Login required' },
      { label: 'Testing login script', status: 'error', detail: testResult.error?.slice(0, 80) },
    ]);

    // Store script ID in metadata for later reference
    const session = await queries.getAgentSession(sessionId);
    if (session) {
      await queries.updateAgentSession(sessionId, {
        metadata: { ...session.metadata, loginScriptId: savedScript.id },
      });
    }

    await setStepWaitingUser(
      sessionId,
      'env_setup',
      `Login script failed: ${testResult.error?.slice(0, 120)}. Fix the script in Settings → Setup and retry.`,
    );
    return false;
  }

  // Script works — save it and add as default setup step
  const savedScript = await queries.createSetupScript({
    repositoryId,
    name: 'Login Setup',
    type: 'playwright',
    code: scriptResult.code,
    description: 'Auto-generated login setup by onboarding agent',
  });

  await addDefaultSetupStep(repositoryId, 'script', savedScript.id);

  await updateSubsteps(sessionId, 'env_setup', [
    { label: 'Checking base URL', status: 'done', detail: `${connResult.responseTime}ms` },
    { label: 'Detecting login', status: 'done', detail: loginDetection.hasRegisterLink ? 'Register + Login' : 'Login' },
    { label: 'Login setup added', status: 'done', detail: `${testResult.duration}ms` },
  ]);

  await setStepCompleted(sessionId, 'env_setup', {
    url: baseUrl,
    responseTime: connResult.responseTime,
    loginRequired: true,
    loginSetup: true,
    loginScriptId: savedScript.id,
  });
  return true;
}

async function runTests(sessionId: string, repositoryId: string) {
  await setStepActive(sessionId, 'run_tests');
  if (await isCancelled(sessionId)) return false;

  try {
    const buildResult = await createAndRunBuild('manual', undefined, repositoryId);

    if (!buildResult.buildId) {
      await setStepFailed(sessionId, 'run_tests', 'Build was queued — please wait and retry');
      return false;
    }

    const buildId = buildResult.buildId;

    // Store build ID in metadata
    const session = await queries.getAgentSession(sessionId);
    if (session) {
      const buildIds: string[] = [...(session.metadata.buildIds || []), buildId];
      await queries.updateAgentSession(sessionId, {
        metadata: { ...session.metadata, buildIds },
      });
    }

    await updateSubsteps(sessionId, 'run_tests', [
      { label: `Running ${buildResult.testCount} tests`, status: 'running' },
    ]);

    // Wait for build to complete
    const summary = await waitForBuild(buildId);
    if (!summary) {
      await setStepFailed(sessionId, 'run_tests', 'Build not found after creation');
      return false;
    }

    if (await isCancelled(sessionId)) return false;

    // Store initial results in metadata
    const sess = await queries.getAgentSession(sessionId);
    if (sess) {
      await queries.updateAgentSession(sessionId, {
        metadata: {
          ...sess.metadata,
          initialPassedCount: summary.passedCount,
          initialFailedCount: summary.failedCount,
        },
      });
    }

    await updateSubsteps(sessionId, 'run_tests', [
      {
        label: `${summary.passedCount} passed, ${summary.failedCount} failed`,
        status: summary.failedCount > 0 ? 'error' : 'done',
      },
    ]);

    await setStepCompleted(sessionId, 'run_tests', {
      buildId,
      passedCount: summary.passedCount,
      failedCount: summary.failedCount,
      totalTests: summary.totalTests,
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to run tests';
    await setStepFailed(sessionId, 'run_tests', message);
    return false;
  }
}

async function runFixTests(sessionId: string, repositoryId: string) {
  await setStepActive(sessionId, 'fix_tests');
  if (await isCancelled(sessionId)) return false;

  // Get the latest build summary + intelligence context
  const session = await queries.getAgentSession(sessionId);
  if (!session) return false;
  const intelligence = session.metadata?.codebaseIntelligence as CodebaseIntelligenceContext | undefined;

  const buildIds = session.metadata.buildIds || [];
  const lastBuildId = buildIds[buildIds.length - 1];
  if (!lastBuildId) {
    await setStepFailed(sessionId, 'fix_tests', 'No build found to fix');
    return false;
  }

  const summary = await getBuildSummary(lastBuildId);
  if (!summary || summary.failedCount === 0) {
    // No failures — skip
    await setStepCompleted(sessionId, 'fix_tests', { skipped: true, reason: 'No failing tests' });
    return true;
  }

  // Get failing test results from the build's test run
  const build = await queries.getBuild(lastBuildId);
  if (!build?.testRunId) {
    await setStepCompleted(sessionId, 'fix_tests', { skipped: true, reason: 'No test run found' });
    return true;
  }

  const testResultsList = await queries.getTestResultsByRun(build.testRunId);
  const failedResults = testResultsList.filter(
    (r) => r.status === 'failed' && r.errorMessage && r.testId,
  );

  if (failedResults.length === 0) {
    await setStepCompleted(sessionId, 'fix_tests', { skipped: true, reason: 'No test errors to fix' });
    return true;
  }

  const fixAttempts: Record<string, number> = { ...session.metadata.fixAttempts };
  const codeHashes: Record<string, string[]> = { ...session.metadata.codeHashes };
  let fixedCount = 0;
  let unfixableCount = 0;

  for (let i = 0; i < failedResults.length; i++) {
    if (await isCancelled(sessionId)) return false;

    const result = failedResults[i];
    const testId = result.testId!;
    const errorMessage = result.errorMessage!;

    const attempts = fixAttempts[testId] || 0;
    if (attempts >= MAX_FIX_ATTEMPTS) {
      unfixableCount++;
      continue;
    }

    const test = await queries.getTest(testId);

    await updateSubsteps(sessionId, 'fix_tests', [
      {
        label: `Fixing test ${i + 1}/${failedResults.length}: ${test?.name || testId}`,
        status: 'running',
        detail: `Attempt ${attempts + 1}/${MAX_FIX_ATTEMPTS}`,
      },
    ]);

    const fixResult = await aiFixTest(repositoryId, testId, errorMessage, intelligence);
    fixAttempts[testId] = attempts + 1;

    if (fixResult.success && fixResult.code) {
      // Check for oscillation
      const hashes = codeHashes[testId] || [];
      const newHash = hashCode(fixResult.code);

      if (hashes.includes(newHash)) {
        // Oscillation detected — mark as unfixable
        unfixableCount++;
        continue;
      }

      hashes.push(newHash);
      codeHashes[testId] = hashes;

      // Apply the fix
      await queries.updateTest(testId, { code: fixResult.code });
      if (test) {
        const branch = await getCurrentBranchForRepo(repositoryId);
        const versions = await queries.getTestVersions(testId);
        await queries.createTestVersion({
          testId,
          name: test.name,
          code: fixResult.code,
          version: (versions.length || 0) + 1,
          changeReason: 'ai_fix',
          branch: branch ?? null,
        });
      }
      fixedCount++;
    }

    // Update metadata periodically
    const currentSession = await queries.getAgentSession(sessionId);
    if (currentSession) {
      await queries.updateAgentSession(sessionId, {
        metadata: { ...currentSession.metadata, fixAttempts, codeHashes },
      });
    }
  }

  await updateSubsteps(sessionId, 'fix_tests', [
    {
      label: `${fixedCount} fixed, ${unfixableCount} unfixable`,
      status: fixedCount > 0 ? 'done' : unfixableCount > 0 ? 'error' : 'done',
    },
  ]);

  await setStepCompleted(sessionId, 'fix_tests', { fixedCount, unfixableCount });
  return true;
}

async function runRerunTests(sessionId: string, repositoryId: string) {
  // Check if fixes were made
  const session = await queries.getAgentSession(sessionId);
  if (!session) return false;

  const fixStep = session.steps.find((s) => s.id === 'fix_tests');
  if (fixStep?.result?.skipped || (fixStep?.result?.fixedCount === 0)) {
    // No fixes were made — skip rerun
    await updateStep(sessionId, 'rerun_tests', {
      status: 'skipped',
      completedAt: new Date().toISOString(),
    });
    return true;
  }

  await setStepActive(sessionId, 'rerun_tests');
  if (await isCancelled(sessionId)) return false;

  try {
    const buildResult = await createAndRunBuild('manual', undefined, repositoryId);

    if (!buildResult.buildId) {
      await setStepFailed(sessionId, 'rerun_tests', 'Build was queued — please wait and retry');
      return false;
    }

    const buildId = buildResult.buildId;

    const sess = await queries.getAgentSession(sessionId);
    if (sess) {
      const buildIds: string[] = [...(sess.metadata.buildIds || []), buildId];
      await queries.updateAgentSession(sessionId, {
        metadata: { ...sess.metadata, buildIds },
      });
    }

    await updateSubsteps(sessionId, 'rerun_tests', [
      { label: `Re-running ${buildResult.testCount} tests`, status: 'running' },
    ]);

    const summary = await waitForBuild(buildId);
    if (!summary) {
      await setStepFailed(sessionId, 'rerun_tests', 'Build not found');
      return false;
    }

    if (await isCancelled(sessionId)) return false;

    // Store final results
    const finalSess = await queries.getAgentSession(sessionId);
    if (finalSess) {
      await queries.updateAgentSession(sessionId, {
        metadata: {
          ...finalSess.metadata,
          finalPassedCount: summary.passedCount,
          finalFailedCount: summary.failedCount,
        },
      });
    }

    await updateSubsteps(sessionId, 'rerun_tests', [
      {
        label: `${summary.passedCount} passed, ${summary.failedCount} failed`,
        status: summary.failedCount > 0 ? 'error' : 'done',
      },
    ]);

    await setStepCompleted(sessionId, 'rerun_tests', {
      buildId,
      passedCount: summary.passedCount,
      failedCount: summary.failedCount,
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to re-run tests';
    await setStepFailed(sessionId, 'rerun_tests', message);
    return false;
  }
}

async function runSummary(sessionId: string) {
  await setStepActive(sessionId, 'summary');

  const session = await queries.getAgentSession(sessionId);
  if (!session) return;

  const meta = session.metadata;
  const result: Record<string, unknown> = {
    testsCreated: meta.testsCreated || 0,
    initialPassed: meta.initialPassedCount || 0,
    initialFailed: meta.initialFailedCount || 0,
    finalPassed: meta.finalPassedCount ?? meta.initialPassedCount ?? 0,
    finalFailed: meta.finalFailedCount ?? meta.initialFailedCount ?? 0,
    buildIds: meta.buildIds || [],
    fixAttempts: meta.fixAttempts || {},
  };

  await setStepCompleted(sessionId, 'summary', result);
  await queries.updateAgentSession(sessionId, {
    status: 'completed',
    completedAt: new Date(),
  });
}

// ============================================
// Orchestrator
// ============================================

type StepRunner = (sessionId: string, repositoryId: string, teamId: string) => Promise<boolean>;

const STEP_ORDER: Array<{ id: AgentStepId; run: StepRunner }> = [
  { id: 'settings_check', run: (sid, rid, tid) => runSettingsCheck(sid, rid, tid) },
  { id: 'select_repo', run: (sid, rid) => runSelectRepo(sid, rid) },
  { id: 'scan_and_template', run: (sid, rid) => runScanAndTemplate(sid, rid) },
  { id: 'discover', run: (sid, rid) => runDiscover(sid, rid) },
  { id: 'env_setup', run: (sid, rid) => runEnvSetup(sid, rid) },
  { id: 'run_tests', run: (sid, rid) => runTests(sid, rid) },
  { id: 'fix_tests', run: (sid, rid) => runFixTests(sid, rid) },
  { id: 'rerun_tests', run: (sid, rid) => runRerunTests(sid, rid) },
  {
    id: 'summary',
    run: async (sid) => {
      await runSummary(sid);
      return true;
    },
  },
];

async function executeFromStep(sessionId: string, repositoryId: string, teamId: string, startStepId: AgentStepId) {
  const startIdx = STEP_ORDER.findIndex((s) => s.id === startStepId);
  if (startIdx === -1) return;

  for (let i = startIdx; i < STEP_ORDER.length; i++) {
    if (await isCancelled(sessionId)) return;

    const step = STEP_ORDER[i];
    const success = await step.run(sessionId, repositoryId, teamId);

    if (!success) {
      // Step paused or failed — stop execution
      return;
    }
  }

  revalidatePath('/run');
}

// ============================================
// Public API
// ============================================

export async function startPlayAgent(repositoryId: string): Promise<{ sessionId: string }> {
  const { team } = await requireRepoAccess(repositoryId);

  // Cancel any existing active session for this repo
  const existing = await queries.getActiveAgentSession(repositoryId);
  if (existing) {
    await queries.updateAgentSession(existing.id, {
      status: 'cancelled',
      completedAt: new Date(),
    });
  }

  const session = await queries.createAgentSession({
    repositoryId,
    teamId: team?.id ?? null,
    status: 'active',
    currentStepId: 'settings_check',
    steps: buildInitialSteps(),
    metadata: {},
  });

  // Fire-and-forget: run steps
  executeFromStep(session.id, repositoryId, team?.id ?? '', 'settings_check').catch((err) => {
    console.error('[PlayAgent] Unhandled error:', err);
    queries.updateAgentSession(session.id, { status: 'failed' }).catch(() => {});
  });

  return { sessionId: session.id };
}

export async function resumePlayAgent(sessionId: string): Promise<{ success: boolean }> {
  await requireTeamAccess();

  const session = await queries.getAgentSession(sessionId);
  if (!session || session.status === 'cancelled' || session.status === 'completed') {
    return { success: false };
  }

  // Find the step that needs resuming
  const waitingStep = session.steps.find((s) => s.status === 'waiting_user' || s.status === 'failed');
  if (!waitingStep) return { success: false };

  // Reset step status
  await updateStep(sessionId, waitingStep.id, {
    status: 'pending',
    error: undefined,
    userAction: undefined,
  });
  await queries.updateAgentSession(sessionId, { status: 'active' });

  const { team } = await requireRepoAccess(session.repositoryId);

  // Fire-and-forget: resume from the waiting step
  executeFromStep(sessionId, session.repositoryId, team?.id ?? '', waitingStep.id).catch((err) => {
    console.error('[PlayAgent] Resume error:', err);
    queries.updateAgentSession(sessionId, { status: 'failed' }).catch(() => {});
  });

  return { success: true };
}

export async function cancelPlayAgent(sessionId: string): Promise<{ success: boolean }> {
  await requireTeamAccess();

  const session = await queries.getAgentSession(sessionId);
  if (!session) return { success: false };

  await queries.updateAgentSession(sessionId, {
    status: 'cancelled',
    completedAt: new Date(),
  });

  revalidatePath('/run');
  return { success: true };
}

export async function getPlayAgentSession(sessionId: string) {
  return queries.getAgentSession(sessionId);
}

export async function getActivePlayAgentSession(repositoryId: string) {
  return queries.getActiveAgentSession(repositoryId);
}

export async function skipDiscoverStep(sessionId: string): Promise<{ success: boolean }> {
  await requireTeamAccess();
  const session = await queries.getAgentSession(sessionId);
  if (!session) return { success: false };
  await queries.updateAgentSession(sessionId, {
    metadata: { ...session.metadata, skipDiscovery: true },
  });
  return { success: true };
}
