/**
 * autoresearch/harness/fast-eval.ts — Per-Track Fast Evaluation (IMMUTABLE)
 *
 * Evaluates prompt quality without running Playwright. Pure code analysis.
 *
 * Usage:
 *   pnpm tsx autoresearch/harness/fast-eval.ts --track=route-accuracy --repo-id=<id>
 *   pnpm tsx autoresearch/harness/fast-eval.ts --track=test-generation --repo-id=<id>
 *   pnpm tsx autoresearch/harness/fast-eval.ts --track=auth-resilience --repo-id=<id>
 *   pnpm tsx autoresearch/harness/fast-eval.ts --track=fix-loop --repo-id=<id>
 */

import { db } from '@/lib/db';
import { testResults, tests, testRuns, functionalAreas } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { getAISettings } from '@/lib/db/queries/settings';
import { getRoutesByRepo } from '@/lib/db/queries/routes';
import { getAIProvider } from '@/lib/ai/index';
import type { AIProviderConfig } from '@/lib/ai/types';
import {
  SYSTEM_PROMPT,
  createBranchAwareTestPrompt,
  createFixPrompt,
  extractCodeFromResponse,
} from '@/lib/ai/prompts';
import { stripTypeAnnotations } from '@/lib/playwright/types';
import { classifyFailure, type FailureCategory } from './metrics';

// ─── Config ─────────────────────────────────────────────────────

const SAMPLE_SIZE = parseInt(process.env.SAMPLE_SIZE || '10', 10);

// ─── Types ──────────────────────────────────────────────────────

export interface TrackEvalResult {
  track: string;
  score: number; // 0-1, higher is better
  details: {
    label: string;
    passed: boolean;
    reason?: string;
  }[];
  duration_ms: number;
}

// ─── Helpers ────────────────────────────────────────────────────

async function loadAIConfig(): Promise<AIProviderConfig> {
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
  } catch { /* DB not available */ }

  return { provider: 'claude-cli' };
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

function extractGotoUrls(code: string): string[] {
  const urls: string[] = [];
  // Match page.goto('...') and page.goto(`...`)
  const gotoRegex = /page\.goto\(\s*['"`]([^'"`$]+)['"`]\s*\)/g;
  let match;
  while ((match = gotoRegex.exec(code)) !== null) {
    urls.push(match[1]);
  }
  // Match page.goto(`${baseUrl}/path`)
  const templateRegex = /page\.goto\(\s*`\$\{baseUrl\}([^`]*)`/g;
  while ((match = templateRegex.exec(code)) !== null) {
    urls.push(match[1] || '/');
  }
  return urls;
}

async function getFailedTests(
  repositoryId: string,
  category?: FailureCategory,
  limit: number = SAMPLE_SIZE
) {
  // Get latest test run
  const [latestRun] = await db
    .select({ id: testRuns.id })
    .from(testRuns)
    .where(eq(testRuns.repositoryId, repositoryId))
    .orderBy(desc(testRuns.startedAt))
    .limit(1);

  if (!latestRun) return [];

  const failed = await db
    .select({
      testId: testResults.testId,
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
    .where(
      and(
        eq(testResults.testRunId, latestRun.id),
        eq(testResults.status, 'failed')
      )
    );

  // Filter by category if specified
  const filtered = category
    ? failed.filter(f => classifyFailure(f.errorMessage) === category)
    : failed;

  return filtered.slice(0, limit);
}

// ─── Track Evaluators ───────────────────────────────────────────

export async function evalRouteAccuracy(
  repositoryId: string
): Promise<TrackEvalResult> {
  const start = Date.now();
  const details: TrackEvalResult['details'] = [];

  // Get available routes
  const repoRoutes = await getRoutesByRepo(repositoryId);
  const routePaths = new Set(repoRoutes.map(r => r.path));

  // Get 404 failures
  const failures = await getFailedTests(repositoryId, '404_route', SAMPLE_SIZE);

  if (failures.length === 0) {
    return {
      track: 'route-accuracy',
      score: 1.0,
      details: [{ label: 'no_404_failures', passed: true, reason: 'No 404 failures found' }],
      duration_ms: Date.now() - start,
    };
  }

  console.error(`[route-accuracy] Regenerating ${failures.length} failed tests...`);
  const config = await loadAIConfig();
  const provider = getAIProvider(config);

  for (const f of failures) {
    const label = (f.testName || 'unknown').slice(0, 40);
    try {
      const prompt = createBranchAwareTestPrompt({
        testName: f.testName || 'test',
        acceptanceCriteria: f.description || f.testName || '',
        userStoryTitle: f.areaName || 'Unknown',
        userStoryDescription: `Testing: ${f.areaName || 'Unknown'}`,
        targetUrl: f.targetUrl || undefined,
        availableRoutes: Array.from(routePaths),
      });

      const response = await provider.generate({ prompt, systemPrompt: SYSTEM_PROMPT });
      const code = extractCodeFromResponse(response);

      // Check if generated goto URLs match known routes
      const gotoUrls = extractGotoUrls(code);
      const allValid = gotoUrls.length === 0 || gotoUrls.every(url => {
        const path = url.startsWith('http') ? new URL(url).pathname : url;
        return routePaths.has(path) ||
          Array.from(routePaths).some(rp => {
            const pattern = rp.replace(/\[[\w]+\]/g, '[^/]+');
            return new RegExp(`^${pattern}$`).test(path);
          });
      });

      details.push({
        label,
        passed: allValid,
        reason: allValid ? 'All URLs match known routes' : `Invalid URLs: ${gotoUrls.join(', ')}`,
      });
    } catch (e) {
      details.push({
        label,
        passed: false,
        reason: `Generation error: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  const score = details.filter(d => d.passed).length / details.length;
  return {
    track: 'route-accuracy',
    score,
    details,
    duration_ms: Date.now() - start,
  };
}

export async function evalTestGeneration(
  repositoryId: string
): Promise<TrackEvalResult> {
  const start = Date.now();
  const details: TrackEvalResult['details'] = [];

  // Get recent failures to regenerate
  const failures = await getFailedTests(repositoryId, undefined, SAMPLE_SIZE);

  if (failures.length === 0) {
    return {
      track: 'test-generation',
      score: 1.0,
      details: [{ label: 'no_failures', passed: true }],
      duration_ms: Date.now() - start,
    };
  }

  const repoRoutes = await getRoutesByRepo(repositoryId);
  const routePaths = repoRoutes.map(r => r.path);

  console.error(`[test-generation] Regenerating ${failures.length} tests...`);
  const config = await loadAIConfig();
  const provider = getAIProvider(config);

  for (const f of failures) {
    const label = (f.testName || 'unknown').slice(0, 40);
    try {
      const prompt = createBranchAwareTestPrompt({
        testName: f.testName || 'test',
        acceptanceCriteria: f.description || f.testName || '',
        userStoryTitle: f.areaName || 'Unknown',
        userStoryDescription: `Testing: ${f.areaName || 'Unknown'}`,
        targetUrl: f.targetUrl || undefined,
        availableRoutes: routePaths,
      });

      const response = await provider.generate({ prompt, systemPrompt: SYSTEM_PROMPT });
      const code = extractCodeFromResponse(response);

      // Check 1: Syntax
      const syntaxErr = syntaxCheck(code);
      if (syntaxErr) {
        details.push({ label, passed: false, reason: `Syntax: ${syntaxErr}` });
        continue;
      }

      // Check 2: No TS annotations remaining after strip
      const hasImports = /^import\s+/m.test(code);
      if (hasImports) {
        details.push({ label, passed: false, reason: 'Contains import statements' });
        continue;
      }

      // Check 3: Has proper test signature
      const hasSignature = /export\s+async\s+function\s+test\s*\(/.test(code);
      if (!hasSignature) {
        details.push({ label, passed: false, reason: 'Missing test function signature' });
        continue;
      }

      // Check 4: Has screenshot call
      const hasScreenshot = /screenshot/i.test(code);

      details.push({
        label,
        passed: true,
        reason: hasScreenshot ? 'Valid with screenshot' : 'Valid but no screenshot call',
      });
    } catch (e) {
      details.push({
        label,
        passed: false,
        reason: `Generation error: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  const score = details.filter(d => d.passed).length / details.length;
  return {
    track: 'test-generation',
    score,
    details,
    duration_ms: Date.now() - start,
  };
}

export async function evalAuthResilience(
  repositoryId: string
): Promise<TrackEvalResult> {
  const start = Date.now();
  const details: TrackEvalResult['details'] = [];

  // Check auth redirect failures
  const authFailures = await getFailedTests(repositoryId, 'auth_redirect', SAMPLE_SIZE);

  if (authFailures.length === 0) {
    return {
      track: 'auth-resilience',
      score: 1.0,
      details: [{ label: 'no_auth_failures', passed: true, reason: 'No auth redirect failures' }],
      duration_ms: Date.now() - start,
    };
  }

  // For each auth failure, check if the error pattern suggests fixable auth issues
  for (const f of authFailures) {
    const label = (f.testName || 'unknown').slice(0, 40);
    const error = (f.errorMessage || '').toLowerCase();

    // Classify the auth issue
    const isLoginRedirect = error.includes('login') || error.includes('sign-in') || error.includes('signin');
    const is401 = error.includes('401') || error.includes('unauthorized');
    const isSessionExpired = error.includes('session') || error.includes('expired');

    details.push({
      label,
      passed: false,
      reason: isLoginRedirect ? 'Login redirect' : is401 ? '401 unauthorized' : isSessionExpired ? 'Session expired' : 'Auth issue',
    });
  }

  const score = details.filter(d => d.passed).length / Math.max(details.length, 1);
  return {
    track: 'auth-resilience',
    score,
    details,
    duration_ms: Date.now() - start,
  };
}

export async function evalFixLoop(
  repositoryId: string
): Promise<TrackEvalResult> {
  const start = Date.now();
  const details: TrackEvalResult['details'] = [];

  // Get failures that aren't 404s (those are route issues, not fix issues)
  const failures = await getFailedTests(repositoryId, 'selector_timeout', SAMPLE_SIZE);

  if (failures.length === 0) {
    return {
      track: 'fix-loop',
      score: 1.0,
      details: [{ label: 'no_fixable_failures', passed: true }],
      duration_ms: Date.now() - start,
    };
  }

  console.error(`[fix-loop] Generating fixes for ${failures.length} tests...`);
  const config = await loadAIConfig();
  const provider = getAIProvider(config);

  const repoRoutes = await getRoutesByRepo(repositoryId);
  const routePaths = repoRoutes.map(r => r.path);

  for (const f of failures) {
    const label = (f.testName || 'unknown').slice(0, 40);
    try {
      const prompt = createFixPrompt({
        existingCode: f.testCode || '',
        errorMessage: f.errorMessage || '',
        targetUrl: f.targetUrl || undefined,
        availableRoutes: routePaths,
      });

      const response = await provider.generate({ prompt, systemPrompt: SYSTEM_PROMPT });
      const code = extractCodeFromResponse(response);

      // Check 1: Syntax
      const syntaxErr = syntaxCheck(code);
      if (syntaxErr) {
        details.push({ label, passed: false, reason: `Fix syntax error: ${syntaxErr}` });
        continue;
      }

      // Check 2: Fix actually changed the code
      const isDifferent = code.trim() !== (f.testCode || '').trim();
      if (!isDifferent) {
        details.push({ label, passed: false, reason: 'Fix produced identical code' });
        continue;
      }

      // Check 3: Fix didn't introduce route hallucination
      const gotoUrls = extractGotoUrls(code);
      const routeSet = new Set(routePaths);
      const allValid = gotoUrls.every(url => {
        const path = url.startsWith('http') ? new URL(url).pathname : url;
        return routeSet.has(path) || routePaths.some(rp => {
          const pattern = rp.replace(/\[[\w]+\]/g, '[^/]+');
          return new RegExp(`^${pattern}$`).test(path);
        });
      });

      details.push({
        label,
        passed: allValid,
        reason: allValid ? 'Valid fix' : `Fix introduced hallucinated route: ${gotoUrls.join(', ')}`,
      });
    } catch (e) {
      details.push({
        label,
        passed: false,
        reason: `Fix error: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  const score = details.filter(d => d.passed).length / details.length;
  return {
    track: 'fix-loop',
    score,
    details,
    duration_ms: Date.now() - start,
  };
}

// ─── CLI Entry ──────────────────────────────────────────────────

if (process.argv[1]?.includes('fast-eval')) {
  const trackArg = process.argv.find(a => a.startsWith('--track='));
  const repoIdArg = process.argv.find(a => a.startsWith('--repo-id='));

  if (!trackArg || !repoIdArg) {
    console.error('Usage: pnpm tsx autoresearch/harness/fast-eval.ts --track=<name> --repo-id=<id>');
    console.error('Tracks: route-accuracy, test-generation, auth-resilience, fix-loop');
    process.exit(1);
  }

  const track = trackArg.split('=')[1];
  const repositoryId = repoIdArg.split('=')[1];

  const evaluators: Record<string, (repoId: string) => Promise<TrackEvalResult>> = {
    'route-accuracy': evalRouteAccuracy,
    'test-generation': evalTestGeneration,
    'auth-resilience': evalAuthResilience,
    'fix-loop': evalFixLoop,
  };

  const evaluator = evaluators[track];
  if (!evaluator) {
    console.error(`Unknown track: ${track}`);
    process.exit(1);
  }

  evaluator(repositoryId).then(result => {
    console.log('---');
    console.log(`track:      ${result.track}`);
    console.log(`score:      ${result.score.toFixed(6)}`);
    console.log(`duration:   ${result.duration_ms}ms`);
    console.log(`samples:    ${result.details.length}`);
    console.log(`passed:     ${result.details.filter(d => d.passed).length}`);
    console.log(`failed:     ${result.details.filter(d => !d.passed).length}`);
    console.log('---');
    for (const d of result.details) {
      console.log(`${d.passed ? 'PASS' : 'FAIL'} ${d.label}${d.reason ? ` | ${d.reason}` : ''}`);
    }
  }).catch(e => {
    console.error('Error:', e);
    process.exit(1);
  });
}
