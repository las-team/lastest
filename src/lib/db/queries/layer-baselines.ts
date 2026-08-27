/**
 * Per-layer baseline queries (Verify phase, v1.14+).
 *
 * One module per layer kind; each table mirrors the visual-diff `baselines`
 * table with a layer-specific JSON payload. Branch-scoped (per-branch
 * baselines, with `main` as the implicit fallback).
 *
 * The `a11y` slice is gone from here: `a11y_baselines` is owned by
 * `@lastest/plugin-a11y` (RFC §9 phase 3) and reached through its own
 * actions. `LAYER_BASELINE_KINDS` below still lists `"a11y"` — that is core's
 * evidence-layer vocabulary, not a claim to the table.
 */

import { db } from "../index";
import {
  networkBaselines,
  consoleBaselines,
  perfBaselines,
  variableBaselines,
  urlTrajectoryBaselines,
  domBaselines,
} from "../schema";
import type {
  NetworkBaseline,
  ConsoleBaseline,
  PerfBaseline,
  VariableBaseline,
  UrlTrajectoryBaseline,
  DomBaseline,
  NetworkBaselinePayload,
  ConsoleBaselinePayload,
  PerfBaselinePayload,
  VariableBaselinePayload,
  UrlTrajectoryBaselinePayload,
  DomBaselinePayload,
  LayerBaselineKind,
} from "../schema";
import { eq, and, isNull } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { v4 as uuid } from "uuid";

interface CreateBaselineInput<T> {
  testId: string;
  stepLabel: string | null;
  branch: string;
  /** B2: the environment this approval belongs to. NULL = every environment. */
  environmentKey?: string | null;
  approvedFromComparisonId?: string | null;
  approvedBy?: string | null;
  payload: T;
}

/**
 * The six layer-baseline tables share a shape, so they share their read.
 *
 * Environment fallback is all-or-nothing per table, not per row: if this
 * environment has approved layer baselines, they are the complete answer;
 * otherwise the unscoped set is. Merging the two would produce a set that was
 * never approved as a whole — for the network and console layers especially,
 * a half-UAT half-unscoped allowlist is a verdict nobody signed off on.
 */
async function listActiveLayerBaselines<R>(
  columns: {
    testId: AnyPgColumn;
    branch: AnyPgColumn;
    isActive: AnyPgColumn;
    environmentKey: AnyPgColumn;
  },
  testId: string,
  branch: string,
  environmentKey: string | null | undefined,
  run: (cond: ReturnType<typeof and>) => Promise<R[]>,
): Promise<R[]> {
  const base = [
    eq(columns.testId, testId),
    eq(columns.branch, branch),
    eq(columns.isActive, true),
  ];
  if (environmentKey) {
    const scoped = await run(
      and(...base, eq(columns.environmentKey, environmentKey)),
    );
    if (scoped.length > 0) return scoped;
  }
  return run(and(...base, isNull(columns.environmentKey)));
}

export async function listActiveNetworkBaselines(
  testId: string,
  branch: string,
  environmentKey?: string | null,
): Promise<NetworkBaseline[]> {
  return listActiveLayerBaselines(
    networkBaselines,
    testId,
    branch,
    environmentKey,
    (cond) => db.select().from(networkBaselines).where(cond),
  );
}

export async function listActiveConsoleBaselines(
  testId: string,
  branch: string,
  environmentKey?: string | null,
): Promise<ConsoleBaseline[]> {
  return listActiveLayerBaselines(
    consoleBaselines,
    testId,
    branch,
    environmentKey,
    (cond) => db.select().from(consoleBaselines).where(cond),
  );
}

export async function listActivePerfBaselines(
  testId: string,
  branch: string,
  environmentKey?: string | null,
): Promise<PerfBaseline[]> {
  return listActiveLayerBaselines(
    perfBaselines,
    testId,
    branch,
    environmentKey,
    (cond) => db.select().from(perfBaselines).where(cond),
  );
}

export async function listActiveVariableBaselines(
  testId: string,
  branch: string,
  environmentKey?: string | null,
): Promise<VariableBaseline[]> {
  return listActiveLayerBaselines(
    variableBaselines,
    testId,
    branch,
    environmentKey,
    (cond) => db.select().from(variableBaselines).where(cond),
  );
}

export async function listActiveUrlTrajectoryBaselines(
  testId: string,
  branch: string,
  environmentKey?: string | null,
): Promise<UrlTrajectoryBaseline[]> {
  return listActiveLayerBaselines(
    urlTrajectoryBaselines,
    testId,
    branch,
    environmentKey,
    (cond) => db.select().from(urlTrajectoryBaselines).where(cond),
  );
}

export async function listActiveDomBaselines(
  testId: string,
  branch: string,
  environmentKey?: string | null,
): Promise<DomBaseline[]> {
  return listActiveLayerBaselines(
    domBaselines,
    testId,
    branch,
    environmentKey,
    (cond) => db.select().from(domBaselines).where(cond),
  );
}

export async function createNetworkBaseline(
  input: CreateBaselineInput<NetworkBaselinePayload>,
): Promise<NetworkBaseline> {
  const id = uuid();
  await db
    .insert(networkBaselines)
    .values({ id, ...input, isActive: true, approvedAt: new Date() });
  const [row] = await db
    .select()
    .from(networkBaselines)
    .where(eq(networkBaselines.id, id));
  return row;
}

export async function createConsoleBaseline(
  input: CreateBaselineInput<ConsoleBaselinePayload>,
): Promise<ConsoleBaseline> {
  const id = uuid();
  await db
    .insert(consoleBaselines)
    .values({ id, ...input, isActive: true, approvedAt: new Date() });
  const [row] = await db
    .select()
    .from(consoleBaselines)
    .where(eq(consoleBaselines.id, id));
  return row;
}

export async function createPerfBaseline(
  input: CreateBaselineInput<PerfBaselinePayload>,
): Promise<PerfBaseline> {
  const id = uuid();
  await db
    .insert(perfBaselines)
    .values({ id, ...input, isActive: true, approvedAt: new Date() });
  const [row] = await db
    .select()
    .from(perfBaselines)
    .where(eq(perfBaselines.id, id));
  return row;
}

export async function createVariableBaseline(
  input: CreateBaselineInput<VariableBaselinePayload>,
): Promise<VariableBaseline> {
  const id = uuid();
  await db
    .insert(variableBaselines)
    .values({ id, ...input, isActive: true, approvedAt: new Date() });
  const [row] = await db
    .select()
    .from(variableBaselines)
    .where(eq(variableBaselines.id, id));
  return row;
}

export async function createUrlTrajectoryBaseline(
  input: Omit<CreateBaselineInput<UrlTrajectoryBaselinePayload>, "stepLabel">,
): Promise<UrlTrajectoryBaseline> {
  const id = uuid();
  await db
    .insert(urlTrajectoryBaselines)
    .values({ id, ...input, isActive: true, approvedAt: new Date() });
  const [row] = await db
    .select()
    .from(urlTrajectoryBaselines)
    .where(eq(urlTrajectoryBaselines.id, id));
  return row;
}

export async function createDomBaseline(
  input: CreateBaselineInput<DomBaselinePayload>,
): Promise<DomBaseline> {
  const id = uuid();
  await db
    .insert(domBaselines)
    .values({ id, ...input, isActive: true, approvedAt: new Date() });
  const [row] = await db
    .select()
    .from(domBaselines)
    .where(eq(domBaselines.id, id));
  return row;
}

export const LAYER_BASELINE_KINDS: readonly LayerBaselineKind[] = [
  "network",
  "console",
  "a11y",
  "perf",
  "variable",
  "url_trajectory",
  "dom",
] as const;
