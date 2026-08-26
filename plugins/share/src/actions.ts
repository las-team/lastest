"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireActor } from "@lastest/kernel";

import * as queries from "./data/queries";
import { sharePlugin } from "./index";
import { generateShareSlug, buildShareUrl } from "./slug";
import { shareWiring } from "./wiring";
import type { PublicShare, PublicShareKind } from "./schema";

/**
 * Share's server actions.
 *
 * A `"use server"` module inside a `transpilePackages` workspace package
 * produces real, dispatchable action ids (spike S1), so these live in the
 * package with no codegen and no shim. Every export below is declared
 * locally rather than re-exported — `export { x } from "…"` inside a
 * `"use server"` file compiles to a module with no exports at all
 * (`plugin-migration-recipe.md` §6).
 *
 * Authorization is the kernel's: every session path calls
 * `runtime.contextFor(sharePlugin, …)` — `resolveScope` runs the app's
 * `requireRepoAccess`/`requireTeamAccess` — and `requireActor(ctx)` asserts
 * the session where a write is attributed to a person. This replaced the
 * `ShareHost.requireRepoAccess`/`requireTeamAccess`/`requireTestAccess`
 * host guards once `ctx.actor` and the enriched `TeamRef` carried everything
 * they used to return (user id/email, team name/slug, repo name).
 */

const INTERNAL_SHARE_DISCORD_WEBHOOK_URL =
  process.env.LASTEST_SHARE_DISCORD_WEBHOOK_URL || "";

export interface PublishShareResult {
  shareId: string;
  slug: string;
  url: string;
}

export async function publishBuildShare(
  buildId: string,
  options: { scopedTestId?: string | null; kind?: PublicShareKind } = {},
): Promise<PublishShareResult> {
  const { runtime, host } = shareWiring();

  const info = await host.getBuildPublishInfo(buildId, options.scopedTestId);
  if (!info) throw new Error("Build not found");

  const ctx = await runtime.contextFor(sharePlugin, {
    repositoryId: info.repositoryId,
  });
  const actor = requireActor(ctx);

  const kind: PublicShareKind = options.kind ?? "regression";

  // Reuse an existing live share instead of minting a new URL on every
  // publish — see `data/queries.ts`'s `getActiveTestShare`/`getActiveBuildShare`
  // doc comments for the reuse rule. Revoked shares are NOT reused.
  const existing = options.scopedTestId
    ? await queries.getActiveTestShare(options.scopedTestId)
    : await queries.getActiveBuildShare(buildId);

  let share: PublicShare;
  if (existing && options.scopedTestId) {
    share = await queries.repointPublicShare(existing.id, {
      buildId,
      targetDomain: info.targetDomain,
      publishedByUserId: actor.userId,
      kind: options.kind,
    });
  } else if (existing) {
    share = existing;
  } else {
    const slug = generateShareSlug();
    share = await queries.createPublicShare({
      slug,
      buildId,
      testId: options.scopedTestId ?? null,
      repositoryId: info.repositoryId,
      ownerTeamId: ctx.team.id,
      publishedByUserId: actor.userId,
      status: "public",
      kind,
      targetDomain: info.targetDomain,
    });
  }

  const shareUrl = buildShareUrl(share.slug);
  // Only ping on a genuinely new share — re-runs that refresh an existing
  // link shouldn't spam the channel.
  if (!existing && INTERNAL_SHARE_DISCORD_WEBHOOK_URL) {
    const { notes: demoNotes } = await host.getDemoNotes(
      buildId,
      info.repositoryId,
    );
    void host
      .sendShareNotification(INTERNAL_SHARE_DISCORD_WEBHOOK_URL, {
        shareUrl,
        slug: share.slug,
        targetDomain: info.targetDomain,
        repoName: ctx.repo
          ? ctx.repo.name || ctx.repo.fullName
          : info.repositoryId,
        publishedByEmail: actor.email,
        teamName: ctx.team.name,
        scopedTestName: info.scopedTestName,
        outreachHook: demoNotes?.outreachHook ?? null,
        testingStruggles: demoNotes?.testingStruggles ?? [],
      })
      .catch((e) => {
        console.error("[publicShare] discord ping failed", e);
      });
  }

  revalidatePath(`/builds/${buildId}`);
  return { shareId: share.id, slug: share.slug, url: shareUrl };
}

export async function publishLatestTestShare(
  testId: string,
  options: { kind?: PublicShareKind } = {},
): Promise<PublishShareResult> {
  const { host } = shareWiring();
  const resolved = await host.resolveOrCreateBuildForTest(testId);
  if (!resolved) {
    throw new Error(
      "No test runs found. Run this test at least once before publishing a share.",
    );
  }
  return publishBuildShare(resolved.buildId, {
    scopedTestId: testId,
    kind: options.kind,
  });
}

export async function listTestShares(testId: string): Promise<PublicShare[]> {
  const { runtime, host } = shareWiring();
  const repositoryId = await host.getTestRepositoryId(testId);
  if (!repositoryId) return [];
  await runtime.contextFor(sharePlugin, { repositoryId });
  return queries.listPublicSharesForTest(testId);
}

export async function revokePublicShare(shareId: string): Promise<void> {
  const { runtime } = shareWiring();
  const share = await queries.getPublicShareById(shareId);
  if (!share) throw new Error("Share not found");
  if (!share.repositoryId) throw new Error("Share has no repository");
  await runtime.contextFor(sharePlugin, { repositoryId: share.repositoryId });

  await queries.revokePublicShareById(shareId);
  revalidatePath(`/builds/${share.buildId}`);
  revalidatePath(`/r/${share.slug}`);
}

export async function listBuildShares(buildId: string): Promise<PublicShare[]> {
  const { runtime, host } = shareWiring();
  const info = await host.getBuildPublishInfo(buildId);
  if (!info) return [];
  await runtime.contextFor(sharePlugin, { repositoryId: info.repositoryId });
  return queries.listPublicSharesForBuild(buildId);
}

export interface ClaimShareResult {
  newRepositoryId: string;
  newTestId: string | null;
}

/**
 * Claim flow — called after the user authenticates. Copies the test code
 * (and only the test code + active baselines) into a fresh repository in
 * the claimer's team. Idempotent: claiming the same slug from the same team
 * returns the existing clone.
 */
export async function claimPublicShare(
  slug: string,
): Promise<ClaimShareResult> {
  const { runtime, host } = shareWiring();
  // No scope request: `resolveScope` falls through to the app's
  // `requireTeamAccess()`, so the claimer's team is the session's and no
  // argument influenced it.
  const ctx = await runtime.contextFor(sharePlugin);
  const actor = requireActor(ctx);
  const share = await queries.getPublicShareBySlug(slug);
  if (!share || share.status !== "public") {
    throw new Error("Share not found or revoked");
  }

  const repoName = share.targetDomain || `claimed-${slug.slice(0, 8)}`;
  const { repositoryId: targetRepositoryId } = await host.findOrCreateClaimRepo(
    ctx.team.id,
    ctx.team.slug,
    repoName,
  );

  const { testIds } = await host.cloneShareIntoRepo({
    shareTestId: share.testId,
    shareBuildId: share.buildId,
    sourceRepositoryId: share.repositoryId,
    targetRepositoryId,
    createdByUserId: actor.userId,
  });
  if (testIds.length === 0) throw new Error("Share has no tests to claim");

  // Land the claimer in the new repo so /tests shows what they just claimed.
  await host.setSelectedRepository(actor.userId, targetRepositoryId);

  await queries.markPublicShareClaimed(slug, ctx.team.id, actor.userId);
  revalidatePath(`/r/${slug}`);
  return {
    newRepositoryId: targetRepositoryId,
    newTestId: share.testId ? (testIds[0] ?? null) : null,
  };
}

/**
 * Convenience wrapper for auth callback pages — claims and redirects.
 */
export async function claimAndRedirect(slug: string): Promise<never> {
  const result = await claimPublicShare(slug);
  redirect(result.newTestId ? `/tests/${result.newTestId}` : "/tests");
}
