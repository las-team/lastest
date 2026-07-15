# Feature Spec: Interactive Test Playback (Step-Synced Timeline)

## Overview

Turns passive webm playback into a step-annotated, evidence-synced timeline: per-step tick marks with action icons on the scrubber, click-a-step-to-seek, active-step highlighting during playback, speed presets up to 8x, and a bidirectional sync bus so evidence panes (network table, perf chart, step list, chapter rail) can both follow and drive the video. Surfaces: test-detail Recordings card (primary), the `/r/` public share player, and the Verify RunPane (per `docs/specs/27-verify-review-evidence-ux.md` §7).

The foundational move is clock unification: today step timings, network requests, console entries, and URL trajectory live on three different time origins (video-relative, absolute epoch, test-start-relative) — and per-step timings aren't persisted at all. Everything gets rebased to **one clock: the video clock** (ms since recording start).

## Current state

- `src/components/video-player.tsx` — scrubber with hover frame preview, playback-rate popover, `durationMsFallback` (video-player.tsx:80 — works around webm files missing EBML duration), imperative `seek`/`seekAndPlay` handle (video-player.tsx:51).
- `src/components/replay-player.tsx` — document-level `[data-seek]` click listener (replay-player.tsx:31); `src/components/chapter-rail.tsx` — screenshot thumbnails seek via that data attribute.
- Per-step timings exist live: the EB emits `response:step_event` with `durationMs` from `finishCurrentStep` (`packages/embedded-browser/src/test-executor.ts:1677`), but they land only in the in-memory `src/lib/ws/step-state.ts` (30-min TTL) — **never persisted**.
- `videoStartMs` is anchored when recording starts (EB test-executor.ts:660) but **not persisted**; the only durable step→video anchor is `CapturedScreenshot.atMs` (schema.ts:535).
- `networkRequests[].startTime` is absolute epoch; `urlTrajectory[].capturedAtMs` is relative to test start; `consoleErrors` is `string[]` with no timestamps (schema.ts:893, captured at EB test-executor.ts:1087).
- Known reliability gaps folded into this spec: `videoPath` persistence is a silent best-effort try/catch (`src/lib/execution/executor.ts:1288-1312`); the disk fallback `resolveTestVideoUrl` (`src/lib/share/video-fallback.ts`) is share-only; share captions use an even-split clock (`src/lib/share/captions.ts:98`) that drifts from the chapter rail's `atMs` anchors.

## 1. Data model: persist step timings

New jsonb column on `test_results`:

```typescript
stepTimings: jsonb("step_timings").$type<StepTiming[]>(),

interface StepTiming {
  stepIndex: number;
  label: string;      // "Step N" structural key, matches CapturedScreenshot.label
  stepType: string;   // navigate | click | fill | assert | shot | ...
  status: "passed" | "failed";
  startMs: number;    // relative to videoStartMs
  endMs: number;
}
```

- **Source**: the EB's existing `finishCurrentStep` events (test-executor.ts:1677) are accumulated **in the EB process** and returned in the final result payload alongside `screenshots` — not read back from the lossy in-memory ws `step-state.ts`. The executor (`src/lib/execution/executor.ts`) threads the array through to the insert exactly like `screenshots`.
- **Clock**: the EB rebases each event to `videoStartMs` (test-executor.ts:660) before emitting the final array, so persisted values are already video-relative. `videoStartMs` itself is persisted on the payload envelope (or as `video_start_ms`) for forensics/legacy rebasing.
- **Backfill ladder** for legacy rows (same ladder `collectChapters` uses today): `stepTimings` → `screenshots[].atMs` anchors (step spans between consecutive anchors) → even split across `durationMsFallback`.

## 2. Clock rebasing (all evidence onto the video clock)

- **Network**: rebase `NetworkRequest.startTime` (epoch) to video-relative ms at persist time; legacy rows rebase at read time using a screenshot's `(atMs, capturedAt)` pair when one exists, else remain unanchored (consumers hide time-sync affordances).
- **URL trajectory**: `capturedAtMs` is test-start-relative; test start vs `videoStartMs` differs by context-creation time — rebase at persist time with the same offset the EB already knows.
- **Console**: extend capture (EB test-executor.ts:1087) to `{ atMs, level, text }` (video-relative). The column type becomes the union `string[] | ConsoleEntry[]` — jsonb, no migration; readers use a small normalizer that maps legacy strings to `{ atMs: null, level: "error", text }`.

## 3. Annotated scrubber

Extend `VideoPlayer` (`src/components/video-player.tsx`) with an optional `segments` prop derived from `stepTimings`:

- **Per-step segment ticks** under the existing Radix slider track, with step numbers below and pass/fail status coloring.
- **Tiny action icons** per segment, chosen by `stepType` (lucide: navigate → globe, click → mouse-pointer, fill → keyboard, shot → camera, assert → check); a `+N` collapse when segments are too narrow.
- **Click segment → seek** to `startMs`; **active segment highlight** driven by `timeupdate`.
- **Speed presets up to 8x** in the existing rate popover (currently tops out lower); persisted per-session.
- No `segments` prop → identical to today's player (share/legacy paths unaffected until wired).

## 4. Bidirectional sync bus

A small React context + event emitter, `usePlaybackSync`:

- Player publishes `currentTimeMs` (throttled to ~4 Hz for consumers; scrubber stays on raw `timeupdate`).
- Any pane publishes `seekTo(ms)`; the mounted player subscribes and calls its imperative `seekAndPlay`/`seek` handle.
- Replaces the ad-hoc `[data-seek]` document listener for React consumers, but the **data-attribute path is kept** for server-rendered share HTML (replay-player.tsx:31 keeps listening; the bus is layered on top).

## 5. Evidence sync consumers

- **Chapter rail** (`chapter-rail.tsx`): auto-highlights the chapter containing `currentTimeMs`.
- **Step lists** (test-detail steps, verify case rail): follow playback with auto-scroll; manual scroll pauses following and shows a "Resume auto-scroll" affordance.
- **Network table**: row highlighting tracks `currentTimeMs` (rebased `startTime`); **perf chart** crosshair tracks it (spec 27 §3–4 consume this).
- **Verify focus mode**: playing through a step selects it in the case rail — opt-in toggle, off by default (spec 27 §7).

## 6. Surfaces

1. **Test-detail Recordings card** — primary surface: annotated scrubber + step-list sync.
2. **`/r/` share page** — player + ChapterRail gain scrubber ticks; **captions clock fix**: `timingFor` (captions.ts:98) switches from even-split to the same ladder as §1 (`stepTimings` → `atMs` → even split), fixing the documented drift between captions and chapter seeks.
3. **Verify RunPane** — embeds the player per spec 27 §7.

## 7. Reliability fixes folded in

- **`videoPath` persistence made non-best-effort**: the silent catch in executor.ts:1288-1312 logs the error, retries the write once, and on final failure records a visible entry in `test_results.logs` — a missing video must be diagnosable, not silent.
- **Disk fallback everywhere**: reuse `resolveTestVideoUrl` (`src/lib/share/video-fallback.ts`) in test-detail (currently share-only) so a row whose `videoPath` write failed but whose file exists on disk still plays.

## 8. Schema changes

Per the CLAUDE.md Schema Changes checklist (schema.ts → `pnpm db:push` → queries touch-ups; no reset):

- `test_results.step_timings` jsonb (`StepTiming[]`), plus `video_start_ms` if not folded into the payload envelope.
- `consoleErrors` type widened to the legacy union (type-only; jsonb needs no migration).
- Rebased network/url timestamps are value-level changes, not schema changes.
- Touch-ups in `src/lib/db/queries/tests.ts` selects and any `TestResultLite`-style projections that should expose `stepTimings` (it's small — safe to include in list payloads).

## Key files

| File                                                | Purpose                                               |
| --------------------------------------------------- | ----------------------------------------------------- |
| `src/components/video-player.tsx`                    | `segments` prop, ticks, icons, 8x rate, sync publish  |
| `src/components/replay-player.tsx`                   | keeps `[data-seek]`; bus layered on top               |
| `src/components/chapter-rail.tsx`                    | auto-highlight consumer                               |
| `packages/embedded-browser/src/test-executor.ts`     | timing accumulation (line 1677), `videoStartMs` (660), console capture (1087) |
| `src/lib/execution/executor.ts`                      | thread `stepTimings`; harden videoPath save (1288-1312) |
| `src/lib/db/schema.ts`                               | `step_timings` column; `ConsoleEntry` union           |
| `src/lib/share/captions.ts`                          | replace even-split `timingFor` (line 98)              |
| `src/lib/share/video-fallback.ts`                    | reuse `resolveTestVideoUrl` in test-detail            |

## Implementation notes (v1, shipped)

Deviations from the sections above, chosen during implementation:

- **Console entries are a separate column**, `test_results.console_entries`
  (`ConsoleEntry[]`), instead of widening `consoleErrors` to a union type —
  ~40 consumer files treat `consoleErrors` as `string[]` (diffing, triage,
  issue bodies), and a union would have forced a normalizer into every one
  of them for zero data gain. `consoleErrors` stays the diff/compat surface;
  `consoleEntries` carries `{atMs, level, text}` for timeline consumers.
- **Clock rebasing is additive, not in-place**: `NetworkRequest.atMs` and
  `UrlTrajectoryStep.atMs` (video-clock ms) sit alongside the original
  epoch `startTime` / test-start `capturedAtMs` rather than rewriting them.
- **No `video_start_ms` column** — the EB rebases timings to the video clock
  before shipping the payload, so persisting the anchor adds nothing.
- The sync bus is `usePlaybackSync` + `SyncedVideoPlayer`
  (`src/components/playback-sync.tsx`); for server-rendered share islands,
  `ReplayPlayer` additionally broadcasts a throttled
  `lastest:playback-time` document event that `ChapterRail` consumes.
- The timing ladder helper is `resolveStepSegments`
  (`src/lib/playback/step-timings.ts`).

## Out of scope

- No changes to CDP live streaming (`packages/embedded-browser` streaming path) — this is post-run playback only.
- No mobile/device-frame chrome around the video.
- No device-level FPS/CPU/RSS metrics — web vitals remain the perf series (spec 27 §4).
- The 1-job-1-EB provisioning model is untouched.
