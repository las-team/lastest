/**
 * Per-layer step-feedback queries (Verify phase, v1.14+).
 *
 * One row per (stepComparisonId, layer) capturing the reviewer's decision:
 * pending | approved | rejected | snoozed | auto_approved.
 */

import { db } from '../index';
import { stepLayerFeedback } from '../schema';
import type {
  StepLayerFeedback,
  NewStepLayerFeedback,
  EvidenceLayer,
  LayerFeedbackStatus,
  LayerBaselineKind,
  AIDiffRecommendation,
} from '../schema';
import { eq, and } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

export async function getLayerFeedback(stepComparisonId: string, layer: EvidenceLayer): Promise<StepLayerFeedback | undefined> {
  const [row] = await db
    .select()
    .from(stepLayerFeedback)
    .where(and(eq(stepLayerFeedback.stepComparisonId, stepComparisonId), eq(stepLayerFeedback.layer, layer)));
  return row;
}

export async function getLayerFeedbackByStep(stepComparisonId: string): Promise<StepLayerFeedback[]> {
  return db
    .select()
    .from(stepLayerFeedback)
    .where(eq(stepLayerFeedback.stepComparisonId, stepComparisonId));
}

export async function getLayerFeedbackByBuild(buildId: string): Promise<StepLayerFeedback[]> {
  return db
    .select()
    .from(stepLayerFeedback)
    .where(eq(stepLayerFeedback.buildId, buildId));
}

interface UpsertInput {
  stepComparisonId: string;
  buildId: string;
  layer: EvidenceLayer;
  status: LayerFeedbackStatus;
  baselineKind?: LayerBaselineKind | null;
  reviewTodoId?: string | null;
  note?: string | null;
  decidedBy?: string | null;
  aiRecommendation?: AIDiffRecommendation | null;
}

export async function upsertLayerFeedback(input: UpsertInput): Promise<StepLayerFeedback> {
  const existing = await getLayerFeedback(input.stepComparisonId, input.layer);
  if (existing) {
    await db
      .update(stepLayerFeedback)
      .set({
        status: input.status,
        baselineKind: input.baselineKind ?? null,
        reviewTodoId: input.reviewTodoId ?? null,
        note: input.note ?? null,
        decidedBy: input.decidedBy ?? null,
        decidedAt: new Date(),
        aiRecommendation: input.aiRecommendation ?? null,
      })
      .where(eq(stepLayerFeedback.id, existing.id));
    const [row] = await db.select().from(stepLayerFeedback).where(eq(stepLayerFeedback.id, existing.id));
    return row;
  }
  const id = uuid();
  const insert: NewStepLayerFeedback = {
    id,
    stepComparisonId: input.stepComparisonId,
    buildId: input.buildId,
    layer: input.layer,
    status: input.status,
    baselineKind: input.baselineKind ?? null,
    reviewTodoId: input.reviewTodoId ?? null,
    note: input.note ?? null,
    decidedBy: input.decidedBy ?? null,
    decidedAt: new Date(),
    aiRecommendation: input.aiRecommendation ?? null,
  };
  await db.insert(stepLayerFeedback).values(insert);
  const [row] = await db.select().from(stepLayerFeedback).where(eq(stepLayerFeedback.id, id));
  return row;
}
