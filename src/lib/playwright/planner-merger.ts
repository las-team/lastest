/**
 * Planner Merger — deduplicates and merges results from multiple planners
 * into a single unified list of functional areas with combined test plans.
 *
 * Acts as the orchestrator's failsafe: when a planner returns rawOutput but
 * no structured areas, the merger attempts to salvage useful content from it.
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

// ---------------------------------------------------------------------------
// Raw output salvaging — extract areas from unstructured planner responses
// ---------------------------------------------------------------------------

/**
 * Try to extract areas from raw text when structured parsing failed.
 * Handles: markdown headings with test steps, JSON fragments, code blocks,
 * or just chunks of text that can serve as a test plan.
 */
function salvageAreasFromRawOutput(raw: string, source: PlannerSource): TaggedArea[] {
  const areas: TaggedArea[] = [];

  // Strategy 1: Try JSON extraction (planner may have returned valid JSON wrapped in text)
  try {
    const jsonMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/) || [null, null];
    const jsonStr = jsonMatch[1]?.trim();
    if (jsonStr) {
      const parsed = JSON.parse(jsonStr);
      const rawAreas = parsed.areas || (Array.isArray(parsed) ? parsed : null);
      if (Array.isArray(rawAreas)) {
        for (const a of rawAreas) {
          if (a.name) {
            areas.push({
              name: String(a.name),
              description: a.description ? String(a.description) : undefined,
              routes: Array.isArray(a.routes) ? a.routes.map(String) : [],
              testPlan: a.testPlan ? String(a.testPlan) : '',
              source,
            });
          }
        }
        if (areas.length > 0) return areas;
      }
    }
  } catch { /* not JSON, continue */ }

  // Strategy 2: Split by markdown H2/H3 headings into areas
  const headingBlocks = raw.split(/(?=^#{2,3}\s)/m).filter(b => b.trim().length > 50);
  if (headingBlocks.length > 1) {
    for (const block of headingBlocks) {
      const nameMatch = block.match(/^#{2,3}\s+(.+)/m);
      if (!nameMatch) continue;
      const name = nameMatch[1].trim().replace(/[*_`]/g, '');
      if (name.length < 3 || name.length > 100) continue;

      // Extract routes from the block
      const blockRoutes: string[] = [];
      for (const line of block.split('\n')) {
        const routeMatch = line.match(/^\s*[-*]\s*(\/\S+)/);
        if (routeMatch) blockRoutes.push(routeMatch[1]);
      }

      areas.push({
        name,
        routes: blockRoutes,
        testPlan: block.trim(),
        source,
      });
    }
    if (areas.length > 0) return areas;
  }

  // Strategy 3: Treat the entire raw output as a single area's test plan
  // Only if there's substantial content (not just an error message)
  if (raw.length > 200) {
    // Try to extract a meaningful name from the first heading or line
    const firstHeading = raw.match(/^#{1,3}\s+(.+)/m);
    const name = firstHeading
      ? firstHeading[1].trim().replace(/[*_`]/g, '').slice(0, 80)
      : `${SOURCE_LABELS[source]} Output`;

    // Extract any routes mentioned
    const allRoutes: string[] = [];
    for (const line of raw.split('\n')) {
      const routeMatch = line.match(/["'`]\/([\w\-/[\]:]+)["'`]|^\s*[-*]\s*(\/[\w\-/[\]:]+)/);
      if (routeMatch) allRoutes.push(routeMatch[1] ? `/${routeMatch[1]}` : routeMatch[2]);
    }

    areas.push({
      name,
      routes: [...new Set(allRoutes)],
      testPlan: raw.trim(),
      source,
    });
  }

  return areas;
}

// ---------------------------------------------------------------------------
// Main merge function
// ---------------------------------------------------------------------------

/**
 * Merge results from multiple planners into a deduplicated list of areas.
 * Groups areas by name similarity or route overlap, then merges each group.
 *
 * When a planner has areas: [], the merger tries to salvage from rawOutput.
 */
export function mergePlannerResults(results: PlannerResult[]): PlannerArea[] {
  // Collect all areas tagged with their source
  const tagged: TaggedArea[] = [];

  for (const result of results) {
    if (result.areas.length > 0) {
      // Planner produced structured output — use as-is
      for (const area of result.areas) {
        tagged.push({ ...area, source: result.source });
      }
    } else if (result.rawOutput) {
      // Planner failed structured parsing — try to salvage from raw output
      const salvaged = salvageAreasFromRawOutput(result.rawOutput, result.source);
      tagged.push(...salvaged);
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
