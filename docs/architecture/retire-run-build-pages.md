# Retiring `/run` and `/builds/[buildId]` into `/verify`

Status: **shipped (2026-08-27)**. `/verify` is the single execution surface.
`/run` and `/builds/*` are redirect stubs; every client that backed them is
deleted, and the `verifyPhaseEnabled` flag is gone from the schema, the UI and
the code.

## What shipped, against the plan below

| Phase | Outcome |
|---|---|
| 0 | Flag deleted outright rather than defaulted-on — `teams.verify_phase_enabled` and `src/lib/verify/feature-flag.ts` no longer exist. Requires `pnpm db:push`. |
| 1 | `verify/[buildId]/build-history-drawer.tsx` + `getBuildHistory()` server action (builds + branch heads in one lazy call). `BuildGraphView`/`BuildSummaryCard` reused verbatim; both now link to `/verify/<id>`. |
| 2 | `verify/[buildId]/run-menu.tsx` — split button: primary = smart-with-fallback (unchanged `runVerifyBuild`), menu = Run smart (with a lazy `analyzeSmartRun` count + changed-file line), Run all, Run comparison vs `<base>`, plus a compose chip. Quota lock disables it with a reason. The comparison *setting* is now `ComparisonBaselineSelect` in Settings → Repository; the boolean toggle is gone, because choosing "Run comparison" in the menu is the decision it used to persist. |
| 3 | "Accept all safe" added to the Unsorted column's action bar, driven by a new `aiSafe` boolean on the slim diff. It runs the identical write path as "Verify all", narrowed to the AI-judged-safe cases. Bulk approve was already covered by the per-column "Verify all". `PublishShareDialog` was **not** deleted after all — the test detail page renders it too — it moved to `src/components/share/`. |
| 4 | `FilterPanel` gained Browser (only the engines this build produced) and Root cause (`rca.headline`) rows. The optional metric-chip row was not built; `MetricsRow` survives as a dashboard component with its `FilterType` moved into it. |
| 5 | `/run` → `/verify`; `/builds/[buildId]` → `/verify/[buildId]`; `/builds/[buildId]/diff/[diffId]` resolves `(testId, stepLabel)` → `step_comparisons.id` and lands on `?mode=focus&step=<id>`, falling back to the board. ~40 `revalidatePath` call sites repointed; in-app links, GitHub issue bodies and confirm-on-green now mint `/verify` URLs directly. |
| 6 | Deleted: `run-dashboard-client`, `build-detail-client`, `build-polling-wrapper`, `build-actions-client`, `diff-viewer-client`, `verify-phase-toggle`, `webmcp-toggle`, `src/server/actions/verify-phase.ts`. `step-label-editor` moved to `src/components/builds/` and is now reachable from Verify's focus header (renaming a step re-diffs it, which is a repair path, not decoration). |

Also carried over, beyond the plan: the live EB stream (item 18) as a
collapsible panel above the board while a build runs, and the comparison-pair
sibling chip (item 17) beside the branch picker.

Not carried over, deliberately: `/run`'s base-URL card, URL history, connection
test and branch picker (all duplicates of `sidebar-quick-actions.tsx`), and the
build page's publish-share dialog (sharing is still available from a test and
over MCP).

---

Original proposal follows.

## 1. How the three pages are built today

### `/run` — `src/app/(app)/run/page.tsx` + `run-dashboard-client.tsx` (920 LOC)
Server page fetches everything eagerly (tests, runs, 25 builds, env config,
compose config, branches, review todos, latest build + its diffs, run usage)
and hands a 20-prop bag to one client component. Two-column layout:

- Right column: Run Tests card, Comparison Run toggle + baseline branch,
  Smart Run card, Base URL card (+ history dropdown + connection test +
  BranchSelector), `<ReviewContent>` (todos + pending diffs).
- Left column: Build History card — list (`BuildSummaryCard` ×25) or graph
  (`BuildGraphView`, branch heads + baseline markers).
- When the verify flag is on it already renders a "Run is now part of Verify"
  banner at the top, i.e. it is a known-dead surface.

### `/builds/[buildId]` — `page.tsx` + `build-detail-client.tsx` (1174 LOC)
Server page fetches build summary, recent 5 builds, embedded stream URL,
comparison-pair sibling, a11y score/trend/violations, public shares. Renders:

- Verify hand-off banner (flag on), comparison-pair banner.
- `<BuildPollingWrapper>` → hero + `<MetricsRow>` (clickable filters) +
  `<RecentHistory>` + git info + `<PublishShareDialog>` + `<BuildActionsClient>`.
- `<BuildDetailClient>`: A11y cards, "Test Cases for Review" table with
  filters (status, browser, RCA source, group-by-area/test), checkbox
  multi-select, bulk approve / bulk add-todo, "Accept All Safe (AI)".
- Child route `/builds/[buildId]/diff/[diffId]` — the classic diff viewer
  (1461 LOC) + `MultiLayerPanel` + step-label editor + prev/next navigation.

### `/verify` + `/verify/[buildId]` — the target
- `/verify` is a redirector: latest build on active branch → `/verify/<id>`;
  otherwise renders `VerifyIndexClient` empty shell.
- `/verify/[buildId]` server-fetches frame-only data (areas, tests, branches,
  change map, a11y + design-system trends/violations, playwright settings) and
  defers heavy data to a client `/api/builds/[buildId]/verify-status` poll.
- `BoardFocusClient` header: title + live running chip, `Build #xxxxxxxx ·
  <label> · n/m verified`, Board/Focus tabs, Filter panel, Branch picker,
  primary **Run** button (`runVerifyBuild` = smart run, falls back to run-all).
- `BoardView` (kanban triage) and `FocusView` (7439 LOC) with per-layer panes:
  compare/state/run/text/visual/dom/network/console/a11y/design/perf/api/url/
  variable + intent panel + linked-issue card + focus/ignore region drawing.

**Key finding:** the sidebar (`sidebar-quick-actions.tsx`) already owns
Create, **Run All**, **Base URL + connection test**, and branch selection. Most
of `/run`'s right column is a second copy of the sidebar.

## 2. Gap analysis — what dies if we just delete the pages

| # | Function | Lives in | Exists in Verify? | Recommendation |
|---|---|---|---|---|
| 1 | Build history list (25) | /run | No | **Build-history drawer in Verify header** (see §3) |
| 2 | Build graph view (branch heads, baseline markers) | /run | No | Same drawer, list/graph toggle preserved |
| 3 | Last-5-builds strip | /builds | No | Inline in Verify header, opens the drawer |
| 4 | Explicit "Run All Tests" | /run | Partial (Run = smart w/ fallback) | Split-button on Verify **Run**: Smart / All / Comparison |
| 5 | Comparison Run toggle + baseline branch | /run | No | Move the persisted setting to Settings; expose "Run comparison" in the Run split-button |
| 6 | Smart Run analysis preview (files changed, affected tests) | /run | No (runs blind) | Popover on the Run split-button, lazy `analyzeSmartRun` on open |
| 7 | Base URL input + history + test connection | /run | Sidebar already has it | **Drop** — pure duplicate |
| 8 | Branch selector | /run | Yes (BranchPicker) | Drop |
| 9 | Compose config badge ("N composed") | /run | No | Chip in the Run popover, links to /compose |
| 10 | Runs-paused / quota lock | /run | No | Disable Run + tooltip; reuse `deriveRunUsageBannerState` |
| 11 | `<ReviewContent>` todos + pending diffs | /run | No | `/review` already renders it standalone — link from Verify; no new work |
| 12 | Publish public `/r/` share | /builds | No | **Not carried over** (user decision). The feature survives headless via the `lastest_publish_share` MCP tool and `@lastest/plugin-share`; only the build-page dialog goes away. `/r/<slug>` pages and already-minted shares are unaffected. |
| 13 | Approve-all / Accept-all-AI-safe | /builds | No (per-layer only) | Add "Accept all safe" to Verify's board column action bar |
| 14 | Bulk multi-select approve / bulk add-todo | /builds | No | Board multi-select (shift-click) + existing column action bar |
| 15 | Browser filter, RCA source filter, group-by area/test | /builds | Partial (Filter panel has area/status) | Extend Verify `FilterPanel` with browser + RCA source; group-by is a Board grouping toggle |
| 16 | MetricsRow clickable metric→filter | /builds | Counts only in header | Optional: metric chips row under Verify header that write into `filters` |
| 17 | Comparison-pair sibling banner | /builds | No | Chip next to the branch picker: "baseline ↔ feature" |
| 18 | Embedded live stream while running | /builds | No | Verify already polls; add the stream to the Board running-state panel |
| 19 | Classic diff viewer `/builds/:id/diff/:diffId` | /builds | Superseded by FocusView Visual pane | Keep the route alive as a **redirect** to `/verify/:id?mode=focus&step=<stepId>`; delete the 1461-LOC client once step mapping is verified |
| 20 | Step-label editor | diff page | No | Move into FocusView `StepDetailHeader` |
| 21 | External deep links (`/builds/...` in GitHub issue bodies, Slack confirm-on-green, activity feed, setup guide, share plugin) | many | n/a | Keep `/builds/*` as permanent redirects; do **not** break minted URLs |

## 3. Proposed Verify information architecture

```
/verify                     → redirect to latest build (unchanged)
/verify/[buildId]           → the one execution surface
  header
    left   Verify · Build #xxxx · <branch@sha> · n/m verified
           ├─ [history ▾]  ← NEW: last-5 dots, click = drawer
    right  [Board|Focus]  [Filter ▾]  [branch ▾]  [Run ▾]  [⋯]
                                                    │        └─ Share, Export CSV,
                                                    │           Open in GitHub
                                                    ├ Run smart (N tests)
                                                    ├ Run all (M tests)
                                                    └ Run comparison vs <base>
  history drawer (right side sheet, lazy-loaded)
    ├ list view   BuildSummaryCard ×25   (reused as-is)
    └ graph view  BuildGraphView         (reused as-is)
  banners: build-aborted, coverage-gaps, comparison-pair
  body: Board | Focus (unchanged)
```

Why a drawer and not a `/verify/history` route: build history is a *picker*,
not a destination — every row navigates to `/verify/<id>`. A drawer keeps the
current build on screen, avoids a second full page load, and lets the list be
fetched lazily (`getBuildsByRepo(repoId, 25)` via a small route handler)
instead of blocking the frame render the way `/run` does today.

## 4. Migration phases

0. **Flip the flag** — `isVerifyPhaseEnabled()` defaults to `true`. Ship and
   soak before anything is deleted.
1. **Header history drawer** — new `verify/[buildId]/build-history-drawer.tsx`
   + `GET /api/repos/[repoId]/builds?limit=25`. Reuses `BuildSummaryCard` and
   `BuildGraphView` untouched. Ship behind no flag; purely additive.
2. **Run split-button** — smart / all / comparison + `analyzeSmartRun` popover
   + quota lock. Comparison *settings* move to `/settings`.
3. **Build actions** — "Accept all safe" + bulk approve into the board column
   action bar. `PublishShareDialog` is deleted with the page, not migrated.
4. **Filter parity** — browser + RCA-source into `FilterPanel`; optional
   metric-chip row.
5. **Redirects** — `/run` → `/verify`; `/builds/[buildId]` → `/verify/[buildId]`;
   `/builds/[buildId]/diff/[diffId]` → `/verify/[buildId]?mode=focus&step=…`.
   Sidebar "Runs" entry removed; mobile bottom nav `/run` → `/verify`.
   Update `revalidatePath("/run")` / `revalidatePath("/builds/...")` call sites
   (≈25 across `src/server/actions/*`, `src/lib/diff/core.ts`).
6. **Delete** `src/app/(app)/run/**` and `src/app/(app)/builds/[buildId]/**`
   except the redirect stubs, plus `publish-share-dialog.tsx`,
   `build-actions-client.tsx`, `build-polling-wrapper.tsx`,
   `build-detail-client.tsx`, `diff-viewer-client.tsx`, `step-label-editor.tsx`.
   Remove `isVerifyPhaseEnabled` and every call site.

## 5. Risks

- **Flag default flips to on.** `isVerifyPhaseEnabled()` returns `true` by
  default (per-team `verifyPhaseEnabled` and `VERIFY_PHASE_ENABLED` become
  opt-*out* overrides, then the flag is deleted entirely in step 6). This must
  land in step 0, not step 6 — every subsequent phase assumes Verify is the
  surface everyone sees. Both "Run is now part of Verify" / "Verify this build"
  hand-off banners become dead code the moment it flips.
- **Minted external URLs.** GitHub issue bodies, Slack messages and public
  shares embed `/builds/<id>` and `/builds/<id>/diff/<id>`. Redirects are
  mandatory and permanent; the diff redirect needs a diffId → stepId lookup
  (`visual_diffs.testId + stepLabel` → `step_comparisons`), and must fall back
  to `/verify/<buildId>` when no step matches.
- **`ReviewContent` orphaning.** It is rendered by both `/run` and `/review`;
  only the `/run` instance goes away.
- **Board lacks a flat table.** Users who triage 200 diffs via the `/builds`
  table lose that shape. Focus view's case sidebar is the replacement — worth
  validating before deleting, or add a "List" mode as a third tab.
