# Public share links migration — result

> **Superseded in part (wiring-shape collapse):** this doc describes the
> original `host`+`data` wiring where `ShareHost.requireRepoAccess`/
> `requireTeamAccess`/`requireTestAccess` did auth *and* actor enrichment.
> Those identity methods are gone: the plugin now has the standard tenanted
> wiring (`runtime`+`host`+`data`), authorizes through
> `runtime.contextFor()` + `requireActor(ctx)` (`ctx.actor`, `TeamRef.name`/
> `slug`, `RepoRef.fullName` carry what the host guards used to return), and
> its actions live behind `@lastest/plugin-share/actions` like every other
> plugin's. See recipe §4.1 and `plugins/share/src/wiring.ts`.

**Status:** done and building. `pnpm install`, `pnpm arch`, `pnpm lint`,
`pnpm types`, `pnpm test` and `pnpm build` all pass.
**Recipe:** [`plugin-migration-recipe.md`](./plugin-migration-recipe.md).
**Phase:** the eighth plugin of RFC §9 phase 4, after
[`rca`](./rca-migration-result.md), [`app-map`](./app-map-migration-result.md),
[`launch`](./launch-migration-result.md),
[`api-test`](./api-test-migration-result.md),
[`playground`](./playground-migration-result.md),
[`gamification`](./gamification-migration-result.md) and
[`ci`](./ci-migration-result.md).

---

## 1. The headline

`plugins/share/` is a workspace package (~7,800 LOC — larger than any prior
phase-4 plugin, `ci` included). `plugins/share/package.json` lists
`@lastest/contracts`, `@lastest/core-data`, `@lastest/eb-protocol`,
`@lastest/kernel`, `@lastest/playback`, `@lastest/ui`,
`@lastest/video-fallback`, `drizzle-orm`, `jszip`, `lucide-react`, `uuid` — no
`playwright`, no `@lastest/db`, no `@lastest/pool-service`, no AI SDK. There is
no `@/…` import anywhere under `plugins/share/`. `pnpm arch` reports **0
violations in the target layout**.

| Was | Now |
| --- | --- |
| `src/lib/share/{grade,slug,xray,demo-facts,vtt,social-copy,a11y-projection}.ts` | `plugins/share/src/*.ts` (verbatim, imports redirected) |
| `src/lib/share/video-fallback.ts` | `libs/video-fallback` — promoted, not moved into the plugin (see §5) |
| `src/lib/share/{captions,generate-captions}.ts` | `src/lib/demo-captions/*.ts` — **deferred**, not migrated (see §4) |
| `src/lib/db/queries/public-shares.ts` (own-table half) | `plugins/share/src/data/queries.ts` |
| `src/lib/db/queries/public-shares.ts` (core-join half) | `src/lib/core/share-host.ts` |
| `src/server/actions/public-shares.ts` | `plugins/share/src/actions.ts` |
| `src/components/share/*.tsx` | `plugins/share/src/ui/*.tsx` |
| `src/components/diff/mobile-diff-gallery-client.tsx` | `plugins/share/src/ui/mobile-diff-gallery.tsx` (single consumer, moved wholesale) |
| `src/app/(public)/r/[slug]/page.tsx` (3,004 lines) | `plugins/share/src/ui/page.tsx` + a 13-line app wrapper |
| `packages/db/src/schema/growth.ts`'s `publicShares` table | `plugins/share/src/schema.ts`, renamed `share_public_shares` |
| — | `plugins/share/src/{host,wiring,deletion,index}.ts` |
| — | `libs/playback/`, `libs/video-fallback/` (new libs, §5) |
| — | `src/lib/core/{share-host,share-reads}.ts` |

Action-id count, per recipe §8: 7 exported actions
(`publishBuildShare`, `publishLatestTestShare`, `listTestShares`,
`revokePublicShare`, `listBuildShares`, `claimPublicShare`,
`claimAndRedirect`), 7 ids in `server-reference-manifest.json`. Exact match —
no re-export trap, no dead actions.

## 2. Port size: 15, the largest of any phase-4 plugin, and deliberately at the recipe's stop line

Costed before starting, per recipe §1.5. A first pass over what
`/r/<slug>` reads — `builds`, `tests`, `testRuns`, `testResults`,
`visualDiffs`, `stepComparisons`, `repositories`/`teams` (flags),
`buildDemoNotes`, `repoAwards` — landed north of 20 raw core calls, which by
§1.5's own table (`> ~15: STOP`) reads like a `url-diff` repeat. It isn't,
and the reason is worth stating plainly: **`url-diff` was orchestration of
core modules that had not been extracted yet** (`core/diff` still doesn't
exist). Share's reads are of core **tables**, already reachable through
`src/lib/db/queries`, already core by `core-scope.md` §2 with no argument.
The port is large because the *page* is large, not because a missing core
module is being routed around.

Grouped by what each method is:

- **Identity (3):** `requireRepoAccess`, `requireTeamAccess`,
  `requireTestAccess`. See §3 for why this plugin does not use
  `runtime.contextFor()`.
- **Publish flow (2):** `getBuildPublishInfo`, `resolveOrCreateBuildForTest`.
- **Render flow (6):** `getBuildRenderContext` — the big one, collapsing
  `resolveShareBuild` + test + testRun + diffs + results + stepComparisons
  into one call, the same move `plugins/rca/src/host.ts` made for its own
  diff/change-map reads — plus `getOwnerTeamFlags`, `getPlatformStats`,
  `getBuildA11yViolations`, `getRepoAward`, `getDemoNotes`.
- **Claim flow (3):** `findOrCreateClaimRepo`, `cloneShareIntoRepo`,
  `setSelectedRepository`.
- **Notification (1):** `sendShareNotification`.

Three things this port does **not** contain, each cut for a specific,
recorded reason rather than trimmed to hit a number:

- **No `readStorageFile` / video byte access.** `resolveTestVideoUrl` /
  `resolveResultVideoUrl` moved to `@lastest/video-fallback` instead of
  becoming host methods — see §5. That is two fewer methods this port would
  otherwise have needed.
- **No AI capability, no captions read/write.** Captions authoring did not
  migrate with this plugin at all — see §4. That is roughly four methods
  (AI generation, demo-notes write, screenshot-byte read, caption-target
  resolution) this port does not carry.
- **No sitemap enrichment.** `src/app/sitemap.ts` composes the plugin's own
  read (`listIndexablePublicShares`) with a batched core read
  (`getSitemapEnrichment`, in `src/lib/core/share-host.ts`, not `ShareHost`)
  itself — it is app code, so it may. One fewer method, and the join runs
  once per revalidate instead of once per plugin call.

Without those three cuts the port would have been ~20, comfortably past the
stop line. With them, 15 — right at it, not under it. That is the honest
number, and it is why §6 exists: the next plugin this size should expect the
same shape, not assume 15 is typical.

## 3. The wiring divergence: no `runtime`, despite being team-tenanted

Every prior tenanted-with-storage plugin (`a11y`, `explorer`, `ci`) wires
both a `runtime` (for `contextFor()`) and `data`. `share` wires only `data`.

`PluginContext` carries `team: TeamRef` (id, plan, entitlements) and
`repo?: RepoRef` (id, teamId, name, defaultBranch) — no user id, no team
name, no repo full name. Every write this plugin does (`publishBuildShare`'s
Discord ping needs the publisher's email and the team's name;
`claimPublicShare`'s idempotent-repo lookup needs the team's slug) needs at
least one field `contextFor()` does not carry. A `contextFor()` call would
still have needed a second host call to fill the gap — so `ShareHost.
requireRepoAccess` / `requireTeamAccess` do the authorization *and* the
enrichment in one call instead, and `wiring.ts` takes `data` straight from
the slot the same way `launch`/`playground` do, but for a different reason:
they are untenanted; this plugin just does its own authorization.

This is a new variant worth flagging for whoever's next: **"team-tenanted"
and "uses `contextFor()`" are not the same decision.** The kernel does not
require the latter of the former; it is worth doing only when `ctx.team`
alone is enough for the plugin's needs. `ci` needed it (its actions call
`contextFor(ciPlugin)` with no scope, per §1.7); `share` needed richer
identity, so it built that into the host instead.

## 4. Captions authoring did not migrate — and that split is the finding worth carrying

`src/lib/share/captions.ts` and `generate-captions.ts` — the AI vision pass
that writes `build_demo_notes.payload.captions` — sat under `src/lib/share/`
and were claimed by the `share` `PSEUDO_PLUGINS` `lib` entry, but their
*action*, `src/server/actions/captions.ts`, was never listed in `share`'s
`actions` (only `public-shares.ts` was). Reading the consumer list rather
than the directory (the same lesson `ci`/`launch`/`gamification` each
recorded) says these are a distinct authoring pipeline that happens to write
into a column this plugin only *reads*.

Both files relocated to `src/lib/demo-captions/` — a plain `src/lib` move,
zero behavior change, staying core-classified and unmigrated. `plugins/
share/src/vtt.ts` (pure WebVTT formatting, no captions-*generation* logic)
stayed with `share`, since the public `/share/<slug>/captions.vtt` route is
genuinely this plugin's surface; only the AI authoring step left.

The cost this avoided: captions authoring alone would have added AI
capability, a demo-notes *write*, and a screenshot-byte read to the port —
call it four more methods, pushing 15 to ~19 and making the "is this worth
doing" call in §2 much harder to defend. Splitting it out is why the
question didn't have to be answered under pressure.

**What this means for whoever migrates `demo`:** `src/lib/demo-captions/`
now needs a home. It is not `src/lib/demo/` (that pseudo-plugin is about
seed/sandbox data, unrelated) — it reads/writes `build_demo_notes`, the same
table `demo-notes.ts` actions touch, and needs an AI capability + a way to
read screenshot bytes core doesn't expose to any plugin yet. Whoever takes
it should re-cost it as its own unit rather than assume it is a "share"
leftover; it never was.

## 5. Three libs promotions, and the one that had a hidden second consumer

Per recipe §5's mechanical test (read the import list):

- **`libs/video-fallback`** — `resolveTestVideoUrl` / `resolveResultVideoUrl`
  had zero `@/…` imports (`fs/promises`, `path` only), which made the first
  instinct "host method" wrong. It should have been a library from the
  start. It turned out to have a **second consumer already**:
  `src/server/actions/tests.ts` — an unrelated feature — imports
  `resolveResultVideoUrl` for a result-row video-path backfill. That import
  was *already* the `plugin → plugin` violation `crossPluginPatternsFor()`
  would have flagged once `share` graduated (its old path was
  `@/lib/share/video-fallback`), invisible until this migration made the
  directory it lived under disappear. Promoting it removed the violation
  before it could ever be counted — recipe §1.5's hazard-2 lesson
  (`grep -a` for binary files) has a sibling: **grep a promotion candidate's
  consumer list before assuming it is single-purpose**, not just its own
  import list.
- **`libs/playback`** — `resolveStepSegments` / `isInteractivePlaybackEnabled`
  had real external consumers already (`test-detail-client.tsx`,
  `verify/[buildId]/focus-view.tsx` and `page.tsx`, `replay-player.tsx`)
  before this migration touched them. Promoted with narrowed local types
  (`StepScreenshotTiming`) rather than importing `CapturedScreenshot` from
  core, per §6.1's "narrow, don't drag the whole type across" — the module
  only ever reads `.atMs` / `.label`.
- **`libs/ui`** gained `VideoPlayer`, `ReplayPlayer`, `ScreenshotViewer` —
  all three already used by test-detail, Verify and the share page alike,
  none with a stray `@/…` import beyond `@/lib/utils#cn` (already in
  `libs/ui/src/cn.ts`) and `@/components/ui/popover` (already in
  `libs/ui`). `redactCodeSecrets`, by contrast, had **no** consumer outside
  this page and its own test — it moved straight into the plugin
  (`plugins/share/src/redact-code.ts`) rather than through `libs/`, per §5's
  "promotion is for code more than one feature needs."

## 6. A core-table-heavy page needs its types narrowed, not promoted — and doing so in full is what made the 3,004-line move safe

`StepComparisonEvidence` and its ten sub-interfaces (`NetworkDiffSummary`,
`ConsoleDiffSummary`, `A11yDiffSummary`, `DesignSystemDiffSummary`,
`PerfDiffSummary`, `VariableDiffSummary`, `StorageStateDiffSummary` and
friends), plus `CapturedScreenshot`, `StepVerdict`, `VideoCaption`,
`DemoNotes` and `BuildA11yViolationRow`, are core's types (`step_comparisons`,
`test_results`, `build_demo_notes`, the a11y aggregate) — not this plugin's.
Recipe §6.1 says narrow rather than promote when that's true, and the
temptation with a page this size was to promote them to `@lastest/
eb-protocol` instead, to avoid hand-copying ~17 interfaces. That would have
been presumptuous (§6.1: "promoting another feature's payload types ahead of
that feature's own migration") for the ones that are Verify's vocabulary,
not the wire protocol's — `StepComparisonEvidence`'s summaries are computed
by the app's own scorer, not sent by the EB, unlike the four types that
*were* already in `eb-protocol` (`DomDiffResult`, `DomSnapshotElement`,
`StepTiming`, `WebVitalsSample`) and were imported from there directly.

So `plugins/share/src/types.ts` carries full structural copies rather than a
trimmed subset. The alternative — hand-narrowing to "only the fields the JSX
touches" — was tried first and abandoned: grepping actual field access
(`s.layers?.network`, `.consoleDiff`, `.a11y`, `.perf`, `.url`, `.variable`)
across a 3,000-line file found real, non-trivial usage of nearly every
sub-summary, and the risk of silently dropping a field used once, 2,000
lines from its declaration, was worse than copying ~150 lines of interface
bodies verbatim. **`RepoAward` is the sharpest version of this rule**: the
render-prop that hands `<AwardBadgeRow>` down to the plugin (§7) is typed
against the *real*, wide `RepoAward` from `@/lib/db/schema` — a trimmed
narrow copy would have failed to type-check at the render-prop boundary,
because a narrower object isn't assignable to a wider required prop type.
The fix was copying `RepoAward` in full (all 9 fields) rather than the 4 the
page itself reads — the deciding question is not "what does this plugin
read" but "what does everything downstream of this plugin's return value
require."

One structural-typing assist worth naming: `deriveShareFacts`'s input type
(`share/demo-facts.ts`) reads `test?.setupTestId` and
`build?.buildSetupTestId` — fields **not** used anywhere in `page.tsx`
itself, only inside a helper it calls with the whole `test`/`build` object.
Neither showed up in a grep of `page.tsx` for `test\?\.`/`build\.` field
access; they only surfaced by reading `demo-facts.ts` in full before
narrowing `ShareTest`/`ShareBuild`. Grepping the top-level file for field
access is not sufficient when a full object gets passed to a helper that
reads more of it than the caller does.

## 7. The render-prop boundary, and the one that stayed inline instead

`AwardBadgeRow` (`src/components/awards/`) is genuinely another feature's
component — it renders per-tier badge shields, imports `./badges`, and is
typed against the wide `RepoAward`. It went down as a prop
(`PageProps.awardBadgeRow`), the same route `app-map`'s live-progress panel
took: the plugin decides *whether* to render it (`showAwardBadges`), the app
supplies *what* gets rendered. `MobileDiffGallery`
(`src/components/diff/mobile-diff-gallery-client.tsx`), by contrast, had
exactly one consumer — this page — and needed only `cn` (already in
`libs/ui`), so it moved into the plugin wholesale
(`plugins/share/src/ui/mobile-diff-gallery.tsx`) rather than through a
render prop. The distinguishing question, same as §5's libs test: **is this
component's owner a different feature, or is it only "different" because of
where the file happened to sit?**

## 8. A near-miss: a reverse read that would have re-created the `gamification` core→feature edge

`src/lib/db/queries/awards.ts` (the not-yet-migrated `awards` pseudo-plugin's
query module, but itself a `src/lib/db` file — `CORE_SRC_PATHS`) read
`publicShares` directly, three times, for the repo-award badge SVG endpoint
and the public awards page. Once the table moved into `plugins/share/src/
schema.ts`, that stopped being reachable at all (`core-scope.md` §6: a
plugin's tables are only reachable through the plugin) — and `awards.ts`
importing `@lastest/plugin-share` directly would have been the exact
core→feature edge recipe §1.6 documents for `gamification`'s `createTest()`
→ `@/lib/gamification/hooks`, just walked in the opposite direction (core
reaching *forward* into a plugin instead of a plugin being reached from
core).

The fix mirrors that precedent's shape rather than repeating its blocking
cost: `src/lib/core/share-reads.ts` re-exports three of the plugin's own
exported read functions (`getPublicShareBySlug`,
`listPublicSharesForRepositories`,
`getLatestPublicShareSlugForRepository`), and `awards.ts` calls those
instead of touching the table. `src/lib/core/` is the one place in `src/`
that already legitimately imports plugins (the composition root does it for
every `configure<Name>` call), so this is not a new kind of edge — it is the
existing one, used for a read instead of a wiring call.

**One iteration of this got it wrong and is worth recording.** The first
draft of `share-reads.ts` called `getPluginRuntime()` (from
`src/lib/core/runtime.ts`) before each read, reasoning that a call arriving
before boot should fail loudly rather than race it. That pulled the
*entire* composition root — every plugin package, every `*-host.ts`,
`@lastest/kernel`, all of `@lastest/core-*` — into `awards.ts`'s import
graph, and because `awards.ts` is part of the `@/lib/db/queries` barrel
which nearly everything in the app imports, it bloated a huge swath of the
app's module graph. The concrete symptom was `src/lib/execution/eb-pool.
test.ts` failing (`No "DEFAULT_STABILIZATION_SETTINGS" export … on the
"@/lib/db/schema" mock`) — a manual partial mock that broke the moment the
import graph reached a module needing an export the mock didn't provide,
reached only because of this new chain. The fix was deleting the
`getPluginRuntime()` call entirely: the same boot-order guarantee every
other host already relies on (`src/instrumentation.ts` awaits it before the
server handles a request) makes the defensive call unnecessary, and removing
it dropped `share-reads.ts` back to importing only the plugin's own
lightweight modules. **Worth generalizing: `src/lib/core/` files that exist
to be called *from* `src/lib/db/queries` must never import `./runtime`** —
that specific direction turns a narrow read into a graph-wide dependency on
every plugin that exists, defeating the entire point of the split.

## 9. Table rename, no FK, no cascade change — and one real bug fix riding along

`public_shares` → `share_public_shares` (recipe §2.4 — not free this time,
same as `gamification`/`ci`). Handled in `scripts/migrate.js` as a pure
`ALTER TABLE … RENAME`, before `drizzle-kit push --force`, mirroring
`GAMIFICATION_RENAMES` exactly: no columns changed, so no backfill, no
`ON DELETE` behavior to preserve, unlike `ci`'s FK-bearing tables.

No FK was dropped, because — like `gamification` — none existed. Every one
of `buildId`, `testId`, `repositoryId`, `ownerTeamId`, `publishedByUserId`,
`claimedByTeamId`, `claimedByUserId` was already a convention-only reference.
That makes `deletion.ts`'s `onTeamDeleted`/`onRepoDeleted` hooks a genuine
**bug fix** riding along with the migration, not a preservation: before this
PR, deleting a team or a repository left every share it had published (or
had claimed into it) behind, unreaped, forever. `src/lib/db/queries/
repositories.ts`'s `deleteRepository` transaction had a raw
`tx.delete(publicShares).where(...)` call that covered the repo-owns-share
direction only — team deletion, and the claimed-by-team direction of repo
deletion, were never covered by anything. Both are now driven by
`cascadePluginDeletion`, uniformly.

## 10. Behaviour changes, stated plainly

- **`publishLatestTestShare` authorizes later than before.** The pre-plugin
  code called `requireRepoAccess` before resolving/creating the underlying
  build; `host.resolveOrCreateBuildForTest` does that resolution with no
  actor at all, and the real authorization happens in the `publishBuildShare`
  call it delegates to. The visible difference: "this test has no runs yet"
  can now surface before an authorization check where before it surfaced
  after. No share content crosses that boundary either way — only the
  existence of a runless test does, and only to a caller who already knows
  the test id.
- **`claimAndRedirect` no longer calls a bare `requireAuth()`.** It was
  redundant with `claimPublicShare`'s own `requireTeamAccess()`
  (team access implies auth); dropping it is one fewer round trip, not a
  behavior change in what gets enforced.
- **The claim flow's repo-name uniqueness check now filters `provider ===
  "local"` inside the host** rather than the action — same predicate,
  moved to the one place with a route to the table.

Everything else is the same code, different import paths and different
callers for the pieces that used to be direct `queries.*`/`db.*` calls.

## 11. What I did NOT verify

Per recipe §9.

- **No runtime click-through.** No request was made to `/r/<slug>`,
  `/r/<slug>/claim`, `/share/<slug>/...`, `/share/<slug>/captions.vtt`, or
  the v1 API share endpoints against a running app. `pnpm build` resolving
  every route, the server-reference-manifest's 7-for-7 action count, and
  `grep`-confirmed plugin strings in the emitted chunks are the evidence
  here, and — as every prior result doc notes — that is not the same claim.
- **No `pnpm db:push` against a dev database.** The `share_public_shares`
  rename in `scripts/migrate.js` is unexercised; it is a structural copy of
  the already-run `GAMIFICATION_RENAMES` path with one table pair, but it
  has not itself run.
- **The deletion hooks have never fired.** Same gap as every previous
  migration's hooks — `onTeamDeleted`/`onRepoDeleted` are covered by
  `manifests.test.ts`'s "declares at least one target" check, not by an
  actual account or repo deletion.
- **The video-fallback disk scan, the claim flow's baseline file copy, and
  the Discord notification** are all unexercised beyond type-checking —
  each does real filesystem or network I/O that only a running app with
  real storage and a real webhook URL would exercise.
- **The OG image route's hero-image selection** (`/api/og/share/[slug]`)
  compiles against the new `ShareVisualDiff`/`ShareTestResult` types but was
  not rendered; its logic was untouched, only its data source.

## 12. For whoever migrates the next one

1. **A port at the recipe's stop line is not automatically a stop.** §2.
   Check *why* the number is large — orchestrating an unextracted core
   module (`url-diff`, stop) reads differently from reading a lot of
   already-core tables because the page itself is large (`share`, go). The
   distinguishing question: would extracting a core module shrink this
   port, or would it just move the same 15 reads behind a different name?
2. **"Team-tenanted" does not imply "uses `contextFor()`."** §3. Check what
   fields your writes actually need before assuming the kernel's context is
   enough; if it isn't, a host method that authorizes *and* enriches in one
   call is a legitimate, precedented alternative to a second lookup.
3. **Read the consumer list of every file in a `lib:` entry, not just the
   feature's own action list.** §4. A `PSEUDO_PLUGINS` `lib` entry claims a
   whole directory; a file inside it can still belong to a different,
   unlisted feature, discoverable only by checking who calls it.
4. **A promotion candidate needs its consumer list grepped, not just its
   import list.** §5. `video-fallback.ts` had zero `@/…` imports and *still*
   nearly became a host method, because the question "is this shared" was
   asked from the wrong side.
5. **Files that exist to be called from `src/lib/db/queries` must not
   import the composition root.** §8. `getPluginRuntime()`/`./runtime` pulls
   in every plugin that exists; anything reachable from the query barrel
   inherits that graph. Rely on the boot-order guarantee instead of
   re-asserting it defensively.
6. **A narrow copy has to satisfy everything downstream, not just what the
   plugin itself reads.** §6. `RepoAward` needed all 9 fields, not the 4
   `page.tsx` touches, because a render-prop boundary re-introduces the
   wide type's requirements on the other side.
