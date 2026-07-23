# App Map "Explore" — Spec + Implementation Plan

> Status: Phases A–C implemented (this branch); Phase D remains stretch/unbuilt.
> Targets the App Map work from branch `feat/app-map`; file/line references
> below are against that branch as it stood when the spec was written.

## Context

Revyl's "Atlas Explore" (@hxyden, x.com/hxyden/status/2075658847277224181) validates
the pattern Lastest's App Map already stakes on web: exploratory agents crawl the
app, and every screen becomes one connected map. This spec covers the features worth
adopting — a map-level Explore launcher, an explorer swarm, and Screens/Flows view
tabs — plus navigation behavior: a clear hierarchy view and a step-by-step mode for
screens.

**Decisions made:**

- Deliverable now is this spec document only; implementation follows in phases.
- Exploration stays **Pro-only** behind the existing `assertQaAgentAccess` gate,
  with a new per-plan `maxExplorers` cap in `src/lib/billing/plans.ts`.

## 1. Feature spec

### 1.1 View tabs: Map / Screens / Flows

Header tab bar (shadcn `Tabs`, house pattern from `test-detail-client.tsx`) on
`/app-map`:

- **Map** — existing React Flow canvas, unchanged.
- **Screens** — flat responsive gallery of every node with a screenshot
  (`/api/media${path}`), coverage pill, path/title; toggle to include
  screenshot-less nodes as placeholders. Click → same `NodeDetailPanel`.
- **Flows** — named user journeys derived from `test_results.urlTrajectory`
  (already fetched in `build-map.ts`): one flow per latest test result with ≥2
  trajectory steps; name = test name, steps = trajectory steps with `stepLabel` +
  matched screenshot.

Active tab persisted in the existing localStorage blob
(`app-map:state:${repositoryId}`).

### 1.2 Navigation: hierarchy view

- **Entry root**: user can mark any node "Set as entry root" (in
  `NodeDetailPanel`); root gets a badge; "clear root" in toolbar. Persisted in
  localStorage v1 (promote to repo settings later).
- **Hierarchy layout**: with a root set, compute a **spanning tree** from the root
  (BFS over edges, edge-kind priority `nav > redirect > link`) and feed dagre only
  the spanning-tree edges → clean single-rooted top-down hierarchy like the Revyl
  map. Non-tree edges render dimmed/dashed; unreachable nodes park in a bottom
  "unlinked" rank.
- **Tree outline panel**: collapsible left sidebar mirroring the same spanning
  tree — rows with path, title, coverage dot, chevron collapse. Click row → select
  + center node on canvas; canvas selection highlights the row (two-way sync).

### 1.3 Navigation: step-by-step mode for screens

In the Flows tab, selecting a flow opens the **flow player**:

- Large current-step screenshot, prev/next buttons + arrow-key navigation,
  progress dots.
- The action (`stepLabel`) rendered between transitions as "action → resulting
  screen".
- Filmstrip of all step thumbnails below; click any to jump.
- Entry points: from the Flows list, and from a node's detail panel ("appears in
  N flows" → jump into a flow at that screen).

### 1.4 "Explore app" launcher (map-level)

Primary button on the App Map toolbar → dialog:

- **Explorers**: 1–10 slider; values above plan `maxExplorers` disabled with
  upgrade hint. Pro-only overall (existing `assertQaAgentAccess`).
- **Depth**: shallow→deep slider (1–6) → crawl `maxDepth` + page budget
  (`6 + depth*5`, cap 40).
- **Strategy**: breadth-first / depth-first / balanced.
- **Max time**: 2/5/10/20 min wall-clock deadline.
- **Auth context**: optional free-text sign-in instructions (e.g. "Log in with
  demo@acme.com / hunter2, then tap Continue") + optional structured
  email/password.

Launch = new QA-agent run mode `explore` with pipeline
`[qa_setup, qa_login, qa_discover]` (skips spec/plan/test-gen). One active
session per repo preserved.

### 1.5 Explorer swarm

- N explorers = N EB pods claimed from the existing pool (`claimPoolEB` is
  `FOR UPDATE SKIP LOCKED`-safe), all crawling **in one Node process / one
  session**, sharing an in-memory frontier + visited set.
- **Partitioning**: first path segments assigned round-robin to explorers as
  discovered; work-stealing fallback so nobody idles; shared visited set
  guarantees no duplicate visits.
- **Dedupe**: visited keyed on normalized href AND `canonicalPath(url)` (cap ~2
  concrete URLs per canonical path so `/orders/1..999` doesn't burn budget).
- **Progressive claim**: explorer #1 gets the full 5-min claim timeout (must
  succeed); #2..K get 30s each — run with however many arrive.

### 1.6 Live exploration progress

- New activity events: `map:page_discovered`, `map:explorer_status`,
  `map:blocked` — emitted through the existing SSE activity feed
  (`/api/activity-feed`).
- Map auto-grows: `qaDiscovery.crawledPages` flushed incrementally (throttled
  ≥3s) during explore so `buildAppMap` (computed-on-read) picks up new nodes;
  client debounces SSE events → refetch `getAppMap`.
- **Progress panel** (floating, bottom-left): per-explorer card with status dot,
  pages-mapped counter, current URL, live EB screencast thumbnail
  (`BrowserViewer`), amber **BLOCKED** rows (auth wall / dead end + URL); header
  totals (screens found, elapsed/budget, Stop button).

### 1.7 Explicit non-goals (v1)

- AI-driven interactive login following prose (SSO buttons, OTP) — Phase D. v1
  auth context = AI-extract structured creds/loginUrl from the prose, feed the
  existing cascade.
- Button-driven SPA navigation discovery (crawler follows `<a href>` only) —
  Phase D "AI explorer".
- Merge-screens manual curation, build/time scope selectors — later.

## 2. Implementation plan (phased; each phase ships alone)

### Phase A — Tabs, Screens, Flows, Hierarchy (pure UI + one read action)

- **New `src/lib/app-map/flows.ts`**: `AppFlow`/`AppFlowStep` types + pure
  `deriveFlows(trajectoryResults, branch)` — sort `urlTrajectory` by `stepIndex`,
  match screenshots by `label === stepLabel` with positional-zip fallback (same
  logic as `build-map.ts:369-441`); drop <2-step flows. Export `canonicalPath`
  from `build-map.ts:114` (add `export`).
- **New `src/lib/app-map/hierarchy.ts`**: pure
  `buildSpanningTree(nodes, edges, rootId)` with edge-kind priority; fallback
  root = existing `pickRootId` (`app-map-client.tsx:149`).
- **Modify `src/server/actions/app-map.ts`**: add `getAppFlows()` (lazy-loaded
  when Flows tab opens; same `requireTeamAccess` + selected-repo pattern as
  `getAppMap`).
- **Modify `src/app/(app)/app-map/app-map-client.tsx`**: tab state + persistence;
  entry-root state; spanning-tree-filtered edges into `computePositions`
  (line 93); mount outline panel; lift `NodeDetailPanel` (line 805) into
  `node-detail-panel.tsx`; export/move `COVERAGE_COLOR`/`COVERAGE_LABEL` to
  `app-map-shared.ts`.
- **New client components** in `src/app/(app)/app-map/`: `screens-gallery.tsx`,
  `flows-view.tsx`, `flow-player.tsx`, `tree-outline.tsx`.
- **Tests**: `src/lib/app-map/flows.test.ts`, `src/lib/app-map/hierarchy.test.ts`.

### Phase B — Explore launcher, single explorer

- **`src/lib/db/schema.ts`** (types only, jsonb — no db:push): `QaRunMode` +
  `"explore"`; new `ExploreStrategy`, `QaExploreConfig`, `QaExplorerState`,
  `QaExploreState`; `AgentSessionMetadata` + `qaExplore?`, `qaAuthContext?`;
  `ActivityEventType` +
  `map:page_discovered | map:explorer_status | map:blocked`.
- **Encrypt `qaAuthContext`** at rest alongside `quickstartPassword`
  (`src/lib/db/queries/integrations.ts:346-371` encrypt/decrypt helpers).
- **`src/lib/qa-agent/crawl.ts`**: extend `QaCrawlOptions` with `maxDepth` (queue
  entries `{url, depth}`), `deadline` (checked beside `signal`),
  `maxPagesHardCap` (existing callers keep the 12 clamp); export
  `extractDom`/`pickNextLinks`; extract shared
  `attachPageObservers(page, baseOrigin)`.
- **`src/server/actions/qa-agent.ts`**: `StartQaAgentInput` +
  `explore?`/`authContext?`; `MODE_PIPELINES` +
  `explore: ["qa_setup","qa_login","qa_discover"]` (line 2305); explore-mode
  completion at end of `executeQaPipeline` (verify where non-summary pipelines
  mark `completed`; guard `mode === "explore"`); `runQaDiscover` (line 981)
  explore branch: depth/budget/deadline options, **incremental throttled
  `qaDiscovery` flush** in `onPage` (this is what makes the map grow live), emit
  `map:page_discovered`; `runQaLogin` (line 517): AI-extract
  `{email, password, loginUrl}` from `qaAuthContext` prose via existing
  `generateWithAI` + feed the existing `creds_untested` cascade.
- **`src/server/actions/app-map.ts`**: `startExploration(input)` thin wrapper
  (resolves target URL exactly as `buildAppMap` does at `build-map.ts:207`, calls
  `startQaAgent` with `mode:"explore"`, `groups: []`); `getActiveExploration()`
  for reload-resume.
- **`src/lib/billing/plans.ts`**: add `maxExplorers` per tier (explore itself
  stays Pro-only; field drives slider caps + future gating).
- **New `explore-dialog.tsx`**; **modify `page.tsx`** (fetch active exploration);
  **modify `app-map-client.tsx`**: SSE `EventSource` to
  `/api/activity-feed?repo=…` while exploring → debounced (4s) `getAppMap`
  refetch; minimal status strip (counter + cancel).

### Phase C — Swarm + live progress panel

- **New `src/lib/qa-agent/explore.ts`**: pure `SharedFrontier` class (strategy
  ordering, canonical dedupe, segment round-robin + work-stealing, depth/budget
  cutoffs) + `exploreTargetApp(opts)` orchestrator (per-EB CDP connect,
  storage-state inject or `attemptLogin`, loop frontier→goto→extract→add;
  BLOCKED detection: redirected-to-auth-URL while unauthenticated, or starved
  frontier; final richest-snapshot dedupe by canonical path).
- **`src/server/actions/qa-agent.ts`**: new `runQaDiscoverSwarm(...)` called from
  `runQaDiscover` when `explorers > 1` — progressive multi-EB claim, per-explorer
  `streamUrl` on `qaExplore.explorers[i]` (`metadata.streamUrl` stays explorer 0
  for `/qa-agent` page compat), single serialized throttled `flushState()` for
  `mergeMetadata` (never concurrent read-merge-rewrite), `finally` releases ALL
  EBs; cap claims at `min(requested, poolMax − reserved − 5)`.
- **New `explore-progress-panel.tsx`**: reuse `useQaAgent` 2s polling hook for
  `qaExplore` state + SSE for the event feed; `BrowserViewer` thumbnails; Stop =
  existing cancel action.
- **Tests**: `src/lib/qa-agent/explore.test.ts` (frontier
  dedupe/partitioning/strategies/budget), merged-pages dedupe.

### Phase D (stretch)

AI interactive login (prose-following, OTP via `waiting_user`), entry root → repo
settings, flow names from `qaPlan.journeys`, AI explorer for SPA button-nav,
merge-screens curation, build/time scope.

## 3. Verification

- **Phase A**: `pnpm test -- src/lib/app-map`; manual: repo with
  trajectory-bearing results → tabs, gallery, flow player stepping (keys +
  filmstrip), entry-root re-layout, outline↔canvas sync.
- **Phase B**: explore depth 2 / 5 min vs demo app → map gains nodes live (watch
  SSE in devtools), auth-context prose → logged-in crawl.
- **Phase C**: 3 explorers → 3 EB Jobs (`kubectl get jobs -n lastest`), 3
  screencast thumbs, distinct subtree counters, BLOCKED row on authed subtree
  without creds, all EBs released on completion AND on cancel.

## 4. Risks

1. Incremental `qaDiscovery` flush = new write traffic on encrypted
   `agent_sessions.metadata` — throttle ≥3s, cap ~40 pages.
2. Explore-mode session completion: confirm non-summary pipeline finalization
   point before wiring (`finalizeQaTaskAndDispatch` should no-op without
   `qaTaskId` — verify).
3. EB pool contention with builds — progressive claim degrades gracefully; cap
   formula above.
4. `<a href>`-only crawler misses SPA button navigation — documented non-goal,
   Phase D.
5. Canonical dedupe vs auth states: one state per canonical path in v1 (explore
   runs post-auth-resolution).
