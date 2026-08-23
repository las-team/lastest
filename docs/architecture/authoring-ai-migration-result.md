# `authoring-ai` migration — result

> ## UPDATE: migrated. This document's original body (below) is the
> pre-migration costing; the box above it in `core-plugin-refactor.md` and
> this update are the actual outcome.

**Status:** ~~attempted, **stopped before any code moved**~~ →
re-costed to **Go** after `54e05d08 core: AI browser tools capability
(AiCallOptions.browserTools)` landed → **migrated**. `plugins/authoring-ai/`
is a workspace package; `src/lib/playwright/{generator-agent,healer-agent,
enhancer-agent,planner-agent,planner-merger,planner-types,
scenario-grouping}.ts` and `src/lib/playwright/planners/` are deleted, not
left as re-exports.
**Recipe:** [`plugin-migration-recipe.md`](./plugin-migration-recipe.md).
**Phase:** RFC §9 phase 4, the fifteenth plugin — past the "14 of 14" line
phase 4 closed on, because this one had to wait on a core PR the costing
itself specified.

---

## 1. What actually shipped

Everything §2–§7 below costed as a paper estimate. The built port:

- **`plugins/authoring-ai/src/host.ts`** — 17 methods grouping into 9 items:
  `buildSeedFixture`, `getCodebaseIntelligence`, test read/write (3),
  functional-area read/write (4), `getRoutesByRepo`, `getRepoSpecFiles`,
  `summarizeDomChanges`, `getCurrentBranchForRepo`, `validateGeneratedTest`,
  and the three sideways calls (`aiScanRoutes`, `extractUserStoriesFromFiles`,
  `syncAreaPlanAndSpecs`). Above §1.5's ~15-method line by count, but the
  grouping is what §1.5 says to trust, and 9 groups is healthy for a feature
  this wide (four agents, four planners).
- **No `ctx.tests`/`ctx.repos` reuse.** Neither capability covers functional
  areas or the specific writes this feature needs (`updateTestCode` tagged
  `"ai_fix"`, `saveAreaPlan` with `planGeneratedAt`), so `host.ts` declares
  them narrow rather than widening a capability inside this PR — the same
  call `api-test` made for `ctx.tests`.
- **Two libs promotions, not host methods.** `extractCodeFromResponse` and
  `SELECTOR_ROBUSTNESS_RULES` (`src/lib/ai/prompts.ts`) are pure text
  helpers with zero `@/…` imports of their own, already shared by core
  (`ai.ts`) and three still-unmigrated pseudo-plugins (`play-agent.ts`,
  `spec-import.ts`, `specs.ts`) before this plugin needed them too — recipe
  §5's row-one case. Promoted to `libs/ai-kit/src/response-code.ts`;
  `src/lib/ai/prompts.ts` imports (not just re-exports) them, because five
  of its own prompt templates interpolate `${SELECTOR_ROBUSTNESS_RULES}`
  directly.
- **`getAIConfig`/`getAISettings` disappeared entirely, not just moved.**
  Every pre-migration agent called `queries.getAISettings` then
  `getAIConfig(settings)` by hand to build an `AIProviderConfig` for
  `generateWithAI`. `ctx.ai.generate()` already does exactly that
  internally (`src/lib/core/ai-capability.ts`), so switching the four
  agents onto `ai.generate({ browserTools: session, ... })` deleted the
  manual config-building code rather than turning it into a host method —
  a debt item the pre-migration cost table (§3) listed and the real port
  never needed.
- **`agent-context.ts` stays core, unmoved** (§5's false-lead finding
  held): `getAIConfig` is gone from the picture entirely (previous bullet);
  `buildSeedFixture` is the one piece of it the plugin still needs, and is
  now `host.buildSeedFixture()` — one method, not a reclassification.

## 2. The browser-tools capability, as consumed

`AiCallOptions.browserTools` shipped exactly as this document's original §2
specified. Consuming it collapsed real duplication: all four agents had
hand-rolled the identical `useMCP`/`mcpConfig`/`agentSdkStrictMcpConfig`
branch (four copies, one per file) to wire Playwright MCP against a raw
`cdpEndpoint`. `ai-capability.ts`'s `applyBrowserTools` is that logic once,
and the four agent files shrank to `ai.generate(prompt, { ..., browserTools:
session })` — no MCP config, no CDP string, ever, in plugin code.

`ctx.browser.withBrowser(...)` replaced every raw `claimEmbeddedBrowserForAgent`
/ `releasePoolEB` pair. One caller needed more than the one-shot
`agentCreateTest`/`agentHealTest` wrappers give: `qa-agent.ts`'s batch
generation step deliberately shares **one** EB across several sequential
generate calls ("so the live view is coherent and the pool isn't drained" —
its own pre-existing comment). `actions.ts` exports
`withAuthoringAiSession(repositoryId, claimOptions, fn)` for exactly that
shape: one `ctx.browser.withBrowser` claim, handed back as bound
`createTest`/`healTest`/`enhanceTest` calls that all reuse the same session.

**`BrowserClaimOptions.storageStateId` replaced a hand-rolled injection.**
The same `qa-agent.ts` call site used to fetch a storage-state row and call
`injectStorageStateIntoEb(eb.cdpUrl, ...)` by hand before generating, so the
generator's exploration browser matched the tests' auth. Under
`withAuthoringAiSession`, `storageStateId` is a claim option — core injects
it as part of the claim, and `session.authApplied` (surfaced on
`AuthoringAiSession`) is the same signal the pre-migration code derived
manually. This is not a new capability; it already existed for every other
plugin. `qa-agent.ts` (still unmigrated) is just the first caller to reach it
through `authoring-ai`'s wrapper instead of by hand.

## 3. Fixed for free: two call sites that could never have worked

Two consumers called the pre-migration `agentCreateTest`/`agentHealTestCore`
**without a `cdpEndpoint` at all** — `src/server/actions/play-agent.ts`'s
`runGenerate()` (the whole-area batch generator) and
`src/app/api/v1/[...slug]/route.ts`'s `POST /tests/:id/heal-full` handler.
Both would have hit the pre-migration functions' own guard
(`"[GeneratorAgent] cdpEndpoint is required — refusing to launch a
host-process browser"`) on every call, caught by their own `try/catch`, and
returned a canned failure. Whether either path was reachable in practice
wasn't re-derived here — flagging it because the new `agentCreateTest`/
`agentHealTest` claim a browser internally and now succeed where they used
to fail closed. Not a behavior change this PR chose; a side effect of the
boundary making the browser claim unconditional instead of caller-supplied.

## 4. What did not resolve

The three sideways calls this document's §4 found are unchanged in kind,
just relocated. `host.ts`'s `aiScanRoutes`/`extractUserStoriesFromFiles`/
`syncAreaPlanAndSpecs` are filled by `src/lib/core/authoring-ai-host.ts`
with dynamic `import()`s into `ai-routes.ts`/`spec-import.ts`/`specs.ts` —
the composition root importing an unmigrated action module, the same shape
`app-map`'s host used for its own unmigrated-neighbour calls. This plugin
does not make any of those three migratable; `ai-routes.ts` and `specs.ts`
remain unclassified orphans, and `spec-import.ts` remains its own oversized,
uncosted `PSEUDO_PLUGINS` entry.

## 5. What I did NOT verify

- **No runtime exercise of the AI/MCP path.** `pnpm build`, `pnpm test`
  (1790 tests) and `pnpm arch` all pass, and the emitted
  `.next/server/chunks/plugins_authoring-ai_src_actions_ts_*.js` chunk
  confirms the package compiled into the server bundle — but no agent
  actually generated or healed a test against a live Embedded Browser in
  this session. `src/lib/ai/authoring-ai.integration.test.ts` (rewired to
  call `agentHealTest` on a `PluginContext` built via
  `getPluginRuntime().contextFor(authoringAiPlugin, { repositoryId, teamId
  })`, the same trusted-background shape
  `explorer.integration.test.ts` uses) was not run — it needs
  `pnpm test:integration`, a live AI provider and a live EB pool.
- **`withAuthoringAiSession`'s `qa-agent.ts` rewiring** was not exercised
  end-to-end; only typechecked and linted.
- **No new unit tests were added** for `plugins/authoring-ai/` itself —
  `planner-merger.ts`/`scenario-grouping.ts` carried no tests before the
  move either (confirmed: no `.test.ts` alongside the originals), so none
  were dropped, but none were added.
