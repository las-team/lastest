/**
 * Scoring rules for the "Beat the Bot" gamification layer.
 *
 * Design principles (informed by ACM survey on gamification pitfalls):
 *  - Rewards >> penalties. Penalty kept small & daily-capped.
 *  - No direct "points for bugs found" — bug-hunting for its own sake is a
 *    textbook perverse incentive. Big rewards are tied to *verified* outcomes
 *    (approved changes, resolved review todos).
 *  - Test creation reward is intentionally small to prevent test-farming.
 *
 * Multipliers (during Bug Blitz) are applied in awardScore at write time.
 */

import type { ScoreEventKind } from '@/lib/db/schema';

export interface ScoreRule {
  /** Base point delta (pre-multiplier). Negative = penalty. */
  base: number;
  /** Human-readable reason used in activity copy & tooltips. */
  reason: string;
  /** If set, at most `dailyCap` points of this kind can be earned per actor per day (abs value). */
  dailyCap?: number;
  /** Achievement code to unlock on first occurrence, if any. */
  firstTimeAchievement?: 'first_test' | 'first_regression';
}

export const SCORE_RULES: Record<ScoreEventKind, ScoreRule> = {
  test_created: {
    base: 10,
    reason: 'Created a test',
    firstTimeAchievement: 'first_test',
  },
  diff_approved_as_change: {
    base: 15,
    reason: 'Approved a real visual change',
  },
  regression_caught: {
    base: 100,
    reason: 'Your test caught a real regression',
    firstTimeAchievement: 'first_regression',
  },
  triage_resolved: {
    base: 5,
    reason: 'Resolved a review todo',
  },
  flake_penalty: {
    base: -5,
    reason: 'Flaky diff attributed to your test',
    dailyCap: 25, // max 25 points of penalty per actor per day
  },
  achievement_bonus: {
    base: 25,
    reason: 'Achievement unlocked',
  },
} as const;

/** Compute the final delta for a rule given an active bug-blitz multiplier (×100, e.g. 200 = 2×). */
export function applyMultiplier(base: number, multiplier: number): number {
  if (multiplier === 100) return base;
  // Round toward zero so a 2× on −5 stays −10, a 2× on +15 becomes +30.
  const signed = Math.trunc((base * multiplier) / 100);
  return signed;
}

/** Threshold points-over-bot for the beat-the-bot achievement tiers. */
export const BEAT_BOT_TIERS = [
  { code: 'beat_bot_first' as const, minMargin: 1, label: 'First blood' },
  { code: 'beat_bot_by_100' as const, minMargin: 100, label: 'Crushed the bot' },
] as const;
