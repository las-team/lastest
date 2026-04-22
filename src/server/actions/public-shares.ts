'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import path from 'path';
import { promises as fs } from 'fs';
import * as queries from '@/lib/db/queries';
import { requireAuth, requireRepoAccess, requireTeamAccess } from '@/lib/auth';
import { generateShareSlug, buildShareUrl } from '@/lib/share/slug';
import { STORAGE_DIRS, toRelativePath } from '@/lib/storage/paths';
import type { PublicShare } from '@/lib/db/schema';

export interface PublishShareResult {
  shareId: string;
  slug: string;
  url: string;
}

function deriveTargetDomain(targetUrl: string | null | undefined): string | null {
  if (!targetUrl) return null;
  try {
    return new URL(targetUrl).hostname;
  } catch {
    return null;
  }
}

export async function publishBuildShare(
  buildId: string,
  options: { scopedTestId?: string | null } = {},
): Promise<PublishShareResult> {
  const build = await queries.getBuild(buildId);
  if (!build) throw new Error('Build not found');

  const testRun = build.testRunId ? await queries.getTestRun(build.testRunId) : null;
  const repoId = testRun?.repositoryId ?? null;
  if (!repoId) throw new Error('Build has no repository');

  const session = await requireRepoAccess(repoId);

  const scopedTest = options.scopedTestId
    ? await queries.getTest(options.scopedTestId)
    : null;

  let primaryTest = scopedTest;
  if (!primaryTest && build.testRunId) {
    const results = await queries.getTestResultsByRun(build.testRunId);
    const firstResult = results[0];
    primaryTest = firstResult?.testId ? (await queries.getTest(firstResult.testId)) ?? null : null;
  }

  const targetDomain = deriveTargetDomain(primaryTest?.targetUrl);

  const slug = generateShareSlug();
  const share = await queries.createPublicShare({
    slug,
    buildId,
    testId: scopedTest?.id ?? primaryTest?.id ?? null,
    repositoryId: repoId,
    ownerTeamId: session.team.id,
    publishedByUserId: session.user.id,
    status: 'public',
    targetDomain,
  });

  revalidatePath(`/builds/${buildId}`);
  return { shareId: share.id, slug: share.slug, url: buildShareUrl(share.slug) };
}

export async function publishLatestTestShare(testId: string): Promise<PublishShareResult> {
  const test = await queries.getTest(testId);
  if (!test) throw new Error('Test not found');
  if (!test.repositoryId) throw new Error('Test has no repository');

  await requireRepoAccess(test.repositoryId);

  const results = await queries.getTestResultsByTest(testId);
  const mostRecent = results.find((r) => r.testRunId);
  if (!mostRecent?.testRunId) {
    throw new Error(
      'No test runs found. Run this test at least once before publishing a share.',
    );
  }
  const build = await queries.getBuildByTestRun(mostRecent.testRunId);
  if (!build) throw new Error('Most recent run has no associated build');

  return publishBuildShare(build.id, { scopedTestId: testId });
}

export async function listTestShares(testId: string): Promise<PublicShare[]> {
  const test = await queries.getTest(testId);
  if (!test?.repositoryId) return [];
  await requireRepoAccess(test.repositoryId);
  return queries.listPublicSharesForTest(testId);
}

export async function revokePublicShare(shareId: string): Promise<void> {
  const share = await queries.getPublicShareById(shareId);
  if (!share) throw new Error('Share not found');
  if (!share.repositoryId) throw new Error('Share has no repository');
  await requireRepoAccess(share.repositoryId);

  await queries.revokePublicShareById(shareId);
  revalidatePath(`/builds/${share.buildId}`);
  revalidatePath(`/r/${share.slug}`);
}

export async function listBuildShares(buildId: string): Promise<PublicShare[]> {
  const build = await queries.getBuild(buildId);
  if (!build) return [];
  const testRun = build.testRunId ? await queries.getTestRun(build.testRunId) : null;
  if (!testRun?.repositoryId) return [];
  await requireRepoAccess(testRun.repositoryId);
  return queries.listPublicSharesForBuild(buildId);
}

async function copyBaselineFiles(
  sourceBaselines: Array<{ imagePath: string | null }>,
  sourceRepoId: string,
  targetRepoId: string,
): Promise<Map<string, string>> {
  const pathMap = new Map<string, string>();
  for (const b of sourceBaselines) {
    if (!b.imagePath) continue;
    const relative = b.imagePath.replace(/^\/+/, '');
    const segments = relative.split('/');
    if (segments[0] !== 'screenshots') continue;
    const sourceAbs = path.join(STORAGE_DIRS.screenshots, segments.slice(1).join('/'));
    const newRelativeUnder = segments.slice(1).join('/').replace(sourceRepoId, targetRepoId);
    const targetAbs = path.join(STORAGE_DIRS.screenshots, newRelativeUnder);
    try {
      await fs.mkdir(path.dirname(targetAbs), { recursive: true });
      await fs.copyFile(sourceAbs, targetAbs);
      pathMap.set(b.imagePath, toRelativePath(targetAbs));
    } catch {
      // Best-effort — first run will create a fresh baseline if this fails.
    }
  }
  return pathMap;
}

export interface ClaimShareResult {
  newRepositoryId: string;
  newTestId: string;
}

/**
 * Claim flow — called after the user authenticates. Copies the test code
 * (and only the test code + active baselines) into a fresh repository in
 * the claimer's team. Idempotent: claiming the same slug from the same team
 * returns the existing clone.
 */
export async function claimPublicShare(slug: string): Promise<ClaimShareResult> {
  const session = await requireTeamAccess();
  const ctx = await queries.getPublicShareContext(slug);
  if (!ctx) throw new Error('Share not found or revoked');
  if (!ctx.test) throw new Error('Share has no test to claim');

  // Idempotency: if this team already has a repo named after the share, reuse it.
  const existingRepos = await queries.getRepositoriesByTeam(session.team.id);
  const repoName = ctx.share.targetDomain || `claimed-${slug.slice(0, 8)}`;
  const existing = existingRepos.find((r) => r.name === repoName && r.provider === 'local');

  let targetRepoId: string;
  if (existing) {
    targetRepoId = existing.id;
  } else {
    const repo = await queries.createRepository({
      teamId: session.team.id,
      provider: 'local',
      owner: session.team.slug,
      name: repoName,
      fullName: `${session.team.slug}/${repoName}`,
      defaultBranch: 'main',
    });
    targetRepoId = repo.id;
  }

  // If the test was already claimed into this repo (from an earlier claim), reuse it.
  const priorTests = await queries.getTestsByRepo(targetRepoId);
  const prior = priorTests.find((t) => t.name === ctx.test!.name && t.code === ctx.test!.code);
  if (prior) {
    return { newRepositoryId: targetRepoId, newTestId: prior.id };
  }

  const newTest = await queries.createTest({
    repositoryId: targetRepoId,
    functionalAreaId: null,
    name: ctx.test.name,
    code: ctx.test.code,
    description: ctx.test.description,
    targetUrl: ctx.test.targetUrl,
    executionMode: ctx.test.executionMode ?? 'procedural',
    agentPrompt: ctx.test.agentPrompt,
    createdByUserId: session.user.id,
    createdByBotId: null,
  });

  // Best-effort: copy active baselines so first run has something to diff against.
  if (ctx.share.repositoryId) {
    const activeBaselines = await queries.getActiveBaselinesForTest(ctx.test.id);
    const pathMap = await copyBaselineFiles(activeBaselines, ctx.share.repositoryId, targetRepoId);
    for (const b of activeBaselines) {
      if (!b.imagePath) continue;
      const newPath = pathMap.get(b.imagePath);
      if (!newPath) continue;
      await queries.createBaseline({
        repositoryId: targetRepoId,
        testId: newTest.id,
        stepLabel: b.stepLabel,
        imagePath: newPath,
        imageHash: b.imageHash,
        branch: b.branch,
        isActive: true,
        browser: b.browser ?? 'chromium',
      });
    }
  }

  await queries.markPublicShareClaimed(slug, session.team.id, session.user.id);
  revalidatePath(`/r/${slug}`);
  return { newRepositoryId: targetRepoId, newTestId: newTest.id };
}

/**
 * Convenience wrapper for auth callback pages — claims and redirects.
 */
export async function claimAndRedirect(slug: string): Promise<never> {
  await requireAuth();
  const result = await claimPublicShare(slug);
  redirect(`/tests/${result.newTestId}`);
}
