# App Map migration — result

**Status:** done and building. `pnpm install`, `pnpm arch`, `pnpm lint`,
`pnpm types`, `pnpm test` and `pnpm build` all pass.
**Recipe:** [`plugin-migration-recipe.md`](./plugin-migration-recipe.md).
**Phase:** the second plugin of RFC §9 phase 4, after
[`rca`](./rca-migration-result.md).
**Not committed.**

---

## 1. The headline

`app-map` is a workspace package. `plugins/app-map/package.json` lists seven
dependencies — `@dagrejs/dagre`, `@lastest/contracts`, `@lastest/eb-protocol`,
`@lastest/kernel`, `@lastest/ui`, `@lastest/url-canonical`, `@xyflow/react`,
plus `sonner` — and no `playwright`, no `@lastest/db`, no `drizzle-orm`, no
`@lastest/pool-service`. There is no `@/…` import anywhere under
`plugins/app-map/`. `pnpm arch` reports **0 violations in the target layout**.

The moved surface, ~3,000 LOC vertical — the largest of phase 4 so far and the
first one where most of the weight is UI:

| Was | Now |
| --- | --- |
| `src/lib/app-map/build-map.ts` | `plugins/app-map/src/build-map.ts` |
| `src/lib/app-map/flows.ts` + `.test.ts` | `plugins/app-map/src/flows.ts` |
| `src/lib/app-map/hierarchy.ts` + `.test.ts` | `plugins/app-map/src/hierarchy.ts` |
| `src/lib/app-map/sitemap.ts` | `plugins/app-map/src/sitemap.ts` |
| `src/lib/app-map/canonical.ts` | **deleted** — it was already a shim over `@lastest/url-canonical` |
| `src/server/actions/app-map.ts` | `plugins/app-map/src/actions.ts` |
| `src/app/(app)/app-map/*.tsx` (8 files) | `plugins/app-map/src/ui/` |
| — | `plugins/app-map/src/{index,host,wiring}.ts`, `src/ui/page.tsx` |

14 unit tests moved with the code and pass unmodified apart from import paths.
Three files stay on the app side: `page.tsx` (now composition only),
`explore-progress-panel.tsx` and a new one-line `cancel-exploration.ts` — §5
says why.

**The build is the evidence, not the claim.** `server-reference-manifest.json`
carries **5 action ids** whose module is `plugins/app-map/src/actions.ts` — the
whole action surface — plus 1 for the app-side shim. Spike S1 holds for a
second package.

## 2. The burndown did not move, and that is the finding

`pnpm arch` was 31 before and is **31 after**. App Map had zero counted
violations going in, so removing its `PSEUDO_PLUGINS` entry removed nothing.

That is not because App Map was clean. `src/server/actions/app-map.ts` opened
with:

```ts
import { addQaTask, startQaAgent } from "./qa-agent";
```

A `plugin → plugin` import, forbidden by RFC §3 — and **the walker could not
see it.** `crossPluginPatternsFor()` in `tools/architecture/boundaries.mjs`
builds its patterns from `@/…` aliases; this was a *relative* import between
two files that both live in `src/server/actions/`. Every cross-plugin edge
written that way has been invisible since phase 0.

I measured the blind spot rather than guessing at it. Counting relative
imports between server-action modules owned by *different* pseudo-plugins:
there were **two** such edges in the repo, and this migration removed one. The
survivor is `quickstart → share` (`quickstart-agent.ts` → `./public-shares`).
So the hole is small — but it was hiding exactly the edge that made this
feature interesting, and "the burndown says 31" was never quite true.

**Recommended follow-up, as its own PR:** teach the walker to resolve relative
specifiers inside `src/server/actions/` against the pseudo-plugin ownership
map. It lives under `tools/architecture/`, which is CODEOWNERS-protected core,
and it would *raise* the baseline by one — which is the honest direction.
Deliberately not bundled here (RFC §7.2).

## 3. The shape: one capability, no schema, nine host methods

App Map owns **no tables**, and not by accident of the migration: the graph is
computed on read from data four other subsystems already persist. No `schema`,
therefore no `deletion` hook — the `design-system`/`rca` shape rather than the
`a11y`/`explorer` one. The recipe predicted this is the common case, and phase
4 is now two-for-two on it.

One capability is declared: **`repos`**, for `ctx.repos.baseUrl()`.

`AppMapHost` has **nine methods**, in three groups that have very different
futures — the full argument is in the file header of
[`plugins/app-map/src/host.ts`](../../plugins/app-map/src/host.ts):

| Group | Methods | Destination |
| --- | --- | --- |
| Repo discovery reads | `listRoutes`, `listAreas`, `listAreaIdsWithTests`, `getCrawlDiscovery`, `listTrajectoryResults` | one future `ctx.discovery` capability |
| Security boundary | `fetchSitemapXml` | `core/security`, together with explorer's `assertSafeOutboundUrl` |
| qa-agent seams | `getActiveExploration`, `requestCoverage`, `startExploration` | `ctx.jobs.enqueue("qa-agent.…")` when qa-agent migrates |

Only the middle one is a boundary in [`core-scope.md`](./core-scope.md) §2
terms. The five reads are reads core has no capability for; the three seams are
another feature, reached the only legal way (§5).

### 3.1 The one behaviour change

Base-URL resolution moved from two hand-rolled copies of

```ts
repo.branchBaseUrls?.[branch] ?? envConfig?.baseUrl ?? ""
```

(one in `buildAppMap`, one in `startExploration`) to a single
`ctx.repos.baseUrl(repositoryId, branch)`.

**Core's resolution order is not identical.** It tries
`branchBaseUrls[branch]` → `branchBaseUrls.main` → any other configured branch
URL → environment settings. The old code went straight from the first to the
last. So for a repo that has per-branch URLs configured for *some* branches but
not the selected one, *and* an environment base URL, App Map now builds against
`main`'s URL where it used to build against the environment URL.

This is deliberate and it is the only behaviour change in the migration. The
alternative was keeping a second, subtly different resolver inside a plugin —
which is the exact drift `ReposCapability` exists to prevent, and its doc
comment argues the point at length. Flagged here rather than buried because
RFC §2 says behaviour is held constant, and this is the exception.

### 3.2 Two things that got *stricter*

- **Authorization.** The actions used to call `requireTeamAccess()` and then
  trust `getSelectedRepository()`. They now take a `repositoryId`, and
  `contextFor({ repositoryId })` runs `requireRepoAccess` inside the runtime's
  `resolveScope`. Same guard the rest of the app uses, now unskippable.
- **The plan's explorer quota.** `planConfig(team.plan).maxExplorers` was
  clamped inside the feature's own action. It is clamped in
  `src/lib/core/app-map-host.ts` now, and the team is resolved from the
  *repository* rather than from the session the caller happens to hold. A
  feature that can clamp its own quota is not a quota.

## 4. Two type copies, and why they are not a fork

The plugin needs four core types it may not import: `QaDiscovery`,
`CapturedScreenshot`, `ExploreStrategy` and `QaExploreState`
(`UrlTrajectoryStep` was already in `@lastest/eb-protocol`, so it is imported
properly).

`rca` solved the same problem by **moving** its payload types into
`@lastest/eb-protocol`. That was right for `rca` — they were its own verdict
types. It would be wrong here: three of these four are *qa-agent's*
`agent_sessions.metadata` shapes, and promoting another plugin's payloads into
a core package ahead of that plugin's own migration is presumptuous.

So they are declared narrow in `host.ts` — the `RcaChangeMap` precedent — and
the assertion that they still match core lives in
[`src/lib/core/app-map-host.ts`](../../src/lib/core/app-map-host.ts) as
`satisfies` clauses on the values crossing the boundary. If core's shape
drifts, that file stops type-checking. **This migration therefore needed no
core change at all** — the first phase-4 plugin that did not.

`libs/ui` grew two primitives (`dialog`, `slider`, the `hover-card` pattern
from `rca`). `libs/` is the third tier and carries no review gate, so that is
not a core change either; the app keeps re-export shims at the old paths.

## 5. Why one component stayed behind

`explore-progress-panel.tsx` renders a live QA-agent session (`useQaAgent`)
inside core's EB stream viewer (`BrowserViewer`) — one plugin plus one core
component, both unimportable from a plugin. It is handed down as
`exploreProgressPanel`, exactly the way `src/app/(app)/explorer/page.tsx` hands
down `browserViewer`. `cancelExploration` is the same story for a server
action, and it is a *declared wrapper* rather than `export { cancelQaAgent }
from "…"` because a re-export inside a `"use server"` module compiles to a
module with no exports (spike S1's trap, hit deliberately this time).

The general rule this makes concrete, worth carrying forward: **a plugin owns
the placement, the app owns the thing placed.** The plugin decides where the
live view goes and when it mounts; it never learns what it is.

## 6. What this says about the phase-4 ordering

The recipe's port-size table said `app-map` was **~12** and viable. Measured
properly it came out at **9**, and the five discovery reads are one missing
capability rather than nine unrelated gaps — the "8–15" band's description
("expect most of the port to be one missing capability") was accurate.

The counting method matters more than the number. My first pass over this
feature counted **20** distinct imported symbols, which would have put it over
the stop line. That count included type-only imports and `@/components/ui`
primitives — neither of which is a *port method*, because types get narrowed or
promoted and primitives go to `libs/ui`. Count the **core functions the feature
calls**, as §1.5 actually says, and nothing else.

Two things I would tell the next person:

- **UI weight is not port weight.** 2,500 of App Map's 3,000 LOC is React, and
  it cost almost nothing to move: two shadcn primitives to `libs/ui` and two
  render props. The features that are expensive are the ones that *coordinate*
  (RFC §9's own conclusion), and coordination shows up in the port count, not
  in the LOC.
- **Check for invisible edges before trusting a zero.** A feature with no
  counted violations may simply be importing its neighbours by relative path.
  `grep -rn 'from "\./' src/server/actions/<feature>.ts` costs ten seconds.

## 7. What I did NOT verify

Be suspicious of everything in this section.

- **No runtime exercise whatsoever.** The app was never started. Nothing
  opened `/app-map`, rendered the graph, dragged a node, opened the Flows tab,
  or launched an exploration. `pnpm build` proves Next.js can resolve and
  register the five moved server actions and the eight `"use client"`
  components across the package boundary; it proves nothing about them
  rendering or dispatching.
- **The React Flow canvas is the least-covered thing here.** `app-map-client.tsx`
  is 1,225 lines with no unit test, and it took the most edits of any file in
  the migration (action signatures, two new props, five dependency arrays). The
  14 tests that pass all cover `flows.ts` and `hierarchy.ts` — pure functions
  that barely changed. If you exercise one thing by hand, make it this page.
- **`@xyflow/react`, `@dagrejs/dagre` and `sonner` resolving from inside the
  package is proven only by the build.** They are now declared in the plugin's
  own manifest; under pnpm's strict layout a missing one fails at import, and
  the build imports them. That is real, but it is not the same as the canvas
  mounting in a browser.
- **The behaviour-change in §3.1 is reasoned, not measured.** No repo with a
  partial `branchBaseUrls` map and an environment URL was constructed to
  observe the difference.
- **The integration test did not run.** `src/server/actions/qa-agent.integration.test.ts`
  calls `buildAppMap` and was updated for the new signature (it now passes
  `appAppMapHost` explicitly). It needs a database, a pool service and a real
  crawl; `pnpm test:integration` was not run.
- **No `db:push` was run and none is needed** — no schema changed. App Map
  owns no tables and none moved.
- **The blind-spot count in §2 is a static count** from a one-off script over
  `src/server/actions/`, not a permanent check. Until the walker change lands,
  nothing stops a new relative cross-plugin import from appearing.
