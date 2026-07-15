# Feature Spec: Verify Review Screen — Evidence UX Upgrades

## Overview

Upgrades the Verify focus mode (`/verify/[buildId]`) from a "read the layer verdicts" screen into a full evidence-inspection surface, adopting the report-UX patterns from best-in-class E2E report tools (tabbed evidence report synchronized with playback, per-step action metadata, filterable network/perf/state panes) while keeping Lastest's baseline-vs-current review model untouched: case statuses (Verified/Missed/Broken), per-layer decisions via `decideLayer`, and check modes all stay exactly as they are.

This spec covers the review-screen changes only. The interactive video player it embeds (step-annotated scrubber, playback↔evidence sync bus) is specified separately in `docs/specs/28-interactive-test-playback.md` and referenced here as a dependency.

## Current state

- `src/app/(app)/verify/[buildId]/focus-view.tsx` (~6550 lines) renders a 12-tab evidence strip — `COMPARE_TABS` (focus-view.tsx:182): Run / Visual / Text / DOM / Network / Console / A11y / Design / Perf / URL / Variables / API — with per-tab tone dots from `classifyLayer` + check modes (`src/lib/verify/check-modes.ts`).
- Board mode lives in `board-view.tsx`; live data via `/api/builds/[buildId]/verify-status` (2s poll); decisions via `decideLayer` (`src/server/actions/layer-feedback.ts:69`).
- There is **no video playback anywhere in verify or builds pages** — players exist only in test-detail and the `/r/` share page.
- Evidence available on `test_results` (`src/lib/db/schema.ts`): `screenshots` (`CapturedScreenshot[]`, schema.ts:887 — `atMs` video offset at schema.ts:535 is the only persisted step→video anchor), `consoleErrors` (`string[]`, schema.ts:893 — no timestamps), `networkRequests` (`NetworkRequest[]`, schema.ts:894 — absolute-epoch `startTime`), `videoPath` (schema.ts:919), `urlTrajectory` (schema.ts:942), `webVitals` (schema.ts:944), `storageStateSnapshot` (schema.ts:946).
- `step_comparisons` rows carry the per-step verdict + per-layer sub-summaries but **no timing fields**.

## 1. Tab strip upgrades

- **Per-tab change counts** next to the existing tone dots: `Network (3)`, `Console (2)`, `A11y (5)`. Counts come from the `step_comparisons.layers` sub-summaries already in the verify-status payload (added/removed/changed item counts per layer), summed across the selected case's steps — computed client-side, no new queries.
- Counts respect check modes: a layer in `disable` mode shows no count (matching how its tone dot is already muted); `log` layers show counts in the muted style.
- **Keyboard tab cycling**: `[` / `]` (or `Tab`/`Shift+Tab` within the strip) cycles `COMPARE_TABS`; existing shortcut help overlay gains the entries.

## 2. Step detail header

A per-step action-metadata panel at the top of focus mode (above the pane content), showing for the selected step:

- Step kind badge + natural-language label (from the step's `CapturedScreenshot.label`/`title`, schema.ts:526).
- Duration **and video time range** (`0:10.1 → 0:17.9`) sourced from spec 28's `stepTimings` (`test_results.step_timings`); hidden for legacy rows without timings.
- Target descriptor + click coordinates when the step logs carry them (EB runs populate `test_results.logs`, schema.ts:914 — `[Nav]`/`[Shot]` probe lines; selector/coords parsed best-effort, omitted otherwise).
- A cropped "component interacted" thumbnail: the step screenshot cropped around the interaction coordinates when available, else the full step thumbnail.
- Live status chip while the build is still running (data already flows through the 2s verify-status poll).

## 3. Network pane parity

Keep the existing baseline↔current column layout and add:

- **Type filter chips with counts** — All / API / Img / Doc / Other, bucketed from `NetworkRequest.resourceType` (schema.ts:36): `xhr`+`fetch` → API, `image` → Img, `document` → Doc, rest → Other. Chips filter both columns.
- **Request-density mini-timeline** over the run duration (video-relative once spec 28 rebases `startTime`; falls back to first-request-relative for legacy rows). Clicking a bucket scrolls the table.
- **Sortable columns**: URL, time, status, type, size (`responseSize`).
- **Row click → side panel** with HEADERS / RESPONSE / PREVIEW tabs. Headers come from `requestHeaders`/`responseHeaders`; bodies are fetched on demand from the `network_bodies_path` sidecar (schema.ts:920) — never inlined into the poll payload. PREVIEW renders image responses with a download button.
- **Totals footer**: `83 requests, 179.5 KB transferred` per side (count + summed `responseSize`).
- **Auto-scroll follow** ("RESUME AUTO-SCROLL"): when the spec-28 player is mounted and playing, the table follows `currentTimeMs`; manual scrolling pauses following and surfaces the resume affordance.

## 4. Perf pane parity

Replace the static web-vitals list with a chart:

- **Time-series chart** of `WebVitalsSample` values (schema.ts:834) across steps, x-axis = step index (or video time when spec 28 timings exist).
- **Toggleable series chips**: LCP / CLS / INP / FCP / TBT / TTFB. CLS plots on a secondary unitless axis.
- **Hover crosshair tooltip** showing the step/time plus every enabled series value; when the spec-28 player is mounted, the crosshair tracks `currentTimeMs`.
- **Peak badges**: e.g. `Peak LCP 3.2s @ step 4`, computed per enabled series.
- **Baseline overlay**: baseline run values (from `perfBaselines`) drawn dashed, current run solid — this is the Lastest twist on the pattern: the chart is a comparison, not a single-run monitor.

## 5. New State tab

A 13th `COMPARE_TABS` entry (`state`), the web analogue of a "files touched" pane:

- **Storage areas as the tree**: Cookies / localStorage / sessionStorage / IndexedDB from `test_results.storageStateSnapshot` (schema.ts:946), with `+N` change badges per area.
- **Diffed current vs baseline run** (not start-vs-end of one run — consistent with every other verify layer): per-area ADD / CHANGE / REMOVE entries with key-level detail, and a "No changes" fallback state.
- **Range selector (phase 2)**: scoping the diff to a step range requires per-step snapshots, which don't exist yet; the initial version diffs end-of-run snapshots only and the UI reserves the range control.
- **New layer plumbing**: add `"storage"` to `EvidenceLayer` (schema.ts:4172) and `CheckLayer` (check-modes.ts:19), default mode `log` in `DEFAULTS` (check-modes.ts:41), and a `storageState` sub-summary computed post-run into `step_comparisons.layers`. The check-modes settings dialog gains the row; `classifyLayer` + case-status derivation pick it up through the existing generic layer machinery. `decideLayer` needs no changes — the new layer is decidable like any other.

## 6. Run/Info parity

Extend the existing RunPane (the `run` tab):

- **Copyable IDs**: test ID, test-result ID, build ID, one-click copy.
- **CLI / MCP snippets**: ready-to-paste `lastest_get_test_run` MCP call and a rerun command for this test/build.
- **Execution metadata**: viewport, browser, EB image, runner kind, started/finished timestamps — mirrors the "Info" tab pattern.

## 7. Embedded playback

RunPane mounts the spec-28 interactive player when `test_results.videoPath` is set (schema.ts:919). Playing through a step optionally selects it in the case rail (opt-in toggle). All sync behavior (scrubber segments, `usePlaybackSync`) is defined in spec 28 — this spec only reserves the mount point and the opt-in.

## Data / schema changes

All additive:

- Per-tab counts, network chips/sort/footer, perf chart: **client-side only**, computed from payloads the verify screen already receives.
- Network bodies: fetched on demand per-request via the existing `network_bodies_path` sidecar route — the slim `TestResultLite` projection used by the verify-status poll must stay slim.
- State layer: new `EvidenceLayer`/`CheckLayer` value + post-run `storageState` diff written into `step_comparisons.layers`; verify-status payload grows by the per-layer sub-summary only (bounded), respecting the 2s-poll size budget.
- Step detail video time range: reads spec 28's `step_timings` — no schema work in this spec.

## Key files

| File                                                | Purpose                                              |
| --------------------------------------------------- | ---------------------------------------------------- |
| `src/app/(app)/verify/[buildId]/focus-view.tsx`      | `COMPARE_TABS` (line 182), all panes, step header    |
| `src/app/api/builds/[buildId]/verify-status/route.ts` | 2s poll payload; gains storage sub-summary          |
| `src/lib/verify/check-modes.ts`                      | `CheckLayer` union + `DEFAULTS` gain `storage: "log"` |
| `src/lib/db/schema.ts`                               | `EvidenceLayer` (line 4172), `test_results` evidence columns |
| `src/server/actions/layer-feedback.ts`               | `decideLayer` (line 69) — unchanged, verify only     |
| `src/lib/verify/case-status.ts`                      | picks up the new layer via generic machinery         |

## Implementation notes (v1, shipped)

Deviations from the sections above, chosen during implementation:

- **Tab counts**: the strip's existing per-layer delta text (`+2 −1`,
  `3 new`, …) already carries the change magnitude, so no separate `(N)`
  badge was added; the State layer got a matching delta. Keyboard cycling
  shipped as `[` / `]`.
- **Network pane**: the pane was already a single filterable table with a
  Δ-vs-baseline summary (not two columns) — kept. Added sortable columns,
  totals footer, density mini-timeline, and body download. A PREVIEW tab
  for images was dropped: the EB only captures bodies for fetch/xhr/
  document requests (16 KB cap), so there is nothing to preview.
- **Step detail header** shows the step screenshot as the thumbnail; target
  selector + click coordinates were dropped — step logs don't reliably
  carry them today.
- **State tab** covers Cookies + localStorage (what
  `storageStateSnapshot` captures); sessionStorage/IndexedDB would need
  capture-side work first. The storage layer emits `low` signal and can
  never flip a verdict — it is informational by design, mode default `log`
  with a `storage_mode` settings column + per-test override.
- **Perf chart** overlays the baseline as dashed per-metric reference lines
  from `step_comparisons.layers.perf.deltas` (metric-level, not per-step —
  per-step baseline samples aren't in the verify payload). CLS renders as
  its own mini-chart rather than a second y-axis.

## Out of scope / gotchas

- **No changes to `decideLayer` semantics** or the Verified/Missed/Broken triage model — this is presentation + one new layer, not a new review flow.
- **Poll payload discipline**: heavy evidence (network bodies, image previews, storage snapshots) is fetched on demand per-tab; nothing heavy rides the 2s poll.
- **Legacy rows**: every new affordance must degrade — no `step_timings` → hide time ranges and density-timeline video anchoring; no `storageStateSnapshot` on the baseline run → State tab shows "no baseline snapshot" instead of a fake all-ADD diff.
- **focus-view.tsx size**: at ~6550 lines, new panes (State, network side panel, perf chart) should land as extracted components, not more inline JSX.
- Check-modes dialog + `DEFAULT_*` settings constants must both gain the new layer (see CLAUDE.md Schema Changes checklist).
