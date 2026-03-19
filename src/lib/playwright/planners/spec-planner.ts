/**
 * Spec Planner — discovers spec/PRD files in the repo via GitHub API,
 * fetches their contents ("Select All"), extracts user stories,
 * and maps acceptance criteria into test plans.
 *
 * If structured extraction fails, returns the raw spec content so the
 * orchestrator/merger can still salvage useful information.
 */

import * as queries from '@/lib/db/queries';
import { getRepoTree, getFileContent } from '@/lib/github/content';
import type { PlannerResult } from '@/lib/playwright/planner-types';

const SPEC_PATTERNS = ['docs/', 'specs/', 'specifications/', 'requirements/', 'stories/', 'features/'];
const SPEC_FILES = ['README.md', 'SPEC.md', 'PRD.md', 'SPECIFICATION.md', 'REQUIREMENTS.md', 'USER_STORIES.md'];

function isSpecFile(path: string): boolean {
  const lower = path.toLowerCase();
  if (SPEC_FILES.some(f => lower === f.toLowerCase())) return true;
  if (SPEC_PATTERNS.some(p => lower.startsWith(p))) {
    return lower.endsWith('.md') || lower.endsWith('.txt') || lower.endsWith('.pdf');
  }
  return false;
}

export async function runSpecPlanner(
  repositoryId: string,
  branch: string,
): Promise<PlannerResult> {
  const start = Date.now();

  try {
    const repo = await queries.getRepository(repositoryId);
    if (!repo) {
      return { source: 'spec', areas: [], error: 'Repository not found', durationMs: Date.now() - start, inputSummary: `branch: ${branch}` };
    }

    const account = repo.teamId
      ? await queries.getGithubAccountByTeam(repo.teamId)
      : await queries.getGithubAccount();

    if (!account) {
      return { source: 'spec', areas: [], error: 'No GitHub account', durationMs: Date.now() - start, inputSummary: `branch: ${branch}` };
    }

    const repoTree = await getRepoTree(account.accessToken, repo.owner, repo.name, branch);
    if (!repoTree || repoTree.tree.length === 0) {
      return { source: 'spec', areas: [], durationMs: Date.now() - start, inputSummary: `branch: ${branch}, 0 spec files` };
    }

    const specEntries = repoTree.tree.filter(
      entry => entry.type === 'blob' && isSpecFile(entry.path),
    );

    if (specEntries.length === 0) {
      return { source: 'spec', areas: [], durationMs: Date.now() - start, inputSummary: `branch: ${branch}, 0 spec files` };
    }

    const filePaths = specEntries.map(e => e.path);
    const rawContents: string[] = [];
    for (const path of filePaths) {
      const content = await getFileContent(account.accessToken, repo.owner, repo.name, path, branch);
      if (content) rawContents.push(`--- ${path} ---\n${content}`);
    }
    const rawSpecContent = rawContents.join('\n\n');

    // Try structured extraction via AI
    const { extractUserStoriesFromFiles } = await import('@/server/actions/spec-import');
    const storiesResult = await extractUserStoriesFromFiles(repositoryId, branch, filePaths);
    const durationMs = Date.now() - start;

    if (storiesResult.success && storiesResult.stories?.length) {
      const areas = storiesResult.stories.map(story => ({
        name: story.title,
        description: story.description,
        routes: [] as string[],
        testPlan: buildSpecTestPlan(story),
      }));
      return {
        source: 'spec',
        areas,
        durationMs,
        inputSummary: `branch: ${branch}, ${specEntries.length} spec files (${filePaths.join(', ')})`,
      };
    }

    // Extraction failed — return raw spec content for merger to salvage
    return {
      source: 'spec',
      areas: [],
      rawOutput: rawSpecContent,
      error: storiesResult.error || `${specEntries.length} spec files found, extraction failed`,
      durationMs,
      inputSummary: `branch: ${branch}, ${specEntries.length} spec files (${filePaths.join(', ')})`,
    };
  } catch (error) {
    return {
      source: 'spec',
      areas: [],
      error: error instanceof Error ? error.message : 'Spec planner failed',
      durationMs: Date.now() - start,
      inputSummary: `branch: ${branch}`,
    };
  }
}

function buildSpecTestPlan(
  story: { title: string; description: string; acceptanceCriteria: Array<{ description: string; testName?: string }> },
): string {
  const lines: string[] = [
    `## ${story.title} (from spec)\n`,
    story.description,
    '',
  ];

  if (story.acceptanceCriteria?.length) {
    lines.push('### Test Scenarios');
    for (const ac of story.acceptanceCriteria) {
      const name = ac.testName || ac.description;
      lines.push(`- ${name}`);
    }
  }

  return lines.join('\n');
}
