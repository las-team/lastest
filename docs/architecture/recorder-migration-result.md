# Recorder migration — result

**Status:** done and building. `pnpm install`, `pnpm arch`, `pnpm lint`,
`pnpm types`, `pnpm test` (1676 passed) and `pnpm build` all pass. Action-id
count matches exactly (15 exported actions, 15 ids in
`server-reference-manifest.json`).
**Recipe:** [`plugin-migration-recipe.md`](./plugin-migration-recipe.md).
**Phase:** the eleventh plugin of RFC §9 phase 4, and the second out of the
§6.2 `src/lib/playwright` split (after `ranger`).
**Not committed.**

---

## 1. The headline

`recorder` is a workspace package. `plugins/recorder/package.json` lists
`@lastest/eb-protocol`, `@lastest/kernel`, `@lastest/recording-codegen` and
`@lastest/ui` — no `playwright`, no `@lastest/db`, no
`@lastest/pool-service`. There is no `@/…` import anywhere under
`plugins/recorder/`. `pnpm arch` reports **0 violations in the target
layout** and the current-layout burndown went **18 → 14**: the
`recorder::browser` (2) and `recorder::db` (2) entries are gone, not moved —
one of the two `browser` violations was a file that turned out to have zero
callers (§3).

| Was | Now |
| --- | --- |
| `src/server/actions/recording.ts` (1255 LOC) | `plugins/recorder/src/actions.ts` (809) + `src/lib/core/recorder-host.ts` (478) |
| `src/lib/recording/timeline-events.ts` (192) | `plugins/recorder/src/timeline-events.ts` (189) |
| `src/components/recording/*.tsx` (4 files, 1150) | `plugins/recorder/src/ui/*.tsx` (4 files, 1137) |
| `src/lib/playwright/selector-analysis.ts` (309) | `plugins/recorder/src/selector-analysis.ts` (309) |
| `src/lib/playwright/debug-recorder.ts` (651) | **deleted** — zero callers, confirmed dead (§3) |
| `src/lib/playwright/event-to-code.ts` (655) + `debug-parser.ts` (1007) | `libs/recording-codegen/src/*.ts` (1695, incl. barrel) — **not** the plugin (§2) |
| `src/components/ui/tooltip.tsx` + `.client.tsx` | `libs/ui/src/tooltip.tsx` — promoted alongside (§4) |
| `src/components/ui/dropdown-menu.tsx` | `libs/ui/src/dropdown-menu.tsx` — promoted alongside (§4) |

Net: 4562 old lines (recording.ts, timeline-events, the four components,
selector-analysis, debug-recorder) became 3371 plugin-side lines plus 1695
lines that turned out not to be the plugin's at all.

## 2. Two libs came out of this migration, not one plugin

Recipe §1.5 says count what the feature *calls*; §5 says a shared,
dependency-free module is a lib, not core and not the feature that happens to
sit next to it. This migration is where both showed up on the same two
files.

`src/lib/playwright/event-to-code.ts` and `debug-parser.ts` lived in
`PSEUDO_PLUGINS["recorder"].files` — directory placement, not an ownership
claim. Reading their **import lists** (recipe §5's mechanical test): zero
imports, either of them. Reading their **consumer lists** is what settled it:

```
debug-parser.ts    → src/lib/execution/executor.ts (core)
                    → src/app/(app)/tests/[id]/test-detail-client.tsx
                    → src/components/tests/{test-vars-tab,success-criteria-tab}.tsx
                    → src/components/playback/playback-timeline.tsx
                    → src/server/actions/debug.ts

event-to-code.ts   → src/lib/playwright/assertion-parser.ts (core)
                    → src/lib/execution/full-build-pipeline.integration.test.ts
                    → src/lib/recording/timeline-events.ts (the actual recorder code)
```

`debug-parser.ts` is imported by core's own test executor. `event-to-code.ts`
is imported by core's own assertion parser. Neither is core in the
`core-scope.md` §2 sense (neither guards tenancy, capacity, money or
credentials — they are pure code-generation and step-parsing), so
reclassifying them as `CORE_SRC_PATHS` (recipe §1.6's "reclassify"
resolution, the `ci` shape) would have been defensible but wrong: a
CODEOWNERS-gated module that guards nothing is exactly the sprawl
`core-scope.md` §1 exists to prevent. `libs/recording-codegen` is the right
shape — importable by core and the plugin alike, no review gate — and it is
why `recorder`'s own port stayed smaller than the six-consumer web around
these two files would otherwise suggest.

One `import(...)`-typed reference in `src/lib/playwright/types.ts` and one
static import in an integration test needed the same path swap; both were
mechanical.

## 3. A confirmed-dead file, and a table-stakes lesson about counting hazard 1

`src/lib/playwright/debug-recorder.ts` (651 lines) was the third file listed
under `recorder`'s `files`, and it was the more interesting of the two
`browser::playwright` violations: `import type { Page } from "playwright"`
plus one inline `import("playwright").Frame` type — both type-only, not a
runtime `connectOverCDP` call like `ranger`'s had been. Grepping for its
exports (`injectRecordingListeners`, `DebugRecordingSession`) across the
whole repository returned **zero callers anywhere** — not commented out, not
dynamically imported, nothing. Its own header comment ("Injects recording
event listeners into an existing Playwright Page during a debug session")
described a mechanism the live debug session (`src/server/actions/debug.ts`)
never actually calls; `debug.ts` drives its floating recording controls
through `sendDebugCommand` to the runner instead.

This is `demo`'s finding (ranger-migration-result.md §2) in a fourth shape:
not "not a plugin at all," but a single file inside a real migration that
turned out to be dead weight nobody had noticed because grep for the
*directory* found it and nothing had ever grepped for its *exports*. Deleted
rather than migrated — the two-line net effect on the `browser` burndown
column (2 → 0 for this entry, of which one was always going to be zero
regardless of how the migration went) is not really the interesting part;
the interesting part is that a `files`-listed entry in `PSEUDO_PLUGINS` is a
location claim, and recipe §1.6's "read the consumer list before costing
anything" applies to files, not only to whole pseudo-plugins.

## 4. Two shadcn primitives moved to `@lastest/ui` as part of this PR

`plugins/recorder/src/ui/step-card.tsx` uses `Tooltip`/`TooltipContent`/
`TooltipTrigger`; `recording-controls.tsx` uses `DropdownMenu*`. Neither was
in `@lastest/ui` yet (the lib currently holds what earlier migrations
happened to need — `button`, `card`, `input`, `popover`, `select`, `switch`,
`checkbox`, and so on). Recipe §6: "a primitive that is not there yet moves
in — definition to `libs/ui`, re-export shim left at `src/components/ui/…`
so no app import changes." Both moved verbatim (the tooltip's accessibility
logic — auto-forwarding label text to `aria-label` for icon-only triggers —
and the dropdown's full Radix wrapper, unchanged), `libs/ui/package.json`
picked up `@radix-ui/react-tooltip` and `@radix-ui/react-dropdown-menu`, and
every existing `@/components/ui/tooltip` / `@/components/ui/dropdown-menu`
import in the app kept working unchanged through the shim. `tooltip.tsx`
also folded its separate `tooltip.client.tsx` split back into one file — that
split existed for an app-specific Next.js SSR bug already fixed by the time
this migration found it (see the shim's own comment, kept for the next
person who wonders why it says what it says).

## 5. The host port: 19 methods, five debt items, one of them new

Recipe §1.5's line is ~15 before "stop." Nineteen is over it on the raw
count, and the honest reason is not that the migration is a bad idea — it is
that a live, runner-driven recording session is architecturally unlike
anything migrated before it, and grouping the nineteen tells the real story:

| Group | Methods | What it is |
| --- | --- | --- |
| Runner-channel session | 10 | claim/release a runner, create/get/clear/complete a session, send a WS command, get merged events, write OCR-touched events back, cross-pod busy check |
| OCR | 3 | `ocrWarmup`/`ocrSleep`/`extractOcrText`, unchanged from the pre-plugin `src/lib/ocr` facade |
| Guarded writes | 2 | `saveRecordedTest`, `updateRerecordedTest` — the `api-test` shape |
| Data | 2 | `getPlaywrightSettings`, `resolveSetupSteps` (the setup-chain precedence, moved verbatim) |
| Security | 1 | `fetchGuarded` — the **fourth** plugin to declare this exact SSRF gap, after `explorer`, `app-map` and `api-test` (fifth counting `ranger`'s narrower `assertSafeOutboundUrl`) |
| Guard | 1 | `requireRecordingAccess()` — the team-session check every action opens with |

Four of the five groups already have precedent (guarded writes: `api-test`;
security: the now-quadruple-declared SSRF gap; OCR and settings: ordinary
data reads). The runner-channel group is the one with none. Recording does
not fit `ctx.browser.withBrowser`'s model — that capability claims an EB,
hands the plugin a short-lived server-side `Page`, and releases on return;
recording instead claims a *runner*, tells it to drive itself and stream
events back over the WS command channel for a human-paced session that can
run for minutes, with the actual Playwright driving happening inside the
runner process, never inside a `Page` the app holds. There was nothing
existing to reuse. That is this migration's honest contribution to the
phase-5 backlog: a `RunnerChannelCapability` (or an extension of
`BrowserCapability` to a "hand off to the runner and stream back" shape)
that would retire ten methods here — the same kind of "one missing
capability, several old debt items" signal `playground` first demonstrated,
just for a capability nothing has needed yet rather than one two plugins
already needed independently.

## 6. Authorization: every method is its own gate, because there is nowhere else for it to live

`recorder` declares no `capabilities` and holds no `PluginContext` — the
same shape as `design-system` and `events`. Unlike those two, its actions
*do* need a per-call auth check (`recording:write`, pre-existing and
team-scoped, no repo-ownership component — that property predates this
migration, not introduced by it). With no `ctx` to read a session off, the
guard has to live on the host. Rather than duplicating
`requireCapability("recording:write")` inside all seventeen non-write
methods, it is one shared `requireRecordingAccess()` that every plugin action
calls exactly where the pre-plugin code called `requireCapability` — same
call site, same granularity, moved rather than multiplied. The two methods
that write into the core `tests` table (`saveRecordedTest`,
`updateRerecordedTest`) carry their *own* guard instead
(`requireRepoCapability(…, "tests:write")` / `requireTestOwnership`,
respectively) — recipe §3.1's rule that a write's authorization lives inside
the write, because `recording:write` does not cover writing a `tests` row
and a plugin that could reach the table through a differently-guarded path
would not really be authorized by either check.

## 7. A narrowed type that had to widen back out

`getOrCreateFunctionalArea`'s first draft returned `{ id, name }` — the two
fields the plugin's own code reads. `pnpm types` caught the gap immediately:
`recording-client.tsx` splices the result into a local `FunctionalArea[]`
list that a wider, core-typed area tree also renders, and the call site was
*already* defensively filling eight more fields with `?? null` — written,
evidently, against the original action's full-row return shape. This is the
`AwardBadgeRow` lesson from `awards-migration-result.md` restated: a
narrowed type has to satisfy everything downstream of the plugin, not just
what the plugin itself reads. Fixed by widening `FunctionalAreaRef` to the
full structural copy of `functionalAreas` (`packages/db/src/schema/tests.ts`)
— nine fields, all narrowed by hand since the table itself is 24-FK core and
not something the plugin may import.

`domSnapshot` went the other way on purpose: `RecordingSession.domSnapshot`
and `SaveRecordedTestInput.domSnapshot` are typed `unknown` in the plugin,
because the plugin never reads into that value — it only receives it from
one host call and hands it to another. The two casts back to
`DomSnapshotData` live entirely on the app side (`recording-client.tsx` and
`recorder-host.ts`), which already knows the real shape. `unknown` at a
boundary the plugin only passes through, not one it reads, is the correct
type — narrower than the caller needs is a bug; narrower than the *plugin*
needs is the point.

## 8. What I did not verify

No runtime click-through of `/record` or the debug "record from here" view —
this was verified by `pnpm build` succeeding, the build's route table
listing both `/record` and `/tests/[id]/debug` as generated routes, the
action-id count matching exactly (15/15), and a `grep` confirming
`generateCodeFromRemoteEvents`/`requireRecordingAccess` landed in an emitted
server chunk. No `db:push` against a live database — this migration adds no
schema (recorder owns no tables), so the risk surface is narrower than
`ranger`'s or `launch`'s, but the query-layer calls inside
`recorder-host.ts` (`resolveSetupSteps`'s four-branch precedence in
particular) are moved verbatim from the pre-plugin code and were not
independently re-tested against a live recording session. No real embedded
browser exercised the runner-channel host methods end to end; `pnpm test`
covers `selector-analysis.ts`, `event-to-code.ts` and `debug-parser.ts`
(all pre-existing, unit-level, and green) but nothing in this repo currently
exercises `startRecording` → runner → `stopRecording` as an integration.
