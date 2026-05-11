/**
 * Per-layer baseline queries (Verify phase, v1.14+).
 *
 * One module per layer kind; each table mirrors the visual-diff `baselines`
 * table with a layer-specific JSON payload. Branch-scoped (per-branch
 * baselines, with `main` as the implicit fallback).
 */

import { db } from '../index';
import {
  networkBaselines,
  consoleBaselines,
  a11yBaselines,
  perfBaselines,
  variableBaselines,
  urlTrajectoryBaselines,
  domBaselines,
} from '../schema';
import type {
  NetworkBaseline,
  ConsoleBaseline,
  A11yBaseline,
  PerfBaseline,
  VariableBaseline,
  UrlTrajectoryBaseline,
  DomBaseline,
  NetworkBaselinePayload,
  ConsoleBaselinePayload,
  A11yBaselinePayload,
  PerfBaselinePayload,
  VariableBaselinePayload,
  UrlTrajectoryBaselinePayload,
  DomBaselinePayload,
  LayerBaselineKind,
} from '../schema';
import { eq, and } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

interface CreateBaselineInput<T> {
  testId: string;
  stepLabel: string | null;
  branch: string;
  approvedFromComparisonId?: string | null;
  approvedBy?: string | null;
  payload: T;
}

export async function listActiveNetworkBaselines(testId: string, branch: string): Promise<NetworkBaseline[]> {
  return db.select().from(networkBaselines).where(
    and(eq(networkBaselines.testId, testId), eq(networkBaselines.branch, branch), eq(networkBaselines.isActive, true)),
  );
}

export async function listActiveConsoleBaselines(testId: string, branch: string): Promise<ConsoleBaseline[]> {
  return db.select().from(consoleBaselines).where(
    and(eq(consoleBaselines.testId, testId), eq(consoleBaselines.branch, branch), eq(consoleBaselines.isActive, true)),
  );
}

export async function listActiveA11yBaselines(testId: string, branch: string): Promise<A11yBaseline[]> {
  return db.select().from(a11yBaselines).where(
    and(eq(a11yBaselines.testId, testId), eq(a11yBaselines.branch, branch), eq(a11yBaselines.isActive, true)),
  );
}

export async function listActivePerfBaselines(testId: string, branch: string): Promise<PerfBaseline[]> {
  return db.select().from(perfBaselines).where(
    and(eq(perfBaselines.testId, testId), eq(perfBaselines.branch, branch), eq(perfBaselines.isActive, true)),
  );
}

export async function listActiveVariableBaselines(testId: string, branch: string): Promise<VariableBaseline[]> {
  return db.select().from(variableBaselines).where(
    and(eq(variableBaselines.testId, testId), eq(variableBaselines.branch, branch), eq(variableBaselines.isActive, true)),
  );
}

export async function listActiveUrlTrajectoryBaselines(testId: string, branch: string): Promise<UrlTrajectoryBaseline[]> {
  return db.select().from(urlTrajectoryBaselines).where(
    and(eq(urlTrajectoryBaselines.testId, testId), eq(urlTrajectoryBaselines.branch, branch), eq(urlTrajectoryBaselines.isActive, true)),
  );
}

export async function listActiveDomBaselines(testId: string, branch: string): Promise<DomBaseline[]> {
  return db.select().from(domBaselines).where(
    and(eq(domBaselines.testId, testId), eq(domBaselines.branch, branch), eq(domBaselines.isActive, true)),
  );
}

export async function createNetworkBaseline(input: CreateBaselineInput<NetworkBaselinePayload>): Promise<NetworkBaseline> {
  const id = uuid();
  await db.insert(networkBaselines).values({ id, ...input, isActive: true, approvedAt: new Date() });
  const [row] = await db.select().from(networkBaselines).where(eq(networkBaselines.id, id));
  return row;
}

export async function createConsoleBaseline(input: CreateBaselineInput<ConsoleBaselinePayload>): Promise<ConsoleBaseline> {
  const id = uuid();
  await db.insert(consoleBaselines).values({ id, ...input, isActive: true, approvedAt: new Date() });
  const [row] = await db.select().from(consoleBaselines).where(eq(consoleBaselines.id, id));
  return row;
}

export async function createA11yBaseline(input: CreateBaselineInput<A11yBaselinePayload>): Promise<A11yBaseline> {
  const id = uuid();
  await db.insert(a11yBaselines).values({ id, ...input, isActive: true, approvedAt: new Date() });
  const [row] = await db.select().from(a11yBaselines).where(eq(a11yBaselines.id, id));
  return row;
}

export async function createPerfBaseline(input: CreateBaselineInput<PerfBaselinePayload>): Promise<PerfBaseline> {
  const id = uuid();
  await db.insert(perfBaselines).values({ id, ...input, isActive: true, approvedAt: new Date() });
  const [row] = await db.select().from(perfBaselines).where(eq(perfBaselines.id, id));
  return row;
}

export async function createVariableBaseline(input: CreateBaselineInput<VariableBaselinePayload>): Promise<VariableBaseline> {
  const id = uuid();
  await db.insert(variableBaselines).values({ id, ...input, isActive: true, approvedAt: new Date() });
  const [row] = await db.select().from(variableBaselines).where(eq(variableBaselines.id, id));
  return row;
}

export async function createUrlTrajectoryBaseline(input: Omit<CreateBaselineInput<UrlTrajectoryBaselinePayload>, 'stepLabel'>): Promise<UrlTrajectoryBaseline> {
  const id = uuid();
  await db.insert(urlTrajectoryBaselines).values({ id, ...input, isActive: true, approvedAt: new Date() });
  const [row] = await db.select().from(urlTrajectoryBaselines).where(eq(urlTrajectoryBaselines.id, id));
  return row;
}

export async function createDomBaseline(input: CreateBaselineInput<DomBaselinePayload>): Promise<DomBaseline> {
  const id = uuid();
  await db.insert(domBaselines).values({ id, ...input, isActive: true, approvedAt: new Date() });
  const [row] = await db.select().from(domBaselines).where(eq(domBaselines.id, id));
  return row;
}

export const LAYER_BASELINE_KINDS: readonly LayerBaselineKind[] = [
  'network',
  'console',
  'a11y',
  'perf',
  'variable',
  'url_trajectory',
  'dom',
] as const;
