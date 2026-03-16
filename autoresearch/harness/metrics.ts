/**
 * autoresearch/harness/metrics.ts — DB Metric Extraction (IMMUTABLE)
 *
 * Queries the DB to compute all metrics from the latest build for a repository.
 *
 * Usage:
 *   pnpm tsx autoresearch/harness/metrics.ts --repo-id=<id>
 */

import { db } from '@/lib/db';
import { testResults, tests, testRuns, builds, routes, functionalAreas } from '@/lib/db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';

// ─── Failure Classification ─────────────────────────────────────

export type FailureCategory =
  | '404_route'
  | 'syntax_error'
  | 'auth_redirect'
  | 'selector_timeout'
  | 'assertion'
  | 'other';

export function classifyFailure(errorMessage: string | null): FailureCategory {
  if (!errorMessage) return 'other';
  const msg = errorMessage.toLowerCase();

  if (msg.includes('404') || msg.includes('not found') || msg.includes('network failure') || msg.includes('net::err'))
    return '404_route';
  if (msg.includes('syntax') || msg.includes('unexpected token') || msg.includes('not a function'))
    return 'syntax_error';
  if (msg.includes('login') || msg.includes('redirect') || msg.includes('sign in') || msg.includes('unauthorized'))
    return 'auth_redirect';
  if (msg.includes('timeout') || msg.includes('selector') || msg.includes('locator') || msg.includes('waiting for'))
    return 'selector_timeout';
  if (msg.includes('expect') || msg.includes('assert'))
    return 'assertion';

  return 'other';
}

// ─── Types ──────────────────────────────────────────────────────

export interface FailureDetail {
  testId: string;
  testName: string;
  targetUrl: string | null;
  errorMessage: string | null;
  category: FailureCategory;
  functionalArea: string | null;
}

export interface BuildMetrics {
  buildId: string;
  testRunId: string;
  pass_rate: number;
  route_accuracy: number;
  syntax_quality: number;
  auth_success: number;
  route_coverage: number;
  efficiency: number;
  passed: number;
  failed: number;
  total: number;
  failure_details: FailureDetail[];
  category_counts: Record<FailureCategory, number>;
}

// ─── Metric Queries ─────────────────────────────────────────────

export async function getLatestBuildMetrics(repositoryId: string): Promise<BuildMetrics | null> {
  // Get latest build for this repo via testRuns
  const latestBuild = db
    .select({
      buildId: builds.id,
      testRunId: builds.testRunId,
      passedCount: builds.passedCount,
      failedCount: builds.failedCount,
      totalTests: builds.totalTests,
    })
    .from(builds)
    .innerJoin(testRuns, eq(builds.testRunId, testRuns.id))
    .where(eq(testRuns.repositoryId, repositoryId))
    .orderBy(desc(builds.createdAt))
    .limit(1)
    .get();

  if (!latestBuild) return null;

  // Get all test results for this build's test run
  const results = db
    .select({
      testResultId: testResults.id,
      testId: testResults.testId,
      status: testResults.status,
      errorMessage: testResults.errorMessage,
      testName: tests.name,
      targetUrl: tests.targetUrl,
      areaName: functionalAreas.name,
    })
    .from(testResults)
    .innerJoin(tests, eq(testResults.testId, tests.id))
    .leftJoin(functionalAreas, eq(tests.functionalAreaId, functionalAreas.id))
    .where(eq(testResults.testRunId, latestBuild.testRunId!))
    .all();

  // Get all routes for the repo
  const repoRoutes = db
    .select({ path: routes.path, hasTest: routes.hasTest })
    .from(routes)
    .where(eq(routes.repositoryId, repositoryId))
    .all();

  // Classify failures
  const failures: FailureDetail[] = [];
  const categoryCounts: Record<FailureCategory, number> = {
    '404_route': 0,
    'syntax_error': 0,
    'auth_redirect': 0,
    'selector_timeout': 0,
    'assertion': 0,
    'other': 0,
  };

  for (const r of results) {
    if (r.status === 'failed') {
      const cat = classifyFailure(r.errorMessage);
      categoryCounts[cat]++;
      failures.push({
        testId: r.testId!,
        testName: r.testName || 'Unknown',
        targetUrl: r.targetUrl,
        errorMessage: r.errorMessage,
        category: cat,
        functionalArea: r.areaName,
      });
    }
  }

  const total = results.length;
  const passed = results.filter(r => r.status === 'passed').length;
  const failed = total - passed;

  // Route coverage: how many routes have at least one test
  const routesWithTests = repoRoutes.filter(r => r.hasTest).length;
  const totalRoutes = repoRoutes.length;

  // Route accuracy: 1 - (404 failures / total)
  const routeAccuracy = total > 0 ? 1 - (categoryCounts['404_route'] / total) : 1;

  // Syntax quality: 1 - (syntax errors / total)
  const syntaxQuality = total > 0 ? 1 - (categoryCounts['syntax_error'] / total) : 1;

  // Auth success: 1 - (auth redirect / total)
  const authSuccess = total > 0 ? 1 - (categoryCounts['auth_redirect'] / total) : 1;

  // Route coverage
  const routeCoverage = totalRoutes > 0 ? routesWithTests / totalRoutes : 0;

  // Efficiency: tests per route (lower is better)
  const efficiency = totalRoutes > 0 ? total / totalRoutes : 0;

  return {
    buildId: latestBuild.buildId,
    testRunId: latestBuild.testRunId!,
    pass_rate: total > 0 ? passed / total : 0,
    route_accuracy: routeAccuracy,
    syntax_quality: syntaxQuality,
    auth_success: authSuccess,
    route_coverage: routeCoverage,
    efficiency,
    passed,
    failed,
    total,
    failure_details: failures,
    category_counts: categoryCounts,
  };
}

export async function getRouteHallucinationRate(
  repositoryId: string,
  buildId: string
): Promise<{ hallucinated: string[]; valid: string[] }> {
  // Get all routes for this repo
  const repoRoutes = db
    .select({ path: routes.path })
    .from(routes)
    .where(eq(routes.repositoryId, repositoryId))
    .all();

  const routePaths = new Set(repoRoutes.map(r => r.path));

  // Get the build's test run
  const build = db
    .select({ testRunId: builds.testRunId })
    .from(builds)
    .where(eq(builds.id, buildId))
    .get();

  if (!build?.testRunId) return { hallucinated: [], valid: [] };

  // Get all tests for this run with their targetUrls
  const testUrls = db
    .select({ targetUrl: tests.targetUrl })
    .from(testResults)
    .innerJoin(tests, eq(testResults.testId, tests.id))
    .where(eq(testResults.testRunId, build.testRunId))
    .all();

  const hallucinated: string[] = [];
  const valid: string[] = [];

  for (const t of testUrls) {
    if (!t.targetUrl) continue;
    // Extract path from URL
    let urlPath: string;
    try {
      urlPath = new URL(t.targetUrl).pathname;
    } catch {
      urlPath = t.targetUrl;
    }

    // Check if path matches any known route (exact or pattern match)
    const matches = routePaths.has(urlPath) ||
      Array.from(routePaths).some(rp => {
        // Handle dynamic route patterns like /tests/[id]
        const pattern = rp.replace(/\[[\w]+\]/g, '[^/]+');
        return new RegExp(`^${pattern}$`).test(urlPath);
      });

    if (matches) {
      valid.push(urlPath);
    } else {
      hallucinated.push(urlPath);
    }
  }

  return { hallucinated, valid };
}

// ─── CLI Entry ──────────────────────────────────────────────────

if (process.argv[1]?.includes('metrics')) {
  const repoIdArg = process.argv.find(a => a.startsWith('--repo-id='));
  if (!repoIdArg) {
    console.error('Usage: pnpm tsx autoresearch/harness/metrics.ts --repo-id=<id>');
    process.exit(1);
  }

  const repositoryId = repoIdArg.split('=')[1];

  getLatestBuildMetrics(repositoryId).then(metrics => {
    if (!metrics) {
      console.error('No builds found for this repository');
      process.exit(1);
    }

    console.log('---');
    console.log(`build_id:        ${metrics.buildId}`);
    console.log(`pass_rate:       ${metrics.pass_rate.toFixed(6)}`);
    console.log(`route_accuracy:  ${metrics.route_accuracy.toFixed(6)}`);
    console.log(`syntax_quality:  ${metrics.syntax_quality.toFixed(6)}`);
    console.log(`auth_success:    ${metrics.auth_success.toFixed(6)}`);
    console.log(`route_coverage:  ${metrics.route_coverage.toFixed(6)}`);
    console.log(`efficiency:      ${metrics.efficiency.toFixed(3)}`);
    console.log(`passed:          ${metrics.passed}`);
    console.log(`failed:          ${metrics.failed}`);
    console.log(`total:           ${metrics.total}`);
    console.log('---');
    console.log('failure_breakdown:');
    for (const [cat, count] of Object.entries(metrics.category_counts)) {
      if (count > 0) console.log(`  ${cat}: ${count}`);
    }
    console.log('---');
    console.log('failures:');
    for (const f of metrics.failure_details.slice(0, 30)) {
      console.log(`  [${f.category}] ${f.testName} → ${f.targetUrl || 'no-url'}`);
      if (f.errorMessage) {
        console.log(`    ${f.errorMessage.split('\n')[0].slice(0, 100)}`);
      }
    }
    if (metrics.failure_details.length > 30) {
      console.log(`  ... and ${metrics.failure_details.length - 30} more`);
    }
  }).catch(e => {
    console.error('Error:', e);
    process.exit(1);
  });
}
