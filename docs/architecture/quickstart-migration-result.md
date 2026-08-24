# QuickStart migration — result

**Status:** landed. RFC §9 phase 4's fourteenth and last plugin.
**Package:** `plugins/quickstart/` → `@lastest/plugin-quickstart`
**Recipe followed:** [`plugin-migration-recipe.md`](./plugin-migration-recipe.md)

## 1. The headline

QuickStart is a one-click, nine-step agent: scout a founder's own site,
capture a demo login, generate and run a walkthrough test, mask run-to-run
noise, and publish a founder-facing `/r/<slug>` outreach share. It is the
third plugin out of the §6.2 `src/lib/playwright` split — `recorder` and
`ranger` already landed, `authoring-ai` stayed **stopped**.

QuickStart's own scout module, `src/lib/playwright/quickstart-scout.ts`,
hits the **identical blocker that stopped `authoring-ai`**: it hands a raw
CDP endpoint to an out-of-process `@playwright/mcp` binary so the AI can
drive the browser directly, and `core/contracts/src/browser.ts`'s
`BrowserSession` documents its own absence of that escape hatch verbatim
("notably absent is any way to obtain the CDP URL or the pod address").
Unlike `authoring-ai`, this was not the whole feature — `quickstart-scout.ts`
is 2 of QuickStart's 9 pipeline steps and ~16% of its lines — so rather than
stopping the migration outright, that one module **stays behind**,
unmigrated, in `src/lib/playwright/`, reached from the plugin through a
`QuickstartHost` method instead of an import. The rest of the pipeline — the
9-step orchestrator's control flow, gating, storage-state capture, build
orchestration, notes generation, baseline noise-masking, sharing, and the
full UI — migrated in full.

Burndown: **13 → 8** (`browser` 4→3, `cross-plugin` 5→3, `db` 3→2,
`pool-service` 1→0). Target layout stayed **0**.

## 2. Port size: 32 methods in 9 groups — larger than `share`'s 14, and why that is honest rather than a red flag

Recipe §1.5's stop line is "> ~15, the port would be bigger than the
feature." QuickStart's raw method count is roughly double that. It is not a
sign the boundary was drawn wrong, for the reason `share`'s own result doc
gave at a smaller scale: what stays in `plugins/quickstart/src/actions.ts`
after the port is declared is still the *entire* nine-step orchestrator's
control flow — the auth-mode decision tree (creds-provided login vs.
throwaway-signup vs. public-only), the storage-state reuse window, the
post-run auth-chain-failure downgrade-and-rerun, the share-readiness quality
gate — plus gating and ~1,250 lines of UI. The port is this large because
the *feature* is: QuickStart is an end-to-end demo pipeline that touches
nearly every other subsystem in the product on purpose (tests, builds,
diffs, storage states, shares, activity events). See `plugins/quickstart/
src/host.ts`'s own header for the full 9-group breakdown; the two worth
repeating here:

- **Session CRUD does not get its own table**, unlike `explorer`/`ranger`'s
  precedent for a plugin that can own its session data. QuickStart's rows
  are still `agent_sessions` (`kind: "quickstart"`), reached through four
  host methods. Two of its metadata fields (`quickstartEmail`/
  `quickstartPassword`) are *literally, deliberately* shared with the
  still-unmigrated `qa-agent` pseudo-plugin's own `kind: "qa"` rows — same
  field names, same AES-256-GCM encryption path, by core's own schema
  comment. Splitting QuickStart onto its own table would have meant either
  forking `crypto-fields.ts`'s field-name-keyed encryption or shipping the
  split with QuickStart's copy unencrypted. Left as inherited debt — see
  §4.
- **The scout group (5 methods) is scaffolding, not a permanent seam** — see
  §1 above and the host file's own item 5.

Everything else groups the way `app-map`'s "5 reads of one missing
capability" and `api-test`'s "one security boundary, two authorized writes"
did: gating/settings (6, one missing capability), test CRUD (3, `api-test`'s
exact shape), storage states (3, folds `storage-capture.ts` wholesale),
build orchestration + notes evidence (6, one missing capability), notes
persistence (4), activity (1, deliberately not `ctx.events` — see §3), share
(1).

## 3. `ctx.events` was tried and reverted — a capability that fits everywhere except here

QuickStart declares **zero capabilities**. `events` was the obvious first
choice (`ctx.events.emit()`, the shape `ranger` uses) and was reverted after
reading `plugins/events/src/host.ts`'s own `appEventsHost.emit` more
carefully: it hard-codes `sourceType: pluginId` and `agentType: null`. The
pre-migration code emitted every step event with `sourceType: "play_agent"`
and `agentType: "quickstart"` — that pairing is what makes
`play-agent-timeline.tsx`'s `PwAgentType`-keyed badge map render the pink
"QuickStart" chip in the shared activity feed, which QuickStart shares with
three other still-unmigrated agents (`play`, `qa`, and `ranger`'s
pre-migration form). Going through the generic capability would have
silently degraded every QuickStart activity event to an untagged,
unbadged row — RFC §2's "behaviour is held constant" losing to a capability
that looked like the right shape. `QuickstartHost.emitActivity` preserves
the exact original call shape instead; `ctx.repo`/`ctx.team` still arrive
through `contextFor()` for authorization even with an empty capability set,
since those fields are on `PluginContext`'s base shape regardless of `C`.

## 4. The sideways coupling: two functions shared with two other pseudo-plugins, resolved via a new `-shared.ts` shape

Recipe §1.6.2's sideways hazard, twice at once. `src/server/actions/
qa-agent.ts` imports `captureStorageState` from
`@/lib/quickstart/storage-capture` directly; `src/server/actions/
demo-notes.ts`'s `generateNotesForBuild` imports `generateDemoNotes` from
`@/lib/quickstart/quickstart-notes` directly, in a "reduced-facts mode" for
any build, not just a QuickStart session's own. Both `qa-agent` and `demo`
already have their own `PSEUDO_PLUGINS` entries, so per recipe's table this
is "blocked on that migration landing first (or being merged into this one,
if the coupling is genuinely mutual)."

The coupling is not mutual — both edges point one way, into QuickStart's
files — so merging either whole pseudo-plugin into this migration would
have been wildly disproportionate (`qa-agent` alone is the single largest
server-action file in the repo, 4,409 lines). Instead both functions moved
to `src/lib/core/` as shared, app-level code: `quickstart-storage-shared.ts`
and `quickstart-notes-shared.ts`. Both `qa-agent.ts`/`demo-notes.ts` and
`src/lib/core/quickstart-host.ts` (QuickStart's own host fill) call into the
same files. This is the `share-reads.ts`/`awards-host.ts` shape extended one
step: those precedents route a *migrated plugin's* cross-plugin read through
`src/lib/core/`; here **neither** caller is a migrated plugin, and the
callee (QuickStart) is the one that just became one. `src/lib/core/*` is the
one place in `src/` a pseudo-plugin may reach without tripping the
cross-plugin walker (it is composition-root code, not itself a
`PSEUDO_PLUGINS` entry), so the shape holds regardless of which side of the
edge is packaged.

One concrete consequence worth flagging: because `generateDemoNotes` stayed
app-level code rather than moving inside the plugin's own actions, it was
**not** rewired onto `ctx.ai`. `ai_prompt_logs.action_type` attribution is
therefore unchanged by this migration — still `"agent_discover"`, still
outside `src/lib/core/ai-capability.ts`'s `ACTION_TYPES` allowlist, exactly
as it was before this file existed. Recipe §7's "add your action type before
attribution silently vanishes" warning does not apply here, but only because
the design choice in §3/§4 kept this call path off `ctx.ai` entirely — worth
checking explicitly, not assuming.

## 5. `static-scout.ts` was never this feature — a third `spec-import`-shaped split

The RFC's §6.2 map named two files under `quickstart`'s `files`:
`quickstart-scout.ts` and `static-scout.ts`. Reading consumer lists (recipe
§1.6.2/§5's discipline) found they share no import, table, or type — only
the word "scout" in both names. `static-scout.ts` is a zero-import,
no-browser HTML scraper powering the generic `POST /api/v1/scout` endpoint
(also exposed over MCP as `lastest_scout_url`), consumed only by the
core-classified catch-all API route. Split into its own uncosted
`PSEUDO_PLUGINS["static-scout"]` entry — the same call `data-sources` made
for `spec-import.ts` and `scheduling` made for `scanner.ts` — rather than
migrated, dropped, or silently left attached to a plugin that no longer
exists. Whether it belongs in `libs/*` or `CORE_SRC_PATHS` is left for
whoever picks it up next; nothing about its classification was decided here.

A third file the RFC's map never named, `quickstart-templates.ts`, had
already been promoted to `libs/test-templates` in an earlier pass
(`shared-dependency-promotions.md`) and required no action.

## 6. A misfiled action, found only by reading the consumer, not the directory

`src/server/actions/settings.ts` — a general settings-actions grab-bag, not
itself a `PSEUDO_PLUGINS` entry — held `updateQuickstartEmailTemplate`
(~14 lines), genuinely QuickStart's own code (it writes
`teams.quickstartEmailTemplate`, a QuickStart-specific column on the core
`teams` table). It was invisible to every grep scoped to
`src/lib/quickstart`/`src/server/actions/quickstart*`, and its only caller,
`src/components/settings/quickstart-email-template-input.tsx`, was already
correctly listed under `PSEUDO_PLUGINS["quickstart"].components`. Moved into
`plugins/quickstart/src/actions.ts` alongside the rest.

## 7. `storage-capture.ts`'s host fallback: a legitimate reason to keep a `playwright` import outside the plugin

`captureStorageState`'s primary path already went through a runner claim
(`claimOrProvisionPoolEB` + `executeSetupViaRunner`) — not raw Playwright.
Its fallback path (`chromium.launch()` directly, guarded by
`!isKubernetesMode()`) exists specifically for self-hosted deployments with
**no EB pool at all**, which is exactly the deployment shape where
`ctx.browser.withBrowser` would also have nothing to claim from — that
capability wraps the *pooled* claim path, not a bare local launch. Rather
than force this into a capability it does not fit, the whole function moved
to `src/lib/core/quickstart-storage-shared.ts` unchanged, which is
composition-root code exempt from the `no playwright import` rule the same
way `src/lib/eb/inject-storage-state.ts` already is. This, plus the
sideways-coupling move in §4, is what makes QuickStart's own
`browser`/`pool-service`/`db` baseline violations (3 of the original 13) go
to zero rather than move to a host method that still imports `playwright`.

## 8. `getBuildSummary` is still session-dependent inside the pipeline — untouched, not a regression

`QuickstartHost.getBuildSummary` calls the app's existing
`getBuildSummary` action, which still runs `requireBuildOwnership` →
`requireTeamAccess` → `requireAuth` → `headers()`. That means
`runQsRunAndNotes`'s build-polling loop still cannot run outside a real
Next.js request — a genuine pre-existing architectural fact about
QuickStart (unlike `explorer`'s or `qa-agent`'s trigger dispatch, its step
pipeline was never built to run session-free), confirmed unchanged by
`quickstart.integration.test.ts`'s own long-standing comment on the same
boundary. Not a regression from this migration; noted so the next reader
does not mistake it for one.

## 9. Behaviour changes, stated plainly

- **`GET`/`DELETE /api/v1/quickstart/:sessionId` now go through the plugin
  action** (`getQuickstartSession`/`cancelQuickstart`) instead of a direct
  `queries.getAgentSession` read with an inline `teamId` check — the same
  shape the adjacent `ranger` handlers already used. Behaviourally
  equivalent: both resolve to the identical ownership check, just on the
  other side of `contextFor()`.
- **Three per-step diagnostic fields dropped**: `ebClaimed` (always `true`
  after a successful claim — trivially inferrable, never rendered by the
  panel) and the `richResult` parameter threading through `setCompleted`
  (never populated by any QuickStart call site pre-migration). Neither is
  observable from the UI or the API response shape.
- **Nothing else.** The nine-step pipeline's control flow, the auth-mode
  decision tree, the reuse window, the downgrade-and-rerun, and the
  share-readiness gate are otherwise byte-for-byte the same logic, moved.

## 10. What I did NOT verify

- **No live run.** Nothing here was exercised against a real EB pool, a real
  AI provider, or a real target site — no `pnpm dev` + `pnpm dev:pool`
  click-through of the QuickStart panel, no `pnpm test:integration` run of
  `quickstart.integration.test.ts` (it takes up to 30 minutes and drives a
  real build against `the-internet.herokuapp.com`). `pnpm test`,
  `pnpm types`, `pnpm lint`, `pnpm build`, and `pnpm arch` all pass; the
  integration test's imports were updated to match the new package paths and
  it type-checks, but it has not been *run*.
- **`src/lib/core/quickstart-host.ts`'s jsonb-boundary casts.** Several
  `QuickstartHost` methods narrow `agent_sessions.metadata`/`steps`/
  `currentStepId` with `as any` at the host boundary rather than a precise
  structural mapping or a `satisfies` assertion (recipe §6.1's preferred
  shape). The underlying field names are identical on both sides (the
  plugin's `types.ts` was written to mirror `AgentSessionMetadata`'s
  QuickStart-prefixed fields exactly), so this is believed safe, but it is a
  weaker guarantee than the rest of the port and a fair target for
  tightening later.
- **No `db:push` was run.** QuickStart owns no schema, so there is nothing
  to push — but this also means the "does the plugin registry boot cleanly"
  check (`src/lib/core/manifests.test.ts`, which does run in `pnpm test`)
  is the only check that exercised `resolveRegistry` against this plugin's
  manifest; nothing exercised `getPluginRuntime()` against a live database.

## 11. For whoever migrates `qa-agent` or `demo` next

Two files are waiting for you specifically: `src/lib/core/
quickstart-storage-shared.ts` and `src/lib/core/quickstart-notes-shared.ts`.
Both exist only because `qa-agent`/`demo` call into QuickStart's own logic
and neither side had migrated yet. Once your plugin exists, re-examine both
files — the coupling may resolve the way `awards`↔`share` did (both
directions through `src/lib/core/`, but now genuinely between two packaged
plugins) or the shared function may turn out to belong entirely to your
feature instead, with QuickStart becoming the reverse-read side.

And when you get to `qa-agent`: its `kind: "qa"` rows in `agent_sessions`
share the `quickstartEmail`/`quickstartPassword` field names and encryption
path with QuickStart's own `kind: "quickstart"` rows, by core's explicit
design. Read `plugins/quickstart/src/host.ts`'s item 2 before deciding
whether `qa-agent` gets its own table — the same constraint that kept
QuickStart on the shared table applies in reverse.

## 12. `quickstart-scout.ts` graduated later, and the five-method seam it left disappeared entirely

§2's item 5 called the scout group "scaffolding, not a permanent seam" and
predicted the `AiCallOptions.browserTools` core PR would retire it. It did,
and the prediction was exact enough to be worth recording as a positive
result rather than another finding.

**What landed.** `54e05d08 core: AI browser tools capability` added
`AiCallOptions.browserTools?: BrowserSession`, resolved to a CDP endpoint
only inside `src/lib/core/ai-capability.ts`'s `applyBrowserTools()` via
`@lastest/core-browser/internal`. `authoring-ai` consumed it first (see
[`authoring-ai-migration-result.md`](./authoring-ai-migration-result.md)),
which is what made this migration mechanical: the pattern was already proven
end-to-end, and `ai-capability.ts`'s `ACTION_TYPES` allowlist already carried
`agent_discover` — added speculatively during that migration with a comment
naming `@lastest/plugin-quickstart-scout` in advance. **Zero core changes
were needed here.** That is the framework compounding, the same effect
`playground` recorded against `launch`'s `onUserDeleted`.

**What moved.** `src/lib/playwright/quickstart-scout.ts` (561 lines) became
`plugins/quickstart/src/scout.ts`. Its two entry points changed signature
from `(repositoryId, baseUrl, { cdpEndpoint })` to
`(ai, session, repositoryId, baseUrl)` — the `authoring-ai` shape exactly.
Everything the module used to do by hand is gone: `getAIConfig` +
`queries.getAISettings` (`ctx.ai` resolves per-repo provider settings
internally), and `applyScoutMcpWiring` — a 40-line verbatim copy of the
strict-MCP/disallowed-tools wiring that now exists once, in
`applyBrowserTools`. The plugin's `package.json` gained no dependency; the
capability arrives on `ctx`.

**What the port lost.** All five scout methods (`claimScoutBrowser`,
`releaseScoutBrowser`, `injectStorageState`, `runPublicScout`,
`runAuthedScout`) **and** `getStorageStateJson` — six methods and one whole
group, replaced by **one** new method (below), for a net
**28 methods in 9 groups**. (§2's headline count of 32 was one short of a
strict signature count; 28 is measured against the interface as it stands.)
`getStorageStateJson` is the interesting removal: it
existed only so the plugin could read a stored state out as raw JSON and pass
it to `injectStorageState(cdpUrl, json)`. `BrowserClaimOptions.storageStateId`
injects by *id*, with core resolving the credential material — so the
migration did not just relocate that step, it **removed a path by which
credential material crossed the plugin boundary at all**. A port method that
disappears because the capability has a better shape than the host method is
the outcome §1.5 is trying to produce.

**The one method that had to survive the group.** Deleting the claim
methods would have deleted their error message too, and that message was not
generic. `describeEbClaimFailure` probed `getEbPoolHealth()` to separate "all
browsers busy, try later" from "pods provisioned but never became ready" —
the ImagePullBackOff case, whose fix is a specific command
(`pnpm stack:refresh:eb`) nobody can guess from `NoBrowserAvailableError`'s
"the pool is at capacity". A plugin cannot derive it; pool health is core's.
So `describeBrowserClaimFailure(err)` is the port's new item 5, called only
when `err.name === "NoBrowserAvailableError"`. That match is a string on both
sides — a plugin cannot `instanceof` a class it may not import — so the union
of names is declared once in `@lastest/contracts` as `BrowserErrorName` and
both sides annotate against it, which is what keeps a rename in `core/browser`
from silently turning every claim failure back into the generic message with
nothing failing to say so. **The generalisable point: a
retired host method's *diagnostics* are functionality, and they do not
retire with the mechanism.** Checking what the deleted branch reported, not
just what it did, is the step that catches this. Its honest future is a
`BrowserCapability` widening — core knows its own pool health, and every
plugin claiming a browser wants the same sentence.

**A behaviour change worth naming.** The old code decided
`preAuthenticated` from `injectStorageState`'s own boolean return; the new
code reads `session.authApplied`, which `core/contracts/src/browser.ts`
documents as `false` whenever no `storageStateId` was requested — so it
cannot mistake "did not ask" for "asked and failed". Same decision, sourced
from the contract instead of from a local variable.

**Two behaviour changes the capability's defaults would have made silently,
and the explicit values that stop them.** `withBrowser` bounds the *whole
callback*, where the old code's 5 minutes bounded only the claim and left the
scout itself unbounded. Taking `DEFAULT_DEADLINE_MS` would therefore have
converted a slow authed walk — the step whose login replay the code comments
already describe as taking minutes — into a torn-down session, so both call
sites pass `SCOUT_DEADLINE_MS` and `SCOUT_CLAIM_TIMEOUT_MS` explicitly; the
latter is the pre-migration number, kept by intent rather than by coincidence.
Core still clamps the deadline to `maxHoldFor(plan)`, which is the point: the
plugin asks for what the step needs and core decides what the tenant may hold.
Separately, folding the claim into the same `throw` as the AI loop had made a
failed *claim* in `qs_scout_authed` non-fatal, where it used to stop the
pipeline — a pool outage would have quietly downgraded every run to a
public-only walk. `describeScoutError` now returns a `kind` alongside its text
and the claim case stays fatal. **The generalisable point: when a hand-rolled
mechanism becomes a capability call, its *defaults* are a behaviour change even
though no line of feature logic moved — diff the timeouts, not just the
control flow.**

**Capability declaration.** `quickstart`'s manifest went from
`capabilities: []` — §3's "no real capabilities at all, and that is a
finding" — to `["ai", "browser"]`. That finding was true *because* the scout
could not be expressed; it is not true any more, and the honest reading is
that the empty set was always a measure of the missing capability rather than
of the feature. §3's other half still stands unchanged: `ctx.events` remains
the wrong shape for QuickStart's `sourceType: "play_agent"` tagging, and
`emitActivity` stays a host method.

**Note on §5 and §11.** `static-scout.ts` (§5) was resolved in the same pass
and went to `libs/static-scout` — zero imports, zero core calls, one caller,
so a `libs/*` promotion rather than either classification §5 left open. And
§11's advice about `demo` is now partly moot: that pseudo-plugin's entry is
gone (its two lib files reclassified core, its two actions confirmed dead and
deleted), so `src/lib/core/quickstart-notes-shared.ts`'s second consumer no
longer exists. The file stays shared for `qa-agent`, which is still
unmigrated; re-examine it when that lands.
