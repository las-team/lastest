/**
 * Planner Merger — deduplicates and merges results from multiple planners
 * into a single unified list of functional areas with combined test plans.
 */

import type { PlannerArea, PlannerResult, PlannerSource } from './planner-types';

const SOURCE_LABELS: Record<PlannerSource, string> = {
  browser: 'Browser Exploration',
  code: 'Codebase Scan',
  spec: 'Spec Analysis',
  routes: 'Known Routes',
};

// Priority: browser plans are richest, then spec, code, routes
const SOURCE_PRIORITY: Record<PlannerSource, number> = {
  browser: 4,
  spec: 3,
  code: 2,
  routes: 1,
};

interface TaggedArea extends PlannerArea {
  source: PlannerSource;
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[-_]/g, ' ')
    .replace(/\s+(test|tests|testing|area|section)$/i, '')
    .replace(/\s+/g, ' ');
}

function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function findGroupIndex(
  groups: TaggedArea[][],
  area: TaggedArea,
  normalizedNames: Map<number, string>,
): number {
  const areaName = normalizeName(area.name);

  for (let i = 0; i < groups.length; i++) {
    // Check name match
    if (normalizedNames.get(i) === areaName) return i;

    // Check route overlap
    const groupRoutes = groups[i].flatMap(a => a.routes);
    if (area.routes.length > 0 && groupRoutes.length > 0) {
      if (jaccardSimilarity(area.routes, groupRoutes) > 0.5) return i;
    }
  }

  return -1;
}

function mergeGroup(group: TaggedArea[]): PlannerArea {
  // Sort by source priority (highest first) for plan ordering
  const sorted = [...group].sort((a, b) => SOURCE_PRIORITY[b.source] - SOURCE_PRIORITY[a.source]);

  // Pick the longest name
  const name = sorted.reduce((best, a) => a.name.length > best.length ? a.name : best, sorted[0].name);

  // Pick the longest description
  const descriptions = sorted.map(a => a.description).filter(Boolean) as string[];
  const description = descriptions.reduce((best, d) => d.length > best.length ? d : best, descriptions[0] || '');

  // Union routes (deduplicate by path)
  const routeSet = new Set<string>();
  for (const area of sorted) {
    for (const route of area.routes) routeSet.add(route);
  }

  // Combine test plans with source headers (skip empty plans)
  const planParts: string[] = [];
  const seenSources = new Set<PlannerSource>();

  for (const area of sorted) {
    if (!area.testPlan?.trim()) continue;
    if (seenSources.has(area.source)) {
      // Append to existing source section
      const lastIdx = planParts.findIndex(p => p.startsWith(`### Source: ${SOURCE_LABELS[area.source]}`));
      if (lastIdx !== -1) {
        planParts.splice(lastIdx + 1, 0, area.testPlan.trim());
        continue;
      }
    }
    seenSources.add(area.source);
    if (sorted.length > 1 && new Set(sorted.map(a => a.source)).size > 1) {
      planParts.push(`### Source: ${SOURCE_LABELS[area.source]}`);
    }
    planParts.push(area.testPlan.trim());
  }

  return {
    name,
    description: description || undefined,
    routes: Array.from(routeSet),
    testPlan: planParts.join('\n\n'),
  };
}

/**
 * Merge results from multiple planners into a deduplicated list of areas.
 * Groups areas by name similarity or route overlap, then merges each group.
 */
export function mergePlannerResults(results: PlannerResult[]): PlannerArea[] {
  // Collect all areas tagged with their source
  const tagged: TaggedArea[] = [];
  for (const result of results) {
    for (const area of result.areas) {
      tagged.push({ ...area, source: result.source });
    }
  }

  if (tagged.length === 0) return [];

  // Group by name similarity or route overlap
  const groups: TaggedArea[][] = [];
  const normalizedNames = new Map<number, string>();

  for (const area of tagged) {
    const idx = findGroupIndex(groups, area, normalizedNames);
    if (idx >= 0) {
      groups[idx].push(area);
    } else {
      const newIdx = groups.length;
      groups.push([area]);
      normalizedNames.set(newIdx, normalizeName(area.name));
    }
  }

  // Merge each group and sort by route count descending
  return groups
    .map(mergeGroup)
    .sort((a, b) => b.routes.length - a.routes.length);
}
