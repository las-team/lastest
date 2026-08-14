/**
 * Interactive playback feature flag (spec 28).
 *
 * The "new player" — the step-annotated scrubber (per-step segment ticks with
 * action icons, click-to-seek, active-segment highlight), the Verify Run-pane
 * recording card, and the playback↔evidence sync that drives the chapter rail
 * — ships behind Early Adopter mode.
 *
 * Everything degrades by omission: surfaces simply don't pass `segments` to
 * `<VideoPlayer>` / `<ReplayPlayer>`, so teams without the flag get exactly the
 * plain player they had before spec 28. Verify's Run pane had no player at all
 * before the spec, so it renders none when the flag is off.
 *
 * Two ways to enable:
 *   - Per-team flag: teams.earlyAdopterMode = true
 *   - Env override:  INTERACTIVE_PLAYBACK_ENABLED=1 (turns it on for everyone)
 *
 * Mirrors `isVerifyPhaseEnabled()` in `@/lib/verify/feature-flag`.
 */

export function isInteractivePlaybackEnabled(
  team?: { earlyAdopterMode?: boolean | null } | null | undefined,
): boolean {
  if (
    process.env.INTERACTIVE_PLAYBACK_ENABLED === "1" ||
    process.env.INTERACTIVE_PLAYBACK_ENABLED === "true"
  ) {
    return true;
  }
  return team?.earlyAdopterMode ?? false;
}
