# `authoring-ai` migration — result

> ## UPDATE (re-costed after `54e05d08`): **blocker 1 is resolved. The verdict is now Go.**
>
> §2 below asked for a specific core PR and specified its three implementation
> points. That PR has since landed as `54e05d08 core: AI browser tools
> capability (AiCallOptions.browserTools)` (+ `8243858c`, a test-typing fix),
> and it landed **exactly** as §2 specified — worth recording, because it means
> a costing document's "what would unblock this" section can be precise enough
> to implement from:
>
> | §2 asked for | Shipped |
> | --- | --- |
> | `core/browser` tracks `session → claim.cdpUrl` in a module-private structure, resolvable only by composition-root code | `CDP_BY_SESSION` (a `WeakMap`) + `resolveSessionCdpUrl`, exported from `@lastest/core-browser/internal`, deleted on teardown |
> | `core/contracts/src/ai.ts` gains an optional `browserTools` field | `readonly browserTools?: BrowserSession` |
> | `src/lib/core/ai-capability.ts` accepts it, resolves the URL, wires `useMCP`/`mcpConfig` | `applyBrowserTools()` — and it went further than asked: it throws on an unresolvable or expired session rather than silently degrading to a host-process browser, and it centralises the strict tool allowlist the four pre-migration files each hand-rolled |
>
> `BrowserSession`'s guarantee is intact — the plugin still holds an opaque
> object at every point, and the endpoint is never returned to a caller.
>
> **Blocker 2 (§4) still stands as a fact but no longer as a *stop*.** The
> three sideways calls — `spec-planner.ts → spec-import.ts`,
> `code-planner.ts → ai-routes.ts`, `planner-agent.ts → specs.ts` — are three
> host-port methods filled by the composition root, which is exactly what
> `app-map` did with its three calls into an unmigrated neighbour (one debt
> item, not three). §4 read them as fatal partly because blocker 1 made the
> question moot. They are not: a host method can call an unmigrated action
> module, because the *composition root* is allowed to import anything. What a
> host method cannot do is make the other feature migratable — that debt
> stays, and `ai-routes.ts`/`specs.ts` remain unclassified orphans (§7).
>
> **Re-costed port: ~21 raw calls grouping into ~7 debt items** — 13 core
> queries (functional areas ×4, tests ×3, repo/github ×3, AI settings, routes,
> agent session), `agent-context`'s `getAIConfig`/`buildSeedFixture` (×2),
> `computeDomDiff`, `getCurrentBranchForRepo`, `revalidatePath`, one
> `validateGeneratedTest`, and the three sideways calls. Above §1.5's ~15 line,
> below `quickstart`'s 32, and the grouping is healthy.
>
> Two costing corrections found while re-reading, both cheaper than §3
> assumed:
>
> - **Five of the six system prompts move *into* the plugin, not to a lib.**
>   `GENERATOR_`/`HEALER_`/`ENHANCER_`/`SCOUT_`/`DEEP_DIVER_SYSTEM_PROMPT` have
>   exactly one consumer each — their own agent file. `PLANNER_SYSTEM_PROMPT`
>   looks shared with `plugins/explorer/src/ai/planner.ts` and is not: explorer
>   declares its own const of the same name with different text. No
>   `libs/ai-prompts` is needed.
> - **`validation-retry.ts` should *not* be promoted.** §3 implied a lib. Its
>   dependency `validate-test-against-api.ts` reads
>   `process.cwd()/src/lib/ai/runner-api.d.ts` — recipe §5's row-three shape
>   (`video-fallback`'s near-miss). It stays core and becomes **one** host
>   method, `validateGeneratedTest(code)`, which is §3.1's stronger "do the
>   thing" form anyway. Moving a cwd-dependent asset inside a feature PR is the
>   drive-by this recipe keeps warning about.
>
> Everything below this box is the original, unamended stop verdict. Read it
> for the costing detail and the two false leads (§5, §6), not for the status.

**Status:** ~~attempted, **stopped before any code moved**~~ — **superseded by
the box above: blocker 1 resolved by `54e05d08`, verdict is Go, not yet
executed.** Costed per
[`plugin-migration-recipe.md`](./plugin-migration-recipe.md) §1.5/§1.6; the
`PSEUDO_PLUGINS["authoring-ai"]` entry is unchanged.
**Recipe:** [`plugin-migration-recipe.md`](./plugin-migration-recipe.md).
**Phase:** RFC §9 phase 4, the next candidate after `recorder`/`ranger` in the
`src/lib/playwright` split (§6.2).
**Not committed.**

---

## 1. The headline

`authoring-ai` — the AI test-generation family (`generator-agent.ts`,
`healer-agent.ts`, `enhancer-agent.ts`, `planner-agent.ts`, `planner-merger.ts`,
`planner-types.ts`, `scenario-grouping.ts`, `planners/*.ts`) — does not move
this round. Two independent blockers, either one sufficient on its own:

1. **The feature's core value proposition has no core capability behind it
   yet.** Every one of `generator-agent.ts`, `healer-agent.ts`,
   `enhancer-agent.ts`, and two of `planner-agent.ts`'s three functions work by
   handing the AI provider live MCP browser tools (`browser_navigate`,
   `browser_snapshot`, `browser_click`, …) wired to a real, claimed EB's CDP
   endpoint. Neither `ctx.ai` nor `ctx.browser` can express that today, and
   `core/browser`'s real contract says explicitly why not (§2).
2. **The `planners/` sub-bundle reaches into two other features that are
   themselves not migrated, not classified, and (where costed) already past
   the recipe's cost ceiling.** `spec-planner.ts` calls into `spec-import.ts`
   — already documented as an oversized, uncosted `PSEUDO_PLUGINS` entry in
   its own right — and `code-planner.ts` calls into `ai-routes.ts`, which has
   no `PSEUDO_PLUGINS` entry, its own three-component UI surface, and is
   claimed by nothing (§4).

Both are genuine "Stop" verdicts in the sense `url-diff` established: the port
would not be a boundary, it would be core (or a sibling feature) re-exported
through a keyhole. Nothing was moved; this document exists so the next person
does not re-derive the same finding from scratch, and so two false leads I
chased first (§5, §6) don't get re-chased either.

## 2. Blocker 1: there is no capability for "AI + live browser tools"

The RFC's original §4.2 sketched `BrowserHandle.withRawPage` as a day-one
escape hatch precisely for cases like this. It was never built. The real
`core/browser` contract (`core/contracts/src/browser.ts`) says so in its own
docstring, on the type every plugin actually gets:

```ts
/**
 * A claimed EB. Everything on it is a capability core is prepared to vouch for;
 * notably absent is any way to obtain the CDP URL or the pod address.
 */
export interface BrowserSession {
  readonly id: string;
  readonly page: DrivablePage;
  readonly streamUrl: string | null;
  extendDeadline(byMs: number): Promise<number>;
  isolatedPage(): Promise<DrivablePage>;
}
```

No `cdpUrl`. No raw-page escape hatch. `core/ai`'s contract
(`core/contracts/src/ai.ts`) is equally narrow — `AiCallOptions` has
`actionType` / `repositoryId` / `systemPrompt` / `signal` / `json` / `tier` and
nothing that could carry an MCP server config or a CDP endpoint.

The pre-plugin code holds a raw `cdpEndpoint: string` in five call sites
(`agentCreateTest`, `agentHealTestCore`, `agentEnhanceTest`,
`agentDiscoverAreas`, `runDeepDiveExploration`) and forwards it into
`generateWithAI(..., { useMCP: true, mcpConfig: { cdpEndpoint } })`, which
spawns `@playwright/mcp` as a subprocess pointed at that URL. It never calls
`chromium.connectOverCDP` itself — so it is not the same shape as the six
direct-CDP offenders RFC §1.1 named (`explorer/tester.ts`,
`qa-agent/{auth,crawl,explore}.ts`, `play-agent.ts`, `ranger.ts`, all fixed or
migrated already) — but it is the same *class* of problem: a raw pod-adjacent
URL sitting in feature-reachable code, one `mcpConfig` typo away from a
host-process browser (the code already throws defensively for exactly that:
*"refusing to launch a host-process browser"*, four times, in four files).

**What would unblock this** is a scoped extension, not a rewrite: `ctx.ai`
already exists, and `core/browser`'s `BrowserSession` is already an opaque
handle the plugin cannot introspect. The natural shape is
`AiCallOptions.browserTools?: BrowserSession` — the plugin passes the session
object it already holds from `ctx.browser.withBrowser(...)`, and
`src/lib/core/ai-capability.ts` (composition-root code, which already has a
legitimate path to the real claim) resolves whatever `generateWithAI`'s MCP
bridge needs from it *without ever handing the string back to the caller*.
That keeps `BrowserSession`'s own guarantee — "no plugin ever holds a pod
address" — intact; it does not relax it. Implementing it means:

- `core/browser/src/browser.ts` — track `session → claim.cdpUrl` in a
  module-private structure at construction, and export a function only
  composition-root code can call to resolve it back.
- `core/contracts/src/ai.ts` — add the optional `browserTools` field.
- `src/lib/core/ai-capability.ts` — accept it, resolve the URL, wire
  `useMCP`/`mcpConfig` into the existing `generateWithAI` call.

This is a real core capability with a real security argument attached — the
exact kind of thing RFC §7.2 and this repo's CLAUDE.md both say must not ride
along inside a feature PR. I did not design or implement it here; it needs
its own review, not a paragraph in a migration doc's justification section.

## 3. What the cost table would look like, if blocker 1 were solved

For the record — this is what §1.5 costing found, file by file, assuming the
`browserTools` capability above exists and every raw EB claim
(`claimEmbeddedBrowserForAgent`/`releasePoolEB`, three call sites) is replaced
by `ctx.browser.withBrowser(...)`:

| File | Core calls (would become host port / `ctx.*`) | Notes |
| --- | --- | --- |
| `generator-agent.ts` | `getAISettings`, `getFunctionalArea`, `getAIConfig`, `buildSeedFixture`, `generateWithAI`(+MCP) | `getAIConfig`/`buildSeedFixture` from `agent-context.ts` — already core, see §5 |
| `healer-agent.ts` | `getTest`, `getTestResultsByTest`, `getAISettings`, `updateTestWithVersion`, `getAIConfig`, `buildSeedFixture`, `getCurrentBranchForRepo`, `computeDomDiff`/`summarizeDomDiff`, `generateWithAI`(+MCP) | `getCurrentBranchForRepo` is `git-utils.ts` — not core, see §6 |
| `enhancer-agent.ts` | `getTest`, `getAISettings`, `getAIConfig`, `buildSeedFixture`, `generateWithAI`(+MCP) | subset of `healer-agent.ts` |
| `planner-agent.ts` | `getAISettings`, `getOrCreateFunctionalAreaByRepo`, `updateFunctionalArea`, `getActiveAgentSession`, `getAIConfig`, `buildSeedFixture`, `generateWithAI`(+MCP ×2, plain ×1), `syncAreaPlanAndSpecs` | last one is `specs.ts` — unmapped feature, see §4 |
| `planner-merger.ts`, `planner-types.ts`, `scenario-grouping.ts` | none | pure; stay in the plugin as-is |
| `planners/route-planner.ts` | `getRoutesByRepo`, `getFunctionalAreasByRepo` | the one clean planner |
| `planners/code-planner.ts` | `aiScanRoutes` | `ai-routes.ts` — unmapped feature, see §4 |
| `planners/spec-planner.ts` | `getRepository`, `getGithubAccountByTeam`, `getGithubAccount`, `getRepoTree`/`getFileContent` (already `libs/github`), `extractUserStoriesFromFiles` | last one is `spec-import.ts` — already-flagged oversized pseudo-plugin |
| `planners/browser-planner.ts` | `getFunctionalAreasByRepo`, plus the three own-file planner calls | raw EB claim → `ctx.browser.withBrowser` |

Grouped, that is roughly **13 genuine core reads/writes** (would collapse
toward a handful of methods, similar to `rca`'s six), **1 already-core
helper** (`agent-context.ts`, free), **1 unclassified utility**
(`git-utils.ts`), and **3 calls into two other non-core, non-plugin
features** (`spec-import.ts`, `ai-routes.ts`, `specs.ts`) that cannot be
ported around — they would have to be inverted, promoted, or migrated first,
per §1.6's three-way table.

Even with the MCP capability solved, this is not a clean "Go": it is a
`gamification`-shaped situation (a blocking dependency to resolve first) laid
over an `api-test`-shaped one (mostly core-table reads), with the added
complication that two of the blockers are sibling features, not core.

## 4. Blocker 2: `planners/` reaches into two unmigrated, unclassified features

`PSEUDO_PLUGINS["authoring-ai"].files` includes the whole `planners/`
directory. Reading each file's import list (not just its directory, per
recipe §1.6):

- `planners/spec-planner.ts` calls `extractUserStoriesFromFiles` from
  `src/server/actions/spec-import.ts`. That module already has its own
  `PSEUDO_PLUGINS["spec-import"]` entry, added specifically because
  `data-sources-migration-result.md` §1 found its own port would run past the
  recipe's ~15-method stop line on its own. Authoring-ai cannot route around
  that; it would inherit the same block. **This half is not a new finding —
  `pnpm arch` already counts it.** `crossPluginPatternsFor()` generates a
  pattern from every other `PSEUDO_PLUGINS` entry's paths, `spec-import` has
  one, so `authoring-ai (1) cross-plugin @/server/actions/spec-import
  src/lib/playwright/planners/spec-planner.ts:118` is already sitting in the
  current 13-violation burndown, and was before this document existed. What
  this migration attempt adds is the *consequence*: that counted violation is
  not fixable by porting a host method, because the thing on the other end is
  itself blocked.
- `planners/code-planner.ts` calls `aiScanRoutes` from
  `src/server/actions/ai-routes.ts` (799 lines). This one has **no**
  `PSEUDO_PLUGINS` entry at all — it is not core (not in `CORE_SRC_PATHS`),
  not a declared pseudo-plugin, and not `UNCLASSIFIED_SRC_PATHS` either. It
  has its own UI surface (`src/components/ai/code-diff-scan-dialog.tsx`,
  `ai-scan-routes-dialog.tsx`, `mcp-explore-routes-dialog.tsx`) that
  `authoring-ai`'s map never claimed. **This half genuinely is invisible to
  `pnpm arch`** — with no `PSEUDO_PLUGINS` entry there is no pattern to
  generate, so `code-planner.ts → ai-routes.ts` does not appear in the 13
  above at all. It is an orphaned feature the map never named, found only
  because `code-planner.ts`'s import list pointed at it.
- `planner-agent.ts` itself (not just `planners/`) calls
  `syncAreaPlanAndSpecs` from `src/server/actions/specs.ts` — same invisible
  shape as `ai-routes.ts`: unmapped, uncosted, not core, not counted.

None of these three is "core calling the feature" (§1.6's first row) — they
are the feature calling *sideways*, into other pseudo-features the map never
listed together. The three-way table in §1.6 (invert / reclassify / stop)
doesn't quite have a row for this, because it assumes the thing on the other
end of the import is core. Generalizing it, now recipe §1.6.2: when a
pseudo-plugin's own files import another pseudo-plugin, check whether the
other side already has a `PSEUDO_PLUGINS` entry — if it does, `pnpm arch`
already counts the edge (as it did for `spec-import` here) and the finding is
about the *consequence*, not the visibility; if it does not, the edge is a
genuine blind spot the same way §1.6's core-ward version is, and it has to be
resolved the same way `spec-import`/`route-scan` were — split into its own
tracked, uncosted entry, or migrate the upstream feature first. I've recorded
`ai-routes.ts` as exactly that kind of orphan below (§7) rather than silently
leaving it undiscoverable.

## 5. False lead 1: `agent-context.ts` does not need reclassifying

My first pass over `generator-agent.ts`/`healer-agent.ts`/`enhancer-agent.ts`/
`planner-agent.ts` flagged `src/lib/playwright/agent-context.ts`
(`getAIConfig`, `buildSeedFixture`) as a §1.6 hit: `src/lib/core/ai-capability.ts`
— unambiguously core — imports it, which looked exactly like `ci`'s
misfiled-boundary case.

It is not a finding. `tools/architecture/boundaries.mjs`'s `CORE_SRC_PATHS`
already lists `"src/lib/playwright"` in full (the §6.2 split note: *"The core
half of the split. The plugin half is enumerated per plugin below; anything
not named there stays core by default"*), and `agent-context.ts` is not named
under any plugin's `files` array. It was already core, already
CODEOWNERS-protected (`/src/lib/playwright/` in `.github/CODEOWNERS` covers
the whole directory), before this investigation started. `core/ai-capability.ts`
importing it is core importing core — no violation, no action. Recording this
so the next person checks the *directory's* `CORE_SRC_PATHS` membership before
re-deriving the same false alarm.

Once `authoring-ai` is packaged, `getAIConfig`/`buildSeedFixture` still need a
host-port method each (a plugin cannot import `@/lib/playwright/agent-context`
any more than any other `@/…` path) — that part of the original finding
stands. It is just not a *reclassification*.

## 6. False lead 2: `git-utils.ts` is a real gap, but not a `CORE_SRC_PATHS` one

`src/lib/git-utils.ts` (`getCurrentBranchForRepo`) is imported by
`src/lib/core/recorder-host.ts` — genuinely core, genuinely importing a file
outside `CORE_SRC_PATHS`. Unlike `agent-context.ts`, this one really is
unclassified: it is not in `CORE_SRC_PATHS`, not in `UNCLASSIFIED_SRC_PATHS`,
not any plugin's `files`. Eight other consumers (`tests.ts`, `play-agent.ts`,
`debug.ts`, `spec-import.ts`, `specs.ts`, `ai.ts`, plus `healer-agent.ts`
here) confirm it is genuinely shared, not authoring-ai's own.

I did **not** reclassify it to `CORE_SRC_PATHS`, and want to be explicit about
why, because "core already imports it" was the exact test that sent
`ci`'s `oauth.ts`/`content.ts` there. The difference:
[`core-scope.md`](./core-scope.md) §2's revised bar is not "core imports it"
— it is tenancy, capacity, money, credentials, or the registry. `git-utils.ts`
detects a branch name from CI env vars, a DB column, or a local `git`
subprocess call. It guards nothing. By the letter of §2 it is `libs/`
material, not `core/` material — putting it in `CORE_SRC_PATHS` would be
exactly the core-sprawl `core-scope.md` was written to stop.

It cannot go to `libs/` as-is either: `getCurrentBranchForRepo` takes a
`repositoryId` and calls `queries.getRepository()` itself, and
`FORBIDDEN_LIB_IMPORTS` bans `@/*` from `libs/*` for the same reason it is
banned from plugins. The real fix is a small, independent refactor — split
the pure branch-resolution logic (env vars → provided `selectedBranch` →
local `git rev-parse` → provided `defaultBranch`) from the one DB read, so the
pure part moves to `libs/git-utils` and each of the eight call sites passes in
the two branch fields it already has or can fetch. That touches eight files
for a genuinely-good but unrelated cleanup, which is more than this
migration's scope buys — flagging it here rather than doing it as a drive-by.

## 7. What actually changes in this PR

Nothing under `src/` or `plugins/`. Two doc-only updates:

- This file.
- A short paragraph in [`core-plugin-refactor.md`](./core-plugin-refactor.md)'s
  progress log, in the same style as the `url-diff` entry.
- A note added to `plugin-migration-recipe.md` generalizing §1.6 to
  pseudo-plugin → pseudo-plugin edges (§4 above), plus a pointer to check the
  *current* core contract rather than the RFC's original draft before
  assuming an escape hatch exists (§2 above).
- A one-line comment above `PSEUDO_PLUGINS["authoring-ai"]` in
  `tools/architecture/boundaries.mjs` pointing at this document, matching the
  existing `spec-import`/`route-scan` annotation style. `ai-routes.ts` is
  **not** added as a new `PSEUDO_PLUGINS` entry here — naming it would imply
  it has been scoped as a migration candidate, which it has not; it is
  recorded in this document instead, the same way `change-map` was left for
  `rca` to inherit rather than guessed at.

`pnpm arch` is unaffected: the current-layout burndown does not move, because
nothing here was ever counted as a violation (`authoring-ai` never opened a DB
handle or drove Playwright directly — its violation-free state is exactly the
"zero is not proof of a cheap migration" case `api-test`/`ranger` already
established, for a third reason now: sideways feature coupling doesn't trip
the walker any more than core-ward coupling past the query layer does).

## 8. What I did NOT verify

- **No runtime exercise.** Nothing in this feature ran. This was entirely a
  static read of imports and the current `core/contracts` source.
- **The cost table in §3 is a paper estimate**, not a built port. Actual
  grouping (which of the 13 core calls collapse into one capability) was not
  attempted past a first pass, because blocker 1 makes the exercise
  hypothetical until the MCP capability exists.
- **`ai-routes.ts` was not read in full** — only its import list and its three
  component consumers, enough to establish it is unmapped, not enough to cost
  it.
- **I did not check whether `spec-import.ts` or `ai-routes.ts` have their own
  sideways couplings** the way this document found authoring-ai's. If either
  gets migrated first, re-run this costing pass — the picture may improve on
  its own.
