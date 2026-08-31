import { eq, and, desc, sql, isNotNull } from "drizzle-orm";
import { v4 as uuid } from "uuid";

import { db } from "./db";
import { sharePublicShares } from "../schema";
import type { NewPublicShare, PublicShare, PublicShareKind } from "../schema";

/**
 * The plugin's own table only. Every query here touches `share_public_shares`
 * and nothing else — reads that need a build, test, or any other core row go
 * through `ShareHost` instead (`core-scope.md` §6: a plugin does not reach a
 * core table, it calls a core function).
 */

export async function createPublicShare(
  data: Omit<NewPublicShare, "id" | "createdAt">,
): Promise<PublicShare> {
  const id = uuid();
  const createdAt = new Date();
  await db()
    .insert(sharePublicShares)
    .values({ ...data, id, createdAt });
  const [row] = await db()
    .select()
    .from(sharePublicShares)
    .where(eq(sharePublicShares.id, id));
  return row;
}

export async function getPublicShareBySlug(
  slug: string,
): Promise<PublicShare | undefined> {
  const [row] = await db()
    .select()
    .from(sharePublicShares)
    .where(eq(sharePublicShares.slug, slug));
  return row;
}

export async function getPublicShareById(
  id: string,
): Promise<PublicShare | undefined> {
  const [row] = await db()
    .select()
    .from(sharePublicShares)
    .where(eq(sharePublicShares.id, id));
  return row;
}

export async function listPublicSharesForBuild(
  buildId: string,
): Promise<PublicShare[]> {
  return db()
    .select()
    .from(sharePublicShares)
    .where(eq(sharePublicShares.buildId, buildId))
    .orderBy(desc(sharePublicShares.createdAt));
}

export async function listPublicSharesForTest(
  testId: string,
): Promise<PublicShare[]> {
  return db()
    .select()
    .from(sharePublicShares)
    .where(eq(sharePublicShares.testId, testId))
    .orderBy(desc(sharePublicShares.createdAt));
}

// Most recent live build-wide share for a build (testId IS NULL). Backs the
// "1 share per build" reuse rule — re-publishing a build returns this slug
// instead of minting a new one.
export async function getActiveBuildShare(
  buildId: string,
): Promise<PublicShare | undefined> {
  const [row] = await db()
    .select()
    .from(sharePublicShares)
    .where(
      and(
        eq(sharePublicShares.buildId, buildId),
        eq(sharePublicShares.status, "public"),
        sql`${sharePublicShares.testId} IS NULL`,
      ),
    )
    .orderBy(desc(sharePublicShares.createdAt))
    .limit(1);
  return row;
}

// Most recent live share scoped to a single test, across ALL builds. Backs the
// "1 stable URL per test" reuse rule — re-running a test produces a new build,
// but re-publishing returns this same slug (repointed at the fresh build) so
// the shared link never changes.
export async function getActiveTestShare(
  testId: string,
): Promise<PublicShare | undefined> {
  const [row] = await db()
    .select()
    .from(sharePublicShares)
    .where(
      and(
        eq(sharePublicShares.testId, testId),
        eq(sharePublicShares.status, "public"),
      ),
    )
    .orderBy(desc(sharePublicShares.createdAt))
    .limit(1);
  return row;
}

// Repoint an existing share at a newer build and refresh its derived fields,
// keeping the same id/slug so the public URL is stable across re-runs.
export async function repointPublicShare(
  id: string,
  data: {
    buildId: string;
    targetDomain: string | null;
    publishedByUserId?: string | null;
    kind?: PublicShareKind;
  },
): Promise<PublicShare> {
  await db()
    .update(sharePublicShares)
    .set({
      buildId: data.buildId,
      targetDomain: data.targetDomain,
      ...(data.publishedByUserId
        ? { publishedByUserId: data.publishedByUserId }
        : {}),
      ...(data.kind ? { kind: data.kind } : {}),
    })
    .where(eq(sharePublicShares.id, id));
  const [row] = await db()
    .select()
    .from(sharePublicShares)
    .where(eq(sharePublicShares.id, id));
  return row;
}

export async function revokePublicShareById(id: string): Promise<void> {
  await db()
    .update(sharePublicShares)
    .set({ status: "revoked", revokedAt: new Date() })
    .where(eq(sharePublicShares.id, id));
}

/**
 * Revoke every live share owned by a team, returning how many were revoked.
 *
 * Exists for the regulated-mode switch: turning the profile on refuses to mint
 * new links, but the links already out there are the actual exposure, and the
 * toast says they are gone. This is what makes that true. Idempotent — a
 * second call revokes nothing.
 */
export async function revokePublicSharesForTeam(
  teamId: string,
): Promise<number> {
  const rows = await db()
    .update(sharePublicShares)
    .set({ status: "revoked", revokedAt: new Date() })
    .where(
      and(
        eq(sharePublicShares.ownerTeamId, teamId),
        eq(sharePublicShares.status, "public"),
      ),
    )
    .returning({ id: sharePublicShares.id });
  return rows.length;
}

export async function markPublicShareClaimed(
  slug: string,
  claimedByTeamId: string,
  claimedByUserId: string,
): Promise<void> {
  await db()
    .update(sharePublicShares)
    .set({ claimedByTeamId, claimedByUserId, claimedAt: new Date() })
    .where(
      and(
        eq(sharePublicShares.slug, slug),
        sql`${sharePublicShares.claimedByTeamId} IS NULL`,
      ),
    );
}

export async function incrementPublicShareView(slug: string): Promise<void> {
  await db()
    .update(sharePublicShares)
    .set({
      viewCount: sql`${sharePublicShares.viewCount} + 1`,
      lastViewedAt: new Date(),
    })
    .where(eq(sharePublicShares.slug, slug));
}

// Own-table aggregate for the social-proof strip's "products tested" number.
// The other half (total test runs, platform-wide) is a core aggregate — see
// `ShareHost.getPlatformStats`.
export async function countDistinctPublicTargetDomains(): Promise<number> {
  const [row] = await db()
    .select({
      n: sql<number>`COUNT(DISTINCT ${sharePublicShares.targetDomain})::int`,
    })
    .from(sharePublicShares)
    .where(
      and(
        eq(sharePublicShares.status, "public"),
        isNotNull(sharePublicShares.targetDomain),
      ),
    );
  return row?.n ?? 0;
}

/**
 * Live shares for a set of repositories, newest first per repo — backs the
 * (not yet migrated) `awards` pseudo-plugin's proof-link lookup. Own table
 * only; `awards` composes this with its own `repositories`/`repoAwards`
 * reads on its side of the boundary. See `src/lib/core/share-reads.ts`.
 */
export async function listPublicSharesForRepositories(
  repositoryIds: readonly string[],
): Promise<
  Array<{ repositoryId: string | null; slug: string; createdAt: Date | null }>
> {
  if (repositoryIds.length === 0) return [];
  return db()
    .select({
      repositoryId: sharePublicShares.repositoryId,
      slug: sharePublicShares.slug,
      createdAt: sharePublicShares.createdAt,
    })
    .from(sharePublicShares)
    .where(
      and(
        sql`${sharePublicShares.repositoryId} IN (${sql.join(
          repositoryIds.map((id) => sql`${id}`),
          sql`, `,
        )})`,
        eq(sharePublicShares.status, "public"),
      ),
    )
    .orderBy(desc(sharePublicShares.createdAt));
}

/** The newest live share's slug for one repository, or null. */
export async function getLatestPublicShareSlugForRepository(
  repositoryId: string,
): Promise<string | null> {
  const [row] = await db()
    .select({ slug: sharePublicShares.slug })
    .from(sharePublicShares)
    .where(
      and(
        eq(sharePublicShares.repositoryId, repositoryId),
        eq(sharePublicShares.status, "public"),
      ),
    )
    .orderBy(desc(sharePublicShares.createdAt))
    .limit(1);
  return row?.slug ?? null;
}

/**
 * Raw rows for `src/app/sitemap.ts`. Own table only — the app composes the
 * per-share enrichment (build timestamps, test name, video path) itself by
 * calling core's query layer directly, which it may freely do (it is not a
 * plugin). See `plugin-migration-recipe.md` §6's page rule applied to a route
 * that mostly belongs to core: only the "which shares are indexable" list is
 * this plugin's to answer.
 */
export async function listIndexablePublicShares(limit = 5000): Promise<
  Array<{
    slug: string;
    testId: string | null;
    buildId: string;
    targetDomain: string | null;
    createdAt: Date | null;
  }>
> {
  return db()
    .select({
      slug: sharePublicShares.slug,
      testId: sharePublicShares.testId,
      buildId: sharePublicShares.buildId,
      targetDomain: sharePublicShares.targetDomain,
      createdAt: sharePublicShares.createdAt,
    })
    .from(sharePublicShares)
    .where(
      and(
        eq(sharePublicShares.status, "public"),
        isNotNull(sharePublicShares.testId),
      ),
    )
    .orderBy(desc(sharePublicShares.createdAt))
    .limit(limit);
}
