# `awards` migration result (RFC §9 phase 4, plugin 9 of 13)

**Status:** done. `plugins/awards/` is a workspace package; `src/lib/awards/`
and its old query/component files are deleted;
`tools/architecture/boundaries.mjs`'s `PSEUDO_PLUGINS.awards` entry is gone.
`pnpm arch`'s target layout stays at 0 violations; the current-layout count
drops from 20 to 19.

## 1. What moved

Per-repository tier + category badges computed from build/test/diff history
("Prove your app is not AI slop"), a public criteria page (`/awards`), an
embeddable badge SVG endpoint (`/api/badge/[slug]/[type]`), and the team
trophy room on `/leaderboard`.

| Was | Now |
| --- | --- |
| `src/lib/awards/{criteria,recompute,svg}.ts` | `plugins/awards/src/{domain/criteria,recompute,svg}.ts` |
| `src/lib/db/queries/awards.ts` (repoAwards CRUD + orchestration) | `plugins/awards/src/data/queries.ts` + `plugins/awards/src/reads.ts` |
| `src/lib/db/queries/awards.ts` (core table reads) | `src/lib/db/queries/awards.ts`, trimmed — now `AwardsHost`'s implementation source |
| `src/components/awards/{badges,delta-mark,embed-code-block,trophy-room}.tsx` | `plugins/awards/src/ui/*.tsx` |
| `src/components/awards/award-badge-row.tsx` | unchanged location — see §5 |
| `src/app/(public)/awards/page.tsx` (471 lines) | `plugins/awards/src/ui/page.tsx`; app file keeps only `revalidate`/`metadata` |
| `src/app/api/badge/[slug]/[type]/route.ts` (92 lines) | `plugins/awards/src/api/badge.ts`; app file is a 3-line re-export |
| `packages/db/src/schema/growth.ts`'s `repoAwards` table | `plugins/awards/src/schema.ts`, renamed `awards_repo_awards` |

## 2. The headline: this is the migration `share` was costed to unblock, and the estimate held

`gamification`'s result doc (§9) found that `awards` shares no import with
Beat-the-Bot and costed it at "~8 methods, six of them core aggregate reads
and one a cross-feature read that wants `share` migrated first." `share`
migrated next specifically so that cross-read would exist as plugin exports
rather than a raw `publicShares` select, and this migration's actual port
landed at exactly **8 methods** — see `plugins/awards/src/host.ts`. Grouped:

| # | Method | Group |
| --- | --- | --- |
| 1–3, 5–6 | `getRecentCompletedBuilds`, `getTestCount`, `getRejectedDiffCount`, `listReposWithTests`, `getBuildTotalTests` | core build/test/diff aggregate reads |
| 4 | `getRepository` | core aggregate read (repo lookup) |
| 7–8 | `resolveShareSlug`, `resolveLatestShareSlugs` | cross-feature reads into `share` |

Six of eight are reads of `builds`/`tests`/`visualDiffs`/`repositories` —
exactly what `src/lib/db/queries/awards.ts` did directly through the shared
`db` handle before the move, each now one host method with the same shape it
already had. `getRejectedDiffCountForRepo`/`…Since` collapsed into one method
with an optional `sinceMs`, and the single-repo `getLatestPublicShareSlug` /
batched `listLatestPublicSharesForRepositories` collapsed into always calling
the batched form — neither is a behaviour change, both are recipe §1.5's
"group by what each method is" applied literally.

## 3. The two-way cross-read: both directions go through `src/lib/core/`

`awards` reads `share`'s latest-slug data (the badge's "proof" link); `share`
reads `awards`'s own table (`ShareHost.getRepoAward`, for the `/r/<slug>`
page's badge row). Neither plugin may import the other, so both directions
cross through `src/lib/core/`:

- `AwardsHost.resolveShareSlug`/`resolveLatestShareSlugs`, implemented in
  `src/lib/core/awards-host.ts`, call `src/lib/core/share-reads.ts` — which
  `share`'s migration built and which now serves `awards-host.ts` instead of
  the deleted `src/lib/db/queries/awards.ts`. Only the caller changed; the
  file's boot-order reasoning (never import `./runtime`, since
  `getPluginRuntime()` is what constructs the host in the first place) did
  not need to be re-derived.
- `ShareHost.getRepoAward`, implemented in `src/lib/core/share-host.ts`, now
  calls `@lastest/plugin-awards`'s exported `getRepoAward` directly instead of
  `queries.getRepoAward` — the mirror image, and the same boot-order guarantee
  covers it: both plugins are configured inside the same `getPluginRuntime()`
  call before any request is handled.

Nothing about `plugins/share/src/host.ts`'s `RepoAward` structural copy
changed. It was declared with all 9 fields (not trimmed) specifically because
`AwardBadgeRow` — which stays in the app, see §5 — is typed against the real,
wide `RepoAward`; that argument holds exactly as well post-migration, since
`plugins/awards/src/schema.ts`'s drizzle-inferred `RepoAward` has the same
shape it always did.

## 4. Wiring: the `gamification` shape, arrived at for a third reason

`awards_repo_awards` rows are genuinely tenanted (`repositoryId`, cascading
from a team-owned repo), so this is not `launch`/`playground`'s
`tenancy: "none"`. But none of the plugin's three call paths would benefit
from a `PluginContext`:

- `recomputeRepoAward(repositoryId)` runs from `builds.ts` after a build
  completes, with no session at all on that path.
- `getTeamTrophyRoom(teamId)` runs from `/leaderboard`, which has already
  called `requireTeamAccess()` before passing the id in.
- `getRepoAwardBySlug(slug)` runs from the anonymous badge route and from
  `ShareHost.getRepoAward` — both deliberately unauthenticated.

So `plugins/awards/src/wiring.ts` takes `data` straight from the slot, no
`runtime`, the same shape `gamification` uses — but arrived at independently,
for badge/public-page anonymity rather than gamification's "caller already
authorized a team" reasoning alone. Two plugins now write the same wiring
shape for adjacent-but-different reasons, which is worth flagging the way
recipe §1.5 asks: a `core/identity`-style "receive a pre-authorized id"
primitive would generalize this, not just gamification's version of it.

## 5. `AwardBadgeRow` stays in the app; the badge glyphs it renders don't

`src/components/awards/award-badge-row.tsx` is the one component that did
**not** move. `share`'s `/r/<slug>` page hands it down as a render prop
(`awardBadgeRow={AwardBadgeRow}`) because a plugin may not import another
plugin — recipe §6's "the app owns the thing placed," one level removed here:
the *placement* is share's, but `SplitShield`, the primitive `AwardBadgeRow`
renders with, is still `plugins/awards`'s public UI
(`@lastest/plugin-awards/ui/badges`). So the file that stayed in the app
changed two imports (`RepoAward` and `SplitShield`, both now from the
plugin) and nothing else — it was already the correct shape for a render
prop, just pointed at the wrong package before one existed.

`TrophyRoom`, by contrast, moved wholesale into
`plugins/awards/src/ui/trophy-room.tsx` and `/leaderboard/page.tsx` imports it
directly. The difference from `AwardBadgeRow`: nothing else needs to place it
— only the app route does, and an app importing a plugin's UI directly is
always fine. Its one `@/lib/utils` import (`cn`) became `@lastest/ui`'s `cn`,
which already existed for exactly this reason (`gamification`'s
`user-score-chip.tsx` uses the same swap).

## 6. The badge route moved wholesale; the public page moved wholesale; the app files are minimal on purpose

Both were candidates recipe §6.2 asks to check before assuming a bare
re-export:

- **The badge route** (92 lines) is almost entirely the feature's own —
  parse type/size, resolve the award, render one of five SVGs — with exactly
  one core call (`getBuild`, for the all-passing badge's "N / N" total). That
  call was already going to be a host method (`getBuildTotalTests`), so
  nothing was left for the app to compose. `src/app/api/badge/[slug]/[type]/route.ts`
  is a 3-line re-export of `GET`, following
  `src/app/api/v1/launch/[...path]/route.ts`'s precedent — including keeping
  `dynamic`/`runtime` **literal in the app file** rather than re-exported,
  since Next.js requires route-segment config to be statically present in the
  route file itself.
- **The public page** (471 lines) has zero core reads at all — no session, no
  repo, pure marketing copy and badge previews. It moved to
  `plugins/awards/src/ui/page.tsx` in full; the app's
  `src/app/(public)/awards/page.tsx` keeps only `revalidate`/`metadata` (the
  same reason `dynamic` stays literal on the badge route) and forwards the
  default export. This is the first plugin page with its own `metadata`
  export, and the same constraint applied: it was not re-exported across the
  package boundary, only declared in the app file the way
  `src/app/(app)/explorer/page.tsx` keeps `export const dynamic` next to a
  fully plugin-owned render.

## 7. Table rename and FK drop: the fourth migration to need both

`repo_awards` was not `awards_`-prefixed (recipe §2.4's now-expected case,
after `explorer`, `gamification` and `ci`), and it carried a real FK —
`repositoryId REFERENCES repositories.id ON DELETE CASCADE` — which
`core-scope.md` §6 forbids a plugin from declaring. `scripts/migrate.js`'s
`migrateAwardsTables()` does the rename, then drops the FK by catalogue
lookup (the `migrateCiTables()` shape: implicitly-created constraint names
differ between environments, so `pg_constraint` is the only reliable source).
`plugins/awards/src/deletion.ts`'s `onRepoDeleted` replaces the cascade —
recipe §2.1's ordinary case: one table, one FK, `cascade` behaviour, nothing
to reproduce beyond a delete (unlike `ci`'s `restrict` or `launch`'s
user-scoped rows). No `team_id` column exists on the table at all, so this is
`onRepoDeleted`, not `onTeamDeleted` — team deletion still reaches these rows
because core's own cascade deletes a team's repositories first, which drives
this hook one level removed.

`proofShareSlug` and `lastBuildId` were always convention-only references (no
FK, even before the move) — nothing changes about them; they join the 104
such columns `core-scope.md` §7 counts.

## 8. `core-scope.md` §6 in miniature: the trophy room's `innerJoin` is an existence predicate

`getTeamTrophyRoom`'s `repositories ⋈ tests` join carried a
`HAVING COUNT(tests.id) > 0` — recipe §3.2's exact case. A repo with zero
non-deleted tests must not appear in the trophy room; `AwardsHost.listReposWithTests`
reproduces the filter (it lives in `src/lib/db/queries/awards.ts`'s
`listReposWithTestsForTeam`, unchanged from the pre-migration query), so the
port method is not just a column source. Losing this would have silently
re-added placeholder repos with no tests to every team's trophy room.

## 9. Gates

```
pnpm install            # new package resolves; sonner/lucide-react/uuid pulled in, nothing forbidden
pnpm arch                # target layout: 0. current layout: 20 → 19
pnpm lint                # 0 errors; one pre-existing warning set unchanged, one now-dead `repositories`
                          # import in growth.ts cleaned up as part of the table removal
pnpm types                # clean; plugins/awards typechecks standalone too (`pnpm --filter typecheck`)
pnpm test                 # 114 files / 1676 passed — includes the moved criteria.test.ts (30 cases)
                          # and the boundaries ratchet test
pnpm build                 # clean; /awards, /api/badge/[slug]/[type], /leaderboard, /r/[slug] all
                          # present in the route table; grepped the emitted .next/server chunks for
                          # page copy and the wiring-error string to confirm the plugin's own code
                          # landed in a real chunk, not just a source map
```

`awards` has no server actions at all (`recomputeRepoAward` is
system-triggered, everything else is a read) — the same "no dispatchable
action ids" shape `launch` has with its REST-only surface. So there is no
action-id count to run; the check that applies instead is the one recipe §8
prescribes for that shape: confirm the route(s) appear in the build's route
table and that the plugin's own code landed in the emitted chunk, both done
above.

## 10. What was NOT verified

Per recipe §9. No `pnpm db:push` against a live database — `scripts/migrate.js`'s
rename/FK-drop path was read carefully against the `ci`/`gamification`
precedents it copies but not exercised against real rows. No browser
click-through of `/leaderboard`, `/awards`, or a live badge image; the build's
static route table and a grep for the plugin's emitted strings are the only
runtime-adjacent evidence. No verification that `recomputeRepoAward`'s
fire-and-forget call from `builds.ts` behaves correctly under the dynamic
`import("@lastest/plugin-awards")` the way the pre-migration
`import("@/lib/awards/recompute")` did — the shape is identical to
`gamification`'s already-proven `awardScore` call site, but that is an
argument by analogy, not a run.
