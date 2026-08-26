"use server";

import type { A11yBaselinePayload } from "@lastest/eb-protocol";

import { orm } from "./data/db";
import * as q from "./data/queries";
import { a11yPlugin } from "./index";
import type { A11yBaseline } from "./schema";
import { a11yWiring } from "./wiring";

/**
 * The a11y plugin's write/read surface for its own baselines.
 *
 * Called by core's `src/server/actions/layer-feedback.ts`, which owns the
 * per-layer approve/reject/snooze verb across all seven layer kinds and now
 * routes its `a11y` case here instead of writing the table directly.
 *
 * `repositoryId` is the only scoping the caller supplies; `teamId` comes from
 * the resolved `ctx`, never from the caller — the tenancy argument in
 * `core-scope.md` §6, the same reason a provider plugin attributes events
 * from `ProviderScope` rather than from what the consumer claims.
 */

async function scopedDb(repositoryId: string) {
  const { runtime } = a11yWiring();
  const ctx = await runtime.contextFor(a11yPlugin, { repositoryId });
  return { db: orm(ctx.data), teamId: ctx.team.id };
}

export async function createA11yBaseline(input: {
  repositoryId: string;
  testId: string;
  stepLabel: string | null;
  branch: string;
  approvedFromComparisonId?: string | null;
  approvedBy?: string | null;
  payload: A11yBaselinePayload;
}): Promise<A11yBaseline> {
  const { db, teamId } = await scopedDb(input.repositoryId);
  return q.createA11yBaseline(db, {
    testId: input.testId,
    repositoryId: input.repositoryId,
    teamId,
    stepLabel: input.stepLabel,
    branch: input.branch,
    approvedFromComparisonId: input.approvedFromComparisonId ?? null,
    approvedBy: input.approvedBy ?? null,
    payload: input.payload,
  });
}

export async function listActiveA11yBaselines(input: {
  repositoryId: string;
  testId: string;
  branch: string;
}): Promise<A11yBaseline[]> {
  const { db } = await scopedDb(input.repositoryId);
  return q.listActiveA11yBaselines(db, input.testId, input.branch);
}
