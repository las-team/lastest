/**
 * Spec Planner — discovers spec/PRD files in the repo via GitHub, fetches
 * their contents ("Select All"), extracts user stories through the
 * sideways, unmigrated `spec-import.ts` (recipe §1.6.2 — already its own
 * oversized, uncosted `PSEUDO_PLUGINS` entry; blocked on that migration
 * landing first, not fixed by this one), and maps acceptance criteria into
 * test plans.
 *
 * If structured extraction fails, returns the raw spec content so the
 * orchestrator/merger can still salvage useful information.
 *
 * GitHub credential custody (`account.accessToken`) never reaches this
 * file — `host.getRepoSpecFiles` does the repo/account/tree/content work
 * in the composition root and hands back file contents only.
 */

import type { AuthoringAiHost } from "../host";
import type { PlannerResult } from "../planner-types";

export async function runSpecPlanner(
  host: AuthoringAiHost,
  repositoryId: string,
  branch: string,
): Promise<PlannerResult> {
  const start = Date.now();

  try {
    const specFiles = await host.getRepoSpecFiles(repositoryId, branch);

    if (!specFiles.ok) {
      const error =
        specFiles.reason === "no-repository"
          ? "Repository not found"
          : specFiles.reason === "no-github-account"
            ? "No GitHub account"
            : undefined;
      return {
        source: "spec",
        areas: [],
        error,
        durationMs: Date.now() - start,
        inputSummary:
          specFiles.reason === "no-spec-files"
            ? `branch: ${branch}, 0 spec files`
            : `branch: ${branch}`,
      };
    }

    const filePaths = specFiles.files.map((f) => f.path);
    const rawSpecContent = specFiles.files
      .map((f) => `--- ${f.path} ---\n${f.content}`)
      .join("\n\n");

    const storiesResult = await host.extractUserStoriesFromFiles(
      repositoryId,
      branch,
      filePaths,
    );
    const durationMs = Date.now() - start;

    if (storiesResult.success && storiesResult.stories?.length) {
      const areas = storiesResult.stories.map((story) => ({
        name: story.title,
        description: story.description,
        routes: [] as string[],
        testPlan: buildSpecTestPlan(story),
      }));
      return {
        source: "spec",
        areas,
        durationMs,
        inputSummary: `branch: ${branch}, ${filePaths.length} spec files (${filePaths.join(", ")})`,
      };
    }

    // Extraction failed — return raw spec content for merger to salvage
    return {
      source: "spec",
      areas: [],
      rawOutput: rawSpecContent,
      error:
        storiesResult.error ||
        `${filePaths.length} spec files found, extraction failed`,
      durationMs,
      inputSummary: `branch: ${branch}, ${filePaths.length} spec files (${filePaths.join(", ")})`,
    };
  } catch (error) {
    return {
      source: "spec",
      areas: [],
      error: error instanceof Error ? error.message : "Spec planner failed",
      durationMs: Date.now() - start,
      inputSummary: `branch: ${branch}`,
    };
  }
}

function buildSpecTestPlan(story: {
  title: string;
  description: string;
  acceptanceCriteria: ReadonlyArray<{
    description: string;
    testName?: string;
  }>;
}): string {
  const lines: string[] = [
    `## ${story.title} (from spec)\n`,
    story.description,
    "",
  ];

  if (story.acceptanceCriteria?.length) {
    lines.push("### Test Scenarios");
    for (const ac of story.acceptanceCriteria) {
      const name = ac.testName || ac.description;
      lines.push(`- ${name}`);
    }
  }

  return lines.join("\n");
}
