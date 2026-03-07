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
import { runParallel } from '@/lib/ai/parallel';
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
        const candidate = text.slice(start, i + 1);
        try {
          JSON.parse(candidate);
          return candidate;
        } catch {
          return null; // Balanced brackets but not valid JSON (markdown syntax)
        }
      }
    }
  }

  return null;
}

/**
 * Parse user stories from markdown-formatted AI response.
 * Handles the primary exchange format used across agents.
 */
function parseStoriesFromMarkdown(text: string): ExtractedUserStory[] | null {
  const stories: ExtractedUserStory[] = [];

  // Split on user story headers: ### **User Story N: Title**, ## User Story: Title, ### Title, etc.
  const storyBlocks = text.split(/(?=^#{1,4}\s+\*{0,2}(?:User Story[^*\n]*?[:]\s*)?)/mi);

  let storyIndex = 0;
  for (const block of storyBlocks) {
    if (!block.trim()) continue;

    // Extract title from header
    const headerMatch = block.match(/^#{1,4}\s+\*{0,2}(?:User Story\s*\d*\s*[:.]?\s*)?(.+?)\*{0,2}\s*$/m);
    if (!headerMatch) continue;

    const title = headerMatch[1].replace(/\*+/g, '').trim();
    if (!title) continue;

    storyIndex++;
    const storyId = `US-${storyIndex}`;

    // Extract "As a / I want to / So that" description
    const asAMatch = block.match(/\*{0,2}As a\*{0,2}\s+(.+?)(?:\n|$)/i);
    const iWantMatch = block.match(/\*{0,2}I want(?:\s+to)?\*{0,2}\s+(.+?)(?:\n|$)/i);
    const soThatMatch = block.match(/\*{0,2}So that\*{0,2}\s+(.+?)(?:\n|$)/i);

    let description = '';
    if (asAMatch) {
      description = `As a ${asAMatch[1].replace(/\*+/g, '').trim()}`;
      if (iWantMatch) description += `, I want to ${iWantMatch[1].replace(/\*+/g, '').trim()}`;
      if (soThatMatch) description += `, so that ${soThatMatch[1].replace(/\*+/g, '').trim()}`;
    } else {
      // Fallback: use first non-header, non-AC paragraph as description
      const descMatch = block.match(/^#{1,4}[^\n]+\n+((?:(?![-*]\s*AC|Acceptance|#{1,4}\s)[\s\S])+)/);
      description = descMatch ? descMatch[1].replace(/\*+/g, '').trim() : title;
    }

    // Extract acceptance criteria from bullet points
    const criteria: ExtractedAcceptanceCriterion[] = [];
    // Match: - AC1: desc, - **AC1:** desc, - AC-1.1: desc, - desc (after "Acceptance Criteria" header)
    const acSection = block.match(/(?:\*{0,2}Acceptance Criteria\*{0,2}:?\s*\n)([\s\S]*?)(?=\n#{1,4}\s|\n\*{0,2}(?:User Story|Priority|Notes)|$)/i);
    const acText = acSection ? acSection[1] : block;

    const acPattern = /(?:[-*]|\d+[.)]\s)\s*\*{0,2}(?:AC[-. ]?\d+(?:\.\d+)?)\*{0,2}[:.]\s*(.+?)(?:\n|$)/gi;
    let acMatch;
    let acIndex = 0;
    while ((acMatch = acPattern.exec(acText)) !== null) {
      acIndex++;
      const acDesc = acMatch[1].replace(/\*+/g, '').trim();
      if (!acDesc) continue;
      criteria.push({
        id: `AC-${storyIndex}.${acIndex}`,
        description: `Given the user is on the application, when ${acDesc.toLowerCase()}, then the expected behavior occurs`,
        testName: acDesc,
      });
    }

    // Fallback: plain bullet points after "Acceptance Criteria:" without AC prefix
    if (criteria.length === 0 && acSection) {
      const plainBullets = /(?:[-*]|\d+[.)]\s)\s+(.+?)(?:\n|$)/g;
      let bulletMatch;
      while ((bulletMatch = plainBullets.exec(acSection[1])) !== null) {
        acIndex++;
        const desc = bulletMatch[1].replace(/\*+/g, '').trim();
        if (!desc || desc.length < 5) continue;
        criteria.push({
          id: `AC-${storyIndex}.${acIndex}`,
          description: desc,
          testName: desc.length > 60 ? desc.slice(0, 57) + '...' : desc,
        });
      }
    }

    // Last-resort fallback: any bullets in the block after skipping header + description
    if (criteria.length === 0) {
      const lines = block.split('\n');
      let pastHeader = false;
      let pastDescription = false;
      for (const line of lines) {
        if (!pastHeader) {
          if (/^#{1,4}\s/.test(line)) { pastHeader = true; continue; }
          continue;
        }
        if (!pastDescription) {
          // Skip blank lines and description text until we hit a bullet
          if (/^\s*(?:[-*]|\d+[.)])\s+/.test(line)) pastDescription = true;
          else continue;
        }
        const bulletMatch = line.match(/^\s*(?:[-*]|\d+[.)])\s+(.+)/);
        if (bulletMatch) {
          acIndex++;
          const desc = bulletMatch[1].replace(/\*+/g, '').trim();
          if (!desc || desc.length < 5) continue;
          criteria.push({
            id: `AC-${storyIndex}.${acIndex}`,
            description: desc,
            testName: desc.length > 60 ? desc.slice(0, 57) + '...' : desc,
          });
        }
      }
    }

    if (criteria.length > 0) {
      stories.push({
        id: storyId,
        title,
        description,
        acceptanceCriteria: criteria,
      });
    }
  }

  return stories.length > 0 ? stories : null;
}

// ============================================
// Quality Gate: filter non-testable ACs
// ============================================

const NON_TESTABLE_PREFIX = /^(create|implement|consider|add|build|design|ensure|set up|configure|should|could|might)\b/i;

function validateAndFilterStories(stories: ExtractedUserStory[]): ExtractedUserStory[] {
  const seenDescriptions = new Set<string>();

  // Filter catch-all / markdown-artifact story titles
  const CATCHALL_TITLES = new Set(['summary', 'overview', 'general', 'miscellaneous', 'misc', 'other', 'notes']);
  const META_TEST_AC = /^(follows the constraint|handles loading|includes meaningful|uses steplogger|captures screenshots|employs appropriate)/i;

  // Pre-filter: clean titles and remove catch-all stories
  stories = stories.filter(story => {
    // Strip emoji
    story.title = story.title.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}]/gu, '').trim();
    // Strip status markers like "Planned", "Implemented", "Priority Order" etc.
    story.title = story.title.replace(/\(.*?\)\s*$/, '').trim();
    // Strip leading status words (e.g. "Planned", "Implemented")
    story.title = story.title.replace(/^(planned|implemented|completed|pending|done|in progress)\b\s*/i, '').trim();
    // Filter catch-all titles
    return story.title.length > 0 && !CATCHALL_TITLES.has(story.title.toLowerCase());
  });

  const filtered = stories.map(story => {
    const validACs = story.acceptanceCriteria.filter(ac => {
      const desc = ac.description?.trim();
      if (!desc) return false;

      // Too short or too long
      if (desc.length < 10 || desc.length > 300) return false;

      // Questions
      if (desc.endsWith('?')) return false;

      // Non-testable action verbs
      if (NON_TESTABLE_PREFIX.test(desc)) return false;

      // Filter meta-test-quality ACs (about how to write tests, not what to test)
      if (META_TEST_AC.test(desc)) return false;

      // Deduplicate by normalized description
      const normalized = desc.toLowerCase().replace(/\s+/g, ' ');
      if (seenDescriptions.has(normalized)) return false;
      seenDescriptions.add(normalized);

      return true;
    });

    return { ...story, acceptanceCriteria: validACs };
  }).filter(story => story.acceptanceCriteria.length > 0);

  // Deduplicate stories by title (keep the one with more ACs)
  const storyMap = new Map<string, ExtractedUserStory>();
  for (const story of filtered) {
    const key = story.title.toLowerCase().trim();
    const existing = storyMap.get(key);
    if (!existing || story.acceptanceCriteria.length > existing.acceptanceCriteria.length) {
      storyMap.set(key, story);
    }
  }

  return Array.from(storyMap.values());
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

  // Parse response — try JSON first, then markdown
  let stories: ExtractedUserStory[];
  const jsonStr = extractJsonArray(response);
  if (jsonStr) {
    try {
      stories = JSON.parse(jsonStr);
      // Normalize JSON ACs to match markdown-path quality
      for (const story of stories) {
        if (!story.acceptanceCriteria) continue;
        for (const ac of story.acceptanceCriteria) {
          if (!ac.description) continue;
          // Ensure testName is set
          if (!ac.testName) ac.testName = ac.description;
          // If description looks like a raw title (no sentence structure), wrap it
          if (!ac.description.match(/\b(given|when|then|verify|check|should|must)\b/i)) {
            const rawDesc = ac.description;
            ac.description = `When ${rawDesc.charAt(0).toLowerCase() + rawDesc.slice(1)}, verify the expected behavior`;
          }
        }
      }
    } catch {
      // extractJsonArray returned non-JSON — fall through to markdown
      const parsed = parseStoriesFromMarkdown(response);
      if (!parsed) {
        return { success: false, error: 'Could not extract stories from AI response' };
      }
      stories = parsed;
    }
  } else {
    // AI returned markdown/prose — parse directly
    const parsed = parseStoriesFromMarkdown(response);
    if (!parsed) {
      return { success: false, error: 'Could not extract stories from AI response' };
    }
    stories = parsed;
  }

  // Quality gate: filter non-testable ACs and deduplicate
  stories = validateAndFilterStories(stories);
  if (stories.length === 0) {
    return { success: false, error: 'No testable stories found after quality filtering' };
  }

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

    // Fetch branch context if requested
    let branchChanges: { changedFiles: string[]; fileDiffs?: string } | null = null;
    if (options?.useBranchContext) {
      branchChanges = await fetchBranchDiffs(repositoryId, branch);
    }

    // Pre-create areas and collect all task groups
    interface TaskInfo {
      story: ExtractedUserStory;
      group: ExtractedAcceptanceCriterion[];
      areaId: string;
    }
    const allTasks: TaskInfo[] = [];

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
        allTasks.push({ story, group, areaId: area.id });
      }
    }

    // Run test generation in parallel (concurrency: 3)
    const parallelTasks = allTasks.map((task) => {
      const primaryAC = task.group[0];
      const testName = primaryAC.testName || `${task.story.title}: ${primaryAC.description.slice(0, 60)}`;
      let acDescription = task.group.map(ac => ac.description).join('\n');
      // If description just duplicates the name or is too short, use story context
      if (acDescription === testName || acDescription.trim().length < 20) {
        acDescription = task.story.description;
        if (task.group.length > 0 && task.group[0].description !== testName) {
          acDescription += `\n${task.group.map(ac => ac.description).join('\n')}`;
        }
      }

      return {
        id: primaryAC.id,
        execute: async () => {
          const prompt = createBranchAwareTestPrompt({
            testName,
            acceptanceCriteria: acDescription,
            userStoryTitle: task.story.title,
            userStoryDescription: task.story.description,
            targetUrl: options?.targetUrl,
            branchChanges: branchChanges || undefined,
            codebaseIntelligence: options?.codebaseIntelligence,
          });

          const response = await generateWithAI(config, prompt, SYSTEM_PROMPT, {
            actionType: 'generate_spec_tests',
            repositoryId,
          });
          const code = extractCodeFromResponse(response);

          if (code) {
            await queries.createTest({
              repositoryId,
              functionalAreaId: task.areaId,
              name: testName,
              code,
              description: acDescription,
              targetUrl: options?.targetUrl || null,
            });
            return { created: true, testName };
          }
          return { created: false, testName };
        },
      };
    });

    const results = await runParallel(parallelTasks, 3, async (completed, total) => {
      await updateJobProgress(jobId, completed, total);
    });

    for (const result of results) {
      if (result.success && result.result?.created) {
        testsCreated++;
      } else if (!result.success) {
        errors.push(`${result.error || 'Unknown error'}`);
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
        let acDescription = group.map(ac => ac.description).join('\n');
        // If description just duplicates the name or is too short, use story context
        if (acDescription === testName || acDescription.trim().length < 20) {
          acDescription = story.description;
          if (group.length > 0 && group[0].description !== testName) {
            acDescription += `\n${group.map(ac => ac.description).join('\n')}`;
          }
        }

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
