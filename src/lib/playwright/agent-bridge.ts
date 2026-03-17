/**
 * Agent Bridge — shared infrastructure for Playwright Test Agents
 * (Planner, Generator, Healer, Play Agent)
 *
 * Handles process spawning, temp directory management, output parsing,
 * and cleanup for all agent types.
 */

import { spawn, type ChildProcess } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentType = 'planner' | 'generator' | 'healer';

export interface AgentProcessOptions {
  /** Working directory for the spawned process */
  cwd?: string;
  /** Environment variables to merge */
  env?: Record<string, string>;
  /** Timeout in ms (default 300 000 = 5 min) */
  timeout?: number;
  /** AbortController signal for cancellation */
  signal?: AbortSignal;
  /** Optional step logger for streaming output */
  stepLogger?: (line: string) => void;
}

export interface AgentProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export interface ParsedPlannerArea {
  name: string;
  description?: string;
  routes: string[];
  testPlan: string;
}

export interface ParsedGeneratorTest {
  name: string;
  code: string;
  route?: string;
}

export interface ParsedHealerResult {
  patchedCode: string;
  filename: string;
}

// ---------------------------------------------------------------------------
// Temp directory helpers
// ---------------------------------------------------------------------------

const TEMP_ROOT = path.join(os.tmpdir(), 'lastest2-agents');

async function ensureTempRoot(): Promise<void> {
  await fs.mkdir(TEMP_ROOT, { recursive: true });
}

export async function createTempSpecDir(repoId: string): Promise<string> {
  await ensureTempRoot();
  const dir = path.join(TEMP_ROOT, `specs-${repoId}-${Date.now()}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function createTempTestDir(repoId: string): Promise<string> {
  await ensureTempRoot();
  const dir = path.join(TEMP_ROOT, `tests-${repoId}-${Date.now()}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function cleanupTempDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}

// ---------------------------------------------------------------------------
// Process spawning
// ---------------------------------------------------------------------------

/**
 * Spawn a Playwright agent process and capture output.
 *
 * The command shape:
 *   npx playwright test --agent <type> [extra args]
 *
 * NOTE: The exact CLI flags may evolve as PW agents mature. This function
 * isolates the spawn details so callers don't need to change.
 */
export async function spawnAgentProcess(
  type: AgentType,
  extraArgs: string[],
  options: AgentProcessOptions = {},
): Promise<AgentProcessResult> {
  const timeout = options.timeout ?? 300_000;
  const env = {
    ...process.env,
    ...options.env,
    // Ensure Playwright doesn't try to open a browser GUI
    PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || '',
  };

  const args = ['playwright', 'test', `--agent=${type}`, ...extraArgs];

  return new Promise<AgentProcessResult>((resolve, reject) => {
    const child: ChildProcess = spawn('npx', args, {
      cwd: options.cwd || process.cwd(),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Kill child tree on timeout
      timeout,
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      if (options.stepLogger) {
        for (const line of text.split('\n').filter(Boolean)) {
          options.stepLogger(line);
        }
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      if (options.stepLogger) {
        for (const line of text.split('\n').filter(Boolean)) {
          options.stepLogger(`[stderr] ${line}`);
        }
      }
    });

    // Handle abort signal
    if (options.signal) {
      const onAbort = () => {
        child.kill('SIGTERM');
        reject(new Error('Agent process aborted'));
      };
      if (options.signal.aborted) {
        child.kill('SIGTERM');
        return reject(new Error('Agent process aborted'));
      }
      options.signal.addEventListener('abort', onAbort, { once: true });
      child.on('close', () => {
        options.signal?.removeEventListener('abort', onAbort);
      });
    }

    child.on('error', (err) => {
      reject(new Error(`Failed to spawn agent process: ${err.message}`));
    });

    child.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code });
    });
  });
}

// ---------------------------------------------------------------------------
// Output parsers
// ---------------------------------------------------------------------------

/**
 * Parse Planner agent output from a specs directory.
 * Planner writes markdown files like `specs/area-name.md` with test plans.
 */
export async function parsePlannerOutput(specsDir: string): Promise<ParsedPlannerArea[]> {
  const areas: ParsedPlannerArea[] = [];

  let files: string[];
  try {
    files = await fs.readdir(specsDir);
  } catch {
    return areas;
  }

  for (const file of files) {
    if (!file.endsWith('.md')) continue;

    const content = await fs.readFile(path.join(specsDir, file), 'utf-8');
    const name = path.basename(file, '.md')
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase()); // kebab-case → Title Case

    // Extract routes from markdown links or lines starting with /
    const routes: string[] = [];
    for (const line of content.split('\n')) {
      const routeMatch = line.match(/^\s*[-*]\s*(\/\S+)/);
      if (routeMatch) {
        routes.push(routeMatch[1]);
      }
    }

    // Extract description from first paragraph
    const paragraphs = content.split(/\n\n+/);
    const description = paragraphs[0]?.replace(/^#.*\n?/, '').trim() || undefined;

    areas.push({
      name,
      description,
      routes,
      testPlan: content,
    });
  }

  return areas;
}

/**
 * Parse Generator agent output from a tests directory.
 * Generator writes `.spec.ts` files. We read them and convert to
 * Lastest2's `export async function test(page, baseUrl, screenshotPath, stepLogger)` signature.
 */
export async function parseGeneratorOutput(testsDir: string): Promise<ParsedGeneratorTest[]> {
  const tests: ParsedGeneratorTest[] = [];

  let files: string[];
  try {
    files = await fs.readdir(testsDir);
  } catch {
    return tests;
  }

  for (const file of files) {
    if (!file.endsWith('.spec.ts') && !file.endsWith('.spec.js')) continue;

    const rawCode = await fs.readFile(path.join(testsDir, file), 'utf-8');
    const name = path.basename(file, path.extname(file))
      .replace(/\.spec$/, '')
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());

    // Convert PW test format to Lastest2 signature
    const code = convertPwTestToLastest2(rawCode);

    // Try to extract route from the code (e.g. page.goto('/some-path'))
    const routeMatch = rawCode.match(/page\.goto\(['"]([^'"]+)['"]\)/);
    const route = routeMatch?.[1];

    tests.push({ name, code, route });
  }

  return tests;
}

/**
 * Parse Healer agent output — patched test files.
 */
export async function parseHealerOutput(testsDir: string): Promise<ParsedHealerResult[]> {
  const results: ParsedHealerResult[] = [];

  let files: string[];
  try {
    files = await fs.readdir(testsDir);
  } catch {
    return results;
  }

  for (const file of files) {
    if (!file.endsWith('.spec.ts') && !file.endsWith('.spec.js') && !file.endsWith('.ts') && !file.endsWith('.js')) continue;

    const patchedCode = await fs.readFile(path.join(testsDir, file), 'utf-8');
    results.push({ patchedCode: convertPwTestToLastest2(patchedCode), filename: file });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Code conversion
// ---------------------------------------------------------------------------

/**
 * Convert Playwright's standard test format to Lastest2's function signature:
 *   export async function test(page, baseUrl, screenshotPath, stepLogger) { ... }
 *
 * This strips `import { test, expect } from '@playwright/test'` and
 * extracts the test body.
 */
export function convertPwTestToLastest2(rawCode: string): string {
  // Remove PW imports
  const code = rawCode
    .replace(/import\s*\{[^}]*\}\s*from\s*['"]@playwright\/test['"];?\n?/g, '')
    .replace(/import\s+.*from\s*['"]@playwright\/test['"];?\n?/g, '');

  // Try to extract test body from test('name', async ({ page }) => { ... })
  const testBodyMatch = code.match(
    /test(?:\.describe)?\s*\(\s*['"][^'"]*['"]\s*,\s*async\s*\(\s*\{\s*page\s*\}\s*\)\s*=>\s*\{([\s\S]*)\}\s*\)\s*;?\s*$/
  );

  if (testBodyMatch) {
    const body = testBodyMatch[1].trim();
    // Replace expect() calls with simple assertions that work in Lastest2 context
    const convertedBody = body
      .replace(/await\s+expect\(([^)]+)\)\.toBeVisible\(\)/g, 'await $1.waitFor({ state: "visible" })')
      .replace(/await\s+expect\(([^)]+)\)\.toHaveText\(([^)]+)\)/g, 'await $1.waitFor({ state: "visible" })');

    return `export async function test(page, baseUrl, screenshotPath, stepLogger) {\n  ${convertedBody}\n}`;
  }

  // If we can't parse it structurally, wrap the remaining code
  const trimmed = code.trim();
  if (!trimmed.includes('export async function test')) {
    return `export async function test(page, baseUrl, screenshotPath, stepLogger) {\n  ${trimmed}\n}`;
  }

  return trimmed;
}

// ---------------------------------------------------------------------------
// Utility: write a seed/setup test for agents
// ---------------------------------------------------------------------------

/**
 * Write a seed test file (e.g. login/setup) that agents can use as a
 * starting point before exploring.
 */
export async function writeSeedTest(dir: string, code: string, filename = 'setup.spec.ts'): Promise<string> {
  const filePath = path.join(dir, filename);
  await fs.writeFile(filePath, code, 'utf-8');
  return filePath;
}

/**
 * Write a spec markdown file for Generator/Planner to consume.
 */
export async function writeSpecFile(dir: string, content: string, filename = 'spec.md'): Promise<string> {
  const filePath = path.join(dir, filename);
  await fs.writeFile(filePath, content, 'utf-8');
  return filePath;
}
