/**
 * autoresearch/evaluate.ts — EVALUATION HARNESS
 *
 * Two modes:
 *   --mode=generate  (default) Generate tests for lastest2 routes, run them
 *   --mode=replay    Re-generate tests for previously-failed scenarios from DB
 *
 * Usage:
 *   pnpm tsx autoresearch/evaluate.ts
 *   pnpm tsx autoresearch/evaluate.ts --mode=replay
 *   OLLAMA_BASE_URL=https://... pnpm tsx autoresearch/evaluate.ts
 */

// Allow nested Claude CLI sessions (we may be invoked from within Claude Code)
delete process.env.CLAUDECODE;

import { chromium, type Browser, type BrowserContext } from 'playwright';
import { getAISettings } from '@/lib/db/queries/settings';
import { getRoutesByRepo } from '@/lib/db/queries/routes';
import { getAIProvider, type AIProviderConfig } from '@/lib/ai/index';
import {
  SYSTEM_PROMPT,
  createTestPrompt,
  createBranchAwareTestPrompt,
  extractCodeFromResponse,
} from '@/lib/ai/prompts';
import { stripTypeAnnotations, createExpect } from '@/lib/playwright/runner';
import { db } from '@/lib/db';
import { testResults, tests, testRuns, functionalAreas } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import path from 'path';
import fs from 'fs';
import os from 'os';

// ─── Configuration ───────────────────────────────────────────────

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const TEST_TIMEOUT_MS = 30_000;
const SCREENSHOT_DIR = path.join(os.tmpdir(), 'autoresearch-screenshots');
const AUTH_EMAIL = process.env.AUTH_EMAIL || 'testuser1771664821751@example.com';
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || 'SecurePass123';
const STORAGE_STATE_PATH = path.join(os.tmpdir(), 'autoresearch-auth.json');

const MODE = process.argv.includes('--mode=replay') ? 'replay' : 'generate';
const MAX_REPLAY = parseInt(process.env.MAX_REPLAY || '20', 10);

// Fixed routes for generate mode (lastest2 app routes)
const GENERATE_ROUTES: { path: string; isDynamic: boolean; description: string }[] = [
  { path: '/', isDynamic: false, description: 'Dashboard / home page' },
  { path: '/tests', isDynamic: false, description: 'Test list page' },
  { path: '/settings', isDynamic: false, description: 'Settings page' },
  { path: '/builds', isDynamic: false, description: 'Build list page' },
  { path: '/suites', isDynamic: false, description: 'Suite list page' },
  { path: '/run', isDynamic: false, description: 'Test runner page' },
  { path: '/record', isDynamic: false, description: 'Recorder page' },
  { path: '/review', isDynamic: false, description: 'Review page' },
  { path: '/areas', isDynamic: false, description: 'Functional areas page' },
  { path: '/compose', isDynamic: false, description: 'Test composition page' },
];

// ─── Types ───────────────────────────────────────────────────────

interface TestResult {
  name: string;
  route: string;
  passed: boolean;
  syntaxError: boolean;
  errorMessage?: string;
  durationMs: number;
}

interface ReplayScenario {
  testName: string;
  targetUrl: string;
  userStoryTitle: string;
  acceptanceCriteria: string;
  previousError: string;
  repositoryId: string;
}

// ─── Helpers ─────────────────────────────────────────────────────

function categorizeError(msg: string): string {
  if (/timeout/i.test(msg)) return 'timeout';
  if (/404/i.test(msg) || /not found/i.test(msg)) return '404';
  if (/selector|locator/i.test(msg)) return 'selector';
  if (/navigation/i.test(msg)) return 'navigation';
  if (/not a function/i.test(msg)) return 'bad_matcher';
  if (/assertion|expect/i.test(msg)) return 'assertion';
  if (/syntax|unexpected token/i.test(msg)) return 'syntax';
  if (/network failure/i.test(msg)) return '404';
  return 'other';
}

async function loadAIConfig(): Promise<AIProviderConfig> {
  if (process.env.OLLAMA_BASE_URL) {
    return {
      provider: 'ollama',
      ollamaBaseUrl: process.env.OLLAMA_BASE_URL,
      ollamaModel: process.env.OLLAMA_MODEL || 'glm-4.7-flash:q4_K_M',
    };
  }

  try {
    const settings = await getAISettings();
    if (settings) {
      return {
        provider: settings.provider as AIProviderConfig['provider'],
        openrouterApiKey: settings.openrouterApiKey,
        openrouterModel: settings.openrouterModel || undefined,
        customInstructions: settings.customInstructions,
        anthropicApiKey: settings.anthropicApiKey,
        anthropicModel: settings.anthropicModel || undefined,
        openaiApiKey: settings.openaiApiKey,
        openaiModel: settings.openaiModel || undefined,
        ollamaBaseUrl: settings.ollamaBaseUrl || undefined,
        ollamaModel: settings.ollamaModel || undefined,
      };
    }
  } catch {
    // DB not available
  }

  // Default: Olares Ollama
  return {
    provider: 'ollama',
    ollamaBaseUrl: 'https://d9a7539b.ewyctorlab.olares.com',
    ollamaModel: 'glm-4.7-flash:q4_K_M',
  };
}

function syntaxCheck(code: string): string | null {
  try {
    const stripped = stripTypeAnnotations(code);
    const body = stripped
      .replace(/^import\s+.*$/gm, '')
      .replace(/^export\s+/gm, '');
    new Function(body);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

async function ensureAuth(browser: Browser): Promise<void> {
  if (fs.existsSync(STORAGE_STATE_PATH)) {
    const stat = fs.statSync(STORAGE_STATE_PATH);
    if (Date.now() - stat.mtimeMs < 30 * 60 * 1000) return;
  }

  console.error('Performing login...');
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  try {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
    await page.locator('#email').fill(AUTH_EMAIL);
    await page.locator('#password').fill(AUTH_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 10_000 });
    await context.storageState({ path: STORAGE_STATE_PATH });
    console.error('Login successful.');
  } catch (e) {
    console.error(`Auth failed: ${e instanceof Error ? e.message : e}`);
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

async function runTestCode(
  code: string,
  label: string,
  browser: Browser
): Promise<{ passed: boolean; errorMessage?: string }> {
  let context: BrowserContext | null = null;
  let page = null;

  try {
    const ctxOpts: Record<string, unknown> = { viewport: { width: 1280, height: 720 } };
    if (fs.existsSync(STORAGE_STATE_PATH)) ctxOpts.storageState = STORAGE_STATE_PATH;
    context = await browser.newContext(ctxOpts);
    page = await context.newPage();

    const screenshotPath = path.join(SCREENSHOT_DIR, `${label.replace(/[^a-zA-Z0-9]/g, '_')}.png`);
    const stepLogger = { log: (_msg: string) => {} };
    const expectFn = createExpect(5000);

    const stripped = stripTypeAnnotations(code);
    const exportMatch = stripped.match(
      /export\s+async\s+function\s+test\s*\([^)]*\)\s*\{([\s\S]*)\}\s*$/
    );

    if (!exportMatch) {
      return { passed: false, errorMessage: 'Could not extract test function body' };
    }

    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const testFn = new AsyncFunction(
      'page', 'baseUrl', 'screenshotPath', 'stepLogger', 'expect',
      exportMatch[1]
    );

    await Promise.race([
      testFn(page, BASE_URL, screenshotPath, stepLogger, expectFn),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Test timeout after ${TEST_TIMEOUT_MS}ms`)), TEST_TIMEOUT_MS)
      ),
    ]);

    return { passed: true };
  } catch (e) {
    return { passed: false, errorMessage: e instanceof Error ? e.message : String(e) };
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (page) await (page as any).close().catch(() => {});
    if (context) await context.close().catch(() => {});
  }
}

// ─── Generate Mode ───────────────────────────────────────────────

async function runGenerateMode(
  config: AIProviderConfig,
  browser: Browser
): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const provider = getAIProvider(config);

  for (const route of GENERATE_ROUTES) {
    const start = Date.now();
    console.error(`\n[gen:${route.path}] Generating...`);

    try {
      const prompt = createTestPrompt({
        routePath: route.path,
        targetUrl: `${BASE_URL}${route.path}`,
        isDynamicRoute: route.isDynamic,
        userPrompt: `Visual regression test for ${route.description}. Navigate, verify it loads, take a screenshot.`,
      });

      const response = await provider.generate({ prompt, systemPrompt: SYSTEM_PROMPT });
      const code = extractCodeFromResponse(response);
      console.error(`[gen:${route.path}] ${code.length} chars`);

      const syntaxErr = syntaxCheck(code);
      if (syntaxErr) {
        console.error(`[gen:${route.path}] SYNTAX ERROR: ${syntaxErr}`);
        results.push({ name: `gen:${route.path}`, route: route.path, passed: false, syntaxError: true, errorMessage: `Syntax: ${syntaxErr}`, durationMs: Date.now() - start });
        continue;
      }

      console.error(`[gen:${route.path}] Running...`);
      const { passed, errorMessage } = await runTestCode(code, route.path, browser);
      console.error(`[gen:${route.path}] ${passed ? 'PASSED' : 'FAILED: ' + errorMessage}`);
      results.push({ name: `gen:${route.path}`, route: route.path, passed, syntaxError: false, errorMessage, durationMs: Date.now() - start });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[gen:${route.path}] ERROR: ${msg}`);
      results.push({ name: `gen:${route.path}`, route: route.path, passed: false, syntaxError: false, errorMessage: msg, durationMs: Date.now() - start });
    }
  }

  return results;
}

// ─── Replay Mode ─────────────────────────────────────────────────

async function loadReplayScenarios(): Promise<ReplayScenario[]> {
  // Get the most recent test run
  const latestRun = db.select({ id: testRuns.id, repositoryId: testRuns.repositoryId })
    .from(testRuns)
    .orderBy(desc(testRuns.startedAt))
    .limit(1)
    .get();

  if (!latestRun) {
    console.error('No test runs found in DB');
    return [];
  }

  // Get failed tests with their info
  const failed = db.select({
    testName: tests.name,
    testCode: tests.code,
    targetUrl: tests.targetUrl,
    description: tests.description,
    errorMessage: testResults.errorMessage,
    areaName: functionalAreas.name,
  })
  .from(testResults)
  .innerJoin(tests, eq(testResults.testId, tests.id))
  .leftJoin(functionalAreas, eq(tests.functionalAreaId, functionalAreas.id))
  .where(and(
    eq(testResults.testRunId, latestRun.id),
    eq(testResults.status, 'failed')
  ))
  .all();

  return failed.slice(0, MAX_REPLAY).map(f => ({
    testName: f.testName || 'Unknown',
    targetUrl: f.targetUrl || BASE_URL,
    userStoryTitle: f.areaName || 'Unknown Area',
    acceptanceCriteria: f.description || f.testName || '',
    previousError: f.errorMessage || 'Unknown error',
    repositoryId: latestRun.repositoryId!,
  }));
}

async function runReplayMode(
  config: AIProviderConfig,
  browser: Browser
): Promise<TestResult[]> {
  const scenarios = await loadReplayScenarios();
  console.error(`Loaded ${scenarios.length} failed scenarios from DB`);

  if (scenarios.length === 0) return [];

  // Fetch available routes for the repository
  const repoId = scenarios[0].repositoryId;
  let availableRoutes: string[] = [];
  try {
    const repoRoutes = await getRoutesByRepo(repoId);
    availableRoutes = repoRoutes.map(r => r.path);
    console.error(`Loaded ${availableRoutes.length} available routes for repo`);
  } catch {
    console.error('Could not load routes from DB');
  }

  const results: TestResult[] = [];
  const provider = getAIProvider(config);

  for (const scenario of scenarios) {
    const start = Date.now();
    const label = scenario.testName.slice(0, 50);
    console.error(`\n[replay:${label}] Generating (prev error: ${categorizeError(scenario.previousError)})...`);

    try {
      const prompt = createBranchAwareTestPrompt({
        testName: scenario.testName,
        acceptanceCriteria: scenario.acceptanceCriteria,
        userStoryTitle: scenario.userStoryTitle,
        userStoryDescription: `Testing: ${scenario.userStoryTitle}`,
        targetUrl: scenario.targetUrl,
        availableRoutes: availableRoutes.length > 0 ? availableRoutes : undefined,
      });

      const response = await provider.generate({ prompt, systemPrompt: SYSTEM_PROMPT });
      const code = extractCodeFromResponse(response);
      console.error(`[replay:${label}] ${code.length} chars`);

      const syntaxErr = syntaxCheck(code);
      if (syntaxErr) {
        console.error(`[replay:${label}] SYNTAX ERROR: ${syntaxErr}`);
        results.push({ name: label, route: scenario.targetUrl, passed: false, syntaxError: true, errorMessage: `Syntax: ${syntaxErr}`, durationMs: Date.now() - start });
        continue;
      }

      console.error(`[replay:${label}] Running...`);
      const { passed, errorMessage } = await runTestCode(code, label, browser);
      console.error(`[replay:${label}] ${passed ? 'PASSED' : 'FAILED: ' + (errorMessage || '').slice(0, 80)}`);
      results.push({ name: label, route: scenario.targetUrl, passed, syntaxError: false, errorMessage, durationMs: Date.now() - start });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[replay:${label}] ERROR: ${msg}`);
      results.push({ name: label, route: scenario.targetUrl, passed: false, syntaxError: false, errorMessage: msg, durationMs: Date.now() - start });
    }
  }

  return results;
}

// ─── Main ────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now();
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  // Check app is running
  try {
    const res = await fetch(BASE_URL);
    if (!res.ok && res.status !== 302 && res.status !== 307) {
      console.error(`ERROR: App not reachable at ${BASE_URL} (status ${res.status})`);
      process.exit(1);
    }
  } catch {
    console.error(`ERROR: App not reachable at ${BASE_URL}`);
    process.exit(1);
  }

  console.error(`Mode: ${MODE}`);
  console.error('Loading AI config...');
  const config = await loadAIConfig();
  console.error(`Provider: ${config.provider}`);

  console.error('Launching browser...');
  const browser = await chromium.launch({ headless: true });
  await ensureAuth(browser);

  const results = MODE === 'replay'
    ? await runReplayMode(config, browser)
    : await runGenerateMode(config, browser);

  await browser.close();

  // ─── Compute & output metrics ────────────────────────────────
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const syntaxErrors = results.filter(r => r.syntaxError).length;
  const total = results.length;
  const passRate = total > 0 ? passed / total : 0;
  const durationS = (Date.now() - startTime) / 1000;

  const errorCounts: Record<string, number> = {};
  for (const r of results) {
    if (!r.passed && r.errorMessage) {
      const cat = categorizeError(r.errorMessage);
      errorCounts[cat] = (errorCounts[cat] || 0) + 1;
    }
  }

  const errorSummary = Object.entries(errorCounts)
    .map(([k, v]) => `${k}:${v}`)
    .join(' ') || 'none';

  console.log('---');
  console.log(`mode:          ${MODE}`);
  console.log(`pass_rate:     ${passRate.toFixed(6)}`);
  console.log(`passed:        ${passed}`);
  console.log(`failed:        ${failed}`);
  console.log(`total:         ${total}`);
  console.log(`syntax_errors: ${syntaxErrors}`);
  console.log(`common_errors: ${errorSummary}`);
  console.log(`duration_s:    ${durationS.toFixed(1)}`);

  console.log('---');
  for (const r of results) {
    const status = r.passed ? 'PASS' : 'FAIL';
    const errPart = r.errorMessage ? ` | ${r.errorMessage.split('\n')[0].slice(0, 80)}` : '';
    console.log(`${status} ${r.name} (${(r.durationMs / 1000).toFixed(1)}s)${errPart}`);
  }

  process.exit(0);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(2);
});
