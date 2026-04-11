import { db } from '../index';
import {
  routes,
  routeTestSuggestions,
  scanStatus,
  tests,
} from '../schema';
import type {
  NewRoute,
  NewRouteTestSuggestion,
  NewScanStatus,
} from '../schema';
import { getTestsByRepo } from './tests';
import { eq, inArray } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

// Routes
export async function getRoutesByRepo(repositoryId: string) {
  return db.select().from(routes).where(eq(routes.repositoryId, repositoryId));
}

export async function getRoute(id: string) {
  const [row] = await db.select().from(routes).where(eq(routes.id, id));
  return row;
}

export async function getRoutesByIds(ids: string[]) {
  if (ids.length === 0) return [];
  return db.select().from(routes).where(inArray(routes.id, ids));
}

export async function createRoute(data: Omit<NewRoute, 'id'>) {
  const id = uuid();
  await db.insert(routes).values({ ...data, id });
  return { id, ...data };
}

export async function createRoutes(routeData: Omit<NewRoute, 'id'>[]) {
  const routesWithIds = routeData.map(r => ({ ...r, id: uuid() }));
  if (routesWithIds.length > 0) {
    await db.insert(routes).values(routesWithIds);
  }
  return routesWithIds;
}

export async function updateRoute(id: string, data: Partial<NewRoute>) {
  await db.update(routes).set(data).where(eq(routes.id, id));
}

export async function deleteRoutesByRepo(repositoryId: string) {
  await db.delete(routes).where(eq(routes.repositoryId, repositoryId));
}

export async function getRouteCoverageStats(repositoryId: string) {
  const allRoutes = await getRoutesByRepo(repositoryId);
  const total = allRoutes.length;

  // Get functional areas that have tests
  const repoTests = await getTestsByRepo(repositoryId);
  const areasWithTests = new Set(
    repoTests.map(t => t.functionalAreaId).filter(Boolean)
  );

  // Route has coverage if its functional area has tests OR hasTest flag is true
  const withTests = allRoutes.filter(r =>
    r.hasTest || (r.functionalAreaId && areasWithTests.has(r.functionalAreaId))
  ).length;

  const percentage = total > 0 ? Math.round((withTests / total) * 100) : 0;
  return { total, withTests, percentage };
}

export async function linkRouteToFunctionalArea(routeId: string, functionalAreaId: string) {
  await db.update(routes).set({ functionalAreaId }).where(eq(routes.id, routeId));
}

// Scan Status
export async function getScanStatus(repositoryId: string) {
  const [row] = await db.select().from(scanStatus).where(eq(scanStatus.repositoryId, repositoryId));
  return row;
}

export async function createScanStatus(data: Omit<NewScanStatus, 'id'>) {
  const id = uuid();
  await db.insert(scanStatus).values({ ...data, id });
  return { id, ...data };
}

export async function updateScanStatus(id: string, data: Partial<NewScanStatus>) {
  await db.update(scanStatus).set(data).where(eq(scanStatus.id, id));
}

export async function deleteScanStatus(repositoryId: string) {
  await db.delete(scanStatus).where(eq(scanStatus.repositoryId, repositoryId));
}

// Route Test Suggestions
export async function getSuggestionsByRoute(routeId: string) {
  return db.select().from(routeTestSuggestions).where(eq(routeTestSuggestions.routeId, routeId));
}

export async function getSuggestionsByRoutes(routeIds: string[]) {
  if (routeIds.length === 0) return [];
  return db.select().from(routeTestSuggestions).where(inArray(routeTestSuggestions.routeId, routeIds));
}

export async function createRouteTestSuggestion(data: Omit<NewRouteTestSuggestion, 'id'>) {
  const id = uuid();
  await db.insert(routeTestSuggestions).values({ ...data, id, createdAt: new Date() });
  return { id, ...data, createdAt: new Date() };
}

export async function createRouteTestSuggestions(suggestions: Omit<NewRouteTestSuggestion, 'id'>[]) {
  if (suggestions.length === 0) return [];
  const suggestionsWithIds = suggestions.map(s => ({ ...s, id: uuid(), createdAt: new Date() }));
  await db.insert(routeTestSuggestions).values(suggestionsWithIds);
  return suggestionsWithIds;
}

export async function updateRouteTestSuggestion(id: string, data: Partial<NewRouteTestSuggestion>) {
  await db.update(routeTestSuggestions).set(data).where(eq(routeTestSuggestions.id, id));
}

export async function deleteRouteTestSuggestion(id: string) {
  await db.delete(routeTestSuggestions).where(eq(routeTestSuggestions.id, id));
}

export async function deleteSuggestionsByRoute(routeId: string) {
  await db.delete(routeTestSuggestions).where(eq(routeTestSuggestions.routeId, routeId));
}

// Auto-match suggestions against existing tests using fuzzy keyword matching
function normalizeForMatch(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2);
}

function calculateMatchScore(suggestion: string, testName: string): number {
  const suggestionWords = normalizeForMatch(suggestion);
  const testWords = normalizeForMatch(testName);

  let matches = 0;
  for (const sw of suggestionWords) {
    if (testWords.some(tw => tw.includes(sw) || sw.includes(tw))) {
      matches++;
    }
  }

  return suggestionWords.length > 0 ? matches / suggestionWords.length : 0;
}

export async function autoMatchSuggestionsForRoute(routeId: string, repositoryId: string) {
  const suggestions = await getSuggestionsByRoute(routeId);
  const repoTests = await getTestsByRepo(repositoryId);

  const updates: { suggestionId: string; testId: string }[] = [];

  for (const suggestion of suggestions) {
    if (suggestion.matchedTestId) continue; // Already matched

    let bestMatch: { testId: string; score: number } | null = null;

    for (const test of repoTests) {
      const score = calculateMatchScore(suggestion.suggestion, test.name);
      if (score >= 0.5 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { testId: test.id, score };
      }
    }

    if (bestMatch) {
      updates.push({ suggestionId: suggestion.id, testId: bestMatch.testId });
    }
  }

  // Apply updates
  for (const update of updates) {
    await updateRouteTestSuggestion(update.suggestionId, { matchedTestId: update.testId });
  }

  return updates.length;
}

// Get suggestions with matched/unmatched status for display
export async function getSuggestionsWithMatchStatus(routeId: string) {
  const suggestions = await db
    .select({
      id: routeTestSuggestions.id,
      routeId: routeTestSuggestions.routeId,
      suggestion: routeTestSuggestions.suggestion,
      matchedTestId: routeTestSuggestions.matchedTestId,
      createdAt: routeTestSuggestions.createdAt,
      matchedTestName: tests.name,
    })
    .from(routeTestSuggestions)
    .leftJoin(tests, eq(routeTestSuggestions.matchedTestId, tests.id))
    .where(eq(routeTestSuggestions.routeId, routeId))
    ;

  return suggestions;
}

// Get unmatched suggestions for a functional area (by routes linked to that area)
export async function getUnmatchedSuggestionsByArea(functionalAreaId: string) {
  const areaRoutes = await db
    .select()
    .from(routes)
    .where(eq(routes.functionalAreaId, functionalAreaId))
    ;

  if (areaRoutes.length === 0) return [];

  const routeIds = areaRoutes.map(r => r.id);
  const suggestions = await db
    .select({
      id: routeTestSuggestions.id,
      routeId: routeTestSuggestions.routeId,
      suggestion: routeTestSuggestions.suggestion,
      matchedTestId: routeTestSuggestions.matchedTestId,
      createdAt: routeTestSuggestions.createdAt,
      routePath: routes.path,
    })
    .from(routeTestSuggestions)
    .innerJoin(routes, eq(routeTestSuggestions.routeId, routes.id))
    .where(inArray(routeTestSuggestions.routeId, routeIds))
    ;

  return suggestions.filter(s => !s.matchedTestId);
}

// Get all unmatched suggestions for repository
export async function getUnmatchedSuggestionsByRepo(repositoryId: string) {
  const repoRoutes = await getRoutesByRepo(repositoryId);
  if (repoRoutes.length === 0) return [];

  const routeIds = repoRoutes.map(r => r.id);
  const suggestions = await db
    .select({
      id: routeTestSuggestions.id,
      routeId: routeTestSuggestions.routeId,
      suggestion: routeTestSuggestions.suggestion,
      matchedTestId: routeTestSuggestions.matchedTestId,
      createdAt: routeTestSuggestions.createdAt,
      routePath: routes.path,
    })
    .from(routeTestSuggestions)
    .innerJoin(routes, eq(routeTestSuggestions.routeId, routes.id))
    .where(inArray(routeTestSuggestions.routeId, routeIds))
    ;

  return suggestions.filter(s => !s.matchedTestId);
}
