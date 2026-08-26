/**
 * Shared derivation of the facts a demo (QuickStart) share presents, used by
 * BOTH the OG card (`/api/og/share/[slug]`) and the public share page (`/r/[slug]`)
 * so the unfurl and the page can never disagree (the "consistency invariant" in
 * the share presentation spec §1/§2).
 *
 * We deliberately avoid a `public_shares.meta` column: everything here is derived
 * from data already loaded into `ShareData`. Inputs are loosely typed so this
 * stays decoupled from the query layer and unit-testable.
 */

export interface ShareFactsInput {
  results?: Array<{
    durationMs?: number | null;
    screenshots?: unknown[] | null;
  }> | null;
  diffs?: Array<{
    pixelDifference?: number | null;
    baselineImagePath?: string | null;
    currentImagePath?: string | null;
  }> | null;
  // Positive "authenticated walkthrough" signal: a QuickStart run that captured
  // auth wires the walkthrough test to a login-setup test (test.setupTestId) or
  // a build-level setup (build.buildSetupTestId). Absent → we do NOT claim
  // "authenticated" (conservative: never over-claim a public-only run).
  test?: { setupTestId?: string | null } | null;
  build?: { buildSetupTestId?: string | null } | null;
}

export interface ShareFacts {
  /** Captured screenshots of the primary walkthrough result. */
  steps: number;
  durationMs: number | null;
  /** Human duration, e.g. "2m 00s" / "46s"; null when unknown. */
  duration: string | null;
  authed: boolean;
  /**
   * Count of visual diffs that represent a real, renderable change. Matches the
   * predicate the page uses to build its "N visual changes" sliders so the OG
   * headline number equals the page's section count.
   */
  changeCount: number;
}

/** A visual diff worth rendering as a before/after: real pixel delta AND both
 *  frames present. Single source of truth for the "N visual changes" count. */
export function hasRenderableVisualChange(d: {
  pixelDifference?: number | null;
  baselineImagePath?: string | null;
  currentImagePath?: string | null;
}): boolean {
  return (
    (d.pixelDifference ?? 0) > 0 &&
    !!d.baselineImagePath &&
    !!d.currentImagePath
  );
}

export function formatShareDuration(
  ms: number | null | undefined,
): string | null {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return null;
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}

export function deriveShareFacts(input: ShareFactsInput): ShareFacts {
  const results = input.results ?? [];
  // Primary walkthrough = the result with the most captured screenshots.
  let primary = results[0] ?? null;
  for (const r of results) {
    if ((r.screenshots?.length ?? 0) > (primary?.screenshots?.length ?? 0)) {
      primary = r;
    }
  }
  const steps = primary?.screenshots?.length ?? 0;
  const durationMs = primary?.durationMs ?? null;
  const authed = Boolean(
    input.test?.setupTestId || input.build?.buildSetupTestId,
  );
  const changeCount = (input.diffs ?? []).filter(
    hasRenderableVisualChange,
  ).length;
  return {
    steps,
    durationMs,
    duration: formatShareDuration(durationMs),
    authed,
    changeCount,
  };
}
