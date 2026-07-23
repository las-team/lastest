import type { ExplorerStyle } from "@/lib/db/schema";

/**
 * Planning styles (explorbot's normal/curious/psycho): prompt fragments that
 * steer the scenario planner toward a different coverage angle each loop
 * iteration. Styles rotate — iteration i uses rotation[i % rotation.length].
 */

export const ALL_STYLES: ExplorerStyle[] = ["normal", "curious", "psycho"];

export const STYLE_FRAGMENTS: Record<ExplorerStyle, string> = {
  normal: `STYLE: NORMAL — complete user workflows.
Plan the flows a real user runs daily: CRUD operations and full commit flows
that end in a data or state change (create the record, submit the form, save
the setting). Every scenario must drive to a verifiable outcome — a success
message, a new row in a list, a changed value — not just page visits.`,
  curious: `STYLE: CURIOUS — coverage gaps and less-obvious paths.
Hunt for what earlier scenarios and existing tests missed: secondary buttons,
bulk/batch actions, filters and sorting, pagination edges, empty states,
cancel/back mid-flow, keyboard-only interaction, deep links. Prefer paths that
combine two features (filter THEN edit, search THEN bulk-select).`,
  psycho: `STYLE: PSYCHO — adversarial inputs and stress.
Feed every reachable control hostile input, then COMMIT the form: empty
required fields, absurdly long strings (500+ chars), HTML/script fragments
("<b>x</b>", "'; DROP"), negative and huge numbers, unicode/emoji, past dates
where future is expected, double-submits, rapid repeated clicks. The app must
respond with graceful validation — crashes, raw error pages, silent data
corruption, or unhandled console errors are findings.`,
};

/** Style for iteration i under the given rotation (wraps; safe fallbacks). */
export function nextStyle(
  rotation: ExplorerStyle[] | undefined,
  iteration: number,
): ExplorerStyle {
  const order =
    rotation && rotation.length > 0
      ? rotation.filter((s): s is ExplorerStyle => s in STYLE_FRAGMENTS)
      : ALL_STYLES;
  const effective = order.length > 0 ? order : ALL_STYLES;
  return effective[
    ((iteration % effective.length) + effective.length) % effective.length
  ];
}

/** Parse the persisted comma-separated rotation setting ("normal,psycho"). */
export function parseStyleRotation(
  raw: string | null | undefined,
): ExplorerStyle[] {
  if (!raw) return ALL_STYLES;
  const parsed = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is ExplorerStyle => s in STYLE_FRAGMENTS);
  return parsed.length > 0 ? parsed : ALL_STYLES;
}
