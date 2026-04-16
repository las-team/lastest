# 21 — Gamification ("Beat the Bot")

## Summary

Competitive scoring layer where team members compete against AI bots on a leaderboard. Designed to encourage test quality (not test farming) with rewards heavily weighted toward verified outcomes.

## Schema

| Table | Purpose |
|-------|---------|
| `gamification_seasons` | Named seasons with start/end dates and active/ended status |
| `bug_blitz_events` | Time-boxed multiplier events (2–5×) linked to a season |
| `score_events` | Immutable log of every point award/penalty with actor, kind, source |
| `user_scores` | Denormalized running totals per actor per season for O(1) leaderboard reads |
| `achievements` | Unlocked milestones per actor per season |

Team-level toggle: `teams.gamification_enabled` (default `false`).

## Scoring Rules

| Event | Points | Notes |
|-------|--------|-------|
| `test_created` | +10 | Small to prevent test-farming |
| `diff_approved_as_change` | +15 | Approved real visual change |
| `regression_caught` | +100 | Test caught a real regression |
| `triage_resolved` | +5 | Resolved a review todo |
| `flake_penalty` | −5 | Flaky diff attributed to test (daily cap: 25 pts) |
| `achievement_bonus` | +25 | On first-time achievement unlock |

Bug Blitz multiplier applied at write time. Penalties scale with multiplier too.

## Achievements

- `first_test` — Created your first test
- `first_regression` — Caught your first regression
- `beat_bot_first` — Surpassed the bot score by 1+ points
- `beat_bot_by_100` — Surpassed the bot score by 100+ points
- `season_winner` — Ended the season in first place

## Key Files

| Path | Role |
|------|------|
| `src/lib/gamification/rules.ts` | Scoring constants, multiplier logic, beat-bot tiers |
| `src/lib/gamification/hooks.ts` | Post-insert hooks (e.g. `onTestCreated`) breaking query→auth cycle via dynamic import |
| `src/server/actions/gamification.ts` | `awardScore()` — core primitive, idempotent on (actor, kind, source) |
| `src/lib/db/queries/gamification.ts` | Season, leaderboard, score, achievement queries |
| `src/app/(app)/leaderboard/page.tsx` | Leaderboard page (server component) |
| `src/components/gamification/celebration-listener-client.tsx` | SSE-based celebratory toasts |
| `src/components/gamification/user-score-chip.tsx` | Inline score badge |
| `src/components/settings/gamification-toggle.tsx` | Team enable/disable toggle |
| `src/components/settings/gamification-admin-card.tsx` | Season + Bug Blitz management |

## UI

- **Leaderboard** (`/leaderboard`) — Top 10 ranked actors with podium styling, per-actor stat breakdown (tests, regressions, flakes), viewer's own row appended if outside top 10.
- **Celebration toasts** — Real-time sonner toasts on score events via the existing activity feed SSE stream. Deduped by event ID.
- **Score chip** — Small badge in sidebar showing current user's score.
- **Admin card** — Start/end seasons, create Bug Blitz events with custom multiplier and duration.

## Design Principles

1. **Rewards >> penalties** — Penalty is small and daily-capped.
2. **No "points for bugs found"** — Perverse incentive. Rewards tied to *verified* outcomes (approved changes, resolved todos).
3. **Test creation reward is small** — Prevents test-farming.
4. **Gamification never breaks real flows** — All hooks swallow errors.
5. **Auto-season** — A season is auto-created on first score award if none exists.
