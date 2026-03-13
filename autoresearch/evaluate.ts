/**
 * autoresearch/evaluate.ts — IMMUTABLE EVALUATION HARNESS
 *
 * Measures prompt quality by generating tests for known routes,
 * syntax-checking them, and running them via Playwright against localhost:3000.
 *
 * DO NOT MODIFY THIS FILE — the autoresearch agent optimizes prompts.ts only.
 *
 * Usage: pnpm tsx autoresearch/evaluate.ts
 */

// Allow nested Claude CLI sessions (we may be invoked from within Claude Code)
delete process.env.CLAUDECODE;

import { chromium, type Browser, type Page, type BrowserContext } from 'playwright';
import { getAISettings } from '@/lib/db/queries/settings';
import { getAIProvider, type AIProviderConfig } from '@/lib/ai/index';
import { SYSTEM_PROMPT, createTestPrompt, extractCodeFromResponse } from '@/lib/ai/prompts';
import { stripTypeAnnotations } from '@/lib/playwright/runner';
import { createExpect } from '@/lib/playwright/runner';
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

// Fixed ground-truth routes for lastest2
const ROUTES: { path: string; isDynamic: boolean; description: string }[] = [
  { path: '/', isDynamic: false, description: 'Dashboard / home page' },
  { path: '/tests', isDynamic: false, description: 'Test list page' },
  { path: '/repositories', isDynamic: false, description: 'Repository list page' },
  { path: '/settings', isDynamic: false, description: 'Settings page' },
  { path: '/builds', isDynamic: false, description: 'Build list page' },
  { path: '/suites', isDynamic: false, description: 'Suite list page' },
  { path: '/routes', isDynamic: false, description: 'Routes page' },
  { path: '/run', isDynamic: false, description: 'Test runner page' },
];

// ─── Types ───────────────────────────────────────────────────────

interface RouteResult {
  route: string;
  passed: boolean;
  syntaxError: boolean;
  errorMessage?: string;
  durationMs: number;
}

interface EvalMetrics {
  passRate: number;
  passed: number;
  failed: number;
  total: number;
  routesTested: number;
  syntaxErrors: number;
  commonErrors: Record<string, number>;
  durationS: number;
}

// ─── Helpers ─────────────────────────────────────────────────────

function categorizeError(msg: string): string {
  if (/timeout/i.test(msg)) return 'timeout';
  if (/selector|locator/i.test(msg)) return 'selector';
  if (/navigation/i.test(msg)) return 'navigation';
  if (/not a function/i.test(msg)) return 'bad_matcher';
  if (/assertion/i.test(msg) || /expect/i.test(msg)) return 'assertion';
  if (/syntax|unexpected token/i.test(msg)) return 'syntax';
  return 'other';
}

async function loadAIConfig(): Promise<AIProviderConfig> {
  // OLLAMA_BASE_URL env var forces local GPU inference
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
    // DB not available, fall through to env
  }

  // Fallback to env vars
  if (process.env.OLLAMA_BASE_URL) {
    return {
      provider: 'ollama',
      ollamaBaseUrl: process.env.OLLAMA_BASE_URL,
      ollamaModel: process.env.OLLAMA_MODEL || 'glm-4.7-flash:q4_K_M',
    };
  }
  if (process.env.OPENROUTER_API_KEY) {
    return {
      provider: 'openrouter',
      openrouterApiKey: process.env.OPENROUTER_API_KEY,
      openrouterModel: process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-4',
    };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      provider: 'anthropic',
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929',
    };
  }

  // Default: Olares Ollama with glm-4.7-flash
  return {
    provider: 'ollama',
    ollamaBaseUrl: 'https://d9a7539b.ewyctorlab.olares.com',
    ollamaModel: 'glm-4.7-flash:q4_K_M',
  };
}

function syntaxCheck(code: string): string | null {
  try {
    // Strip TS annotations like the runner does, then check syntax
    const stripped = stripTypeAnnotations(code);
    // Remove top-level import/export for syntax check
    const body = stripped
      .replace(/^import\s+.*$/gm, '')
      .replace(/^export\s+/gm, '');
    new Function(body);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

async function generateTestCode(
  config: AIProviderConfig,
  route: { path: string; isDynamic: boolean; description: string }
): Promise<string> {
  const provider = getAIProvider(config);
  const prompt = createTestPrompt({
    routePath: route.path,
    targetUrl: `${BASE_URL}${route.path}`,
    isDynamicRoute: route.isDynamic,
    userPrompt: `Visual regression test for ${route.description}. Navigate to the page, verify it loads correctly, and take a screenshot.`,
  });

  const response = await provider.generate({
    prompt,
    systemPrompt: SYSTEM_PROMPT,
  });

  return extractCodeFromResponse(response);
}

async function ensureAuth(browser: Browser): Promise<void> {
  // If storageState already exists and is fresh, skip login
  if (fs.existsSync(STORAGE_STATE_PATH)) {
    const stat = fs.statSync(STORAGE_STATE_PATH);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs < 30 * 60 * 1000) return; // 30 min
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
    console.error('Login successful, storageState saved.');
  } catch (e) {
    console.error(`Auth failed: ${e instanceof Error ? e.message : e}`);
    console.error('Tests will run without auth — expect redirects to /login.');
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

async function runTestCode(
  code: string,
  route: string,
  browser: Browser
): Promise<{ passed: boolean; errorMessage?: string }> {
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    const contextOptions: { viewport: { width: number; height: number }; storageState?: string } = {
      viewport: { width: 1280, height: 720 },
    };
    if (fs.existsSync(STORAGE_STATE_PATH)) {
      contextOptions.storageState = STORAGE_STATE_PATH;
    }
    context = await browser.newContext(contextOptions);
    page = await context.newPage();

    const screenshotPath = path.join(SCREENSHOT_DIR, `${route.replace(/\//g, '_') || 'root'}.png`);
    const stepLogger = {
      log: (msg: string) => {
        // Silent during eval — could enable for debug
      },
    };
    const expectFn = createExpect(5000);

    // Strip type annotations and prepare function body
    const stripped = stripTypeAnnotations(code);

    // Extract function body
    const exportMatch = stripped.match(
      /export\s+async\s+function\s+test\s*\([^)]*\)\s*\{([\s\S]*)\}\s*$/
    );

    if (!exportMatch) {
      return { passed: false, errorMessage: 'Could not extract test function body' };
    }

    const body = exportMatch[1];

    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const testFn = new AsyncFunction(
      'page', 'baseUrl', 'screenshotPath', 'stepLogger', 'expect',
      body
    );

    // Run with timeout
    await Promise.race([
      testFn(page, BASE_URL, screenshotPath, stepLogger, expectFn),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Test timeout after ${TEST_TIMEOUT_MS}ms`)), TEST_TIMEOUT_MS)
      ),
    ]);

    return { passed: true };
  } catch (e) {
    return {
      passed: false,
      errorMessage: e instanceof Error ? e.message : String(e),
    };
  } finally {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
  }
}

// ─── Main ────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now();

  // Ensure screenshot dir exists
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

  console.error('Loading AI config...');
  const config = await loadAIConfig();
  console.error(`Provider: ${config.provider}`);

  console.error('Launching browser...');
  const browser = await chromium.launch({ headless: true });

  // Authenticate before running tests
  await ensureAuth(browser);

  const results: RouteResult[] = [];

  for (const route of ROUTES) {
    const routeStart = Date.now();
    console.error(`\n[${route.path}] Generating test...`);

    try {
      // Generate
      const code = await generateTestCode(config, route);
      console.error(`[${route.path}] Generated ${code.length} chars`);

      // Syntax check
      const syntaxErr = syntaxCheck(code);
      if (syntaxErr) {
        console.error(`[${route.path}] SYNTAX ERROR: ${syntaxErr}`);
        results.push({
          route: route.path,
          passed: false,
          syntaxError: true,
          errorMessage: `Syntax: ${syntaxErr}`,
          durationMs: Date.now() - routeStart,
        });
        continue;
      }

      // Run
      console.error(`[${route.path}] Running test...`);
      const { passed, errorMessage } = await runTestCode(code, route.path, browser);

      if (passed) {
        console.error(`[${route.path}] PASSED`);
      } else {
        console.error(`[${route.path}] FAILED: ${errorMessage}`);
      }

      results.push({
        route: route.path,
        passed,
        syntaxError: false,
        errorMessage,
        durationMs: Date.now() - routeStart,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[${route.path}] ERROR: ${msg}`);
      results.push({
        route: route.path,
        passed: false,
        syntaxError: false,
        errorMessage: msg,
        durationMs: Date.now() - routeStart,
      });
    }
  }

  await browser.close();

  // ─── Compute & output metrics ────────────────────────────────
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const syntaxErrors = results.filter(r => r.syntaxError).length;
  const total = results.length;
  const passRate = total > 0 ? passed / total : 0;
  const durationS = (Date.now() - startTime) / 1000;

  // Categorize errors
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

  // Output parseable metrics to stdout
  console.log('---');
  console.log(`pass_rate:     ${passRate.toFixed(6)}`);
  console.log(`passed:        ${passed}`);
  console.log(`failed:        ${failed}`);
  console.log(`total:         ${total}`);
  console.log(`routes_tested: ${total}`);
  console.log(`syntax_errors: ${syntaxErrors}`);
  console.log(`common_errors: ${errorSummary}`);
  console.log(`duration_s:    ${durationS.toFixed(1)}`);

  // Per-route detail
  console.log('---');
  for (const r of results) {
    const status = r.passed ? 'PASS' : 'FAIL';
    const errPart = r.errorMessage ? ` | ${r.errorMessage.slice(0, 80)}` : '';
    console.log(`${status} ${r.route} (${(r.durationMs / 1000).toFixed(1)}s)${errPart}`);
  }

  process.exit(0);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(2);
});
