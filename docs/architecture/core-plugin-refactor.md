# RFC: Core + Plugins

**Status:** phases 0–4 landed — all 14 planned plugins migrated. `rca`,
`app-map`, `launch`, `api-test`, `playground`, `gamification`, `ci`, `share`,
`awards`, `ranger`, `recorder`, `data-sources`, `scheduling` and `quickstart`
done, `url-diff` resolved as core, the credential half of `scm` reclassified
as core. 8 pseudo-plugins remain uncounted, none of them one of the 14
(`share`'s captions half moved to `src/lib/demo-captions/`, unmigrated, not
counted as a plugin; `demo` itself is not a plugin either — see
`ranger-migration-result.md` §2; `spec-import` split out of `data-sources`,
unmigrated — see `data-sources-migration-result.md` §1; `route-scan` split
out of `scheduling`, unmigrated — see `scheduling-migration-result.md` §3;
`static-scout` split out of `quickstart`, unmigrated — see
`quickstart-migration-result.md` §5). `authoring-ai` was costed and
**stopped** — no core capability exists yet for "AI + live browser tools",
and its `planners/` files reach sideways into two other unmigrated features
— see `authoring-ai-migration-result.md`. `quickstart-scout` hits the
identical blocker and also stayed behind, split out of `quickstart` rather
than stopping that whole migration — see `quickstart-migration-result.md`
§1.

> **That blocker is gone.** `54e05d08 core: AI browser tools capability
> (AiCallOptions.browserTools)` landed the exact core PR both of those
> migrations asked for, built to the three implementation points
> `authoring-ai-migration-result.md` §2 specified. `authoring-ai`'s verdict is
> re-costed to **Go** (~21 calls, ~7 debt items) and `quickstart-scout` is
> unblocked with it. Read the UPDATE box at the top of
> [`authoring-ai-migration-result.md`](./authoring-ai-migration-result.md)
> before trusting any "stopped" wording in this document or in
> `tools/architecture/boundaries.mjs` — both predate the PR.
>
> `authoring-ai`'s second blocker (§4 of that doc — `planners/` reaching
> sideways into `spec-import.ts`, `ai-routes.ts` and `specs.ts`) survives as a
> fact but not as a stop: those are three host-port methods filled by the
> composition root, the shape `app-map` already used for its three calls into
> an unmigrated neighbour. It does not make the *other* features migratable;
> `ai-routes.ts` and `specs.ts` are still unclassified orphans.
**Author:** planning doc
**Supersedes:** nothing

> **Progress**
>
> - **Phase 0 — done** (`6dfa0dbe`). CODEOWNERS, the split-PR CI check, ESLint
>   boundary rules and the graph-test ratchet are live. Baseline: **42
>   violations**. Run `pnpm arch` for the current burndown. The map lives in
>   `tools/architecture/boundaries.mjs`.
> - **Phase 1 — done.** See [`core-plugin-spikes.md`](./core-plugin-spikes.md).
>   Three results change this document: §8's codegen fallback is unnecessary
>   (S1), §5 contradicts itself about plugin FKs (S2), and §4.2's `withRawPage`
>   is not needed on day one (S3). Those sections are annotated inline below.
> - **Phase 2 — done.** The kernel, `@lastest/contracts` and the
>   `@lastest/core-*` packages are live, and `explorer` is a package. §6 of this
>   document was **superseded by [`core-scope.md`](./core-scope.md)** in the
>   process: the RFC's bar for core ("more than one plugin needs it") let core
>   sprawl to nine modules, and the revised bar — *a module is core only if a
>   feature getting it wrong would break things for everyone else* — cut it
>   back. Read `core-scope.md` before arguing about where anything belongs.
>   Result: [`explorer-migration-result.md`](./explorer-migration-result.md).
> - **Phase 3 — done.** `CheckLayer` is a registry; `design-system` and `a11y`
>   are check-layer plugins. Both are table-light, and `design-system` proved
>   the no-schema shape (manifest + host port, no `ctx` at all).
> - **Phase 4 — done. 14 of 14 plugins done.** `rca`
>   ([result](./rca-migration-result.md)), `app-map`
>   ([result](./app-map-migration-result.md)), `launch`
>   ([result](./launch-migration-result.md)), `api-test`
>   ([result](./api-test-migration-result.md)), `playground`
>   ([result](./playground-migration-result.md)), `gamification`
>   ([result](./gamification-migration-result.md)), `ci`
>   ([result](./ci-migration-result.md)), `share`
>   ([result](./share-migration-result.md)), `awards`
>   ([result](./awards-migration-result.md)), `ranger`
>   ([result](./ranger-migration-result.md)), `recorder`
>   ([result](./recorder-migration-result.md)), `data-sources`
>   ([result](./data-sources-migration-result.md)), `scheduling`
>   ([result](./scheduling-migration-result.md)) and `quickstart`
>   ([result](./quickstart-migration-result.md)) have landed. `url-diff` did
>   not go to a plugin at all — it was **reclassified as core**: its in-app page
>   and sidebar entry were removed, and what is left has no user surface and
>   exists only to serve the documented `POST /api/v1/snapshot` and
>   `POST /api/v1/diff` endpoints. A documented public API is core by any
>   reading of `core-scope.md` §2. The repeatable procedure is written down in
>   [`plugin-migration-recipe.md`](./plugin-migration-recipe.md) — read that,
>   not §9 below, before migrating the next feature (the recipe is written for
>   *migrating a plugin*; what is left after phase 4 is the uncosted residue
>   listed in this doc's status line plus whatever a phase-5 capability
>   backlog decides to build first — see the end of this section).
>   Burndown: **42 → 34 → 32 → 31 → 22 → 21 → 21 → 21 → 20 → 20 → 19 → 19 → 18 → 14 → 14 → 13 → 8**.
>   `data-sources` is the third migration in a row to graduate without moving
>   the number — its coupling to core was through the query layer (allowed)
>   and, once found, through a core→feature *type* import invisible to the
>   walker in the other direction (recipe §1.6; see below).
>
>   **`scheduling` is the thirteenth, and the second migration (after `ci`) to
>   find that its map entry named a file that was misfiled two directories
>   deep, not just two features deep.** `src/lib/scheduling/scheduler.ts` sat
>   next to the feature's own `cron.ts` by directory convention, but three of
>   its four tick handlers dispatch *other* plugins' triggers — `core/jobs`'s
>   own `worker.ts` and `plugins/launch/src/domain/cohort-engine.ts` both
>   already described it, in their own doc comments, as "the app's
>   scheduler" *before this migration existed*. Reclassified (§1.6) to
>   `src/lib/core/scheduler.ts` — the composition root, not a new
>   `CORE_SRC_PATHS` entry, since the file's whole job is importing every
>   plugin, which is what the composition root is for. Only the one handler
>   that was genuinely the feature's own moved in substance, becoming a call
>   into the plugin's `dispatchDueSchedules()` — the same call shape
>   `dispatchDueExplorerTriggers`/`processLaunchCohorts` already used. The
>   map's second action module, `scanner.ts`, was never this feature either
>   (repository route discovery against core's `routes`/`tests` tables, ~25
>   core calls, nothing shared with schedules/cron) and split into its own
>   uncosted `PSEUDO_PLUGINS["route-scan"]` entry, the `spec-import` move
>   again. Costed at **1 host method**, `ranger`'s tier, once both
>   misattributions were subtracted. See
>   [`scheduling-migration-result.md`](./scheduling-migration-result.md) §2–3.
>
>   It is also the second migration (after `ci`) to delete a core auth helper
>   outright rather than port it: `requireScheduleOwnership` read the
>   feature's own table directly from `src/lib/auth/ownership.ts`, which
>   would have made core import a plugin once the table moved. Replaced by
>   `contextFor()` plus a two-line ownership check inside the plugin's own
>   action — recipe §3.1's "swallow the guard into the write" taken one step
>   further: here the *whole helper* disappears rather than moving inside a
>   host method, because the row it read was never core's to begin with. And
>   recipe §8's action-id count found a second dead action in a row (after
>   `ci`'s three) — `updateScheduleAction`, unreachable from any client
>   before the migration too, deleted rather than carried forward.
>
>   **`recorder` is the second plugin out of the §6.2 `src/lib/playwright`
>   split, and the first migration to produce a new `libs/` package out of
>   files that were never the feature's own.** `event-to-code.ts` and
>   `debug-parser.ts` sat under `PSEUDO_PLUGINS["recorder"].files` by
>   directory convention; their consumer lists said otherwise — core's own
>   `execution/executor.ts` and `playwright/assertion-parser.ts` import them,
>   alongside five app-level consumers that have nothing to do with
>   recording. Both are pure (zero imports of their own), which is recipe
>   §5's mechanical test for "promote to `libs/`" — and `libs/recording-codegen`
>   is what both core and the plugin now import, rather than either
>   reclassifying two guard-nothing files into `CORE_SRC_PATHS` or leaving
>   core with a `plugin-recorder` dependency. It is also the third migration
>   to find a **confirmed-dead file** sitting next to real feature code
>   (`debug-recorder.ts`, 651 lines, zero callers anywhere) — grep for the
>   *directory* had found it three separate times before anyone grepped for
>   its *exports*. And it is the first migration whose host port crosses
>   recipe §1.5's ~15-method line honestly: nineteen methods, but they group
>   into five debt items, and ten of the nineteen are one new capability
>   shape nothing has needed before — a runner-driven, WS-streamed recording
>   session, which fits neither `ctx.browser.withBrowser`'s short-lived
>   server-held `Page` model nor a plain core-table capability. See
>   [`recorder-migration-result.md`](./recorder-migration-result.md) §5 for
>   the exact grouping and what a future `RunnerChannelCapability` would
>   retire.
>
>   **`data-sources` is the third entry the map got wrong, and this time it
>   was wrong three ways at once, not two.** RFC §6.3 maps it to `lib/csv`,
>   `lib/google-sheets` and three action modules including `spec-import.ts`.
>   Reading import lists split it three ways: the parsing/REST-client code was
>   pure and promoted to `libs/csv`/`libs/google-sheets` before the plugin PR
>   (recipe §5); the Google Sheets OAuth refresh was a credential boundary and
>   stayed core, but — unlike `github`/`gitlab` OAuth — with exactly one
>   caller, so it became a few lines in a host file rather than a new
>   `CORE_SRC_PATHS` entry; and `spec-import.ts` turned out to share no table,
>   type or import with the other two in either direction — it is AI test
>   generation, not a data source, and its own port would run past recipe
>   §1.5's stop line (~20+ core calls). Left as its own uncosted
>   `PSEUDO_PLUGINS["spec-import"]` entry rather than migrated or dropped from
>   the burndown silently. See
>   [`data-sources-migration-result.md`](./data-sources-migration-result.md)
>   §1.
>
>   It is also the first plugin to declare `capabilities: ["storage"]`, and
>   the first to own both a table and a blob at once — which found a gap
>   `DeletionHook` was never built for: `StorageCapability` is scoped to
>   `(teamId, pluginId)` at construction from a `ContextScope`, and a deletion
>   hook has neither. The fix is the same shape `data/db.ts` already uses for
>   the table half (the wiring slot carries the raw `StorageHost`, and the
>   hook builds a scoped capability once it knows which team it is deleting
>   for), but nothing generalizes it yet — recorded as a capability gap for
>   whichever plugin next combines `schema` and `storage`. See §3 of the
>   result doc.
>
>   And it is the second migration (after `gamification`) to hit a
>   core→feature edge invisible to `pnpm arch` — but in the *type* direction
>   rather than the *call* direction. `src/lib/execution/executor.ts` (core)
>   needed `GoogleSheetsDataSource`/`CsvDataSource` to resolve
>   `{{sheet:}}`/`{{csv:}}` references in test code, and once those types moved
>   into the plugin's schema, importing them from core would have been exactly
>   the edge `gamification` inverted — except type-only, so `pnpm arch`'s
>   import-pattern walker would not have caught it even if it checked core's
>   imports at all (recipe §1.6 already knew it didn't check the *call*
>   direction; this is the same blind spot on the *type* direction). Resolved
>   two ways: the executor's own signatures were narrowed to `libs/csv`'s
>   `CsvSourceLike` / `libs/google-sheets`'s `SheetSourceLike` (recipe §6.1,
>   the type belongs to core's own resolution logic, not to the plugin), and
>   the DB read itself went through a `src/lib/core/data-sources-reads.ts`
>   re-export of the plugin's own `reads.ts` — the exact shape
>   `share-reads.ts` set for `awards`, reused here for a core consumer instead
>   of a sibling plugin.
>
>   **`ranger` is the first plugin out of the §6.2 `src/lib/playwright` split,
>   and the first migration whose cost was dominated by infrastructure its
>   old code got for free by sharing it with three still-unmigrated agents.**
>   The host port is one method — the fourth verbatim declaration of
>   `assertSafeOutboundUrl`, after `explorer`, `app-map` and `api-test` — so by
>   recipe §1.5 alone this reads like the cheapest migration yet. It was not:
>   369 old lines became 676, because `explorer` set the precedent that a
>   plugin able to own its session data stops sharing the polymorphic
>   `agent_sessions` table and gets its own, and a table costs a schema file
>   and a deletion hook the old code never had to pay for. **§1.5's port count
>   measures what a feature needs from core; it does not measure what a
>   feature was borrowing from its neighbours.** Both are real costs, and only
>   one of them shows up before you start.
>
>   It is also a positive instance of recipe §1.6's check paying for itself in
>   the other direction: grepping core for `demo` — the RFC's original next
>   pick — before costing it found that `src/lib/demo`'s two files are called
>   exclusively from core-classified auth/onboarding code and its two actions
>   have zero callers anywhere in the app. That pseudo-plugin is not a
>   migration candidate at all; see
>   [`ranger-migration-result.md`](./ranger-migration-result.md) §2 for the
>   detail, left unresolved here rather than folded into this PR.
>
>   Two smaller findings. **Migrating onto `ctx.browser.withBrowser` closed a
>   quota gap nobody was trying to close**: the hand-rolled claim path had no
>   run-minute check and no hold-time ceiling, and `core/browser`'s host
>   happens to wrap the identical pool-claim primitives the old code called
>   directly, so both arrived for free. And **a `"use server"` file can be the
>   wrong shape even with zero re-exports in it** — `actions.ts` initially
>   carried the directive out of habit (every other actions.ts in the repo
>   has it) and registered zero action ids in
>   `server-reference-manifest.json`, not because of the S1 re-export trap
>   (recipe §6) but because nothing in the plugin is ever called from a
>   client component. Dropping the directive is the `launch` precedent
>   applied one level down: a plugin's only surface being a route rather than
>   a page argues against `"use server"` even when the route lives in the
>   package that calls it rather than in the plugin itself.
>
>   **`awards` is the plugin `share` was migrated ahead of schedule to
>   unblock, and the estimate held exactly.** `gamification`'s result doc
>   costed it at "~8 methods, six of them core aggregate reads and one a
>   cross-feature read that wants `share` migrated first" before either
>   migration existed; the actual port came in at 8. The interesting part is
>   the shape of the unblocking: `awards` reads `share`'s latest-slug data and
>   `share`'s `ShareHost.getRepoAward` reads `awards`'s table right back — a
>   genuine two-way dependency between two features that may not import each
>   other. Both directions go through `src/lib/core/`
>   (`share-reads.ts`/`awards-host.ts` one way, `awards`'s own exports called
>   from `share-host.ts` the other), and neither needed `./runtime` — the
>   boot-order argument `share-reads.ts` already carried covered both
>   directions without being re-derived. It is also the fourth migration in a
>   row to need a table rename (`repo_awards` → `awards_repo_awards`) *and*
>   the second to need a real FK dropped by catalogue lookup rather than
>   merely a convention-only reference — `ci`'s shape, not `gamification`'s or
>   `share`'s. See [`awards-migration-result.md`](./awards-migration-result.md)
>   for the wiring shape (`gamification`'s "no `runtime`" pattern, arrived at
>   independently for badge/public-page anonymity rather than
>   pre-authorized-team reasoning alone) and the one component
>   (`AwardBadgeRow`) that stayed in the app as a render prop for `share`
>   while the primitives it renders with moved to the plugin.
>
>   **`share` is the largest host port yet (15 methods) and the first one
>   costed deliberately *at* recipe §1.5's own stop line rather than under
>   it.** The port would have been ~20 (past the line) except for two cuts
>   made for independent reasons, not to hit a number: video-fallback moved
>   to a `libs/` package instead of becoming a host method (it had zero
>   `@/…` imports and, unnoticed until this migration, an existing second
>   consumer outside the feature — see
>   [`share-migration-result.md`](./share-migration-result.md) §5), and
>   captions authoring (`src/lib/share/captions.ts`,
>   `generate-captions.ts`) turned out not to be this feature at all —
>   its action module was never listed under `share`'s `PSEUDO_PLUGINS`
>   entry, only its lib files were, and reading the consumer list rather
>   than the directory (§4 of the result doc) sent it to
>   `src/lib/demo-captions/` instead, unmigrated. Without both cuts, the
>   "is this worth doing yet" call in §1.5 would have gone the other way.
>
>   It is also the first migration to hit recipe §1.6's exact hazard in the
>   *reverse* direction. `gamification` found *core calling a feature*
>   (`createTest()` → `@/lib/gamification/hooks`); moving `share`'s table out
>   from under `src/lib/db/queries/awards.ts` (itself `CORE_SRC_PATHS`, since
>   it lives under `src/lib/db`) would have forced the opposite edge — *core
>   reaching forward into a plugin* — had `awards.ts` kept importing
>   `@lastest/plugin-share` directly. The fix is the same shape as
>   `gamification`'s inversion, not a new mechanism: `src/lib/core/
>   share-reads.ts` re-exports three of the plugin's own read functions, and
>   `awards.ts` calls those instead. One iteration of that file got it
>   wrong first — it called `getPluginRuntime()` defensively, which pulled
>   the *entire* composition root into `@/lib/db/queries`'s import graph
>   (nearly every module in the app) and broke an unrelated test's manual
>   mock. The fix: never import `./runtime` from a file that exists to be
>   called *from* the query layer — the same boot-order guarantee every
>   host already relies on covers it for free.
>
>   A structural-typing finding worth carrying into any future
>   `AwardBadgeRow`-shaped render prop: a narrowed type has to satisfy
>   everything *downstream* of the plugin, not just what the plugin itself
>   reads. `RepoAward` needed all 9 fields copied, not the 4 the share page
>   touches, because the render prop hands the value to a component in
>   `src/components/awards/` typed against the real, wide `RepoAward` —
>   a trimmed copy fails to type-check at exactly that boundary.
>
>   **`ci` is the first entry in the map that turned out to be two features, and
>   the finding is about §1.6 of the recipe rather than about CI.** §6.3 lists
>   one plugin, `scm` = `src/lib/github` + `src/lib/gitlab` + two action
>   modules. Grepping core for the feature's name — the check `gamification`
>   forced — came back with `src/lib/auth/auth.ts`, `src/lib/ai/`,
>   `src/lib/change-map/` and eleven more call sites, which on the gamification
>   reading is a large blocking core PR. It was not one, because **core was not
>   calling a feature; it was calling the part of `src/lib/github` that had been
>   misfiled as a feature.** Every module in the credential half (OAuth
>   exchange/refresh, encrypted token resolution, webhook signature
>   verification, repo-content reads) is a boundary `core-scope.md` §2 puts in
>   core without argument, and every module in the CI half had exactly one
>   consumer: its own action module. Nothing moved and nothing inverted — the
>   map was wrong. So a §1.6 hit has **three** possible resolutions, not one:
>   *invert* (`gamification`, blocking core PR), *reclassify* (`ci`, no code
>   moves) or *stop* (`url-diff`, extract the core module first). Treating them
>   all as the first would have priced this migration at roughly double.
>
>   It also produced the first *reduction* in what a port needs. Every
>   user-scoped plugin so far declared a `currentActor`-shaped host method;
>   this one does not, because its actions call `contextFor(ciPlugin)` with **no
>   scope request at all** and `resolveScope` falls through to
>   `requireTeamAccess()`. The team arrives from the session, authorized, with
>   nothing for an argument to influence — which was sitting in the kernel the
>   whole time. `requireTeamAdmin` is still a port method (role is not on
>   `PluginContext` and should not be), and it is now the **fifth** copy of the
>   `core/identity` gap: eight methods across four plugins.
>
>   Two smaller rules generalised out of it. **Recipe §8's action-id count
>   catches dead actions, not only the S1 trap** — it came back 10 for 13
>   exports, and the three missing were `"use server"` endpoints nothing had
>   dispatched *before* the migration either. A zero means the re-export trap; a
>   *partial* mismatch means dead RPC. And **§6's page rule generalises to API
>   routes**: this is the first route that is not a bare re-export, because six
>   of its seven concerns are core's. `launch` handed the whole request over;
>   here the plugin answers four questions about a config row and the app
>   composes. The deciding test is not "is it a route" but *what fraction of the
>   handler belongs to the feature* — moving it wholesale would have taken the
>   port from 9 to 15.
>
>   **`gamification` is the first feature that *core was calling*, and that is
>   the coupling nothing counted.** `createTest()` in `src/lib/db/queries/tests.ts`
>   ended with `import("@/lib/gamification/hooks")` — core reaching into a
>   feature, the one direction §3 forbids outright. `pnpm arch` never saw it,
>   because the walker builds its patterns from what a *plugin* may not import
>   and nothing inspects core's imports at all. So the strongest edge in the
>   feature was invisible to the burndown, to ESLint and to the graph test, and
>   it made the feature unmigratable as it stood: a package cannot be imported
>   from inside the query layer without making core depend on it. Inverting it
>   (core declares a port, the composition root registers the listener) was the
>   blocking core PR ahead of the migration. **Recipe §1.6 is now the check:
>   grep core for the feature's name before costing anything.**
>
>   Two more findings worth carrying. **The `<id>_` table prefix had been free
>   five times running, and it was luck** — five of gamification's six tables
>   needed renaming, and `drizzle-kit push` cannot see a rename: it drops the
>   old table and creates the new one, silently, under `--force`. Two of the old
>   names (`achievements`, `user_scores`) were generic enough to read like core
>   concepts, which is a better argument for the prefix rule than collision
>   avoidance. And **`export type { … }` inside a `"use server"` module compiles
>   to a runtime action export** and fails the production build on every page —
>   a sibling of the known `export { x } from …` trap, caught by `pnpm build`
>   alone after `types` and `lint` both passed.
>
>   It also produced the clearest statement yet of a *missing* capability rather
>   than a missing method. `ctx.events` exists and this is the first migrated
>   feature that genuinely wants it — every award writes an activity row — and
>   it cannot have it. A capability needs a `ContextScope`, and `awardScore` is
>   called from six app sites that hold an already-authorized `teamId`, which
>   `resolveScope` documents as background-paths-only precisely because
>   honouring it from a request would be a tenancy escape. What is missing is a
>   way to pass core a team the *caller has already authorized*, distinct from
>   one it is asked to trust blindly. That is a kernel change with a security
>   argument attached, so it is exactly the kind of thing that must not ride
>   along inside a feature PR.
>
>   **`playground` is the first migration whose port is worth building core
>   for, and it took two plugins to prove it.** Three methods — the smallest
>   port yet — and *all three* are declared verbatim in `plugins/launch/src/host.ts`:
>   resolve a bearer token to a person, rate-limit a key, look up display data
>   for a set of user ids. Two untenanted features, migrated independently,
>   arrived at the same three needs and nothing else. So the port's honest size
>   is **zero new debt items**: it adds nothing to the phase-5 backlog and
>   doubles the evidence for what is on it. One `core/identity` capability plus
>   a rate-limit capability would retire *both* ports completely — six methods,
>   two plugins, zero left. Neither made that case alone. This is §1.5's
>   "group by what each method is" taken to its endpoint, and it is the thing
>   to build before `share` and the rest of the user-scoped list, which will
>   otherwise each write another copy. (`gamification` landed next and wrote
>   four more — see above.)
>
>   It is also where **`launch`'s deferred core question got closed the way the
>   process intends.** That migration ended by noting nothing in the manifest
>   recorded untenanted-ness — the only signal was an absent `runtime` in the
>   wiring — and by declining to fix it as speculative until a second such
>   plugin existed. This is that plugin, so `tenancy: "team" | "none"` landed
>   first as its own commit. The field is a *narrowing*, not an exemption:
>   `resolveRegistry` then rejects every capability but `data`, rejects
>   `provides`, rejects job handlers, and `buildContext` throws if anything
>   builds a context for such a plugin anyway. **The instructive part is that
>   it was not blocking.** `launch`'s core PR (`onUserDeleted`) was — without
>   it the migration shipped a silent GDPR regression. This one was a guard
>   rail the feature would have worked fine without, and a guard rail bundled
>   into a feature PR is an afterthought or nothing. §7.2's split is what made
>   it get written at all, which is a different argument for the workflow than
>   `launch` supplied.
>
>   And the first evidence that **the framework investment compounds**:
>   `playground` needed *no* deletion-related core change, because `launch`
>   had already paid for `onUserDeleted`, the `"user"` `DeletionTarget` and the
>   `cascadePluginDeletion` call. Second plugin of a shape, materially cheaper
>   than the first. `gamification` confirmed it from the other side: it needed no
>   `tenancy` work at all, because that had already landed.
>
>   One rule generalised out of it, now recipe §3.2: **when `core-scope.md` §6
>   makes you delete a join to a core table, check the join type.** A
>   `leftJoin` is only supplying a column and a port method replaces it. An
>   `innerJoin` is supplying a column *and an existence predicate* — the
>   playground's leaderboard join was silently dropping rows whose user no
>   longer exists, and replacing only the display name would have put deleted
>   people back on a public board. The predicate is invisible in the column
>   list, which is where you would look.
>
>   **`api-test` is where the burndown stopped being the metric, on purpose.**
>   It went in at zero counted violations and came out at zero — and unlike
>   `app-map`, nothing was hiding: both counting hazards were checked and the
>   feature genuinely had none. The reason generalises to most of what is
>   left. The walker counts forbidden *imports*; this feature's coupling was to
>   core **tables** (`tests`, `test_results`) and core **auth**
>   (`requireRepoCapability`), reached through `src/lib/db/queries`, which is
>   `CORE_SRC_PATHS` and therefore allowed. A feature can be built almost
>   entirely on other people's data and score zero. **From here the host-port
>   count is the honest number**, and §1.5 of the recipe is where it lives.
>
>   It is also the first plugin that **persists data and owns no table** — an
>   API test *is* a `tests` row — which made `core-scope.md` §6 ("a plugin does
>   not reach a core table, it calls a core function") the whole design rather
>   than a rule that happened not to bind. Two consequences worth carrying
>   forward. First, `ctx.tests` did not fit and was deliberately not stretched:
>   its `createQuarantined` cannot express an un-quarantined write or an
>   update, so the gap was declared in the host port instead of widening a
>   capability inside a feature PR. Second, and better: **the two write methods
>   swallowed their own authorization.** `requireRepoCapability(…,
>   "tests:write")` and `requireTestOwnership` used to be the first line of a
>   server action, one statement away from the write they guard; they now run
>   *inside* the host's `createTest`/`updateTest`, and the plugin has no other
>   path to the table. Three surveyed symbols became zero port methods, and a
>   guard that could be forgotten became one that cannot be.
>
>   The same move fixed a credential leak-in-waiting the same way: `tests.code`
>   is human-visible and version-snapshotted, an `ApiTestDefinition` can carry
>   a live bearer token, and the *host* now renders that column from the
>   definition rather than accepting a pre-rendered string. The plugin keeps
>   the redaction logic (it is knowledge about its own `ApiAuth` type); core
>   keeps the decision to apply it.
>
>   **And §4.2's "escape hatch" argument has a positive twin worth naming.**
>   `runApiTest` had no test coverage at all, because covering it meant mocking
>   global `fetch` *and* an undici `Agent` — the feature owned both halves of
>   its own SSRF control. Moving the transport behind one host method
>   (`fetchGuarded`, "do the request", not "give me the guard") made a stub
>   four lines, and the request path is now covered. The honest framing: the
>   boundary did not create that testability by being a boundary — dependency
>   injection did — but the boundary is what forced the question. A migration
>   that had passed `@/lib/security` through the port wholesale would have
>   satisfied `pnpm arch` and produced none of it. That is the §10 "boundary
>   drawn wrong" risk in its most seductive form: it looks like compliance.
>
>   **`launch` is the first plugin with no tenant, and it needed a core PR to
>   be possible at all.** Its rows belong to a *person* — votes, comments,
>   reactions on a public board — not to a team, so the `DeletionHook`
>   contract's two targets (`onTeamDeleted`, `onRepoDeleted`) could not reach
>   them. Removing the `ON DELETE CASCADE` FKs to `users.id` that §5 requires
>   would have been a silent GDPR regression. `onUserDeleted`, a `"user"`
>   `DeletionTarget`, and a `cascadePluginDeletion` call in `deleteUser`
>   landed first as their own commit. That is §7.2's split-PR workflow paying
>   for itself: the gap was found *because* the core change had to be named
>   and reviewed separately.
>
>   It also breaks the LOC correlation in the opposite direction from
>   `url-diff`: **twice `rca`'s size, two thirds of its port** (4 methods vs
>   6). §4.1's `PluginContext` turns out to decompose more finely than
>   "you get a `ctx` or you get nothing" — launch takes a schema-scoped
>   `DataCapability` directly from its wiring slot and never builds a context,
>   because `ctx.team` would have been a lie. Worth knowing before `share`,
>   `gamification` and `playground`, which all have user-scoped surfaces.
>
>   **The 31 → 22 drop was not a migration.** It was four shared dependencies
>   promoted to `libs/` in one pass
>   ([result](./shared-dependency-promotions.md)) — `@lastest/github` alone was
>   6 violations, 19% of the burndown, because four features each imported it
>   across a feature line. §4.3's "promote the shared part" turns out to be
>   worth *doing first and in bulk*, not per-migration: a feature migration
>   would have converted each of those imports into a host-port method and
>   carried the coupling across the boundary in a nicer coat.
>
>   Every remaining `cross-plugin` violation is now a feature calling another
>   feature's *behaviour* (which wants `ctx.jobs`, not an import) plus one
>   storage item. The cheap structural wins are spent.
>
>   **The burndown is not a complete measure, and `app-map` is how we found
>   out.** It graduated without moving the number, because its one real
>   `plugin → plugin` edge was a *relative* import between two files in
>   `src/server/actions/` and `crossPluginPatternsFor()` only matches `@/…`
>   specifiers. Two such invisible edges existed; this removed one. Fixing the
>   walker is a `tools/architecture/` PR that will *raise* the baseline by one.
>
>   **`authoring-ai` — the next candidate after `recorder`/`ranger` out of the
>   §6.2 `src/lib/playwright` split — was costed and stopped, the second `Stop`
>   verdict after `url-diff` and for a related reason.** Every one of
>   `generator-agent.ts`/`healer-agent.ts`/`enhancer-agent.ts` and two of
>   `planner-agent.ts`'s three functions work by handing the AI provider live
>   MCP browser tools wired to a claimed EB's CDP endpoint, and neither `ctx.ai`
>   nor `ctx.browser` can express that. This is not the RFC's original §4.2
>   gap closing late — `core/browser`'s real `BrowserSession` contract says,
>   in its own docstring, that no CDP-URL escape hatch exists at all:
>   *"notably absent is any way to obtain the CDP URL or the pod address."*
>   The RFC's `withRawPage` sketch was never built; the shipped contract is
>   stricter than the draft. Unblocking this needs a scoped extension —
>   `AiCallOptions.browserTools?: BrowserSession`, resolved only inside
>   `src/lib/core/ai-capability.ts` so the URL still never reaches a plugin —
>   as its own core PR, not a paragraph in a migration doc.
>
>   It also surfaced a coupling shape recipe §1.6 did not have a row for:
>   `authoring-ai`'s `planners/` files import two other pseudo-plugins
>   sideways, and only one half of that is visible today. The call into
>   `src/server/actions/spec-import.ts` (already its own oversized, uncosted
>   `PSEUDO_PLUGINS` entry) is already a counted, visible `cross-plugin`
>   violation — `crossPluginPatternsFor()` generates a pattern from every
>   entry's paths, and `spec-import` has one. The call into
>   `src/server/actions/ai-routes.ts` is not: no `PSEUDO_PLUGINS` entry, its
>   own three-component UI surface, no classification anywhere, discovered
>   only by reading `code-planner.ts`'s import list — a genuinely invisible
>   `plugin → plugin`-shaped edge, the sideways twin of §1.6's core-ward
>   blind spot. See
>   [`authoring-ai-migration-result.md`](./authoring-ai-migration-result.md)
>   for the full costing, plus two false leads (a file that looked misfiled
>   into core and wasn't, and a file that looked like it should reclassify to
>   core and shouldn't) worth reading before anyone re-derives them.
>
>   **`quickstart` is the fourteenth and last plugin, and the first to hit
>   `authoring-ai`'s exact blocker without stopping.** Its own
>   `quickstart-scout.ts` hands a raw CDP endpoint to an out-of-process
>   `@playwright/mcp` binary — structurally identical to what stopped
>   `authoring-ai` — but it is 2 of QuickStart's 9 pipeline steps, not the
>   whole feature, so it split out into its own uncosted
>   `PSEUDO_PLUGINS["quickstart-scout"]` entry (the fourth `spec-import`-shaped
>   split, after `spec-import`, `route-scan` and this migration's own
>   `static-scout`) and stayed behind, reached from the plugin through a host
>   method instead of an import. Doubles the case for the
>   `AiCallOptions.browserTools` core PR `authoring-ai-migration-result.md`
>   asked for: it would now unblock two stalled migrations at once, not one.
>
>   It is also the largest host port of any phase-4 plugin — 32 methods in 9
>   groups, more than double `share`'s 14 — and, per recipe §1.5's own
>   framing, that is a property of the feature rather than a sign the
>   boundary is wrong: QuickStart is an end-to-end pipeline that touches
>   nearly every other subsystem (tests, builds, diffs, storage states,
>   shares, activity events) by design, and the port that stays this
>   large after grouping is the honest number, not an inflated one.
>
>   Two findings worth generalising. First, `ctx.events` was tried and
>   reverted: the generic provider hard-codes `sourceType: pluginId` /
>   `agentType: null`, but QuickStart's activity events need
>   `sourceType: "play_agent"` / `agentType: "quickstart"` to render correctly
>   in a feed shared with three other still-unmigrated agents — a capability
>   that fits everywhere else and silently changes behaviour here. Second, the
>   §1.6.2 sideways hazard hit *twice*, and neither caller (`qa-agent`,
>   `demo`) had migrated first, so recipe's "blocked on that migration landing
>   first" did not apply cleanly — both shared functions moved to
>   `src/lib/core/` as shared, app-level code instead, the `share-reads.ts`
>   shape extended to a case where neither side of the edge started out as a
>   real package. See
>   [`quickstart-migration-result.md`](./quickstart-migration-result.md).

## 1. The problem

The stated motivation, verbatim from the request that triggered this doc:

> Gondolkozz el egy refaktorban, ami az összes ilyen feature-t kiszervezi pluginokba (külön package vagy egyéb hard, non-src szeparációba) és a core egy API + core functions + plugin framework-szerű valamivé válik. Ebben a tempóban és ilyen feature-dömpinggel kb lehetetlen fenntartani a minőséget. […] vágyom rá nagyon hogy legyen egy "core" amihez nem nyúlunk, vagy ha igen, akkor az külön PR legyen és azt nagyon alaposan átnézem + a pluginekbe szervezett funkcionalitás ami csak a core-t hívhatja (tehát pl. ha EB-t drive-olna a QA agent, akkor a core-ban kell függvényeket meghívnia hozzá és nem direct-to-EB stb.)

Restated as requirements:

- **R1.** Features live in hard-separated units (workspace packages), not in `src/`.
- **R2.** Core is an API + core functions + a plugin framework. It is small and stable.
- **R3.** A change to core is *mechanically* a separate PR, and gets reviewed properly.
- **R4.** A plugin may only reach the platform through core. No plugin drives the
  embedded browser (EB), the DB, or an AI provider directly.

**R3 and R4 are the deliverable. R1 and R2 are the means.** Anything in this plan
that does not serve R3/R4 is optional.

### 1.1 Where we actually are

Measured on `claude/github-issue-creation-6ef1vk` (tip `c3ad7e1f`):

| Surface | Size |
| --- | --- |
| `src/` total | ~249,000 LOC |
| `src/components/` | ~63,600 LOC |
| `src/app/` | ~53,200 LOC, 49 API `route.ts` files |
| `src/server/actions/` | ~37,400 LOC across **74** files |
| `src/lib/` | ~48 subdirectories |
| `packages/db/src/schema.ts` | 5,766 lines, **97** tables |
| `src/lib/db/queries/` | ~12,500 LOC across 33 modules |
| existing workspace packages | 9 (`db`, `eb-protocol`, `embedded-browser`, `mcp-server`, `ocr-service`, `pool-service`, `runner`, `shared`, `vscode-extension`) |

Largest single server-action files: `qa-agent.ts` (4,409), `play-agent.ts` (3,455),
`builds.ts` (3,115), `explorer-agent.ts` (1,824), `quickstart-agent.ts` (1,821).

Two observations matter for how this refactor should be scoped.

**Good news: `src/lib/*` is already fairly decoupled.** Cross-feature imports are
thin. `src/lib/rca` imports only `@/lib/db`. `src/lib/comparison` imports only
`@/lib/db`. `src/lib/app-map` imports `@/lib/db` + `@/lib/security`. `src/lib/verify`
imports `@/lib/db` + `@/lib/comparison`. The dependency *graph* is close to
plugin-shaped already. What is missing is **enforcement** and **an injected
capability surface** — nothing stops the next feature from importing anything.

**Bad news: the coupling that does exist is exactly the coupling the request calls
out.** `chromium.connectOverCDP(cdpUrl)` appears at 10 call sites across 7 files:

```
src/lib/eb/inject-storage-state.ts     (core-ish, legitimate)
src/lib/explorer/tester.ts             (feature → EB, direct)
src/lib/playwright/ranger.ts           (feature → EB, direct)
src/lib/qa-agent/auth.ts               (feature → EB, direct)
src/lib/qa-agent/crawl.ts              (feature → EB, direct)
src/lib/qa-agent/explore.ts            (feature → EB, direct)
src/server/actions/play-agent.ts       (feature → EB, direct)
```

Feature code receives a raw `cdpUrl: string` and connects to the pod itself. This is
the concrete instance of the thing R4 forbids, and it is small enough to fix
deliberately — 6 files, not 600.

**The real weight is not in `src/lib/`.** It is in `src/server/actions/` (37k LOC,
where features reach across each other freely), `src/app/` (routes), and
`src/components/` (64k LOC). A plugin boundary that only covers `src/lib/` moves
~15% of a feature's code and leaves the rest behind. Any credible plan has to move
the *vertical slice*.

Vertical footprint of four candidate plugins (lib + actions + API routes + app routes
+ components):

| Feature | Total LOC | Surfaces touched |
| --- | --- | --- |
| `qa-agent` | ~13,700 | lib, actions, api route, app route, components, db/queries |
| `explorer` | ~5,100 | lib, actions, api route, app route, components, db/queries |
| `app-map` | ~3,800 | lib, actions, app route |
| `rca` | ~1,400 | lib, actions, components |

## 2. Non-goals

Naming these explicitly, because each one would multiply the cost with no benefit
against R3/R4.

- **Not a runtime plugin loader.** Plugins are not discovered at boot, not installed
  by users, not versioned independently. They are compile-time workspace packages
  linked into one build. Everything ships together.
- **Not a third-party plugin ecosystem.** No public SDK stability promise, no plugin
  marketplace, no sandboxing against malicious plugins. The threat model is "we
  ship features too fast", not "an attacker writes a plugin".
- **Not a rewrite.** No feature gets reimplemented. Code moves, imports change, a
  capability layer is introduced. Behaviour is held constant.
- **Not a monorepo re-tooling project.** pnpm workspaces + `transpilePackages` +
  `tsc` stay as they are. No Turborepo/Nx/Bazel.
- **Not "everything becomes a plugin".** Auth, billing, DB, execution, and the EB
  plane stay in core. See §6.

## 3. Target architecture

```
lastest/
├─ core/                        ← CODEOWNERS-protected. Change = its own PR.
│  ├─ kernel/                   @lastest/kernel      — plugin registry, context, lifecycle
│  ├─ contracts/                @lastest/contracts   — types only, zero runtime deps
│  ├─ browser/                  @lastest/core-browser— the ONLY path to an EB
│  ├─ data/                     @lastest/core-data   — db handle, table registration, tx
│  ├─ ai/                       @lastest/core-ai     — provider-agnostic prompt/structured calls
│  ├─ jobs/                     @lastest/core-jobs   — background job queue + handler registry
│  ├─ artifacts/               @lastest/core-artifacts — screenshots, evidence, quota
│  ├─ identity/                 @lastest/core-identity— requireAuth/Team/Repo, plan + entitlements
│  └─ events/                   @lastest/core-events — activity events, SSE fan-out
│
├─ plugins/                     ← where features go. One package per feature.
│  ├─ qa-agent/
│  ├─ explorer/
│  ├─ app-map/
│  └─ …
│
├─ packages/                    ← unchanged: db, eb-protocol, embedded-browser,
│                                 pool-service, runner, mcp-server, ocr-service, …
└─ src/                         ← shrinks to the Next.js shell:
   ├─ app/                        layout, auth pages, generated plugin route glue
   ├─ components/ui/              shadcn primitives + shared design system
   └─ lib/                        nothing feature-specific
```

Dependency rule, enforced (§7):

```
plugin  →  core        ✅
plugin  →  plugin      ❌  (compose via core events/jobs, never a direct import)
core    →  plugin      ❌  (core must not know a plugin exists)
plugin  →  @/…         ❌  (no reaching into the Next.js app)
plugin  →  playwright  ❌  (only core/browser may import it)
plugin  →  @lastest/db ❌  (only core/data may import it)
plugin  →  @lastest/pool-service ❌
```

### 3.1 Why packages and not just folders + lint rules

Folders + lint rules would satisfy R3/R4 on paper and cost a tenth as much. The
reason to use real packages anyway:

- A package has a `package.json` with an explicit `dependencies` list. "This plugin
  cannot import Playwright" becomes a fact about the manifest, verifiable by reading
  15 lines, not a lint rule someone can `// eslint-disable`.
- A package has one `index.ts`. The public surface of a feature becomes reviewable.
- `tsconfig.json` `exclude` already skips `packages/`; packages get their own
  typecheck, so a plugin cannot accidentally depend on app-wide global types.

If the cost estimate in §9 turns out to be unacceptable, the honest fallback is
**§7 enforcement applied to `src/lib/*` folders as-is** — that is ~15% of the work
for maybe 60% of the benefit, and it is a legitimate place to stop.

## 4. The plugin contract

A plugin is a package that default-exports one manifest.

```ts
// plugins/explorer/src/index.ts
import { definePlugin } from "@lastest/kernel";

export default definePlugin({
  id: "explorer",
  title: "Explorer",

  // Capabilities the plugin is allowed to ask the kernel for. The kernel builds a
  // PluginContext containing exactly these and nothing else. Adding a capability
  // is a visible one-line diff in the plugin's manifest — that is the audit trail.
  capabilities: ["browser", "ai", "jobs", "data", "artifacts", "events"],

  // Tables this plugin owns. Registered into the drizzle schema at build time.
  // Core tables are read-only to plugins (see §5).
  schema: () => import("./schema"),

  // Background job handlers, keyed by job type. Core owns the queue and the
  // polling loop; the plugin owns the body.
  jobs: {
    "explorer.run": (ctx, payload) => import("./jobs/run").then((m) => m.run(ctx, payload)),
  },

  // Server-side operations. The kernel generates the `"use server"` shims that
  // Next.js needs (see §8). Each op declares its own auth requirement.
  operations: () => import("./operations"),

  // UI surfaces. Route components + nav entries, resolved at build time.
  ui: {
    nav: [{ href: "/explorer", label: "Explorer", icon: "compass" }],
    routes: [{ path: "/explorer", page: () => import("./ui/page") }],
  },

  // Verify check-layers this plugin contributes (see §6.3).
  checkLayers: [],
});
```

Nothing here is dynamic at runtime. `definePlugin` is a typed identity function; a
build step (§8) reads the manifests and emits static glue.

### 4.1 `PluginContext` — the only thing a plugin gets

```ts
interface PluginContext {
  readonly pluginId: string;
  readonly team: TeamRef;          // team id + plan + entitlements, resolved by core
  readonly repo?: RepoRef;
  readonly log: Logger;            // pre-scoped to pluginId
  readonly browser?: BrowserCapability;
  readonly ai?: AiCapability;
  readonly jobs?: JobsCapability;
  readonly data?: DataCapability;
  readonly artifacts?: ArtifactsCapability;
  readonly events?: EventsCapability;
}
```

Capabilities are `undefined` unless declared in the manifest, and the generated types
narrow accordingly — a plugin that did not declare `browser` gets a type error on
`ctx.browser.…`, not a runtime surprise.

### 4.2 The browser capability — the load-bearing part

This is the request's own example, so it gets the most detail. Today feature code
gets a `cdpUrl: string` and calls `chromium.connectOverCDP`. Under this design it
never sees a URL.

```ts
interface BrowserCapability {
  /**
   * Claim an EB for this team, run `fn`, release it. Core owns: pool-service call,
   * plan-based priority class, storage-state injection, run-minute metering,
   * politeness/rate limiting, deadline enforcement, teardown on throw.
   */
  withBrowser<T>(opts: BrowserClaimOptions, fn: (b: BrowserHandle) => Promise<T>): Promise<T>;

  /** Same, N at once, for swarm-style crawlers (explorer, qa-agent). */
  withBrowserSwarm<T>(opts: SwarmOptions, fn: (b: BrowserHandle, i: number) => Promise<T>): Promise<T[]>;
}

interface BrowserHandle {
  goto(url: string, opts?: NavOptions): Promise<NavResult>;
  screenshot(opts?: ShotOptions): Promise<ArtifactRef>;   // lands in core artifacts, quota-checked
  snapshotDom(): Promise<DomSnapshot>;
  evaluate<T>(fn: string | (() => T)): Promise<T>;
  collectEvidence(layers: CheckLayer[]): Promise<EvidenceBundle>;
  readonly streamUrl: string;   // already-proxied, grant-signed. Never a pod address.

  /**
   * ESCAPE HATCH. Hands the plugin a raw Playwright `Page` for the claimed EB.
   * Still core-owned: core made the CDP connection, core closes it, core meters it,
   * and every call is logged with the pluginId + reason.
   *
   * This exists because wrapping all of Playwright is not realistic on day one
   * (qa-agent/crawl.ts and explorer/tester.ts use a wide slice of the API). Each
   * use is a tracked debt item; the goal is that the set of reasons shrinks over
   * time as recurring patterns get promoted into first-class BrowserHandle methods.
   */
  withRawPage<T>(reason: string, fn: (page: Page) => Promise<T>): Promise<T>;
}
```

> **Superseded by S3.** The premise above — that features use "a wide slice of the
> API" — is wrong. All six direct-CDP call sites together use **14 distinct
> Playwright operations**, half of them lifecycle calls that move into core
> wholesale, and zero uses of `route`/`waitForEvent`/`frames`/`addInitScript`/
> `tracing`/etc. `BrowserHandle` can be complete on day one; `withRawPage` should
> ship as a rarely-used release valve with its counter starting at 0, not as an
> expected default. See [`core-plugin-spikes.md`](./core-plugin-spikes.md) §S3.

The honest trade: `withRawPage` means R4 is not perfectly enforced on day one. What it
*does* buy immediately, and what makes it worth doing anyway:

- No plugin ever holds a pod address, so a plugin cannot outlive or leak an EB.
- Claim/release/metering/priority-class/teardown move to exactly one implementation.
- The escape hatch is greppable and countable. "12 `withRawPage` sites" is a number
  that can be driven to zero; "features import Playwright" is not.

### 4.3 Composition without plugin→plugin imports

`explorer` currently imports `@/lib/qa-agent`, and `qa-agent` imports
`@/lib/app-map/canonical`. Under the dependency rule these become:

- **Shared pure logic** (URL canonicalisation, politeness) → promote into
  `@lastest/contracts` or a core module. It is small and genuinely shared.
- **"Run the other feature"** → `ctx.jobs.enqueue("qa-agent.crawl", payload)` plus an
  event subscription. Asynchronous, typed by the job payload contract, no import.

If a promotion into core is contentious, that is a signal the two features should be
one plugin. Merging is allowed; a direct import is not.

> **Amended in practice: promote to `libs/`, in bulk, before migrating.** Two
> corrections from doing this for real
> ([result](./shared-dependency-promotions.md)):
>
> - **The destination is usually `libs/`, not core.** This section says
>   "promote into `@lastest/contracts` or a core module". `core-scope.md` §3
>   added a third tier after this was written, and it is where almost all of
>   these land: a GitHub REST client that takes its token as an argument, a
>   template renderer, a route scanner. None guards tenancy, capacity, money or
>   credentials, so none belongs behind a review gate.
> - **Do the promotions as their own pass, not inside a migration.** Counted by
>   *module imported* rather than by importing feature, four modules accounted
>   for nine violations across seven features. Migrating those features one at
>   a time would have turned each import into a host-port method — satisfying
>   the rule while preserving the coupling. Promotion deletes it.
>
> The test for "is this promotable" is mechanical: **read its import list.** If
> it imports nothing, or only other libs, it is a library. If it imports
> `@/lib/db`, `@/lib/ai` or a storage path, it is a feature or a boundary and
> promotion is the wrong answer.

## 5. Data ownership

97 tables in one 5,766-line file is the single biggest obstacle to hard separation,
and the part most likely to go wrong. Proposed split:

- **Core tables** stay in `packages/db/src/schema.ts`: teams, users, sessions,
  oauth, repositories, tests, testRuns, testResults, builds, visualDiffs, baselines,
  functionalAreas, runners, embeddedSessions, backgroundJobs, subscriptions, all
  settings tables. Roughly 45–50 of the 97.
- **Plugin tables** move to `plugins/<id>/src/schema.ts` — e.g. `explorerTriggers`,
  `qaTasks`, `agentKnowledge`, `agentExperience`, `agentFindings`, `qaAgentTriggers`,
  the `launch*` family (7 tables), the gamification family (`gamificationSeasons`,
  `bugBlitzEvents`, `scoreEvents`, `userScores`, `achievements`,
  `playgroundAchievements`), `buildDemoNotes`, `publicShares`, `repoAwards`.
- `drizzle.config.ts` globs `plugins/*/src/schema.ts` alongside the core schema, so
  `pnpm db:push` keeps working unchanged.

Rules:

- A plugin table name **must** be prefixed with the plugin id (`explorer_*`). Enforced
  by a unit test over the registered schema, so the namespace can't collide.
- A plugin may declare a FK **to** a core table. Core must never FK to a plugin table
  — that would make core depend on a plugin.
- `ctx.data` gives a plugin: its own tables (read/write) + a **read-only, scoped**
  view of core entities (`ctx.data.tests.get(id)`), never a raw drizzle handle.
  `@lastest/db` stays out of plugin `dependencies`.

  > **Amended by S2.** As written this contradicts the FK rule above: declaring
  > `references(() => repositories.id)` requires importing the `repositories`
  > table object, which lives in `@lastest/db/schema`. The ban was aimed at the
  > wrong target — `@lastest/db` (root) constructs a live pool, but
  > `@lastest/db/schema` is table definitions with no connection and grants a
  > plugin nothing. Fix: **`core/data` re-exports the core tables plugins may FK
  > to**, and plugin schemas import from there. `@lastest/db` stays out of plugin
  > manifests, and the permitted FK targets become an explicit list in core
  > instead of all 97 tables.
- Cascade-on-team-delete for plugin tables is registered through core so GDPR
  deletion stays complete. This is a real correctness risk if forgotten — it needs a
  test that asserts every registered table is reachable from the team-deletion path.

## 6. Classification: what is core, what is a plugin

Draft, to be argued over. The bar for **core**: more than one plugin needs it, *or*
it is a security/correctness boundary, *or* it is the product's definition (record →
run → diff → review).

### 6.1 Core

| Module(s) | Destination | Why |
| --- | --- | --- |
| `src/lib/db`, `packages/db` | `core/data` | ~12.5k LOC of queries; the substrate |
| `src/lib/execution` (5.4k) | `core/exec` | test execution *is* the product |
| `src/lib/eb`, pool-service client | `core/browser` | the R4 boundary |
| `src/lib/playwright` (12.8k) | **split** — see §6.2 | half core, half plugin |
| `src/lib/diff` (8.1k) | `core/diff` | pixelmatch + baseline hashing; the product |
| `src/lib/ai` (6.7k) | `core/ai` | provider abstraction; every plugin needs it |
| `src/lib/auth` (1.5k), `src/lib/billing` (2.2k) | `core/identity` | security + entitlements |
| `src/lib/storage` (0.4k), `src/lib/ocr` (0.4k) | `core/artifacts` | quota + evidence |
| `src/lib/verify` (1.4k), `src/lib/comparison` (2.1k) | `core/verify` | layer framework (§6.3) |
| `src/lib/ws` (0.8k), `src/lib/activity-events` | `core/events` | transport |
| `src/lib/security`, `src/lib/rate-limit`, `src/lib/crypto*` | `core/*` | security boundary |
| `src/lib/logger`, `src/lib/http`, `src/lib/utils` | `@lastest/shared` | already exists |

### 6.2 The `src/lib/playwright` split

12.8k LOC and the messiest call. Proposed line:

- **Core:** `runner.ts`, `code-transformer.ts`, `stabilization.ts`, `dom-snapshot.ts`,
  `differ.ts`, `helpers`, `constants`, `types`, `ocr` — the execution substrate.
- **Plugin `recorder`:** `debug-recorder.ts`, `event-to-code.ts`, `debug-parser.ts`.
- **Plugin `authoring-ai`:** `generator-agent.ts`, `healer-agent.ts`,
  `enhancer-agent.ts`, `planner-*`, `planners/`, `scenario-grouping.ts`.
- **Plugin `quickstart`:** `quickstart-scout.ts`, `quickstart-templates.ts`,
  `static-scout.ts`.
- **Plugin `ranger`:** `ranger.ts` (one of the direct-CDP offenders).

This split is the one most likely to be wrong on the first attempt. It should be
attempted late (phase 4), after the contract has been proven on easier features.

### 6.3 Plugins

| Plugin | Sources | Vertical LOC (approx) |
| --- | --- | --- |
| `qa-agent` | `lib/qa-agent`, `actions/qa-agent.ts`, `components/qa-agent`, api+app routes | ~13,700 |
| `explorer` | `lib/explorer`, `actions/explorer-agent.ts`, `components/explorer`, routes | ~5,100 |
| `app-map` | `lib/app-map`, `actions/app-map.ts`, app route | ~3,800 |
| `demo` | `lib/demo` (5.5k), `actions/demo*.ts` | ~6,000 |
| `share` | `lib/share`, `actions/public-shares.ts`, `(public)/r/*` | ~2,000 |
| `gamification` | `lib/gamification`, `lib/awards`, `leaderboard` route | ~2,500 |
| `launch` | `lib/launch` (1.0k) + `db/queries/launch.ts` (764) | ~2,500 |
| `api-test` | `lib/api-test`, `actions/api-tests.ts` | ~2,000 |
| `url-diff` | `lib/url-diff`, `actions/url-diff.ts`, app route | ~1,500 |
| `rca` | `lib/rca`, `actions/rca.ts` | ~1,400 |
| `design-system` | `lib/design-system` (check layer) | ~600 |
| `a11y` | `lib/a11y` (check layer) | ~500 |
| `playground` | `lib/playground` | ~500 |
| `data-sources` | `lib/csv`, `lib/google-sheets`, `lib/integrations` spec-import | ~3,700 |
| `scm` | `lib/github`, `lib/gitlab`, actions for actions/pipelines | ~3,500 |
| `scheduling` | `lib/scheduling`, `lib/scanner` | ~1,300 |
| `recorder`, `authoring-ai`, `quickstart`, `ranger` | from §6.2 | ~12,000 |

**`design-system` and `a11y` are the good news case.** `src/lib/verify/check-modes.ts`
already defines a 9-value `CheckLayer` union with per-layer enforce/log/disable modes.
That is a plugin registry with the extension point hard-coded. Turning `CheckLayer`
from a closed union into a registry that plugins contribute to is the smallest
possible proof that the framework works, and it makes "add a new check layer" a
plugin-only PR — one of the highest-churn kinds of change in this repo.

## 7. Enforcement — the part that actually delivers R3

Everything above is architecture. This section is the mechanism. **It can and should
land first, before a single file moves.**

### 7.1 CODEOWNERS

```
# .github/CODEOWNERS
/core/                  @ewyct
/packages/db/           @ewyct
/packages/pool-service/ @ewyct
/packages/eb-protocol/  @ewyct
/.github/               @ewyct
/k8s/                   @ewyct
```

With branch protection requiring code-owner review, a core change *cannot* merge
without an explicit review. This is R3, mechanically.

### 7.2 The split-PR check

A CI job that fails when one PR touches both core and plugins:

```
if PR touches core/**  AND  PR touches plugins/** :
    fail: "Core and plugin changes must be separate PRs.
           Land the core change first, then the plugin change on top."
```

Escape: a `core-and-plugin` label, applied deliberately, with the reason in the PR
body. Bootstrapping a new capability legitimately needs both — but it should require
saying so out loud.

### 7.3 Import boundaries (ESLint)

```js
// eslint.config.mjs
{
  files: ["plugins/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-imports": ["error", { patterns: [
      { group: ["@/*"],                    message: "Plugins cannot import app code. Use @lastest/kernel." },
      { group: ["@lastest/db", "@lastest/db/*"], message: "Use ctx.data." },
      { group: ["playwright", "playwright-core"], message: "Use ctx.browser." },
      { group: ["@lastest/pool-service", "@lastest/pool-service/*"], message: "Use ctx.browser." },
      { group: ["@anthropic-ai/*", "openai"], message: "Use ctx.ai." },
      { group: ["../../*/src/*", "@lastest/plugin-*"], message: "Plugins cannot import other plugins. Compose via ctx.jobs / ctx.events." },
    ]}],
  },
},
{
  files: ["core/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-imports": ["error", { patterns: [
      { group: ["@lastest/plugin-*", "../../plugins/*"], message: "Core must not know about plugins." },
    ]}],
  },
}
```

**Land these rules in warn mode on day one, against the current `src/lib/*` layout**
(`src/lib/qa-agent` etc. treated as pseudo-plugins). The warning count becomes the
migration burndown metric, and it starts producing pressure immediately — before any
package exists.

### 7.4 Dependency manifests

A plugin's `package.json` simply does not list `playwright`, `@lastest/db`, or
`@lastest/pool-service`. With pnpm's strict `node_modules` layout this is not
advisory — the import fails to resolve. This is the strongest guarantee available and
it costs nothing beyond writing the manifest honestly.

### 7.5 Graph test

One vitest that builds the import graph (`dependency-cruiser` or a small custom
walker) and asserts the §3 rules, so violations fail in `pnpm test`, not just lint.

## 8. Next.js integration

The genuine technical risk. Next.js App Router wants routes on disk under `src/app/`
and `"use server"` files that it can analyse. Three things need to work:

> **Resolved by S1 — this section is mostly moot.** A `"use server"` module inside
> a `transpilePackages` package **does** produce a real, dispatchable server
> action; `"use client"` components inside the package work; and a route page can
> live in the package with a one-line re-export on the app side. No codegen is
> needed for actions or pages — only the nav manifest below, which is a plain
> data array. If a shim is ever needed anyway, note that
> `export { x } from "pkg"` inside a `"use server"` file compiles to a module with
> **no exports**; it must declare wrapper functions. See
> [`core-plugin-spikes.md`](./core-plugin-spikes.md) §S1.

**Server actions from a package.** Next.js requires the `"use server"` directive and
does its own build-time analysis. Whether a `"use server"` module inside a
`transpilePackages` workspace package produces a working action ID is **unverified**
and is the first spike (§9, S1). If it does not work, fallback: the kernel codegen
emits thin `"use server"` files into `src/app/_generated/actions/<plugin>.ts` that
re-export the plugin's operations. Generated, committed, CI-verified up to date.

**Route pages.** Codegen emits `src/app/(app)/<path>/page.tsx` containing a single
re-export from the plugin's UI module. Static, committed, diffable.

**Nav.** `src/components/layout/sidebar.tsx` reads a generated manifest array instead
of a hard-coded list.

`transpilePackages` already contains four workspace packages and works, so the
compilation path is proven. The uncertainty is specifically about `"use server"`
semantics across a package boundary.

A codegen step people forget to run is a classic footgun. Mitigation: `pnpm dev` and
`pnpm build` run it via a `predev`/`prebuild` script, and CI runs it then fails on a
dirty tree.

## 9. Migration plan

Sequenced so that value lands before cost, and so the plan can be abandoned at any
phase boundary with the work done so far still being worth having.

### Phase 0 — Enforcement, zero code movement (~1 week)

Nothing moves. Add: CODEOWNERS, branch protection, the split-PR CI check, ESLint
boundary rules in **warn** mode mapped onto today's `src/lib/*` layout, the graph
test, and this document.

**Delivers R3 immediately.** Core is protected before any refactor exists. If the
rest of the plan is never executed, this phase alone changes how changes get
reviewed. Do not skip it, do not merge it together with phase 1.

### Phase 1 — Spikes (~1 week, throwaway code)

- **S1:** Does a `"use server"` module inside a `transpilePackages` package produce a
  working server action? *Blocks the entire UI story.* Answer before phase 2.
- **S2:** Does drizzle-kit handle a schema glob across `plugins/*/src/schema.ts`
  cleanly, with `pnpm db:push` still working?
- **S3:** How much of `qa-agent/crawl.ts` + `explorer/tester.ts` fits behind
  `BrowserHandle` without `withRawPage`? This calibrates how ambitious §4.2 can be.

If S1 fails and the codegen fallback also proves fragile, **stop and re-scope**: keep
plugins as pure server-side logic packages and leave UI in `src/`. That is a smaller
but still real win — it puts the browser/AI/data capability boundary in place, which
is the R4 half.

> **All three answered — see [`core-plugin-spikes.md`](./core-plugin-spikes.md).**
> S1 works (the stop-and-re-scope branch is off the table), S2 works but exposed
> a contradiction in §5, and S3 came back far better than assumed. Phase 2 is
> unblocked and slightly cheaper than estimated here.

### Phase 2 — Kernel + first plugin (~3 weeks) — **done**

Build `@lastest/contracts`, `@lastest/kernel`, `core/browser`, and migrate **one**
plugin end to end.

> **Landed, with one design correction.** The exit criteria below were met —
> `plugins/explorer` has no `@/` import, no `playwright` and no `@lastest/db`.
> What the phase also produced was evidence that §6's core was too big, which
> is why [`core-scope.md`](./core-scope.md) now supersedes it. Two things the
> RFC did not anticipate: shared pure logic wants a **third tier** (`libs/*`,
> neither core nor plugin, no review gate), and the gap between "what the
> plugin needs" and "what core exposes" is best made *visible* as a named
> **host port** rather than papered over — see `plugins/explorer/src/host.ts`,
> which started at eight methods and is at five.

**Pilot: `explorer`.** Rationale: ~5,100 LOC (large enough to be a real proof, small
enough to finish), and it exercises every capability at once — EB (direct-CDP
offender in `tester.ts`), AI, background jobs, its own tables
(`explorerTriggers`), an API route, an app route, components, and server actions.
`qa-agent` is the flagship but at 13,700 LOC it is the wrong thing to learn on.
`app-map` is easier but has no EB usage, so it would prove nothing about R4.

Exit criteria: `plugins/explorer` has no `@/` imports, no `playwright` dependency, no
`@lastest/db` dependency; explorer works identically in the app; the ESLint rules are
**error**-level for `plugins/**`.

### Phase 3 — Check-layer plugins (~1 week) — **done**

Convert `CheckLayer` from a closed union to a registry; move `design-system` and
`a11y` out as plugins. Small, high-signal, and it makes the highest-churn category of
change (new check layer) plugin-local.

> **Landed as specified.** The prediction in §6.3 held: this was the cheapest
> phase and it produced the two shapes every later plugin copies —
> `design-system` (owns no table, needs no `ctx`, host port only) and `a11y`
> (owns one `a11y_`-prefixed table, so `schema` + a `deletion` hook, which
> `resolveRegistry` refuses to boot without).

### Phase 4 — Roll out (~2–3 months, one PR per plugin)

In rough order of increasing pain: `rca`, `url-diff`, `app-map`, `share`, `launch`,
`gamification`, `playground`, `api-test`, `demo`, `data-sources`, `scm`,
`scheduling`, then the `src/lib/playwright` split (§6.2), then `qa-agent` last —
by which point the contract will have been through a dozen features.

> **`scm` did not exist as a single feature.** Half of it — OAuth
> exchange/refresh, encrypted token resolution, webhook signature verification,
> repo-content reads — is a credential boundary that `src/lib/auth/auth.ts`
> itself imports, so it was reclassified as core and stayed put. The other half
> became `@lastest/plugin-ci` (**9 host methods** for ~5,700 vertical LOC,
> 3,510 of it React). The plugin is named `ci` rather than `scm` because core
> now owns the source-control credentials, and a package called `scm` would
> misdescribe where the boundary is.
>
> Two entries on this list have now split in two — `gamification` into
> Beat-the-Bot + `awards`, and `scm` into core + `ci`. **Read the import lists
> before trusting an entry's boundaries**, not just its size or its name; the
> map was written from directory names and both times that was wrong in the same
> direction (one entry, two things).

> **`url-diff` was never migrated — it was reclassified as core.** Counted
> before starting it: its host port would need **~22 methods** for ~1,000 LOC of
> feature code — six diff engines from `src/lib/diff`, five EB-capture
> primitives, six background-job calls, three storage paths. A port larger than
> the feature it serves is not a boundary, it is core re-exported through a
> keyhole: it would satisfy "no `@/…` imports" while proving nothing, which is
> exactly the §10 risk of drawing the boundary wrong.
>
> The cause is that `url-diff` is not a feature sitting *on* core — it is a thin
> orchestration *of* core. Everything it orchestrates (`src/lib/diff` → §6.1
> `core/diff`, background jobs, the EB command queue) is classified core and
> **not yet extracted**. So it is blocked on a genuine core PR, which is the
> workflow §7.2 asks for, not a detour around it. Do `core/diff` first and
> `url-diff` becomes small.
>
> Compare `app-map`, done instead: **9 host methods** for ~3,000 LOC vertical,
> three of its four engine modules pure. **The cheap plugins are the ones that
> compute; the expensive ones are the ones that coordinate.** That is a better
> predictor than LOC for everything left on this list — and `app-map` sharpened
> it: 2,500 of its 3,000 LOC is React, and the UI cost almost nothing to move
> (two shadcn primitives to `libs/ui`, two render props). Coordination shows up
> in the port count; UI weight does not show up anywhere.

Each plugin is one PR that touches only `plugins/<id>/**` plus generated glue and
deletions from `src/`. If a plugin needs a new core capability, that is a **separate,
earlier PR** — which is exactly the workflow being asked for.

> **In progress — `rca` ([result](./rca-migration-result.md)) and `app-map`
> ([result](./app-map-migration-result.md)) done.** Findings worth knowing
> before the next one:
>
> - **A clean burndown is not proof of a clean feature.** `app-map` had zero
>   counted violations and still held a `plugin → plugin` import — written as a
>   relative path between two `src/server/actions/` files, which the walker does
>   not inspect. Before trusting a zero, run
>   `grep -rn 'from "\./' src/server/actions/<feature>.ts`.
> - **"One PR per plugin" *can* be free.** `app-map` needed **no core change at
>   all** — the counter-example to `rca` below. Where `rca` had to move its own
>   payload types into `@lastest/eb-protocol`, `app-map` declared narrow
>   structural copies in its host port and let the composition root's
>   `satisfies` clauses be the assertion that they still match. Prefer that when
>   the types belong to *another* unmigrated feature; prefer promotion when they
>   are the plugin's own.
> - **"One PR per plugin" is close to true, but not free.** `rca` needed two
>   core edits to be *possible at all*: the visual-diff jsonb payload types had
>   to move to `@lastest/eb-protocol` (a plugin cannot name its own verdict type
>   otherwise), and a shadcn primitive had to move to `libs/ui`. Both follow
>   precedents already set by phase 2/3. Expect a small core PR *ahead of* most
>   phase-4 plugins rather than none — which is the workflow working, not
>   failing.
> - **The ordering in this section is by LOC, and LOC is the wrong metric.**
>   `rca` is the smallest feature in the list and still took two core changes,
>   because what costs is *how many core tables a feature reads* and *which
>   primitives its UI touches* — not its size. Re-read the order with that lens.
> - **A feature that owns no tables is the easy case and most of this list is
>   that case.** No `schema`, no `deletion` hook, no `ctx` — just a manifest and
>   a host port. `rca` declared six port methods, four of which would collapse
>   into one `ctx.diffs` capability if core ever grows one.
> - **Owning tables is not the expensive part; owning *core-shaped* tables
>   is.** `launch` moved seven tables and a 764-line query module and it was
>   still the cheapest port of the three, because none of that data belongs to
>   anyone else. The one place it hurt was a single `leftJoin(users)` for a
>   comment author's display name — one join across the boundary cost one host
>   method and one extra round trip. Count *joins to core tables*, not tables.
> - **Grep core for the feature's name before costing the port.** A
>   core→feature import is invisible to `pnpm arch` — the walker inspects what
>   plugins import, not what core does — and it is blocking, because a package
>   cannot be imported from inside the query layer. `gamification` had one and
>   it was the largest single item in the migration. Recipe §1.6.
> - **Check the table names against the `<id>_` prefix rule.** Free five times
>   running, then five renames in one feature. `drizzle-kit push` resolves a
>   rename by dropping and recreating.
> - **Compare your port to the ports that already exist, method by method.**
>   `playground`'s three are all in `launch`'s four. A port that duplicates
>   another plugin's entirely is not four items of debt and three more — it is
>   the same three, now proven twice, and that is the argument for building the
>   core capability rather than a fifth host file. See the phase-4 note above.
> - **The second plugin of a shape is cheaper, and that is the return on the
>   framework.** `playground` needed no deletion-related core change because
>   `launch` had already landed `onUserDeleted`. First direct evidence in
>   phase 4 that a core PR forced by one migration is prepaid for the next.
> - **Read a feature's import list, not its directory name — and do it before
>   costing the port.** Two modules under `src/lib/launch/` were not launch's:
>   the OAuth redirect-URI allowlist (a credential boundary shared by three
>   clients, two of them not the launch board) and the board actor resolver
>   (already shared with `playground`). Both went to core in the pre-migration
>   commit. §4.3's amendment says do promotions in bulk and first; this is the
>   same lesson at feature scale, where the destination is core rather than
>   `libs/`.

### Phase 5 — Tighten (ongoing)

Drive `withRawPage` call sites toward zero by promoting recurring patterns into
`BrowserHandle`. Shrink `src/lib` to nothing feature-specific. Publish the burndown.

## 10. Cost, and the honest risks

**Cost.** Phases 0–3 are ~5–6 weeks and produce the protected core, the framework,
and two proven plugins. Phase 4 is 2–3 months of part-time work — roughly 20 PRs.
Total: a quarter, at the pace this repo currently moves. That is a lot, which is why
phase 0 is designed to deliver the primary benefit (R3) in the first week.

**Risk: the boundary gets drawn wrong.** §6 is a first draft and some of it is
certainly wrong — particularly the `src/lib/playwright` split. Mitigation: the pilot
is a single feature, and the split ordering puts the contentious calls last.

**Risk: `withRawPage` becomes the default path.** If every plugin uses it for
everything, R4 is satisfied on paper only. Mitigation: count the call sites in CI and
publish the number; a rising count is a visible failure.

**Risk: the codegen layer.** A build step that generates committed files is a
maintenance surface and a source of confusing errors. Mitigation in §8; and if S1
shows packages can host `"use server"` directly, most of the codegen disappears.

**Risk: churn collides with feature work.** Moving a feature into a package conflicts
badly with any in-flight branch touching it. Mitigation: check the open PR stack
before scheduling each phase-4 plugin, and do the noisy moves when that feature is
quiet.

**Risk: cross-cutting DB deletion.** Splitting the schema across packages can silently
break team-deletion cascades (a GDPR concern). Mitigation is the §5 test asserting
every registered table is reachable from the deletion path — this must land with
phase 2, not later.

**What this does not fix.** Plugin *internals* can still be low quality; the
boundary only protects core. `src/components/` (64k LOC) largely stays put in the
early phases. And none of this reduces the total amount of code — it only decides who
has to review which parts of it.

## 11. Decisions needed before phase 1

1. Is the §2 non-goal list right — specifically, is "no runtime plugin loading"
   acceptable forever, or is a third-party plugin story wanted later? (It changes the
   `PluginContext` design substantially.)
2. Is `explorer` the right pilot, or should it be something smaller?
3. Should `billing` be core (as proposed) or a plugin? Argument for plugin:
   self-hosted doesn't need it. Argument for core: entitlements gate every capability.
4. Directory name: `core/` at the repo root (as proposed) vs `packages/core-*`?
5. Is the phase-0-only fallback (§3.1 — enforcement on `src/lib/` folders, no package
   extraction) acceptable as a permanent end state if phase 4 stalls?
