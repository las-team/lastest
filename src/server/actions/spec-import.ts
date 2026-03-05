'use server';

import * as queries from '@/lib/db/queries';
import {
  generateWithAI,
  createUserStoryExtractionPrompt,
  createBranchAwareTestPrompt,
  extractCodeFromResponse,
  SYSTEM_PROMPT,
  MCP_SYSTEM_PROMPT,
} from '@/lib/ai';
import type { AIProviderConfig, CodebaseIntelligenceContext } from '@/lib/ai/types';
import type { ExtractedUserStory, ExtractedAcceptanceCriterion } from '@/lib/db/schema';
import { revalidatePath } from 'next/cache';
import { getRepoTree, getFileContent, compareBranches } from '@/lib/github/content';
import { extractTextFromFile } from '@/lib/file-parser';
import { createJob, updateJobProgress, completeJob, failJob } from './jobs';
import { getCurrentBranchForRepo } from '@/lib/git-utils';
import { requireRepoAccess } from '@/lib/auth';

// ============================================
// Types
// ============================================

export interface SpecImportResponse {
  success: boolean;
  stories?: ExtractedUserStory[];
  importId?: string;
  error?: string;
}

export interface GenerateTestsResponse {
  success: boolean;
  areasCreated: number;
  testsCreated: number;
  errors: string[];
  error?: string;
}

export interface ValidateTestResponse {
  success: boolean;
  passed: boolean;
  error?: string;
  fixedCode?: string;
}

// ============================================
// Helpers
// ============================================

async function getAIConfig(repositoryId?: string | null): Promise<AIProviderConfig> {
  const settings = await queries.getAISettings(repositoryId);
  return {
    provider: settings.provider as 'claude-cli' | 'openrouter' | 'claude-agent-sdk',
    openrouterApiKey: settings.openrouterApiKey,
    openrouterModel: settings.openrouterModel || 'anthropic/claude-sonnet-4',
    customInstructions: settings.customInstructions,
    agentSdkPermissionMode: settings.agentSdkPermissionMode as 'plan' | 'default' | 'acceptEdits' | undefined,
    agentSdkWorkingDir: settings.agentSdkWorkingDir || undefined,
  };
}

/** Extract first valid JSON array from text */
function extractJsonArray(text: string): string | null {
  // 1. Try extracting from markdown code blocks first (```json ... ``` or ``` ... ```)
  const codeBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)```/g;
  let match;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    const block = match[1].trim();
    if (block.startsWith('[')) {
      try {
        JSON.parse(block);
        return block;
      } catch { /* not valid JSON, try next block */ }
    }
  }

  // 2. Fallback: find first top-level [ and match its closing ]
  const start = text.indexOf('[');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (escape) { escape = false; continue; }
    if (char === '\\' && inString) { escape = true; continue; }
    if (char === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (char === '[') depth++;
    else if (char === ']') {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

// ============================================
// Document Discovery (reuse spec-analysis patterns)
// ============================================

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

export interface DiscoveredSpecFile {
  path: string;
  size?: number;
}

export async function discoverSpecFiles(
  repositoryId: string,
  branch: string
): Promise<{ success: boolean; files?: DiscoveredSpecFile[]; error?: string }> {
  await requireRepoAccess(repositoryId);
  try {
    const account = await queries.getGithubAccount();
    if (!account) {
      return { success: false, error: 'GitHub account not connected' };
    }

    const repo = await queries.getRepository(repositoryId);
    if (!repo) {
      return { success: false, error: 'Repository not found' };
    }

    const repoTree = await getRepoTree(account.accessToken, repo.owner, repo.name, branch);
    if (!repoTree || repoTree.tree.length === 0) {
      return { success: false, error: 'Could not read repository tree' };
    }

    const specEntries = repoTree.tree.filter(
      entry => entry.type === 'blob' && isSpecFile(entry.path)
    );

    if (specEntries.length === 0) {
      return { success: false, error: 'No specification files found in repository' };
    }

    const files: DiscoveredSpecFile[] = specEntries.map(entry => ({
      path: entry.path,
      size: entry.size,
    }));

    return { success: true, files };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to discover specs';
    return { success: false, error: message };
  }
}

// ============================================
// Step 1: Extract User Stories from documents
// ============================================

export async function extractUserStoriesFromFiles(
  repositoryId: string,
  branch: string,
  filePaths: string[]
): Promise<SpecImportResponse> {
  await requireRepoAccess(repositoryId);
  try {
    if (filePaths.length === 0) {
      return { success: false, error: 'No files selected' };
    }

    const account = await queries.getGithubAccount();
    if (!account) {
      return { success: false, error: 'GitHub account not connected' };
    }

    const repo = await queries.getRepository(repositoryId);
    if (!repo) {
      return { success: false, error: 'Repository not found' };
    }

    // Fetch file contents
    const contents: string[] = [];
    for (const path of filePaths) {
      const content = await getFileContent(account.accessToken, repo.owner, repo.name, path, branch);
      if (content) {
        contents.push(`--- ${path} ---\n${content}`);
      }
    }

    if (contents.length === 0) {
      return { success: false, error: 'Could not read any selected files' };
    }

    const specContent = contents.join('\n\n');
    return await extractStoriesFromContent(specContent, repositoryId, branch, filePaths, 'github');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to extract user stories';
    return { success: false, error: message };
  }
}

export async function extractUserStoriesFromUpload(
  formData: FormData,
  repositoryId: string,
  branch: string
): Promise<SpecImportResponse> {
  await requireRepoAccess(repositoryId);
  try {
    const files = formData.getAll('files') as File[];
    if (files.length === 0) {
      return { success: false, error: 'No files uploaded' };
    }

    const contents: string[] = [];
    const fileNames: string[] = [];
    for (const file of files) {
      const text = await extractTextFromFile(file);
      if (text.trim()) {
        contents.push(`--- ${file.name} ---\n${text}`);
        fileNames.push(file.name);
      }
    }

    if (contents.length === 0) {
      return { success: false, error: 'Could not extract text from uploaded files' };
    }

    const specContent = contents.join('\n\n');
    return await extractStoriesFromContent(specContent, repositoryId, branch, fileNames, 'upload');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to extract user stories';
    return { success: false, error: message };
  }
}

async function extractStoriesFromContent(
  specContent: string,
  repositoryId: string,
  branch: string,
  sourceFiles: string[],
  sourceType: 'github' | 'upload'
): Promise<SpecImportResponse> {
  const config = await getAIConfig(repositoryId);
  const prompt = createUserStoryExtractionPrompt(specContent);

  const response = await generateWithAI(config, prompt, SYSTEM_PROMPT, {
    actionType: 'extract_user_stories',
    repositoryId,
  });

  // Parse JSON response
  const jsonStr = extractJsonArray(response);
  if (!jsonStr) {
    return { success: false, error: 'AI did not return valid JSON' };
  }

  const stories: ExtractedUserStory[] = JSON.parse(jsonStr);

  // Create import record (non-fatal — stories are still usable if DB tracking fails)
  let importId: string | null = null;
  try {
    const importRecord = await queries.createSpecImport({
      repositoryId,
      name: `Import from ${sourceFiles.length} file(s)`,
      sourceType,
      sourceFiles,
      branch,
      status: 'extracted',
      extractedStories: stories,
    });
    importId = importRecord.id;
  } catch (err) {
    console.error('Failed to create spec import record:', err);
  }

  return { success: true, stories, importId: importId ?? undefined };
}

// ============================================
// Step 2: Get branch changes for context
// ============================================

export async function getBranchChanges(
  repositoryId: string,
  branch: string
): Promise<{ success: boolean; changedFiles?: string[]; error?: string }> {
  await requireRepoAccess(repositoryId);
  try {
    const account = await queries.getGithubAccount();
    if (!account) {
      return { success: false, error: 'GitHub account not connected' };
    }

    const repo = await queries.getRepository(repositoryId);
    if (!repo) {
      return { success: false, error: 'Repository not found' };
    }

    const baseBranch = repo.defaultBranch || 'main';
    if (branch === baseBranch) {
      // No diff against itself
      return { success: true, changedFiles: [] };
    }

    const comparison = await compareBranches(
      account.accessToken,
      repo.owner,
      repo.name,
      baseBranch,
      branch
    );

    if (!comparison) {
      return { success: true, changedFiles: [] };
    }

    const changedFiles = comparison.files.map(f => f.filename);
    return { success: true, changedFiles };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get branch changes';
    return { success: false, error: message };
  }
}

async function fetchBranchDiffs(
  repositoryId: string,
  branch: string
): Promise<{ changedFiles: string[]; fileDiffs?: string } | null> {
  try {
    const account = await queries.getGithubAccount();
    if (!account) return null;

    const repo = await queries.getRepository(repositoryId);
    if (!repo) return null;

    const baseBranch = repo.defaultBranch || 'main';
    if (branch === baseBranch) return null;

    const comparison = await compareBranches(
      account.accessToken,
      repo.owner,
      repo.name,
      baseBranch,
      branch
    );

    if (!comparison || comparison.files.length === 0) return null;

    const changedFiles = comparison.files.map(f => f.filename);

    // Filter to relevant source files (not test files, not configs)
    const sourceFiles = changedFiles.filter(f =>
      (f.endsWith('.tsx') || f.endsWith('.ts') || f.endsWith('.jsx') || f.endsWith('.js') ||
       f.endsWith('.vue') || f.endsWith('.svelte')) &&
      !f.includes('.test.') && !f.includes('.spec.') && !f.includes('__tests__')
    );

    // Fetch content of up to 5 relevant changed files for context
    const filesToFetch = sourceFiles.slice(0, 5);
    const diffs: string[] = [];

    for (const filePath of filesToFetch) {
      const content = await getFileContent(account.accessToken, repo.owner, repo.name, filePath, branch);
      if (content && content.length < 5000) {
        diffs.push(`--- ${filePath} ---\n${content}`);
      }
    }

    return {
      changedFiles: sourceFiles,
      fileDiffs: diffs.length > 0 ? diffs.join('\n\n') : undefined,
    };
  } catch {
    return null;
  }
}

// ============================================
// Step 3: Generate areas and tests from US/AC
// ============================================

export async function generateTestsFromStories(
  repositoryId: string,
  importId: string | null,
  stories: ExtractedUserStory[],
  branch: string,
  options?: {
    useBranchContext?: boolean;
    targetUrl?: string;
    codebaseIntelligence?: CodebaseIntelligenceContext;
  }
): Promise<GenerateTestsResponse> {
  await requireRepoAccess(repositoryId);
  // Count total tests to generate
  const totalTests = stories.reduce((sum, story) => {
    // Count unique tests (grouped ACs = 1 test)
    const grouped = new Set<string>();
    let count = 0;
    for (const ac of story.acceptanceCriteria) {
      if (ac.groupedWith && grouped.has(ac.groupedWith)) continue;
      grouped.add(ac.id);
      count++;
    }
    return sum + count;
  }, 0);

  const jobId = await createJob('build_tests', `Generating ${totalTests} tests from spec`, totalTests, repositoryId);

  try {
    // Update import status
    if (importId) await queries.updateSpecImport(importId, { status: 'generating' });

    const config = await getAIConfig(repositoryId);
    let areasCreated = 0;
    let testsCreated = 0;
    const errors: string[] = [];
    let testIndex = 0;

    // Fetch branch context if requested
    let branchChanges: { changedFiles: string[]; fileDiffs?: string } | null = null;
    if (options?.useBranchContext) {
      branchChanges = await fetchBranchDiffs(repositoryId, branch);
    }

    for (const story of stories) {
      // Create functional area for this User Story
      const area = await queries.getOrCreateFunctionalAreaByRepo(
        repositoryId,
        story.title,
        story.description
      );

      // Track if this was a new area
      const existingAreas = await queries.getFunctionalAreasByRepo(repositoryId);
      const wasNew = existingAreas.filter(a => a.name.toLowerCase() === story.title.toLowerCase()).length <= 1;
      if (wasNew) areasCreated++;

      // Group ACs that should be combined into single tests
      const acGroups = groupAcceptanceCriteria(story.acceptanceCriteria);

      for (const group of acGroups) {
        testIndex++;
        await updateJobProgress(jobId, testIndex, totalTests);

        const primaryAC = group[0];
        const testName = primaryAC.testName || `${story.title}: ${primaryAC.description.slice(0, 60)}`;
        const acDescription = group.map(ac => ac.description).join('\n');

        const prompt = createBranchAwareTestPrompt({
          testName,
          acceptanceCriteria: acDescription,
          userStoryTitle: story.title,
          userStoryDescription: story.description,
          targetUrl: options?.targetUrl,
          branchChanges: branchChanges || undefined,
          codebaseIntelligence: options?.codebaseIntelligence,
        });

        try {
          const response = await generateWithAI(config, prompt, SYSTEM_PROMPT, {
            actionType: 'generate_spec_tests',
            repositoryId,
          });
          const code = extractCodeFromResponse(response);

          if (code) {
            await queries.createTest({
              repositoryId,
              functionalAreaId: area.id,
              name: testName,
              code,
              description: acDescription,
              targetUrl: options?.targetUrl || null,
            });
            testsCreated++;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          errors.push(`${testName}: ${msg}`);
        }
      }
    }

    // Update import record
    if (importId) {
      await queries.updateSpecImport(importId, {
        status: 'completed',
        areasCreated,
        testsCreated,
        completedAt: new Date(),
      });
    }

    await completeJob(jobId);
    revalidatePath('/areas');
    revalidatePath('/tests');

    return { success: true, areasCreated, testsCreated, errors };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate tests';
    if (importId) {
      await queries.updateSpecImport(importId, {
        status: 'failed',
        error: message,
      });
    }
    await failJob(jobId, message);
    return { success: false, areasCreated: 0, testsCreated: 0, errors: [message], error: message };
  }
}

// ============================================
// Step 3b: Create placeholder tests (no AI)
// ============================================

const PLACEHOLDER_CODE = `export async function test(page, baseUrl, screenshotPath, stepLogger) {
  // Placeholder test — record real interactions to replace this stub
  await page.goto(baseUrl);
  await page.screenshot({ path: screenshotPath });
}`;

export async function createPlaceholdersFromStories(
  repositoryId: string,
  importId: string | null,
  stories: ExtractedUserStory[],
  _branch: string,
  options?: {
    targetUrl?: string;
  }
): Promise<GenerateTestsResponse> {
  await requireRepoAccess(repositoryId);
  const totalTests = stories.reduce((sum, story) => {
    const grouped = new Set<string>();
    let count = 0;
    for (const ac of story.acceptanceCriteria) {
      if (ac.groupedWith && grouped.has(ac.groupedWith)) continue;
      grouped.add(ac.id);
      count++;
    }
    return sum + count;
  }, 0);

  const jobId = await createJob('build_tests', `Creating ${totalTests} placeholder tests`, totalTests, repositoryId);

  try {
    if (importId) await queries.updateSpecImport(importId, { status: 'generating' });

    let areasCreated = 0;
    let testsCreated = 0;
    const errors: string[] = [];
    let testIndex = 0;

    for (const story of stories) {
      const area = await queries.getOrCreateFunctionalAreaByRepo(
        repositoryId,
        story.title,
        story.description
      );

      const existingAreas = await queries.getFunctionalAreasByRepo(repositoryId);
      const wasNew = existingAreas.filter(a => a.name.toLowerCase() === story.title.toLowerCase()).length <= 1;
      if (wasNew) areasCreated++;

      const acGroups = groupAcceptanceCriteria(story.acceptanceCriteria);

      for (const group of acGroups) {
        testIndex++;
        await updateJobProgress(jobId, testIndex, totalTests);

        const primaryAC = group[0];
        const testName = primaryAC.testName || `${story.title}: ${primaryAC.description.slice(0, 60)}`;
        const acDescription = group.map(ac => ac.description).join('\n');

        try {
          await queries.createTest({
            repositoryId,
            functionalAreaId: area.id,
            name: testName,
            code: PLACEHOLDER_CODE,
            description: acDescription,
            isPlaceholder: true,
            targetUrl: options?.targetUrl || null,
          });
          testsCreated++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          errors.push(`${testName}: ${msg}`);
        }
      }
    }

    if (importId) {
      await queries.updateSpecImport(importId, {
        status: 'completed',
        areasCreated,
        testsCreated,
        completedAt: new Date(),
      });
    }

    await completeJob(jobId);
    revalidatePath('/areas');
    revalidatePath('/tests');

    return { success: true, areasCreated, testsCreated, errors };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create placeholder tests';
    if (importId) {
      await queries.updateSpecImport(importId, { status: 'failed', error: message });
    }
    await failJob(jobId, message);
    return { success: false, areasCreated: 0, testsCreated: 0, errors: [message], error: message };
  }
}

function groupAcceptanceCriteria(
  criteria: ExtractedAcceptanceCriterion[]
): ExtractedAcceptanceCriterion[][] {
  const groups: Map<string, ExtractedAcceptanceCriterion[]> = new Map();

  for (const ac of criteria) {
    const groupKey = ac.groupedWith || ac.id;
    const existing = groups.get(groupKey) || [];
    existing.push(ac);
    groups.set(groupKey, existing);
  }

  return Array.from(groups.values());
}

// ============================================
// Step 4: Optional MCP validation
// ============================================

export async function validateTestWithMCP(
  repositoryId: string,
  testId: string,
  baseUrl: string
): Promise<ValidateTestResponse> {
  await requireRepoAccess(repositoryId);
  try {
    // Check if baseUrl is localhost
    const url = new URL(baseUrl);
    if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      return { success: false, passed: false, error: 'MCP validation is only available for localhost targets' };
    }

    const test = await queries.getTest(testId);
    if (!test) {
      return { success: false, passed: false, error: 'Test not found' };
    }

    const config = await getAIConfig(repositoryId);

    // Use MCP to validate and fix the test
    const prompt = `Validate and fix this Playwright test by running it against the live application.

Test code:
\`\`\`typescript
${test.code}
\`\`\`

Base URL: ${baseUrl}

Steps:
1. Use browser_navigate to go to the target URL
2. Use browser_snapshot to verify the page structure
3. Check if the selectors in the test code would work on this page
4. If selectors are wrong or the page structure differs, provide FIXED test code
5. Verify assertions would pass against the current page state

If the test looks correct, return the original code unchanged.
If fixes are needed, return the FIXED code.

Return ONLY the code (fixed or original), no explanations.`;

    const response = await generateWithAI(config, prompt, MCP_SYSTEM_PROMPT, {
      actionType: 'fix_test',
      repositoryId,
      useMCP: true,
    });

    const fixedCode = extractCodeFromResponse(response);
    const codeChanged = fixedCode !== test.code;

    if (codeChanged && fixedCode) {
      // Save the fixed version
      const branch = await getCurrentBranchForRepo(repositoryId);
      await queries.updateTestWithVersion(testId, { code: fixedCode }, 'ai_fix', branch ?? undefined);
      revalidatePath('/tests');
      revalidatePath(`/tests/${testId}`);
      return { success: true, passed: false, fixedCode };
    }

    return { success: true, passed: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'MCP validation failed';
    return { success: false, passed: false, error: message };
  }
}

export async function validateAllTestsWithMCP(
  repositoryId: string,
  testIds: string[],
  baseUrl: string
): Promise<{ success: boolean; validated: number; fixed: number; errors: string[] }> {
  let validated = 0;
  let fixed = 0;
  const errors: string[] = [];

  for (const testId of testIds) {
    const result = await validateTestWithMCP(repositoryId, testId, baseUrl);
    if (result.success) {
      validated++;
      if (result.fixedCode) fixed++;
    } else {
      errors.push(result.error || 'Unknown error');
    }
  }

  return { success: true, validated, fixed, errors };
}
