'use server';

import { revalidatePath } from 'next/cache';
import { createHash } from 'crypto';
import * as queries from '@/lib/db/queries';
import { requireRepoAccess, requireTeamAccess } from '@/lib/auth';
import type { AcceptanceCriterion, NewUserStory } from '@/lib/db/schema';
import { createPlanFromUserStoryPrompt, generateWithAI } from '@/lib/ai';
import type { AIProviderConfig } from '@/lib/ai/types';
import { PLACEHOLDER_CODE } from '@/lib/constants/placeholder';
import { parsePlanForPlaceholders } from '@/lib/test-plan/parser';

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

async function getAIConfig(repositoryId: string): Promise<AIProviderConfig> {
  const settings = await queries.getAISettings(repositoryId);
  return {
    provider: settings.provider as 'claude-cli' | 'openrouter' | 'claude-agent-sdk',
    openrouterApiKey: settings.openrouterApiKey,
    openrouterModel: settings.openrouterModel || 'anthropic/claude-sonnet-4',
    customInstructions: settings.customInstructions,
    agentSdkPermissionMode: settings.agentSdkPermissionMode as 'plan' | 'default' | 'acceptEdits' | undefined,
    agentSdkModel: settings.agentSdkModel || undefined,
    agentSdkWorkingDir: settings.agentSdkWorkingDir || undefined,
  };
}

function newAcId() {
  return `ac_${crypto.randomUUID().slice(0, 8)}`;
}

export interface CreateUserStoryInput {
  repositoryId: string;
  functionalAreaId: string;
  title: string;
  asA?: string;
  iWant?: string;
  soThat?: string;
  description?: string;
  acceptanceCriteria?: Array<{ text: string }>;
  source?: 'manual' | 'imported' | 'agent';
  sourceImportId?: string;
}

export async function createUserStory(input: CreateUserStoryInput) {
  await requireRepoAccess(input.repositoryId);

  const acceptanceCriteria: AcceptanceCriterion[] = (input.acceptanceCriteria ?? []).map(ac => ({
    id: newAcId(),
    text: ac.text.trim(),
    status: 'pending' as const,
  }));

  const data: NewUserStory = {
    id: crypto.randomUUID(),
    repositoryId: input.repositoryId,
    functionalAreaId: input.functionalAreaId,
    title: input.title.trim(),
    asA: input.asA?.trim() || null,
    iWant: input.iWant?.trim() || null,
    soThat: input.soThat?.trim() || null,
    description: input.description?.trim() || null,
    acceptanceCriteria,
    source: input.source ?? 'manual',
    sourceImportId: input.sourceImportId ?? null,
    planStale: false,
  };

  const story = await queries.createUserStory(data);
  revalidatePath('/tests');
  return story;
}

export async function updateUserStoryFields(
  id: string,
  patch: {
    title?: string;
    asA?: string | null;
    iWant?: string | null;
    soThat?: string | null;
    description?: string | null;
  },
) {
  await requireTeamAccess();
  await queries.updateUserStory(id, {
    ...patch,
    planStale: true, // any body change makes the existing plan stale
  });
  revalidatePath('/tests');
}

export async function deleteUserStory(id: string) {
  await requireTeamAccess();
  await queries.deleteUserStory(id);
  revalidatePath('/tests');
}

export async function addAcceptanceCriterion(storyId: string, text: string) {
  await requireTeamAccess();
  const story = await queries.getUserStory(storyId);
  if (!story) throw new Error('Story not found');
  const acs = (story.acceptanceCriteria ?? []) as AcceptanceCriterion[];
  const next: AcceptanceCriterion = { id: newAcId(), text: text.trim(), status: 'pending' };
  await queries.updateUserStory(storyId, {
    acceptanceCriteria: [...acs, next],
    planStale: true,
  });
  revalidatePath('/tests');
  return next;
}

export async function updateAcceptanceCriterion(storyId: string, acId: string, text: string) {
  await requireTeamAccess();
  const story = await queries.getUserStory(storyId);
  if (!story) throw new Error('Story not found');
  const acs = (story.acceptanceCriteria ?? []) as AcceptanceCriterion[];
  const next = acs.map(ac => (ac.id === acId ? { ...ac, text: text.trim() } : ac));
  await queries.updateUserStory(storyId, {
    acceptanceCriteria: next,
    planStale: true,
  });
  revalidatePath('/tests');
}

export async function removeAcceptanceCriterion(storyId: string, acId: string) {
  await requireTeamAccess();
  const story = await queries.getUserStory(storyId);
  if (!story) throw new Error('Story not found');
  const acs = (story.acceptanceCriteria ?? []) as AcceptanceCriterion[];
  await queries.updateUserStory(storyId, {
    acceptanceCriteria: acs.filter(ac => ac.id !== acId),
    planStale: true,
  });
  revalidatePath('/tests');
}

export async function setTestAcceptanceCriterionIds(testId: string, acIds: string[]) {
  await requireTeamAccess();
  await queries.setTestAcceptanceCriterionIds(testId, acIds);
  revalidatePath('/tests');
}

export async function clearStoryPlanStale(storyId: string) {
  await requireTeamAccess();
  await queries.setStoryPlanStale(storyId, false);
  revalidatePath('/tests');
}

/**
 * Run the AI to convert a user story into a test plan flow (markdown). Appends or
 * replaces the area's `agentPlan` and clears the story's planStale flag.
 *
 * Strategy: when an area has multiple stories, each new generation appends a
 * `## Story: <title>` header above its phases, so `agentPlan` stays a single
 * coherent markdown doc.
 */
export async function generatePlanFromStory(
  storyId: string,
  options: { mode?: 'replace' | 'append' } = {},
): Promise<{ planMarkdown: string }> {
  const story = await queries.getUserStory(storyId);
  if (!story) throw new Error('Story not found');
  if (!story.repositoryId || !story.functionalAreaId) {
    throw new Error('Story is not linked to a repository / area');
  }
  await requireRepoAccess(story.repositoryId);

  const acs = (story.acceptanceCriteria ?? []) as AcceptanceCriterion[];
  if (acs.length === 0) {
    throw new Error('Add at least one acceptance criterion before generating a plan');
  }

  const area = await queries.getFunctionalArea(story.functionalAreaId);
  const allRoutes = await queries.getRoutesByRepo(story.repositoryId);
  const routes = allRoutes
    .filter(r => r.functionalAreaId === story.functionalAreaId)
    .map(r => r.path);

  const prompt = createPlanFromUserStoryPrompt({
    story: {
      title: story.title,
      asA: story.asA,
      iWant: story.iWant,
      soThat: story.soThat,
      description: story.description,
    },
    acceptanceCriteria: acs.map(ac => ({ id: ac.id, text: ac.text })),
    routes,
  });

  const config = await getAIConfig(story.repositoryId);
  const planBody = await generateWithAI(
    config,
    prompt,
    'You are a senior QA engineer producing structured test plans. Output ONLY the requested markdown phases — no preamble, no fence, no closing remarks.',
    { actionType: 'generate_plan_from_story', repositoryId: story.repositoryId },
  );

  const sectionHeader = `## Story: ${story.title}`;
  const newSection = `${sectionHeader}\n\n${planBody.trim()}\n`;

  let nextPlan: string;
  const existing = area?.agentPlan ?? '';
  if (options.mode === 'replace' || !existing.trim()) {
    nextPlan = newSection;
  } else if (existing.includes(sectionHeader)) {
    // Replace the existing section for this story.
    const re = new RegExp(
      `${sectionHeader.replace(/[.*+?^${}()|[\\\]]/g, '\\$&')}[\\s\\S]*?(?=\\n## Story: |$)`,
      'm',
    );
    nextPlan = existing.replace(re, newSection);
  } else {
    nextPlan = `${existing.trim()}\n\n${newSection}`;
  }

  await queries.updateFunctionalArea(story.functionalAreaId, {
    agentPlan: nextPlan,
    planGeneratedAt: new Date(),
  });
  await queries.setStoryPlanStale(storyId, false);
  revalidatePath('/tests');
  return { planMarkdown: nextPlan };
}

/**
 * Create one placeholder test per scenario found in the area's plan. Each placeholder
 * is pre-linked to the AC ids the planner annotated, so the coverage matrix lights up
 * immediately. Idempotent on (areaId, sorted-ac-ids) pairs.
 */
export async function regeneratePlaceholdersFromPlan(areaId: string) {
  const area = await queries.getFunctionalArea(areaId);
  if (!area) throw new Error('Area not found');
  if (!area.repositoryId) throw new Error('Area has no repository');
  await requireRepoAccess(area.repositoryId);

  const planMarkdown = area.agentPlan ?? '';
  const scenarios = parsePlanForPlaceholders(planMarkdown);
  if (scenarios.length === 0) {
    return { created: 0, skipped: 0 };
  }

  // Look at existing tests in the area to dedupe by AC-id signature.
  const existingTests = await queries.getTestsByFunctionalArea(areaId);
  const existingSignatures = new Set(
    existingTests.map(t => [...((t.acceptanceCriterionIds ?? []) as string[])].sort().join(',')),
  );

  let created = 0;
  let skipped = 0;
  for (const sc of scenarios) {
    const sig = [...sc.acIds].sort().join(',');
    if (existingSignatures.has(sig)) {
      skipped++;
      continue;
    }
    const test = await queries.createTest({
      repositoryId: area.repositoryId,
      functionalAreaId: areaId,
      name: sc.title,
      code: PLACEHOLDER_CODE,
      isPlaceholder: true,
      acceptanceCriterionIds: sc.acIds,
    });
    const specId = await queries.createTestSpec({
      repositoryId: area.repositoryId,
      testId: test.id,
      functionalAreaId: areaId,
      title: sc.title,
      spec: sc.body,
      source: 'planner',
      status: 'has_test',
      codeHash: hashCode(PLACEHOLDER_CODE),
    });
    await queries.linkSpecToTest(specId, test.id);
    existingSignatures.add(sig);
    created++;
  }

  revalidatePath('/tests');
  return { created, skipped };
}
