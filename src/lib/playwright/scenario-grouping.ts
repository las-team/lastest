/**
 * Pure functions for parsing and grouping test scenarios from area plans.
 * Extracted to a separate module so it can be used in both server and client code.
 */

export interface ParsedScenario {
  name: string;
  description: string;
  steps: string;
  /** Primary route this scenario tests (extracted from steps) */
  route?: string;
}

/**
 * A group of related scenarios that should be generated as a single multi-step test.
 * Grouped by route proximity so the test navigates efficiently.
 */
export interface ScenarioGroup {
  /** Test name */
  name: string;
  /** Test description — one-line summary of what this test covers */
  description: string;
  /** Combined prompt with all scenarios in this group */
  combinedSteps: string;
  /** Number of scenarios in this group */
  scenarioCount: number;
}

/**
 * Parse an agentPlan (markdown) into individual scenarios.
 */
export function parseScenariosFromPlan(agentPlan: string, areaName: string): ParsedScenario[] {
  const scenarios: ParsedScenario[] = [];

  // Split by "### Scenario N: Title" headings
  const parts = agentPlan.split(/(?=###\s+Scenario\s+\d+:)/);
  for (const part of parts) {
    const headerMatch = part.match(/^###\s+Scenario\s+\d+:\s*(.+)/);
    if (!headerMatch) continue;
    const name = headerMatch[1].trim();
    const lines = part.split('\n').slice(1);
    const expectedIdx = lines.findIndex(l => /^\*\*Expected\*\*/.test(l));
    const expectedLine = expectedIdx >= 0 ? lines[expectedIdx] : '';
    const description = expectedLine.replace(/^\*\*Expected\*\*:\s*/, '').trim() || name;

    // Extract route from scenario steps (look for "Navigate to /path")
    const routeMatch = part.match(/Navigate to\s+(\/\S+)/i) || part.match(/\/[a-z][\w\-/[\]]*(?=\s|$)/i);
    const route = routeMatch ? routeMatch[1] || routeMatch[0] : undefined;

    scenarios.push({ name, description, steps: part.trim(), route });
  }

  if (scenarios.length > 0) return scenarios;

  // Fallback: split by "### Title" blocks
  const fallbackParts = agentPlan.split(/(?=###\s+(?!Source:))/);
  for (const part of fallbackParts) {
    const hMatch = part.match(/^###\s+(.+)/);
    if (!hMatch) continue;
    const name = hMatch[1].trim().replace(/^Route:\s*/, '');
    if (part.includes('\n-') || part.includes('\n1.')) {
      const routeMatch = part.match(/Navigate to\s+(\/\S+)/i) || part.match(/\/[a-z][\w\-/[\]]*(?=\s|$)/i);
      scenarios.push({
        name: `${areaName} - ${name}`,
        description: name,
        steps: part.trim(),
        route: routeMatch ? routeMatch[1] || routeMatch[0] : undefined,
      });
    }
  }

  if (scenarios.length > 0) return scenarios;

  return [{ name: areaName, description: `Test the ${areaName} functionality`, steps: agentPlan }];
}

/**
 * Group scenarios by route proximity into multi-step test groups.
 * Scenarios sharing the same base route are grouped together.
 * Each group becomes one test that covers multiple scenarios with intermediate screenshots.
 */
export function groupScenariosForGeneration(agentPlan: string, areaName: string, areaRoutes: string[]): ScenarioGroup[] {
  const scenarios = parseScenariosFromPlan(agentPlan, areaName);

  // If 3 or fewer scenarios, keep as one test
  if (scenarios.length <= 3) {
    return [{
      name: areaName,
      description: scenarios.map(s => s.name).join('; '),
      combinedSteps: agentPlan,
      scenarioCount: scenarios.length,
    }];
  }

  // Group by base route (first path segment after /)
  const groups = new Map<string, ParsedScenario[]>();

  for (const scenario of scenarios) {
    let routeKey = '_general';

    if (scenario.route) {
      // Normalize route to base path: /builds/[buildId]/diff/[diffId] → /builds
      const segments = scenario.route.replace(/\[.*?\]/g, '_').split('/').filter(Boolean);
      routeKey = segments[0] || '_general';
    } else {
      // Try to match against known area routes
      for (const r of areaRoutes) {
        const base = r.split('/').filter(Boolean)[0];
        if (base && scenario.steps.includes(r)) {
          routeKey = base;
          break;
        }
      }
    }

    if (!groups.has(routeKey)) groups.set(routeKey, []);
    groups.get(routeKey)!.push(scenario);
  }

  // Build groups, splitting large groups (>8 scenarios) into chunks
  const MAX_SCENARIOS_PER_TEST = 8;
  const result: ScenarioGroup[] = [];

  for (const [routeKey, groupScenarios] of groups) {
    for (let i = 0; i < groupScenarios.length; i += MAX_SCENARIOS_PER_TEST) {
      const chunk = groupScenarios.slice(i, i + MAX_SCENARIOS_PER_TEST);
      const isMultiChunk = groupScenarios.length > MAX_SCENARIOS_PER_TEST;
      const chunkIdx = Math.floor(i / MAX_SCENARIOS_PER_TEST) + 1;

      const groupName = routeKey === '_general'
        ? areaName
        : `${areaName} - /${routeKey}`;
      const name = isMultiChunk ? `${groupName} (Part ${chunkIdx})` : groupName;

      const combinedSteps = chunk.map((s, idx) => (
        `--- Scenario ${idx + 1}: ${s.name} ---\n${s.steps}\n\n**Take a screenshot after verifying this scenario.**`
      )).join('\n\n');

      result.push({
        name,
        description: chunk.map(s => s.name).join('; '),
        combinedSteps,
        scenarioCount: chunk.length,
      });
    }
  }

  return result;
}
