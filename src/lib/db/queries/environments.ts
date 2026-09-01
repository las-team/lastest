/**
 * `environments` — the PROD / UAT / prerelease deployments of the system under
 * test, plus the baseline operations that only make sense once they exist
 * (promotion between environments, surviving a sandbox refresh).
 *
 * Gap analysis B2. The design rule everything here follows: an environment is
 * ADDITIVE. Every scoping column is nullable, every lookup falls back to the
 * NULL row, and a repo that never creates an environment behaves exactly as it
 * did before. There is no "migrate to environments" step for an existing repo.
 */
import { db } from "../index";
import {
  environments,
  environmentVariables,
  baselines,
  repoCredentials,
  sutConnectors,
} from "../schema";
import type { Environment, EnvironmentVariable, Baseline } from "../schema";
import { eq, and, isNull, desc, asc } from "drizzle-orm";
import { v4 as uuid } from "uuid";

/** Environments of a repo, default first, then by explicit order. */
export async function listEnvironments(
  repositoryId: string,
): Promise<Environment[]> {
  return db
    .select()
    .from(environments)
    .where(eq(environments.repositoryId, repositoryId))
    .orderBy(
      desc(environments.isDefault),
      asc(environments.sortOrder),
      asc(environments.label),
    );
}

export async function getEnvironment(
  id: string,
): Promise<Environment | undefined> {
  const [row] = await db
    .select()
    .from(environments)
    .where(eq(environments.id, id));
  return row;
}

export async function getEnvironmentByKey(
  repositoryId: string,
  key: string,
): Promise<Environment | undefined> {
  const [row] = await db
    .select()
    .from(environments)
    .where(
      and(
        eq(environments.repositoryId, repositoryId),
        eq(environments.key, key),
      ),
    );
  return row;
}

/**
 * The environment a run should use when the caller named none.
 *
 * Returns `undefined` rather than inventing one — a repo with no environments
 * runs unscoped, which is the pre-B2 path and must stay reachable.
 */
export async function getDefaultEnvironment(
  repositoryId: string,
): Promise<Environment | undefined> {
  const [flagged] = await db
    .select()
    .from(environments)
    .where(
      and(
        eq(environments.repositoryId, repositoryId),
        eq(environments.isDefault, true),
      ),
    );
  if (flagged) return flagged;
  // A repo can end up with environments but no default (the default was
  // deleted). Falling back to the first is better than running unscoped, which
  // would silently compare a UAT run against PROD baselines.
  const [first] = await listEnvironments(repositoryId);
  return first;
}

export async function createEnvironment(data: {
  repositoryId: string;
  key: string;
  label: string;
  description?: string | null;
  baseUrl?: string | null;
  releaseLabel?: string | null;
  isDefault?: boolean;
  sortOrder?: number;
  createdBy?: string | null;
}): Promise<{ id: string }> {
  const id = uuid();
  const now = new Date();
  await db.insert(environments).values({
    id,
    repositoryId: data.repositoryId,
    key: data.key,
    label: data.label,
    description: data.description ?? null,
    baseUrl: data.baseUrl ?? null,
    releaseLabel: data.releaseLabel ?? null,
    isDefault: data.isDefault ?? false,
    sortOrder: data.sortOrder ?? 0,
    createdBy: data.createdBy ?? null,
    createdAt: now,
    updatedAt: now,
  });
  if (data.isDefault) await setDefaultEnvironment(data.repositoryId, id);
  return { id };
}

export async function updateEnvironment(
  id: string,
  data: {
    label?: string;
    description?: string | null;
    baseUrl?: string | null;
    releaseLabel?: string | null;
    sortOrder?: number;
  },
): Promise<void> {
  // `key` is deliberately absent: it is the value stored on every baseline this
  // environment owns, so renaming it would orphan them all. The UI edits
  // `label`.
  const patch: Partial<typeof environments.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (data.label !== undefined) patch.label = data.label;
  if (data.description !== undefined) patch.description = data.description;
  if (data.baseUrl !== undefined) patch.baseUrl = data.baseUrl;
  if (data.releaseLabel !== undefined) patch.releaseLabel = data.releaseLabel;
  if (data.sortOrder !== undefined) patch.sortOrder = data.sortOrder;
  await db.update(environments).set(patch).where(eq(environments.id, id));
}

/** Exactly one default per repo — clear the others in the same call. */
export async function setDefaultEnvironment(
  repositoryId: string,
  id: string,
): Promise<void> {
  await db
    .update(environments)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(eq(environments.repositoryId, repositoryId));
  await db
    .update(environments)
    .set({ isDefault: true, updatedAt: new Date() })
    .where(eq(environments.id, id));
}

/**
 * Delete an environment.
 *
 * Its connectors and variables cascade away with it; its CREDENTIALS do not —
 * `repo_credentials.environmentId` is `set null`, so those logins reappear as
 * repo-wide rather than vanishing. Baselines keep their `environmentKey` string
 * and simply stop matching, which is recoverable by recreating the environment
 * with the same key. Deleting is not a way to lose approvals.
 */
export async function deleteEnvironment(id: string): Promise<void> {
  await db.delete(environments).where(eq(environments.id, id));
}

/**
 * Record that a sandbox was refreshed.
 *
 * Baselines are NOT touched. That is the survival property: nothing in a
 * baseline's key — test, step, environment, browser, cell — changes when a
 * sandbox is refreshed, so every approval carries over. What a refresh does
 * change is record ids, which is why they belong in `environment_variables`
 * rather than in test bodies. The timestamp exists so Review can label the
 * resulting wave of diffs as a refresh rather than a regression.
 */
export async function recordEnvironmentRefresh(
  id: string,
  note?: string | null,
): Promise<void> {
  await db
    .update(environments)
    .set({
      refreshedAt: new Date(),
      refreshNote: note ?? null,
      updatedAt: new Date(),
    })
    .where(eq(environments.id, id));
}

// ── Environment variables ───────────────────────────────────────────────────

export async function listEnvironmentVariables(
  environmentId: string,
): Promise<EnvironmentVariable[]> {
  return db
    .select()
    .from(environmentVariables)
    .where(eq(environmentVariables.environmentId, environmentId))
    .orderBy(asc(environmentVariables.key));
}

/** `{ docId: '0PL000000000123' }` — merged into the substitution map at run. */
export async function getEnvironmentVariableMap(
  environmentId: string,
): Promise<Record<string, string>> {
  const rows = await listEnvironmentVariables(environmentId);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function upsertEnvironmentVariable(data: {
  environmentId: string;
  key: string;
  value: string;
  description?: string | null;
}): Promise<void> {
  const now = new Date();
  await db
    .insert(environmentVariables)
    .values({
      id: uuid(),
      environmentId: data.environmentId,
      key: data.key,
      value: data.value,
      description: data.description ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [environmentVariables.environmentId, environmentVariables.key],
      set: {
        value: data.value,
        description: data.description ?? null,
        updatedAt: now,
      },
    });
}

export async function deleteEnvironmentVariable(id: string): Promise<void> {
  await db.delete(environmentVariables).where(eq(environmentVariables.id, id));
}

// ── Baseline promotion ──────────────────────────────────────────────────────

export interface PromotionOutcome {
  promoted: number;
  superseded: number;
}

/**
 * Copy the active baselines of one environment onto another.
 *
 * The UAT-signed-off-so-PROD-should-expect-this operation. Two properties worth
 * stating:
 *
 *  - The PNG is SHARED, not copied. `imagePath` and `imageHash` are carried
 *    across, because the promoted baseline is the same image by definition and
 *    duplicating blobs to express that would cost storage and break the
 *    carry-forward hash matching.
 *  - The target's existing baseline for the same (test, step, browser, cell) is
 *    DEACTIVATED, not deleted. A promotion a customer regrets has to be
 *    reversible, and in a regulated segment nothing about an approval should be
 *    destructive.
 *
 * `fromKey`/`toKey` are `environments.key` values; `null` means the
 * repo-wide/unscoped baselines, so promoting an existing single-environment
 * repo's approvals into its first named environment works with no special case.
 */
export async function promoteBaselines(
  repositoryId: string,
  fromKey: string | null,
  toKey: string,
  opts: { browser?: string; promotedBy?: string | null } = {},
): Promise<PromotionOutcome> {
  if (fromKey === toKey) {
    throw new Error("Source and target environment must differ");
  }

  const source = await db
    .select()
    .from(baselines)
    .where(
      and(
        eq(baselines.repositoryId, repositoryId),
        eq(baselines.isActive, true),
        fromKey
          ? eq(baselines.environmentKey, fromKey)
          : isNull(baselines.environmentKey),
        ...(opts.browser ? [eq(baselines.browser, opts.browser)] : []),
      ),
    );
  if (source.length === 0) return { promoted: 0, superseded: 0 };

  const existing = await db
    .select()
    .from(baselines)
    .where(
      and(
        eq(baselines.repositoryId, repositoryId),
        eq(baselines.isActive, true),
        eq(baselines.environmentKey, toKey),
      ),
    );

  // (test, step, browser, cell) is the identity a promotion supersedes — the
  // same tuple `getActiveBaseline` resolves on, minus the environment we are
  // writing.
  const slot = (b: Baseline) =>
    [b.testId, b.stepLabel ?? "", b.browser ?? "", b.dataCell ?? ""].join(" ");
  const supersede = new Map(existing.map((b) => [slot(b), b]));

  const now = new Date();
  let superseded = 0;
  const rows: Array<typeof baselines.$inferInsert> = [];

  for (const b of source) {
    const clash = supersede.get(slot(b));
    if (clash) {
      await db
        .update(baselines)
        .set({ isActive: false })
        .where(eq(baselines.id, clash.id));
      superseded += 1;
    }
    rows.push({
      id: uuid(),
      repositoryId: b.repositoryId,
      testId: b.testId,
      stepLabel: b.stepLabel,
      imagePath: b.imagePath,
      imageHash: b.imageHash,
      approvedFromDiffId: b.approvedFromDiffId,
      branch: b.branch,
      isActive: true,
      browser: b.browser,
      dataCell: b.dataCell,
      environmentKey: toKey,
      domSnapshot: b.domSnapshot,
      createdAt: now,
    });
  }

  if (rows.length > 0) await db.insert(baselines).values(rows);
  return { promoted: rows.length, superseded };
}

// ── Cross-table reads the environment screen needs ──────────────────────────

/** Counts shown on an environment card: how much is actually attached to it. */
export async function getEnvironmentUsage(environmentId: string): Promise<{
  connectors: number;
  credentials: number;
  variables: number;
}> {
  const [conns, creds, vars] = await Promise.all([
    db
      .select({ id: sutConnectors.id })
      .from(sutConnectors)
      .where(eq(sutConnectors.environmentId, environmentId)),
    db
      .select({ id: repoCredentials.id })
      .from(repoCredentials)
      .where(eq(repoCredentials.environmentId, environmentId)),
    db
      .select({ id: environmentVariables.id })
      .from(environmentVariables)
      .where(eq(environmentVariables.environmentId, environmentId)),
  ]);
  return {
    connectors: conns.length,
    credentials: creds.length,
    variables: vars.length,
  };
}
