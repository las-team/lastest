# Feature Spec: Test-Level Multi-Target Inspector

> Status: design • Branch: `claude/design-testing-framework-VAs2E` • Baseline: v1.3 platform
> Scope: per-test, no-rebuild comparison across **Visual + DOM + Network + Variables**, with user-selectable run targets.

## Problem

Today the platform captures rich per-test artifacts but only surfaces them in one shape: build-scoped visual diffs (`src/app/(app)/builds/[buildId]/diff/[diffId]/diff-viewer-client.tsx`). The test detail page (`src/app/(app)/tests/[id]/test-detail-client.tsx:1015–1030`) has tabs for Code/Spec/Steps/etc. but no way to pick *two prior runs of this test* and ask "what changed between them?" across **all** the captured dimensions.

`recalculateDiff()` (`src/server/actions/diffs.ts:859–974`) already proves the model is sound — re-run only the diff step against persisted artifacts, no Playwright re-execution. We extend that pattern to DOM, network, and variables.

## Goal

A single inspector view, opened from a test, that:

1. Lets the user **pick two targets** (current run, baseline run) from the test's run history.
2. Diffs them across four dimensions in parallel:
   - **Visual** — runs the same engine the test is configured for (Pixelmatch / SSIM / Butteraugli — `src/lib/diff/engines.ts:362–380`).
   - **DOM** — structural diff of `testResults.domSnapshot` (`src/lib/db/schema.ts:432`).
   - **Network** — request-by-request diff of `testResults.networkRequests` (line 417) and `networkBodiesPath` (line 427).
   - **Variables** — set-diff of `testResults.extractedVariables` (line 437) and `assignedVariables` (line 443), plus `consoleErrors` (line 416) and `logs` (line 423).
3. Computes results **without re-running Playwright, without rebuilding the EB image, without scheduling a new build**. Pure server-side recompute over already-persisted JSON/binary artifacts.
4. Returns in well under a second for cached pairs (memoize on `(currentResultId, baselineResultId, engine, options)`).

## Competitive context

Researched May 2026:

| Tool | What they expose | What they *don't* |
|------|------------------|-------------------|
| **Playwright Trace Viewer** | DOM before/action/after, network, console, step timeline — all in one viewer | Single-run only; no diff between two runs |
| **Cypress Test Replay** | Time-travel DOM + network + console, streamed snapshot diffs | Cloud-only; single-run debugger, not pairwise compare |
| **Percy** | Stores DOM + assets so user can re-render at different widths without rerunning | DOM is for re-render, not surfaced as a structural diff |
| **Chromatic Diff Inspector** | Highlights changed regions in neon green, baseline-vs-new toggle | Visual-only surface; DOM archive is for rendering, not inspection |
| **Applitools Eyes 10.22** | Visual AI; nascent "DOM-vs-render-artifact" classification | Closed; DOM analysis isn't user-driven pairwise |

**Gap we fill:** none of the above lets the user pick *two arbitrary historical runs* of the same test and get a four-dimensional diff (visual + DOM + network + vars) on demand. Playwright's viewer is per-run; Cypress's is per-run; Percy/Chromatic are visual-first. Lastest already captures all four streams — the missing piece is the inspector.

## Non-goals

- Re-running the test. (The "Re-run" button stays where it is on the test detail page.)
- Cross-test comparison. (Same test, different runs only.)
- Editing baselines. (Approval flow lives in the existing diff viewer.)
- Net-new capture. Everything we diff is already persisted as of v1.3.

## UX

### Entry point
New tab on `src/app/(app)/tests/[id]/test-detail-client.tsx`, inserted between **Screenshots** and **History**:

```
Code · Spec · Steps · Criteria · Vars · Overrides · Screenshots · [Inspect] · History · Recordings · Versions
```

Label: **Inspect**. Icon: `lucide-react/Microscope`.

### Layout
Two-pane top bar for target selection, four-tab body for dimensions.

```
┌──────────────────────────────────────────────────────────────────┐
│ Current ▼  [Run #4821 · 2026-05-06 14:22 · build #312 · main]    │
│ Baseline ▼ [Run #4790 · 2026-05-05 09:01 · build #309 · main]    │
│ Engine: (•) pixelmatch  ( ) ssim  ( ) butteraugli   [Recompute]  │
└──────────────────────────────────────────────────────────────────┘
┌─[Visual]─[DOM]─[Network]─[Variables]─────────────────────────────┐
│                                                                  │
│  (per-tab body — see below)                                      │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### Target picker (Combobox, shadcn)
- **Current** defaults to the latest `testResult` for this test.
- **Baseline** defaults to the most recent run that's the baseline for the test's branch (use `getBaselineForTest()` lookup that already exists in `recalculateDiff()` at `src/server/actions/diffs.ts:879–905`).
- Both pickers list the last 50 runs with badges for `status`, `branch`, `buildId`, captured-at, and a small chip when artifacts are missing (e.g. "no DOM", "no network bodies"). Disable a tab if either side lacks the data.
- Swap button (⇄) between the two pickers.
- Pinned shortcuts: "Last passing", "Last failing", "Build N-1", "Approved baseline".

### Tabs

#### Visual
Reuse the existing diff viewer chrome (`diff-viewer-client.tsx`) but bound to the picker outputs. Engine selector mirrors the current test config but is overridable per inspection (radio group above the body). Below the image: classification (`changed` / `flaky` / `unchanged`), changed-region count, page-shift detection. Same component, different data source.

#### DOM
Side-by-side tree (left = baseline, right = current) backed by `DomSnapshotData` (`src/lib/db/schema.ts:86–112`). Use `src/lib/diff/dom-diff.ts` to compute the structural diff. Render as:
- **Tree view**: collapsed by default; expanded automatically along the path of any changed node. Color rows: green added, red removed, amber attribute-changed, gray unchanged.
- **Element panel** (right side, when a node selected): attribute table with per-attribute diff, computed selector, bounding box overlay button that highlights the node on the visual tab when toggled.
- **Filter bar**: `Only changes`, `Hide attribute-only changes`, `Hide whitespace`, search by selector or text.

#### Network
Two-column waterfall, baseline left, current right, aligned by URL+method. Backed by the `NetworkRequest` interface (`src/lib/db/schema.ts:14–28`).

| Column | Source |
|--------|--------|
| Method | `request.method` |
| URL | `request.url` (truncate, full on hover) |
| Status | `request.status` (color: 2xx green, 3xx blue, 4xx amber, 5xx red, failed magenta) |
| Δ Status | shown if differs between baseline and current |
| Δ Duration | `currentMs - baselineMs`, with sparkline if both present |
| Δ Size | `currentBytes - baselineBytes` |
| Body diff | indicator if `responseBody` differs; click to open inline JSON/text diff |

Filters: by resource type, by status class, "only differences", URL substring. Group-by: domain, resource type, request initiator (when available). Body diffing reads from `networkBodiesPath` lazily — file-system fetch on demand, not in initial payload.

Heuristics for matching across runs (since order varies): match by `(method, normalized URL, request index within URL group)`. Normalized URL strips known volatile query params (timestamps, cache busters) — configurable at the test level under existing `playwrightSettings`.

#### Variables
Three sub-sections:

1. **Extracted variables** (`extractedVariables: Record<string, string>`) — set-diff table: `key | baseline | current | Δ`. Keys missing on one side highlighted; values diffed inline (`react-diff-view` or simple char diff for short strings, line diff for multiline).
2. **Assigned variables** (`assignedVariables: Record<string, string>`) — same shape.
3. **Console & logs** — merged stream of `consoleErrors: string[]` and `logs: Array<{timestamp, level, message}>`. Toggle filter for level (error/warn/info/log/debug). Side-by-side run vs run with line-aligned diff. New errors highlighted.

### Header summary chip
Once all four diffs return, show a chip strip under the tabs: `Visual ●` `DOM ●` `Network ●` `Vars ●` — colored dots (green = unchanged, amber = minor diff, red = significant). Lets the user see "what's actually different" without clicking through every tab.

## Architecture

### New server action

`src/server/actions/inspector.ts` (new):

```ts
export interface InspectTargets {
  testId: string;
  currentResultId: string;
  baselineResultId: string;
  engine?: DiffEngineType;     // default: test config
  dimensions?: Array<'visual' | 'dom' | 'network' | 'variables'>;
}

export interface InspectResult {
  visual?: VisualDiffPayload;        // reuses existing DiffMetadata + image paths
  dom?: DomDiffPayload;              // tree of {path, kind, before, after}
  network?: NetworkDiffPayload;      // matched-pair list + summary
  variables?: VariableDiffPayload;   // {extracted, assigned, console, logs}
  classification: { visual: Severity, dom: Severity, network: Severity, variables: Severity };
  computedAtMs: number;
  cacheKey: string;
}

export async function runInspection(targets: InspectTargets): Promise<InspectResult>;
```

Auth via `requireRepoAccess()` based on `testId → repoId` resolution (same pattern as `recalculateDiff()`).

### Implementation plan

1. **Visual** — call `generateDiff()` with the chosen engine, reading both `screenshotPath`s. Identical to `recalculateDiff()` minus the baseline mutation.
2. **DOM** — extend `src/lib/diff/dom-diff.ts` with a pairwise comparator returning `{added, removed, modified, unchanged}` indexed by stable selector + DOM path. Currently dom-diff focuses on per-snapshot analysis; we add `compareDomSnapshots(a: DomSnapshotData, b: DomSnapshotData): DomDiffPayload`.
3. **Network** — new `src/lib/diff/network-diff.ts`. Match by `(method, normalizedUrl, occurrenceIndex)`. Compute deltas; lazy-load bodies on request from `networkBodiesPath`.
4. **Variables** — new `src/lib/diff/variables-diff.ts`. Pure object-diff over the four maps/arrays. Cheap; runs synchronously in the action.

Each dimension is independent — the action executes them in `Promise.all` and returns partial results if one throws (with an error chip on the dimension's tab).

### Caching

Memo key: `sha256(currentResultId | baselineResultId | engine | optionsJson)`.

Storage: lightweight `inspectorCache` table.

```ts
export const inspectorCache = pgTable('inspector_cache', {
  id: text('id').primaryKey(),                       // cache key
  testId: text('test_id').notNull().references(() => tests.id, { onDelete: 'cascade' }),
  currentResultId: text('current_result_id').notNull(),
  baselineResultId: text('baseline_result_id').notNull(),
  payload: jsonb('payload').$type<InspectResult>().notNull(),
  computedAt: timestamp('computed_at').notNull().defaultNow(),
});
```

Cache invalidation:
- On baseline approval (current diff flow already touches `visualDiffs`; add a hook to drop matching `inspectorCache` rows).
- TTL: 30 days, swept by the existing background job runner (`src/lib/db/queries/background-jobs.ts`).

### Routing

- Detail page tab uses client-side state — same URL `?tab=inspect&current=<id>&baseline=<id>&engine=<x>`. Shareable.
- API surface (for the Lastest MCP server, `packages/mcp-server/`): `POST /api/tests/:id/inspect` accepting `InspectTargets`, returning `InspectResult`. Same auth as the action.

### Performance targets

| Op | Cold (no cache) | Warm |
|----|-----------------|------|
| Visual (Pixelmatch, 1080p) | < 250 ms | < 50 ms |
| DOM diff (10k nodes each side) | < 150 ms | < 50 ms |
| Network diff (200 reqs, no body fetch) | < 50 ms | < 20 ms |
| Variables diff | < 10 ms | < 10 ms |
| **End-to-end inspection** | **< 500 ms** | **< 100 ms** |

Body diffs (network) and large screenshot diffs (Butteraugli) are lazy — only computed when the tab is opened or the row is expanded.

## Data dependencies (already in v1.3)

| Dimension | Source column | File capturing it |
|-----------|---------------|-------------------|
| Visual | `testResults.screenshotPath`, `testResults.screenshots` | `executor.ts`, runner |
| DOM | `testResults.domSnapshot` | `executor.ts:846`, `embedded-browser/src/index.ts:704–721` |
| Network meta | `testResults.networkRequests` | `embedded-browser/src/index.ts:490–547` |
| Network bodies | `testResults.networkBodiesPath` | same, written async |
| Variables | `testResults.extractedVariables`, `testResults.assignedVariables` | `executor.ts:855`, runner |
| Console | `testResults.consoleErrors`, `testResults.logs` | `embedded-browser/src/index.ts:519–520` |

Zero schema additions for capture. One additive table for cache.

## Settings

Add `inspectorSettings` group in the test settings drawer:

- `dom.ignoreAttributes: string[]` — defaults `['data-react-id', 'data-emotion', 'aria-describedby']`
- `dom.ignoreText: 'whitespace' | 'none'` — default `'whitespace'`
- `network.urlNormalizers: Array<{ pattern: string, replace: string }>` — defaults strip `t=`, `v=`, `cb=`, `_=`
- `network.ignoreHosts: string[]` — analytics endpoints, telemetry
- `variables.ignoreKeys: string[]` — for volatile keys like `requestId`, `nonce`

These travel with the test, so the inspection is reproducible.

## Key Files

| File | Purpose | New / Existing |
|------|---------|----------------|
| `src/server/actions/inspector.ts` | `runInspection()` action | new |
| `src/lib/diff/network-diff.ts` | Pairwise network request differ | new |
| `src/lib/diff/variables-diff.ts` | Pure object-diff helpers | new |
| `src/lib/diff/dom-diff.ts` | Add `compareDomSnapshots()` | extend |
| `src/lib/db/schema.ts` | Add `inspectorCache` table; `InspectorSettings` types | extend |
| `src/lib/db/queries/inspector.ts` | Cache get/put/invalidate | new |
| `src/app/(app)/tests/[id]/inspect/inspect-tab-client.tsx` | Tab body, target pickers, dimension tabs | new |
| `src/app/(app)/tests/[id]/inspect/visual-pane.tsx` | Reuse diff viewer chrome | new |
| `src/app/(app)/tests/[id]/inspect/dom-pane.tsx` | Tree + element panel | new |
| `src/app/(app)/tests/[id]/inspect/network-pane.tsx` | Waterfall + body modal | new |
| `src/app/(app)/tests/[id]/inspect/variables-pane.tsx` | Three-section diff table | new |
| `src/app/(app)/tests/[id]/test-detail-client.tsx` | Register the new tab | extend |
| `src/app/api/tests/[id]/inspect/route.ts` | Programmatic endpoint for MCP | new |
| `packages/mcp-server/src/tools/inspect-test.ts` | Expose to AI agents | new |

## Tests

Unit:
- `src/lib/diff/network-diff.test.ts` — match across reorderings, normalize URLs, body lazy
- `src/lib/diff/variables-diff.test.ts` — added/removed/modified keys, multiline values
- `src/lib/diff/dom-diff.test.ts` — extend with pairwise cases (move, attr-only, text-only, structural)
- `src/server/actions/inspector.test.ts` — auth guard, cache hit/miss, partial-failure surface

Integration:
- Two seeded test results with known DOM/network/var deltas → assert each pane renders expected diff payload.
- Cache invalidation on baseline approval.
- Missing-artifact graceful degradation (e.g. `domSnapshot === null` → DOM tab disabled, others still work).

## Open questions

1. Do we want to surface a **classification severity threshold** per dimension as a setting (so a CI-style "fail if Network severity ≥ amber" gate becomes possible later)? Out of scope here, but the payload shape supports it.
2. Should the `Inspect` tab also accept a third "reference" target for three-way views? Not in v1; revisit if users ask.
3. For DOM diffing on very large pages (>50k nodes), do we need a worker offload? Benchmark first; defer until we see real numbers.

## Rollout

- Feature-flagged via existing setting (`featureFlags.inspector`) so internal teams can dogfood before general release.
- No DB migration risk: additive table, no column changes to existing tables.
- No EB image rebuild required — purely host-side.
