# RCA migration — result

**Status:** done and building. `pnpm install`, `pnpm arch`, `pnpm lint`,
`pnpm types`, `pnpm test` and `pnpm build` all pass.
**Recipe:** [`plugin-migration-recipe.md`](./plugin-migration-recipe.md).
**Phase:** the first plugin of RFC §9 phase 4.
**Not committed.**

---

## 1. The headline

`rca` is a workspace package. `plugins/rca/package.json` lists four
dependencies — `@lastest/contracts`, `@lastest/eb-protocol`, `@lastest/kernel`,
`@lastest/ui` — and no `playwright`, no `@lastest/db`, no `drizzle-orm`, no
`@lastest/pool-service`. There is no `@/…` import anywhere under
`plugins/rca/`. `pnpm arch` reports **0 violations in the target layout** and
the current-layout burndown went **34 → 33**: the `rca::db` entry is gone.

The moved surface, ~1,400 LOC vertical:

| Was | Now |
| --- | --- |
| `src/lib/rca/classify.ts` + `.test.ts` | `plugins/rca/src/classify.ts` |
| `src/lib/rca/correlate.ts` + `.test.ts` | `plugins/rca/src/correlate.ts` |
| `src/lib/rca/dynamic-text.ts` | `plugins/rca/src/dynamic-text.ts` (unchanged) |
| `src/lib/rca/run.ts` | `plugins/rca/src/run.ts` |
| `src/server/actions/rca.ts` | `plugins/rca/src/actions.ts` |
| `src/components/diff/rca-badge.tsx` | `plugins/rca/src/ui/rca-badge.tsx` |
| `src/components/diff/rca-panel.tsx` | `plugins/rca/src/ui/rca-panel.tsx` |

27 unit tests moved with the code and pass unmodified apart from import paths
and one fixture (§4).

## 2. The shape: no capabilities, no schema, one host port

RCA owns no tables. Every input it fuses is a core fact on a core table, and
its output is written into a core column (`visual_diffs.metadata.rca`). So the
manifest declares neither `capabilities` nor `schema` — it is the
`design-system` shape, not the `a11y` one.

The manifest is still not ceremony: registering in `MANIFESTS` is what makes
`contextFor()` resolve a scope for the plugin's action, and that is where
`requireRepoAccess` runs. A plugin outside the registry would have to authorize
itself.

`RcaHost` has **six methods**, all in `plugins/rca/src/host.ts`:

| Method | Why core does not cover it yet |
| --- | --- |
| `listBuildVisualDiffs` | `ctx.tests` covers test entities; there is no visual-diff capability at all |
| `getBuildChangeMap` | Change Map is core data with no capability; see the `change-map` note below |
| `getTestAreaIds` | **This is the one that mattered** — it replaced the raw drizzle query |
| `getTestsWithAnyPassedResult` | test-history read; a plausible future `ctx.tests` method |
| `updateDiffMetadata` | the write half of the missing visual-diff capability |
| `resolveRepoIdForBuild` | build → repo lookup, needed *before* a scope exists to authorize with |

None of the six is a boundary in [`core-scope.md`](./core-scope.md) §2 terms —
none can exhaust a shared resource, bypass metering, or leak a credential. They
are reads and writes over core tables that core has no capability for yet. Four
of the six (everything except `getTestAreaIds` and `resolveRepoIdForBuild`)
would collapse into a single `ctx.diffs` capability if one is ever built; that
is the obvious future core PR, and it is deliberately **not** bundled here
(RFC §7.2).

## 3. How `rca::db` actually died

`src/lib/rca/run.ts` held this:

```ts
import { db } from "@/lib/db";
import { tests } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";

const testRows = await db.select({ id: tests.id, areaId: tests.functionalAreaId })
  .from(tests).where(inArray(tests.id, testIds));
```

That query is now `getTestFunctionalAreaIds` in
[`src/lib/db/queries/tests.ts`](../../src/lib/db/queries/tests.ts), next to the
other test queries, and the plugin asks for it through
`RcaHost.getTestAreaIds`. The violation was never that RCA wanted those rows —
it was that feature code was building SQL against a core table through a shared
handle. Moving the query into the query layer is the fix; the port is just how
the plugin reaches it.

`classifyBuildDiffs` now takes the host as its first argument
(`classifyBuildDiffs(host, buildId)`) instead of closing over a module-level
`db`. Both trusted callers pass `appRcaHost`:
`src/server/actions/builds.ts` (post-build finalization) and the p2 spot-check
integration test.

## 4. Two core changes, and why they were unavoidable

Both are core edits that a strict reading of RFC §7.2 wants as their own PR.
They are listed separately here so they can be split at commit time.

**4.1 — The visual-diff payload shapes moved to `@lastest/eb-protocol`.**
`AlignmentSegment`, `PageShiftInfo`, `DomDiffResult`, `RcaCategory`,
`RcaSignal`, `RcaRegionCause`, `RcaVerdict` and `DiffMetadata` moved out of
`packages/db/src/schema/shared.ts` into `packages/eb-protocol/src/index.ts`,
which re-exports every name back so no core call site changed. This is the
*exact* precedent already set for the design tokens — the comment explaining it
was sitting in `shared.ts` — and CLAUDE.md already names eb-protocol as the
home for "persisted jsonb payload shapes". Without it the plugin cannot name
its own verdict type without importing `@lastest/db`.

**4.2 — `hover-card` moved to `libs/ui`.** `rca-badge.tsx` uses it and plugins
may not import `@/components/ui`. Same pattern as the nine primitives already
in `libs/ui`: definition moves, `src/components/ui/hover-card.tsx` becomes a
re-export shim, every existing app import is unchanged. Added
`@radix-ui/react-hover-card` to `libs/ui`'s dependencies.

**Not a core change, but worth flagging:** `ChangeMap` did **not** move. The
classifier reads two of its nine fields, so `host.ts` declares the narrow
`RcaChangeMap` shape and structural typing does the rest. `classify.test.ts`
builds a fixture carrying the full core field set and passes it where
`RcaChangeMap` is expected — that assignment is the assertion that the narrow
shape still matches core's real one.

## 5. The `change-map` debt this inherits

`RcaHost.resolveRepoIdForBuild` is implemented by calling
`@/lib/change-map/compute`, which `tools/architecture/boundaries.mjs` still
lists in `UNCLASSIFIED_SRC_PATHS` — the RFC names it neither core (§6.1) nor a
plugin (§6.3). The migration did not resolve that, deliberately: guessing would
have put a fake number in the burndown. Whoever classifies `change-map`
inherits this method and `getBuildChangeMap` with it.

## 6. What I did NOT verify

Be suspicious of everything in this section.

- **No runtime exercise whatsoever.** The app was never started. Nothing
  clicked a diff, opened the RCA panel, or ran a build to completion. `pnpm
  build` proves Next.js can *resolve* the moved server action and the two
  `"use client"` components across the package boundary; it proves nothing
  about them rendering or dispatching.
- **`recomputeBuildRca` has no callers and never did.** It was already dead
  code in `src/server/actions/rca.ts` before this migration — grep the repo.
  It was carried over unchanged rather than deleted, because this was a move,
  not a cleanup. It is therefore the *least* tested thing here: no build path
  invokes it, so nothing would notice if the wiring were wrong. If you want one
  thing exercised by hand, make it this.
- **The integration test did not run.** `p2-spot-checks.integration.test.ts`
  calls `classifyBuildDiffs` and is behind `vitest.integration.config.ts`; it
  needs a database. `pnpm test:integration` was not run.
- **No `db:push` was run and none is needed** — no schema changed. The
  eb-protocol move is types only; the column shapes are byte-identical.
- **The behaviour-preservation claim rests on reading, not on differential
  testing.** `classify.ts`, `correlate.ts` and `dynamic-text.ts` are unchanged
  apart from import lines, and their 27 tests pass. `run.ts` was genuinely
  rewritten (six inline calls became six host calls) and has **no unit test of
  its own** — it is covered only by the integration test that did not run.
