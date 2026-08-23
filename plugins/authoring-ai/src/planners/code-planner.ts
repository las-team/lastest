/**
 * Code Planner — scans the repository's codebase to discover routes and
 * areas via the sideways, unmigrated `ai-routes.ts` (recipe §1.6.2 — a
 * host method filled by the composition root, not a promotion; see
 * `../host.ts`'s header for why `ai-routes.ts` stays unclassified).
 */

import type { AuthoringAiHost, AuthoringAiIntelligence } from "../host";
import type { PlannerResult } from "../planner-types";

export async function runCodePlanner(
  host: AuthoringAiHost,
  repositoryId: string,
  branch: string,
  intelligence?: AuthoringAiIntelligence,
): Promise<PlannerResult> {
  const start = Date.now();

  try {
    const result = await host.aiScanRoutes(repositoryId, branch, intelligence);
    const durationMs = Date.now() - start;

    if (!result.success || !result.functionalAreas?.length) {
      return {
        source: "code",
        areas: [],
        error: result.error || "No routes found in codebase",
        durationMs,
        inputSummary: `branch: ${branch}${intelligence?.framework ? `, framework: ${intelligence.framework}` : ""}`,
      };
    }

    const areas = result.functionalAreas.map((fa) => ({
      name: fa.name,
      description: fa.description,
      routes: fa.routes.map((r) => r.path),
      testPlan: buildCodeTestPlan(fa.name, fa.routes),
    }));

    return {
      source: "code",
      areas,
      durationMs,
      inputSummary: `branch: ${branch}${intelligence?.framework ? `, framework: ${intelligence.framework}` : ""}`,
    };
  } catch (error) {
    return {
      source: "code",
      areas: [],
      error: error instanceof Error ? error.message : "Code planner failed",
      durationMs: Date.now() - start,
      inputSummary: `branch: ${branch}`,
    };
  }
}

function buildCodeTestPlan(
  areaName: string,
  routes: ReadonlyArray<{
    path: string;
    description?: string;
    testSuggestions?: readonly string[];
  }>,
): string {
  const lines: string[] = [`## ${areaName} (from codebase scan)\n`];

  for (const route of routes) {
    lines.push(`### Route: ${route.path}`);
    if (route.description) lines.push(route.description);

    if (route.testSuggestions?.length) {
      for (const suggestion of route.testSuggestions) {
        lines.push(`- ${suggestion}`);
      }
    } else {
      lines.push(`- Navigate to ${route.path} and verify page loads`);
      lines.push(`- Check for correct heading/content`);
      lines.push(`- Verify navigation elements are present`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
