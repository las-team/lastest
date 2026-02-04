import * as queries from '@/lib/db/queries';
import type { Test, Route, FunctionalArea } from '@/lib/db/schema';

export type MatchReason = 'route_match' | 'url_match' | 'area_match';

export interface AffectedTest {
  testId: string;
  testName: string;
  matchReason: MatchReason;
  confidence: number;
  matchedFile?: string;
}

/**
 * Extract path segments from a file path for matching
 * e.g., "src/app/(app)/dashboard/page.tsx" -> ["app", "dashboard", "page"]
 */
function extractPathSegments(filePath: string): string[] {
  return filePath
    .replace(/\.(tsx?|jsx?|vue|svelte|astro)$/, '') // Remove extensions
    .split('/')
    .filter((segment) => {
      // Filter out common non-meaningful segments
      if (!segment) return false;
      if (segment.startsWith('(') && segment.endsWith(')')) return false; // Route groups like (app)
      if (segment === 'src') return false;
      if (segment === 'app') return false;
      if (segment === 'pages') return false;
      if (segment === 'components') return false;
      if (segment === 'lib') return false;
      if (segment === 'utils') return false;
      if (segment === 'index') return false;
      if (segment === 'page') return false;
      if (segment === 'layout') return false;
      return true;
    })
    .map((s) => s.toLowerCase());
}

/**
 * Extract meaningful path from a URL
 * e.g., "http://localhost:3000/dashboard/settings" -> ["dashboard", "settings"]
 */
function extractUrlSegments(url: string): string[] {
  try {
    const urlObj = new URL(url);
    return urlObj.pathname
      .split('/')
      .filter((s) => s && s !== 'index.html')
      .map((s) => s.toLowerCase());
  } catch {
    return [];
  }
}

/**
 * Calculate match score between two sets of segments
 */
function calculateSegmentMatch(
  sourceSegments: string[],
  targetSegments: string[]
): number {
  if (sourceSegments.length === 0 || targetSegments.length === 0) return 0;

  let matches = 0;
  for (const source of sourceSegments) {
    for (const target of targetSegments) {
      if (
        source === target ||
        source.includes(target) ||
        target.includes(source)
      ) {
        matches++;
        break;
      }
    }
  }

  return matches / Math.max(sourceSegments.length, 1);
}

/**
 * Find tests affected by changed files
 *
 * Matching algorithm (priority order):
 * 1. Route match (100%) - Routes have filePath; if changed file matches, include tests in that route's functionalArea
 * 2. URL match (80%) - Extract path segments from test's targetUrl, match against changed file paths
 * 3. Area match (60%) - Match functionalArea name against folder names in changed files
 */
export async function findAffectedTests(
  changedFiles: string[],
  repositoryId: string
): Promise<AffectedTest[]> {
  const affectedTests: AffectedTest[] = [];
  const seenTestIds = new Set<string>();

  // Get all tests for the repository
  const tests = await queries.getTestsByRepo(repositoryId);
  const routes = await queries.getRoutesByRepo(repositoryId);
  const areas = await queries.getFunctionalAreasByRepo(repositoryId);

  // Build lookup maps
  const areaMap = new Map<string, FunctionalArea>(areas.map((a) => [a.id, a]));
  const routesByArea = new Map<string, Route[]>();
  for (const route of routes) {
    if (route.functionalAreaId) {
      const existing = routesByArea.get(route.functionalAreaId) || [];
      existing.push(route);
      routesByArea.set(route.functionalAreaId, existing);
    }
  }

  // Extract segments from all changed files
  const changedSegments = changedFiles.flatMap(extractPathSegments);
  const uniqueChangedSegments = [...new Set(changedSegments)];

  for (const test of tests) {
    if (seenTestIds.has(test.id)) continue;

    // 1. Route match - if test's functional area has a route whose filePath matches a changed file
    if (test.functionalAreaId) {
      const areaRoutes = routesByArea.get(test.functionalAreaId) || [];
      for (const route of areaRoutes) {
        if (route.filePath) {
          const routeFilePath = route.filePath.toLowerCase();
          for (const changedFile of changedFiles) {
            if (
              changedFile.toLowerCase().includes(routeFilePath) ||
              routeFilePath.includes(changedFile.toLowerCase())
            ) {
              affectedTests.push({
                testId: test.id,
                testName: test.name,
                matchReason: 'route_match',
                confidence: 100,
                matchedFile: changedFile,
              });
              seenTestIds.add(test.id);
              break;
            }
          }
        }
        if (seenTestIds.has(test.id)) break;
      }
    }
    if (seenTestIds.has(test.id)) continue;

    // 2. URL match - match test's targetUrl against changed file paths
    if (test.targetUrl) {
      const urlSegments = extractUrlSegments(test.targetUrl);
      const matchScore = calculateSegmentMatch(urlSegments, uniqueChangedSegments);
      if (matchScore >= 0.3) {
        // At least 30% segment match
        affectedTests.push({
          testId: test.id,
          testName: test.name,
          matchReason: 'url_match',
          confidence: Math.round(80 * matchScore),
          matchedFile: changedFiles.find((f) => {
            const fileSegments = extractPathSegments(f);
            return calculateSegmentMatch(urlSegments, fileSegments) >= 0.3;
          }),
        });
        seenTestIds.add(test.id);
        continue;
      }
    }

    // 3. Area match - match functional area name against folder names in changed files
    if (test.functionalAreaId) {
      const area = areaMap.get(test.functionalAreaId);
      if (area) {
        const areaName = area.name.toLowerCase();
        for (const changedFile of changedFiles) {
          const fileLower = changedFile.toLowerCase();
          if (
            fileLower.includes(areaName) ||
            areaName.split(/[^a-z0-9]+/).some((word) => word && fileLower.includes(word))
          ) {
            affectedTests.push({
              testId: test.id,
              testName: test.name,
              matchReason: 'area_match',
              confidence: 60,
              matchedFile: changedFile,
            });
            seenTestIds.add(test.id);
            break;
          }
        }
      }
    }
  }

  // Sort by confidence descending
  return affectedTests.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Get tests that are NOT affected by the changed files
 */
export async function findUnaffectedTests(
  changedFiles: string[],
  repositoryId: string
): Promise<{ id: string; name: string }[]> {
  const tests = await queries.getTestsByRepo(repositoryId);
  const affectedTests = await findAffectedTests(changedFiles, repositoryId);
  const affectedIds = new Set(affectedTests.map((t) => t.testId));

  return tests
    .filter((t) => !affectedIds.has(t.id))
    .map((t) => ({ id: t.id, name: t.name }));
}
