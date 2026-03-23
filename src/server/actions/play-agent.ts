'use server';

import * as queries from '@/lib/db/queries';
import { requireTeamAccess, requireRepoAccess } from '@/lib/auth';
import { revalidatePath } from 'next/cache';
import type {
  AgentStepState,
  AgentStepId,
  AgentStepRichResult,
  AgentRichResultPlanArea,
} from '@/lib/db/schema';
import { createAndRunBuild } from './builds';
import { getCurrentBranchForRepo } from '@/lib/git-utils';
import { getBuildSummary } from './builds';
import { startRemoteRouteScan, generateBasicTests } from './scanner';
import { applyTestingTemplate } from './repos';
import { aiScanRoutes, saveDiscoveredRoutes } from './ai-routes';
import { discoverSpecFiles, extractUserStoriesFromFiles } from './spec-import';
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
  { id: 'env_setup', label: 'Env Setup', description: 'Verify server, detect login, configure setup' },
  { id: 'scan_and_template', label: 'Scan & Template', description: 'Scan routes and apply testing template' },
  { id: 'plan', label: 'Plan Tests', description: 'Discover functional areas and create test plans' },
  { id: 'review', label: 'Review Plan', description: 'Review and approve the test plan' },
  { id: 'generate', label: 'Generate Tests', description: 'Generate test code from approved plan' },
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
// AbortController Registry
// ============================================

const activeControllers = new Map<string, AbortController>();

function getOrCreateController(sessionId: string): AbortController {
  let controller = activeControllers.get(sessionId);
  if (!controller || controller.signal.aborted) {
    controller = new AbortController();
    activeControllers.set(sessionId, controller);
  }
  return controller;
}

function cleanupController(sessionId: string) {
  activeControllers.delete(sessionId);
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

async function setStepCompleted(sessionId: string, stepId: AgentStepId, result?: Record<string, unknown>, richResult?: AgentStepRichResult) {
  await updateStep(sessionId, stepId, {
    status: 'completed',
    completedAt: new Date().toISOString(),
    result,
    ...(richResult ? { richResult } : {}),
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

function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

async function waitForBuild(buildId: string, signal: AbortSignal): Promise<Awaited<ReturnType<typeof getBuildSummary>>> {
  for (;;) {
    if (signal.aborted) return null;
    const summary = await getBuildSummary(buildId);
    if (!summary) return null;
    if (summary.completedAt) return summary;
    await new Promise((r) => setTimeout(r, BUILD_POLL_INTERVAL_MS));
  }
}

// ============================================
// Step Implementations
// ============================================

async function runSettingsCheck(sessionId: string, repositoryId: string, teamId: string, _signal: AbortSignal) {
  await setStepActive(sessionId, 'settings_check');

  const missing: string[] = [];

  const ghAccount = await queries.getGithubAccountByTeam(teamId);
  if (!ghAccount) missing.push('GitHub account');

  const aiSettings = await getAISettings(repositoryId);
  const hasAI = aiSettings.provider && aiSettings.provider !== 'none';
  if (!hasAI) missing.push('AI provider');

  if (missing.length > 0) {
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

  const pwEnabled = aiSettings.pwAgentEnabled ?? false;
  await setStepCompleted(sessionId, 'settings_check', {
    ghAccount: ghAccount?.githubUsername || 'Connected',
    aiProvider: aiSettings.provider,
    pwAgentEnabled: pwEnabled,
    activeAgents: pwEnabled ? ['scout', 'diver', 'planner', 'generator', 'healer'] : [],
  });
  return true;
}

async function runSelectRepo(sessionId: string, repositoryId: string, _teamId: string, _signal: AbortSignal) {
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

// ============================================
// Env Setup (now step 3 — before scan/plan)
// ============================================

function normalizeUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    parsed.pathname = parsed.pathname.replace(/\/{2,}/g, '/');
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

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

    const hasPasswordField = forms.some(f => f.inputs.some(i => i.type === 'password'));
    const loginSegments = new Set(['login', 'signin', 'sign-in', 'auth', 'sign_in']);
    const pathSegments = new URL(url).pathname.split('/').map(s => s.toLowerCase());
    const isLoginPage = pathSegments.some(s => loginSegments.has(s));

    if (hasPasswordField || isLoginPage) {
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

async function aiGenerateLoginScript(
  repositoryId: string,
  baseUrl: string,
  pageContext: string,
  hasRegister: boolean,
  registerUrl?: string,
  loginUrl?: string,
  signal?: AbortSignal,
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
      signal,
    });
    const code = extractCodeFromResponse(response);
    return { success: true, code };
  } catch (error) {
    if (error instanceof Error && error.message === 'Aborted') throw error;
    const message = error instanceof Error ? error.message : 'Failed to generate login script';
    return { success: false, error: message };
  }
}

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

async function runEnvSetup(sessionId: string, repositoryId: string, _teamId: string, signal: AbortSignal) {
  await setStepActive(sessionId, 'env_setup');
  if (isAborted(signal)) return false;

  const envConfig = await getEnvironmentConfig(repositoryId);
  const baseUrl = envConfig?.baseUrl;

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

  if (isAborted(signal)) return false;

  await updateSubsteps(sessionId, 'env_setup', [
    { label: 'Checking base URL', status: 'done', detail: `${connResult.responseTime}ms` },
    { label: 'Detecting login', status: 'running' },
    { label: 'Login setup', status: 'pending' },
  ]);

  const loginDetection = await detectLoginRequired(baseUrl);

  // Check if setup steps or scripts already exist
  if (loginDetection.needsLogin) {
    const existingSteps = await queries.getDefaultSetupSteps(repositoryId);
    const hasScriptStep = existingSteps.some(s => s.stepType === 'script');
    const existingScripts = await queries.getSetupScripts(repositoryId);
    if (hasScriptStep || existingScripts.length > 0) {
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

  if (isAborted(signal)) return false;

  // Generate and test login script
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
    signal,
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

  if (isAborted(signal)) return false;

  await updateSubsteps(sessionId, 'env_setup', [
    { label: 'Checking base URL', status: 'done', detail: `${connResult.responseTime}ms` },
    { label: 'Detecting login', status: 'done', detail: loginDetection.hasRegisterLink ? 'Register + Login' : 'Login required' },
    { label: 'Testing login script', status: 'running' },
  ]);

  const testResult = await testLoginScript(scriptResult.code, baseUrl, repositoryId);

  if (!testResult.success) {
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

  // Rich result: include login script code for visibility
  const richResult: AgentStepRichResult = {
    type: 'env_setup',
    loginScript: scriptResult.code,
    pageContext: loginDetection.pageContent,
  };

  await setStepCompleted(sessionId, 'env_setup', {
    url: baseUrl,
    responseTime: connResult.responseTime,
    loginRequired: true,
    loginSetup: true,
    loginScriptId: savedScript.id,
  }, richResult);
  return true;
}

// ============================================
// Scan & Template (now step 4)
// ============================================

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

function buildIntelligenceBrief(intel: CodebaseIntelligence, routeCount: number): Record<string, unknown> {
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
    routeCount,
  };
}

async function runScanAndTemplate(sessionId: string, repositoryId: string, _teamId: string, signal: AbortSignal) {
  await setStepActive(sessionId, 'scan_and_template');
  if (isAborted(signal)) return false;

  const repo = await queries.getRepository(repositoryId);
  if (!repo) {
    await setStepFailed(sessionId, 'scan_and_template', 'Repository not found');
    return false;
  }

  const branch = repo.selectedBranch || repo.defaultBranch || 'main';
  const account = repo.teamId ? await queries.getGithubAccountByTeam(repo.teamId) : null;

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

  if (isAborted(signal)) return false;

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

  if (!repo.testingTemplate) {
    await applyTestingTemplate(repositoryId, templateId);
  }

  await updateSubsteps(sessionId, 'scan_and_template', [
    { label: 'Scanning routes', status: 'done', detail: `${scanResult.routesFound} routes found` },
    { label: 'Analyzing codebase', status: 'done', detail: intelDetail },
    { label: 'Applying template', status: 'done', detail: `${templateId} (${classification.confidence}%)` },
  ]);

  // Build rich result with actual routes
  const richResult: AgentStepRichResult = {
    type: 'scan_and_template',
    routes: repoRoutes.map(r => ({ path: r.path, type: r.type || 'static' })),
    framework: (intelligence?.framework || scanResult.framework) ?? undefined,
    template: templateId,
    intelligence: intelligence ? buildIntelligenceBrief(intelligence, scanResult.routesFound || 0) : undefined,
  };

  await setStepCompleted(sessionId, 'scan_and_template', {
    routesFound: scanResult.routesFound,
    framework: intelligence?.framework || scanResult.framework,
    templateApplied: templateId,
    hasIntelligence: !!intelligence,
    ...(intelligence ? { intelligenceBrief: buildIntelligenceBrief(intelligence, scanResult.routesFound || 0) } : {}),
  }, richResult);
  return true;
}

// ============================================
// Plan (step 5) — formerly first half of discover
// ============================================

async function runPlanWithAgents(
  sessionId: string,
  repositoryId: string,
  branch: string,
  signal: AbortSignal,
): Promise<boolean> {
  const envConfig = await getEnvironmentConfig(repositoryId);
  const baseUrl = envConfig?.baseUrl || 'http://localhost:3000';

  const sessionData = await queries.getAgentSession(sessionId);
  const intelligence = sessionData?.metadata?.codebaseIntelligence as CodebaseIntelligenceContext | undefined;

  // Dynamic substep list — grows as scout/divers start
  type SubstepState = NonNullable<AgentStepState['substeps']>[number];
  const plannerStates: SubstepState[] = [
    { label: 'Coordinating multi-planner pipeline', status: 'running', agent: 'orchestrator' },
    { label: 'Scanning codebase routes', status: 'pending', agent: 'planner', source: 'code' },
    { label: 'Checking route coverage', status: 'pending', agent: 'planner', source: 'routes' },
    { label: 'Analyzing spec files', status: 'pending', agent: 'planner', source: 'spec' },
    { label: 'Classifying areas', status: 'pending', agent: 'scout', source: 'browser-scout' },
  ];

  const flushSubsteps = () => updateSubsteps(sessionId, 'plan', [...plannerStates]);
  await flushSubsteps();

  if (isAborted(signal)) return false;

  plannerStates[0].status = 'done';
  await flushSubsteps();

  const { runBrowserPlanner } = await import('@/lib/playwright/planners/browser-planner');
  const { runCodePlanner } = await import('@/lib/playwright/planners/code-planner');
  const { runSpecPlanner } = await import('@/lib/playwright/planners/spec-planner');
  const { runRoutePlanner } = await import('@/lib/playwright/planners/route-planner');

  /** Helper to enrich a substep from a PlannerResult */
  const enrichSubstep = (idx: number, result: import('@/lib/playwright/planner-types').PlannerResult) => {
    plannerStates[idx].status = result.error ? 'error' : 'done';
    plannerStates[idx].detail = result.error ? result.error.slice(0, 60) : `${result.areas.length} areas`;
    plannerStates[idx].durationMs = result.durationMs;
    plannerStates[idx].areasFound = result.areas.length;
    plannerStates[idx].promptLogId = result.promptLogId;
    plannerStates[idx].inputSummary = result.inputSummary;
    plannerStates[idx].outputSummary = result.areas.length > 0 ? result.areas.map(a => a.name).join(', ') : undefined;
    plannerStates[idx].rawError = result.error;
  };

  // ── Phase A: Run code + route planners first (fast), start spec in parallel ──
  plannerStates[1].status = 'running';
  plannerStates[2].status = 'running';
  plannerStates[3].status = 'running';
  await flushSubsteps();

  const specPromise = runSpecPlanner(repositoryId, branch).then(r => {
    enrichSubstep(3, r);
    flushSubsteps();
    return r;
  }).catch(err => {
    plannerStates[3].status = 'error';
    plannerStates[3].rawError = err instanceof Error ? err.message : String(err);
    flushSubsteps();
    return { source: 'spec' as const, areas: [], error: String(err) } as import('@/lib/playwright/planner-types').PlannerResult;
  });

  const [codeResult, routeResult] = await Promise.all([
    runCodePlanner(repositoryId, branch, intelligence).then(r => { enrichSubstep(1, r); flushSubsteps(); return r; })
      .catch(err => { plannerStates[1].status = 'error'; plannerStates[1].rawError = String(err); flushSubsteps(); return { source: 'code' as const, areas: [], error: String(err) } as import('@/lib/playwright/planner-types').PlannerResult; }),
    runRoutePlanner(repositoryId).then(r => { enrichSubstep(2, r); flushSubsteps(); return r; })
      .catch(err => { plannerStates[2].status = 'error'; plannerStates[2].rawError = String(err); flushSubsteps(); return { source: 'routes' as const, areas: [], error: String(err) } as import('@/lib/playwright/planner-types').PlannerResult; }),
  ]);

  if (isAborted(signal)) return false;

  // ── Phase B+C: Browser planner (scout → deep-dive internally) ──
  const otherAreas = [...codeResult.areas, ...routeResult.areas];
  plannerStates[4].status = 'running';
  plannerStates[4].detail = `${otherAreas.length} areas from code+route`;
  await flushSubsteps();

  const browserResult = await runBrowserPlanner(repositoryId, baseUrl, {
    otherPlannerAreas: otherAreas,
    signal,
    onLogCreated: (id) => { plannerStates[4].promptLogId = id; },
    onScoutComplete: (scout) => {
      const exploreAreas = scout.areas.filter(a => a.classification === 'explore');
      const skipCount = scout.areas.filter(a => a.classification === 'skip').length;

      // Update scout substep
      plannerStates[4].status = 'done';
      plannerStates[4].detail = `${skipCount} skip, ${exploreAreas.length} explore`;
      plannerStates[4].durationMs = scout.durationMs;
      plannerStates[4].promptLogId = scout.promptLogId;

      // Add diver substeps for each explore area
      for (const area of exploreAreas) {
        plannerStates.push({
          label: `${area.name} (${area.routes.slice(0, 2).join(', ')}${area.routes.length > 2 ? '...' : ''})`,
          status: 'pending',
          agent: 'diver',
          source: `browser-dive-${area.name}`,
          inputSummary: area.focusPoints?.join('; '),
        });
      }
      flushSubsteps();
    },
    onDeepDiveStart: (areaName) => {
      const idx = plannerStates.findIndex(s => s.source === `browser-dive-${areaName}`);
      if (idx >= 0) { plannerStates[idx].status = 'running'; flushSubsteps(); }
    },
    onDeepDiveComplete: (areaName, areasFound, durationMs, promptLogId) => {
      const idx = plannerStates.findIndex(s => s.source === `browser-dive-${areaName}`);
      if (idx >= 0) {
        plannerStates[idx].status = areasFound > 0 ? 'done' : 'error';
        plannerStates[idx].areasFound = areasFound;
        plannerStates[idx].durationMs = durationMs;
        plannerStates[idx].detail = areasFound > 0 ? `${areasFound} areas` : 'No areas found';
        plannerStates[idx].promptLogId = promptLogId;
        flushSubsteps();
      }
    },
  }).catch(err => {
    plannerStates[4].status = 'error';
    plannerStates[4].rawError = err instanceof Error ? err.message : String(err);
    flushSubsteps();
    return { source: 'browser' as const, areas: [], error: String(err) } as import('@/lib/playwright/planner-types').PlannerResult;
  });

  // Wait for spec planner
  const specResult = await specPromise;

  if (isAborted(signal)) return false;

  // ── Collect all results ──
  const allResults = [browserResult, codeResult, specResult, routeResult];

  const allPlannerResults: Record<string, { source: string; areas: import('@/lib/playwright/planner-types').PlannerArea[]; error?: string; rawOutput?: string }> = {};
  const fulfilledResults: import('@/lib/playwright/planner-types').PlannerResult[] = [];
  for (const r of allResults) {
    allPlannerResults[r.source] = { source: r.source, areas: r.areas, error: r.error, rawOutput: r.rawOutput };
    if (r.areas.length > 0) fulfilledResults.push(r);
  }

  // Persist planner results + scout output to metadata
  const metaSession = await queries.getAgentSession(sessionId);
  if (metaSession) {
    await queries.updateAgentSession(sessionId, {
      metadata: { ...metaSession.metadata, plannerResults: allPlannerResults },
    });
  }

  // Merge results
  const { mergePlannerResults } = await import('@/lib/playwright/planner-merger');

  const mergedAreas = mergePlannerResults(fulfilledResults);
  const sourcesUsed = new Set(fulfilledResults.map(r => r.source)).size;

  if (mergedAreas.length === 0) {
    // Fallback: try to discover from routes
    await setStepCompleted(sessionId, 'plan', {
      method: 'fallback',
      areasFound: 0,
      sourcesUsed: 0,
    });
    return true;
  }

  const areaCount = mergedAreas.length;
  const routeCount = mergedAreas.reduce((sum, a) => sum + a.routes.length, 0);

  // Get existing routes so we don't re-add ones the user may have rearranged
  const existingRoutes = await queries.getRoutesByRepo(repositoryId);
  const existingRoutePaths = new Set(existingRoutes.map(r => r.path));

  // Save only genuinely new routes to DB
  const { saveDiscoveredRoutes: saveRoutes } = await import('./ai-routes');
  await saveRoutes(repositoryId, mergedAreas.map(a => ({
    name: a.name,
    routes: a.routes
      .filter(r => !existingRoutePaths.has(r))
      .map(r => ({
        path: r,
        type: (r.includes('[') || r.includes(':') ? 'dynamic' : 'static') as 'static' | 'dynamic',
      })),
  })));

  // Save agent plans to functional areas
  const richAreas: AgentRichResultPlanArea[] = [];
  for (const area of mergedAreas) {
    const dbArea = await queries.getOrCreateFunctionalAreaByRepo(
      repositoryId,
      area.name,
      area.description,
    );
    if (area.testPlan) {
      // Save snapshot for rollback before overwriting
      const snapshot = JSON.stringify({
        previousPlan: dbArea.agentPlan,
        previousDescription: dbArea.description,
        generatedTestIds: [],
      });
      await queries.updateFunctionalArea(dbArea.id, {
        agentPlan: area.testPlan,
        planGeneratedAt: new Date(),
        planSnapshot: snapshot,
      });
    }
    // Only include routes not already in DB (user may have rearranged them)
    const newRoutes = area.routes.filter(r => !existingRoutePaths.has(r));
    richAreas.push({
      id: dbArea.id,
      name: area.name,
      description: area.description || '',
      routes: newRoutes,
      testPlan: area.testPlan || '',
    });
  }

  // Build rich result for review step
  const richResult: AgentStepRichResult = {
    type: 'plan',
    areas: richAreas,
  };

  await setStepCompleted(sessionId, 'plan', {
    method: 'pw_agents_parallel',
    areasFound: areaCount,
    routesFound: routeCount,
    sourcesUsed,
  }, richResult);
  return true;
}

async function runPlanPromptMode(
  sessionId: string,
  repositoryId: string,
  branch: string,
  signal: AbortSignal,
): Promise<boolean> {
  const discoverSession = await queries.getAgentSession(sessionId);
  const discoverIntelligence = discoverSession?.metadata?.codebaseIntelligence as CodebaseIntelligenceContext | undefined;

  // Check if tests already exist
  const existingTests = await queries.getTestsByRepo(repositoryId);
  if (existingTests.length > 0) {
    const existingAreas = await queries.getFunctionalAreasByRepo(repositoryId);
    await updateSubsteps(sessionId, 'plan', [
      { label: 'Using existing tests', status: 'done', detail: `${existingTests.length} tests in ${existingAreas.length} areas` },
    ]);

    const session = await queries.getAgentSession(sessionId);
    if (session) {
      await queries.updateAgentSession(sessionId, {
        metadata: { ...session.metadata, testsCreated: existingTests.length },
      });
    }

    await setStepCompleted(sessionId, 'plan', {
      testsCreated: existingTests.length,
      areasCreated: existingAreas.length,
      cached: true,
    });
    return true;
  }

  // Discover spec files
  await updateSubsteps(sessionId, 'plan', [
    { label: 'Finding spec files', status: 'running' },
    { label: 'Extracting user stories', status: 'pending' },
  ]);

  const specResult = await discoverSpecFiles(repositoryId, branch);

  if (!specResult.success || !specResult.files || specResult.files.length === 0) {
    // Fallback: AI route scan
    await updateSubsteps(sessionId, 'plan', [
      { label: 'Finding spec files', status: 'done', detail: 'No spec files found' },
      { label: 'AI route scan', status: 'running' },
    ]);

    const aiResult = await aiScanRoutes(repositoryId, branch, discoverIntelligence);
    if (aiResult.success && aiResult.functionalAreas && aiResult.functionalAreas.length > 0) {
      await saveDiscoveredRoutes(repositoryId, aiResult.functionalAreas);
    }

    await setStepCompleted(sessionId, 'plan', {
      method: 'ai_scan_fallback',
      areasFound: aiResult.functionalAreas?.length || 0,
    });
    return true;
  }

  if (isAborted(signal)) return false;

  await updateSubsteps(sessionId, 'plan', [
    { label: 'Finding spec files', status: 'done', detail: `${specResult.files.length} files` },
    { label: 'Extracting user stories', status: 'running' },
  ]);

  const filePaths = specResult.files.map(f => f.path);
  const storiesResult = await extractUserStoriesFromFiles(repositoryId, branch, filePaths);

  await setStepCompleted(sessionId, 'plan', {
    method: 'spec_discovery',
    specsFound: specResult.files.length,
    storiesExtracted: storiesResult.stories?.length || 0,
  });
  return true;
}

async function runPlan(sessionId: string, repositoryId: string, _teamId: string, signal: AbortSignal) {
  await setStepActive(sessionId, 'plan');
  if (isAborted(signal)) return false;

  const repo = await queries.getRepository(repositoryId);
  if (!repo) {
    await setStepFailed(sessionId, 'plan', 'Repository not found');
    return false;
  }

  const branch = repo.selectedBranch || repo.defaultBranch || 'main';

  const aiSettings = await getAISettings(repositoryId);
  if (aiSettings?.pwAgentEnabled) {
    return runPlanWithAgents(sessionId, repositoryId, branch, signal);
  }

  return runPlanPromptMode(sessionId, repositoryId, branch, signal);
}

// ============================================
// Review (step 6) — human gate
// ============================================

async function runReview(sessionId: string, _repositoryId: string, _teamId: string, _signal: AbortSignal) {
  await setStepActive(sessionId, 'review');

  const session = await queries.getAgentSession(sessionId);
  if (!session) return false;

  // If user already approved (approvedAreaIds set via approvePlayAgentPlan), proceed
  if (session.metadata.approvedAreaIds && session.metadata.approvedAreaIds.length > 0) {
    await setStepCompleted(sessionId, 'review', {
      approvedCount: session.metadata.approvedAreaIds.length,
    });
    return true;
  }

  // Auto-approve if user has opted in
  if (session.metadata.autoApproveReview) {
    const planStep = session.steps.find(s => s.id === 'plan');
    const planRich = planStep?.richResult as { type: 'plan'; areas: AgentRichResultPlanArea[] } | undefined;
    let approvedIds: string[];
    if (planRich?.areas) {
      approvedIds = planRich.areas.map(a => a.id);
    } else {
      // Fallback: approve all areas that have an agent plan
      const dbAreas = await queries.getFunctionalAreasByRepo(_repositoryId);
      approvedIds = dbAreas.filter(a => a.agentPlan).map(a => a.id);
    }
    await queries.updateAgentSession(sessionId, {
      metadata: { ...session.metadata, approvedAreaIds: approvedIds },
    });
    await setStepCompleted(sessionId, 'review', { autoApproved: true });
    return true;
  }

  // Check if plan produced no areas (fallback path) — auto-skip review
  const planStep = session.steps.find(s => s.id === 'plan');
  const planResult = planStep?.result;
  if (planResult?.cached || planResult?.method === 'fallback' || planResult?.method === 'ai_scan_fallback' || planResult?.method === 'spec_discovery') {
    await setStepCompleted(sessionId, 'review', { skipped: true, reason: 'No plan to review' });
    return true;
  }

  // Pause for user review — show plan areas with richResult from plan step
  const planRich = planStep?.richResult as { type: 'plan'; areas: AgentRichResultPlanArea[] } | undefined;
  const areaCount = planRich?.areas?.length || 0;

  // Copy the plan's richResult to the review step so the UI can render it
  if (planRich) {
    await updateStep(sessionId, 'review', { richResult: planRich });
  }

  await setStepWaitingUser(
    sessionId,
    'review',
    `${areaCount} functional areas planned. Review and approve to generate tests.`,
  );
  return false;
}

// ============================================
// Generate (step 7) — formerly second half of discover
// ============================================

async function runGenerate(sessionId: string, repositoryId: string, _teamId: string, signal: AbortSignal) {
  await setStepActive(sessionId, 'generate');
  if (isAborted(signal)) return false;

  const session = await queries.getAgentSession(sessionId);
  if (!session) return false;

  const envConfig = await getEnvironmentConfig(repositoryId);
  const baseUrl = envConfig?.baseUrl || 'http://localhost:3000';
  const approvedAreaIds = session.metadata.approvedAreaIds;

  const aiSettings = await getAISettings(repositoryId);
  const useAgents = aiSettings?.pwAgentEnabled ?? false;

  // Get areas to generate tests for
  const dbAreas = await queries.getFunctionalAreasByRepo(repositoryId);
  let targetAreas = dbAreas.filter(a => a.agentPlan);

  // Filter by approved areas if review step provided them
  if (approvedAreaIds && approvedAreaIds.length > 0) {
    targetAreas = targetAreas.filter(a => approvedAreaIds.includes(a.id));
  }

  let testsCreated = 0;
  const generatedTests: Array<{ testId: string; name: string; areaName: string; code: string }> = [];

  if (useAgents && targetAreas.length > 0) {
    const { agentCreateTest, groupScenariosForGeneration } = await import('@/lib/playwright/generator-agent');
    const GENERATOR_CONCURRENCY = 8;

    // Build work items: group scenarios by route proximity per area
    const workItems: Array<{
      area: typeof targetAreas[0];
      group: import('@/lib/playwright/generator-agent').ScenarioGroup;
    }> = [];

    const allRoutes = await queries.getRoutesByRepo(repositoryId);

    for (const area of targetAreas) {
      // Save scenario summary to area description if not already set
      if (area.agentPlan && !area.description) {
        const scenarioLines = area.agentPlan.split('\n').filter(l => /^###\s+Scenario\s+\d+:/.test(l));
        const desc = scenarioLines.length > 0
          ? scenarioLines.map(l => l.replace(/^###\s+Scenario\s+\d+:\s*/, '- ')).join('\n')
          : area.agentPlan.slice(0, 500);
        await queries.updateFunctionalArea(area.id, { description: desc });
      }

      // Get known routes for this area to help grouping
      const routePaths = allRoutes
        .filter(r => r.functionalAreaId === area.id)
        .map(r => r.path);

      const groups = area.agentPlan
        ? groupScenariosForGeneration(area.agentPlan, area.name, routePaths)
        : [{ name: area.name, description: `Test ${area.name}`, combinedSteps: '', scenarioCount: 1 }];

      for (const group of groups) {
        workItems.push({ area, group });
      }
    }

    const totalWork = workItems.length;

    for (let batch = 0; batch < workItems.length; batch += GENERATOR_CONCURRENCY) {
      if (isAborted(signal)) return false;

      const chunk = workItems.slice(batch, batch + GENERATOR_CONCURRENCY);

      await updateSubsteps(sessionId, 'generate', [
        {
          label: `Generating tests (${Math.min(batch, totalWork)}/${totalWork})`,
          status: 'running',
          detail: `${chunk.length} generators in parallel`,
          agent: 'generator',
        },
      ]);

      const results = await Promise.allSettled(
        chunk.map(async ({ area, group }) => {
          const genResult = await agentCreateTest(repositoryId, {
            functionalAreaId: area.id,
            baseUrl,
            scenarioGroup: group,
          });
          if (genResult.success && genResult.code) {
            const test = await queries.createTest({
              repositoryId,
              functionalAreaId: area.id,
              name: group.name,
              description: group.description,
              code: genResult.code,
              targetUrl: baseUrl,
            });
            generatedTests.push({
              testId: test.id,
              name: group.name,
              areaName: area.name,
              code: genResult.code,
            });
            return true;
          }
          return false;
        }),
      );

      testsCreated += results.filter(r => r.status === 'fulfilled' && r.value).length;
    }
  } else {
    // Prompt mode: generate basic tests from saved routes
    const { saveDiscoveredRoutes: _sr } = await import('./ai-routes');
    const repoRoutes = await queries.getRoutesByRepo(repositoryId);
    if (repoRoutes.length > 0) {
      await updateSubsteps(sessionId, 'generate', [
        { label: `Generating smoke tests for ${repoRoutes.length} routes`, status: 'running' },
      ]);
      const routeIds = repoRoutes.map(r => r.id);
      const genResult = await generateBasicTests(repositoryId, routeIds, baseUrl);
      testsCreated = genResult.testsCreated + genResult.testsUpdated;
    }
  }

  // Update planSnapshot with generated test IDs per area
  const testsByArea = new Map<string, string[]>();
  for (const gt of generatedTests) {
    const existing = testsByArea.get(gt.areaName) || [];
    existing.push(gt.testId);
    testsByArea.set(gt.areaName, existing);
  }
  for (const area of targetAreas) {
    const areaTestIds = generatedTests.filter(t => t.areaName === area.name).map(t => t.testId);
    if (areaTestIds.length > 0 && area.planSnapshot) {
      const snapshot = JSON.parse(area.planSnapshot);
      snapshot.generatedTestIds = areaTestIds;
      await queries.updateFunctionalArea(area.id, { planSnapshot: JSON.stringify(snapshot) });
    }
  }

  // Update metadata
  const updatedSession = await queries.getAgentSession(sessionId);
  if (updatedSession) {
    await queries.updateAgentSession(sessionId, {
      metadata: { ...updatedSession.metadata, testsCreated },
    });
  }

  const richResult: AgentStepRichResult = {
    type: 'generate',
    tests: generatedTests,
  };

  await updateSubsteps(sessionId, 'generate', [
    {
      label: `Generated ${testsCreated} tests`,
      status: 'done',
      agent: useAgents ? 'generator' : undefined,
    },
  ]);

  await setStepCompleted(sessionId, 'generate', {
    testsCreated,
    method: useAgents ? 'pw_agents' : 'prompt',
  }, richResult);
  return true;
}

// ============================================
// Run Tests (step 8)
// ============================================

async function runTests(sessionId: string, repositoryId: string, _teamId: string, signal: AbortSignal) {
  await setStepActive(sessionId, 'run_tests');
  if (isAborted(signal)) return false;

  try {
    const buildResult = await createAndRunBuild('manual', undefined, repositoryId);

    if (!buildResult.buildId) {
      await setStepFailed(sessionId, 'run_tests', 'Build was queued — please wait and retry');
      return false;
    }

    const buildId = buildResult.buildId;

    const session = await queries.getAgentSession(sessionId);
    if (session) {
      const buildIds: string[] = [...(session.metadata.buildIds || []), buildId];
      await queries.updateAgentSession(sessionId, {
        metadata: { ...session.metadata, buildIds },
      });
    }

    const allTests = await queries.getTestsByRepo(repositoryId);
    const agentModeTests = allTests.filter(t => t.executionMode === 'agent');
    const proceduralTests = allTests.filter(t => t.executionMode !== 'agent');

    if (agentModeTests.length > 0) {
      await updateSubsteps(sessionId, 'run_tests', [
        { label: `Running ${proceduralTests.length} procedural tests`, status: 'running' },
        { label: `Running ${agentModeTests.length} agent-mode tests`, status: 'pending', agent: 'orchestrator' },
      ]);
    } else {
      await updateSubsteps(sessionId, 'run_tests', [
        { label: `Running ${buildResult.testCount} tests`, status: 'running' },
      ]);
    }

    const summary = await waitForBuild(buildId, signal);
    if (!summary) {
      if (isAborted(signal)) return false;
      await setStepFailed(sessionId, 'run_tests', 'Build not found after creation');
      return false;
    }

    if (isAborted(signal)) return false;

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
    if (error instanceof Error && error.message === 'Aborted') return false;
    const message = error instanceof Error ? error.message : 'Failed to run tests';
    await setStepFailed(sessionId, 'run_tests', message);
    return false;
  }
}

// ============================================
// Fix Tests (step 9)
// ============================================

async function runFixTests(sessionId: string, repositoryId: string, _teamId: string, signal: AbortSignal) {
  await setStepActive(sessionId, 'fix_tests');
  if (isAborted(signal)) return false;

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
    await setStepCompleted(sessionId, 'fix_tests', { skipped: true, reason: 'No failing tests' });
    return true;
  }

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
  const fixes: Array<{ testName: string; originalError: string; fixed: boolean; newCode?: string }> = [];

  const fixAiSettings = await getAISettings(repositoryId);
  const useHealer = fixAiSettings?.pwAgentEnabled ?? false;

  const fixableResults: typeof failedResults = [];
  for (const result of failedResults) {
    const attempts = fixAttempts[result.testId!] || 0;
    if (attempts >= MAX_FIX_ATTEMPTS) {
      unfixableCount++;
    } else {
      fixableResults.push(result);
    }
  }

  if (useHealer) {
    const HEALER_CONCURRENCY = 3;
    const { agentHealTest } = await import('@/lib/playwright/healer-agent');

    for (let batch = 0; batch < fixableResults.length; batch += HEALER_CONCURRENCY) {
      if (isAborted(signal)) return false;

      const chunk = fixableResults.slice(batch, batch + HEALER_CONCURRENCY);
      const completed = Math.min(batch, fixableResults.length);

      await updateSubsteps(sessionId, 'fix_tests', [
        { label: 'Coordinating fix pipeline', status: 'done', agent: 'orchestrator' },
        {
          label: `Healing tests (${completed}/${fixableResults.length})`,
          status: 'running',
          detail: `${chunk.length} healers in parallel`,
          agent: 'healer',
        },
      ]);

      const results = await Promise.allSettled(
        chunk.map(async (result) => {
          const testId = result.testId!;
          const attempts = fixAttempts[testId] || 0;

          const healResult = await agentHealTest(repositoryId, testId);
          fixAttempts[testId] = attempts + 1;

          const test = await queries.getTest(testId);

          if (healResult.success && healResult.code) {
            const hashes = codeHashes[testId] || [];
            const newHash = hashCode(healResult.code);

            if (hashes.includes(newHash)) {
              fixes.push({ testName: test?.name || testId, originalError: result.errorMessage!, fixed: false });
              return 'unfixable' as const;
            }

            hashes.push(newHash);
            codeHashes[testId] = hashes;

            await queries.updateTest(testId, { code: healResult.code });
            if (test) {
              const branch = await getCurrentBranchForRepo(repositoryId);
              const versions = await queries.getTestVersions(testId);
              await queries.createTestVersion({
                testId,
                name: test.name,
                code: healResult.code,
                version: (versions.length || 0) + 1,
                changeReason: 'ai_fix',
                branch: branch ?? null,
              });
            }
            fixes.push({ testName: test?.name || testId, originalError: result.errorMessage!, fixed: true, newCode: healResult.code });
            return 'fixed' as const;
          }
          fixes.push({ testName: test?.name || testId, originalError: result.errorMessage!, fixed: false });
          return 'failed' as const;
        }),
      );

      for (const r of results) {
        if (r.status === 'fulfilled') {
          if (r.value === 'fixed') fixedCount++;
          else if (r.value === 'unfixable') unfixableCount++;
        }
      }

      const currentSession = await queries.getAgentSession(sessionId);
      if (currentSession) {
        await queries.updateAgentSession(sessionId, {
          metadata: { ...currentSession.metadata, fixAttempts, codeHashes },
        });
      }
    }
  } else {
    for (let i = 0; i < fixableResults.length; i++) {
      if (isAborted(signal)) return false;

      const result = fixableResults[i];
      const testId = result.testId!;
      const errorMessage = result.errorMessage!;
      const attempts = fixAttempts[testId] || 0;

      const test = await queries.getTest(testId);
      await updateSubsteps(sessionId, 'fix_tests', [
        {
          label: `Fixing test ${i + 1}/${fixableResults.length}: ${test?.name || testId}`,
          status: 'running',
          detail: `Attempt ${attempts + 1}/${MAX_FIX_ATTEMPTS}`,
        },
      ]);

      const fixResult = await aiFixTest(repositoryId, testId, errorMessage, intelligence);
      fixAttempts[testId] = attempts + 1;

      if (fixResult.success && fixResult.code) {
        const hashes = codeHashes[testId] || [];
        const newHash = hashCode(fixResult.code);

        if (hashes.includes(newHash)) {
          unfixableCount++;
          fixes.push({ testName: test?.name || testId, originalError: errorMessage, fixed: false });
          continue;
        }

        hashes.push(newHash);
        codeHashes[testId] = hashes;

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
        fixes.push({ testName: test?.name || testId, originalError: errorMessage, fixed: true, newCode: fixResult.code });
      } else {
        fixes.push({ testName: test?.name || testId, originalError: errorMessage, fixed: false });
      }

      const currentSession = await queries.getAgentSession(sessionId);
      if (currentSession) {
        await queries.updateAgentSession(sessionId, {
          metadata: { ...currentSession.metadata, fixAttempts, codeHashes },
        });
      }
    }
  }

  if (useHealer) {
    await updateSubsteps(sessionId, 'fix_tests', [
      { label: 'Fix pipeline complete', status: 'done', agent: 'orchestrator' },
      {
        label: `${fixedCount} healed, ${unfixableCount} unfixable`,
        status: fixedCount > 0 ? 'done' : unfixableCount > 0 ? 'error' : 'done',
        agent: 'healer',
      },
    ]);
  } else {
    await updateSubsteps(sessionId, 'fix_tests', [
      {
        label: `${fixedCount} fixed, ${unfixableCount} unfixable`,
        status: fixedCount > 0 ? 'done' : unfixableCount > 0 ? 'error' : 'done',
      },
    ]);
  }

  const richResult: AgentStepRichResult = { type: 'fix_tests', fixes };
  await setStepCompleted(sessionId, 'fix_tests', { fixedCount, unfixableCount }, richResult);
  return true;
}

// ============================================
// Re-run Tests (step 10)
// ============================================

async function runRerunTests(sessionId: string, repositoryId: string, _teamId: string, signal: AbortSignal) {
  const session = await queries.getAgentSession(sessionId);
  if (!session) return false;

  const fixStep = session.steps.find((s) => s.id === 'fix_tests');
  if (fixStep?.result?.skipped || (fixStep?.result?.fixedCount === 0)) {
    await updateStep(sessionId, 'rerun_tests', {
      status: 'skipped',
      completedAt: new Date().toISOString(),
    });
    return true;
  }

  await setStepActive(sessionId, 'rerun_tests');
  if (isAborted(signal)) return false;

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

    const summary = await waitForBuild(buildId, signal);
    if (!summary) {
      if (isAborted(signal)) return false;
      await setStepFailed(sessionId, 'rerun_tests', 'Build not found');
      return false;
    }

    if (isAborted(signal)) return false;

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
    if (error instanceof Error && error.message === 'Aborted') return false;
    const message = error instanceof Error ? error.message : 'Failed to re-run tests';
    await setStepFailed(sessionId, 'rerun_tests', message);
    return false;
  }
}

// ============================================
// Summary (step 11)
// ============================================

async function runSummary(sessionId: string, _repositoryId: string, _teamId: string, _signal: AbortSignal) {
  await setStepActive(sessionId, 'summary');

  const session = await queries.getAgentSession(sessionId);
  if (!session) return true;

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
  return true;
}

// ============================================
// Orchestrator
// ============================================

type StepRunner = (sessionId: string, repositoryId: string, teamId: string, signal: AbortSignal) => Promise<boolean>;

const STEP_ORDER: Array<{ id: AgentStepId; run: StepRunner }> = [
  { id: 'settings_check', run: runSettingsCheck },
  { id: 'select_repo', run: runSelectRepo },
  { id: 'env_setup', run: runEnvSetup },
  { id: 'scan_and_template', run: runScanAndTemplate },
  { id: 'plan', run: runPlan },
  { id: 'review', run: runReview },
  { id: 'generate', run: runGenerate },
  { id: 'run_tests', run: runTests },
  { id: 'fix_tests', run: runFixTests },
  { id: 'rerun_tests', run: runRerunTests },
  { id: 'summary', run: runSummary },
];

async function executeFromStep(sessionId: string, repositoryId: string, teamId: string, startStepId: AgentStepId) {
  const controller = getOrCreateController(sessionId);
  const { signal } = controller;

  try {
    const startIdx = STEP_ORDER.findIndex((s) => s.id === startStepId);
    if (startIdx === -1) return;

    for (let i = startIdx; i < STEP_ORDER.length; i++) {
      if (signal.aborted) return;

      const step = STEP_ORDER[i];
      const success = await step.run(sessionId, repositoryId, teamId, signal);

      if (!success) {
        return;
      }
    }

    revalidatePath('/run');
  } finally {
    cleanupController(sessionId);
  }
}

// ============================================
// Public API
// ============================================

export async function startPlayAgent(repositoryId: string): Promise<{ sessionId: string }> {
  // Allow starting without a repo — settings_check and select_repo steps will guide the user
  let teamId: string;
  if (repositoryId) {
    const { team } = await requireRepoAccess(repositoryId);
    teamId = team?.id ?? '';
  } else {
    const { team } = await requireTeamAccess();
    teamId = team.id;
  }

  // Cancel any existing active session for this repo
  if (repositoryId) {
    const existing = await queries.getActiveAgentSession(repositoryId);
    if (existing) {
      const existingController = activeControllers.get(existing.id);
      if (existingController) existingController.abort();
      cleanupController(existing.id);

      await queries.updateAgentSession(existing.id, {
        status: 'cancelled',
        completedAt: new Date(),
      });
    }
  }

  const session = await queries.createAgentSession({
    repositoryId,
    teamId: teamId || null,
    status: 'active',
    currentStepId: 'settings_check',
    steps: buildInitialSteps(),
    metadata: {},
  });

  // Fire-and-forget: run steps
  executeFromStep(session.id, repositoryId, teamId, 'settings_check').catch((err) => {
    console.error('[PlayAgent] Unhandled error:', err);
    queries.updateAgentSession(session.id, { status: 'failed' }).catch(() => {});
  });

  return { sessionId: session.id };
}

export async function resumePlayAgent(sessionId: string): Promise<{ success: boolean }> {
  const { team } = await requireTeamAccess();

  const session = await queries.getAgentSession(sessionId);
  if (!session || session.status === 'cancelled' || session.status === 'completed') {
    return { success: false };
  }
  if (session.teamId && session.teamId !== team.id) return { success: false };

  // Backward compat: old sessions with 'discover' step — force restart
  if (session.steps.some(s => (s.id as string) === 'discover')) {
    await queries.updateAgentSession(sessionId, {
      status: 'cancelled',
      completedAt: new Date(),
    });
    return { success: false };
  }

  const waitingStep = session.steps.find((s) => s.status === 'waiting_user' || s.status === 'failed');
  if (!waitingStep) return { success: false };

  await updateStep(sessionId, waitingStep.id, {
    status: 'pending',
    error: undefined,
    userAction: undefined,
  });
  await queries.updateAgentSession(sessionId, { status: 'active' });

  // Fire-and-forget: resume from the waiting step
  executeFromStep(sessionId, session.repositoryId, team.id ?? '', waitingStep.id).catch((err) => {
    console.error('[PlayAgent] Resume error:', err);
    queries.updateAgentSession(sessionId, { status: 'failed' }).catch(() => {});
  });

  return { success: true };
}

export async function cancelPlayAgent(sessionId: string): Promise<{ success: boolean }> {
  const { team } = await requireTeamAccess();

  const session = await queries.getAgentSession(sessionId);
  if (!session) return { success: false };
  if (session.teamId && session.teamId !== team.id) return { success: false };

  // Abort the running controller to kill in-flight AI calls
  const controller = activeControllers.get(sessionId);
  if (controller) controller.abort();
  cleanupController(sessionId);

  // Cancel any running builds
  const buildIds = session.metadata?.buildIds || [];
  for (const buildId of buildIds) {
    const build = await queries.getBuild(buildId);
    if (build && !build.completedAt) {
      await queries.updateBuild(buildId, { overallStatus: 'cancelled', completedAt: new Date() }).catch(() => {});
    }
  }

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

export async function approvePlayAgentPlan(
  sessionId: string,
  approvedAreaIds: string[],
  autoApprove?: boolean,
): Promise<{ success: boolean }> {
  const { team } = await requireTeamAccess();
  const session = await queries.getAgentSession(sessionId);
  if (!session) return { success: false };
  if (session.teamId && session.teamId !== team.id) return { success: false };

  await queries.updateAgentSession(sessionId, {
    metadata: {
      ...session.metadata,
      approvedAreaIds,
      ...(autoApprove ? { autoApproveReview: true } : {}),
    },
  });

  // Resume from review step
  return resumePlayAgent(sessionId);
}

export async function skipDiscoverStep(sessionId: string): Promise<{ success: boolean }> {
  const { team } = await requireTeamAccess();
  const session = await queries.getAgentSession(sessionId);
  if (!session) return { success: false };
  if (session.teamId && session.teamId !== team.id) return { success: false };
  await queries.updateAgentSession(sessionId, {
    metadata: { ...session.metadata, skipDiscovery: true },
  });
  return { success: true };
}

export async function rerunPlanner(
  sessionId: string,
  plannerSource: string,
): Promise<{ success: boolean; error?: string }> {
  const { team } = await requireTeamAccess();

  const session = await queries.getAgentSession(sessionId);
  if (!session) return { success: false, error: 'Session not found' };
  if (session.teamId && session.teamId !== team.id) return { success: false, error: 'Forbidden' };

  // Validate plan step exists and is completed/failed
  const planStep = session.steps.find(s => s.id === 'plan');
  if (!planStep || (planStep.status !== 'completed' && planStep.status !== 'failed')) {
    return { success: false, error: 'Plan step not in re-runnable state' };
  }

  const repo = await queries.getRepository(session.repositoryId);
  if (!repo) return { success: false, error: 'Repository not found' };

  const branch = repo.selectedBranch || repo.defaultBranch || 'main';
  const envConfig = await getEnvironmentConfig(session.repositoryId);
  const baseUrl = envConfig?.baseUrl || 'http://localhost:3000';
  const intelligence = session.metadata?.codebaseIntelligence as CodebaseIntelligenceContext | undefined;

  // Mark the substep as running before starting work
  const currentPlanStep = session.steps.find(s => s.id === 'plan')!;
  const preSubsteps = [...(currentPlanStep.substeps || [])];
  const preIdx = preSubsteps.findIndex(s => s.source === plannerSource);
  if (preIdx >= 0) {
    preSubsteps[preIdx] = { ...preSubsteps[preIdx], status: 'running', rawError: undefined };
    await updateStep(sessionId, 'plan', { substeps: preSubsteps });
  } else {
    // New diver — add a running substep
    const isDiver = plannerSource.startsWith('browser-dive-');
    preSubsteps.push({
      label: isDiver ? `Deep-dive: ${plannerSource.replace('browser-dive-', '')}` : plannerSource,
      status: 'running',
      agent: isDiver ? 'diver' : 'planner',
      source: plannerSource,
    });
    await updateStep(sessionId, 'plan', { substeps: preSubsteps });
  }

  // Re-run the specific planner
  let result: import('@/lib/playwright/planner-types').PlannerResult;
  try {
    if (plannerSource.startsWith('browser-dive-')) {
      // Re-run a single deep-diver for a specific area
      const areaName = plannerSource.replace('browser-dive-', '');
      const scoutData = session.metadata?.scoutOutput as import('@/lib/playwright/planner-types').ScoutOutput | undefined;
      const scoutArea = scoutData?.areas?.find(a => a.name === areaName);

      const { runDeepDiveExploration } = await import('@/lib/playwright/planner-agent');
      const areas = await runDeepDiveExploration(
        areaName,
        scoutArea?.routes || [],
        scoutArea?.focusPoints,
        session.repositoryId,
        baseUrl,
      );
      result = { source: 'browser', areas, durationMs: 0, inputSummary: `Re-run: ${areaName}` };
    } else {
      switch (plannerSource) {
        case 'browser': {
          const { runBrowserPlanner } = await import('@/lib/playwright/planners/browser-planner');
          result = await runBrowserPlanner(session.repositoryId, baseUrl);
          break;
        }
        case 'code': {
          const { runCodePlanner } = await import('@/lib/playwright/planners/code-planner');
          result = await runCodePlanner(session.repositoryId, branch, intelligence);
          break;
        }
        case 'spec': {
          const { runSpecPlanner } = await import('@/lib/playwright/planners/spec-planner');
          result = await runSpecPlanner(session.repositoryId, branch);
          break;
        }
        case 'routes': {
          const { runRoutePlanner } = await import('@/lib/playwright/planners/route-planner');
          result = await runRoutePlanner(session.repositoryId);
          break;
        }
        default:
          return { success: false, error: `Unknown planner source: ${plannerSource}` };
      }
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Re-run failed' };
  }

  // Update planner results in metadata
  const freshSession = await queries.getAgentSession(sessionId);
  if (!freshSession) return { success: false, error: 'Session lost' };

  const plannerResults = { ...(freshSession.metadata.plannerResults as Record<string, unknown> || {}) };
  plannerResults[plannerSource] = {
    source: result.source,
    areas: result.areas,
    error: result.error,
    rawOutput: result.rawOutput,
  };

  // Update the substep for this planner
  const substeps = [...(planStep.substeps || [])];
  const substepIdx = substeps.findIndex(s => s.source === plannerSource);
  if (substepIdx >= 0) {
    substeps[substepIdx] = {
      ...substeps[substepIdx],
      status: result.error ? 'error' : 'done',
      detail: result.error ? result.error.slice(0, 60) : `${result.areas.length} areas`,
      durationMs: result.durationMs,
      areasFound: result.areas.length,
      promptLogId: result.promptLogId,
      inputSummary: result.inputSummary,
      outputSummary: result.areas.length > 0 ? result.areas.map(a => a.name).join(', ') : undefined,
      rawError: result.error,
    };
  }

  // Re-merge all planner results
  const { mergePlannerResults } = await import('@/lib/playwright/planner-merger');
  const allResults = Object.values(plannerResults) as Array<{ source: string; areas: import('@/lib/playwright/planner-types').PlannerArea[]; error?: string }>;
  const mergeInput = allResults.filter(r => r.areas.length > 0) as import('@/lib/playwright/planner-types').PlannerResult[];
  const mergedAreas = mergePlannerResults(mergeInput);

  // Filter out routes that already exist in DB (user may have rearranged them)
  const existingRerunRoutes = await queries.getRoutesByRepo(session.repositoryId);
  const existingRerunPaths = new Set(existingRerunRoutes.map(r => r.path));

  // Save merged areas to DB and build rich result
  const richAreas: AgentRichResultPlanArea[] = [];
  for (const area of mergedAreas) {
    const dbArea = await queries.getOrCreateFunctionalAreaByRepo(session.repositoryId, area.name, area.description);
    if (area.testPlan) {
      const snapshot = JSON.stringify({
        previousPlan: dbArea.agentPlan,
        previousDescription: dbArea.description,
        generatedTestIds: [],
      });
      await queries.updateFunctionalArea(dbArea.id, { agentPlan: area.testPlan, planGeneratedAt: new Date(), planSnapshot: snapshot });
    }
    const newRoutes = area.routes.filter(r => !existingRerunPaths.has(r));
    richAreas.push({ id: dbArea.id, name: area.name, description: area.description || '', routes: newRoutes, testPlan: area.testPlan || '' });
  }

  const richResult: AgentStepRichResult = { type: 'plan', areas: richAreas };

  // Update step + metadata
  await updateStep(sessionId, 'plan', {
    status: 'completed',
    result: { method: 'pw_agents_parallel', areasFound: mergedAreas.length, routesFound: mergedAreas.reduce((s, a) => s + a.routes.length, 0) },
    richResult,
    substeps,
  });
  await queries.updateAgentSession(sessionId, {
    metadata: { ...freshSession.metadata, plannerResults },
  });

  // If review step has the old plan, update it too
  const reviewStep = freshSession.steps.find(s => s.id === 'review');
  if (reviewStep?.richResult) {
    await updateStep(sessionId, 'review', { richResult });
  }

  return { success: true };
}
