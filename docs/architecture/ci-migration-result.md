# `ci` migration result (RFC §9 phase 4, plugin 7 of 13)

**Status:** landed. `@lastest/plugin-ci` owns GitHub Actions and GitLab pipeline
integration. The `scm` entry is gone from `PSEUDO_PLUGINS` — and it is the first
entry to graduate as **two things**, half of it reclassified as core.
**Predecessors:** [`gamification`](./gamification-migration-result.md),
[`playground`](./playground-migration-result.md),
[`api-test`](./api-test-migration-result.md),
[`launch`](./launch-migration-result.md),
[`app-map`](./app-map-migration-result.md), [`rca`](./rca-migration-result.md).
**Procedure:** [`plugin-migration-recipe.md`](./plugin-migration-recipe.md).

---

## 1. What moved

| | |
| --- | --- |
| Package | `plugins/ci/` → `@lastest/plugin-ci` |
| Vertical LOC | ~5,700 (1,000 lib + 1,040 actions + 3,510 UI + schema/queries) |
| Tables | 2, both **renamed** (`ci_github_action_configs`, `ci_gitlab_pipeline_configs`) |
| Host port | **9 methods** |
| Server actions | 10 (was 13 — see §5) |
| Capabilities | `["data"]` |
| Tenancy | `team`, resolved from the session |
| Burndown | 20 → **20** (unchanged; `scm` had zero counted violations) |

Deleted from the app: `src/server/actions/github-actions.ts`,
`src/server/actions/gitlab-pipelines.ts`,
`src/lib/db/queries/{github-actions,gitlab-pipelines}.ts`,
`packages/db/src/schema/scm.ts`, `src/lib/github/{actions,workflow-yaml}.ts`,
`src/lib/gitlab/{pipelines,ci-yaml}.ts`, and 14 components under
`src/components/settings/`.

Kept in the app: `src/app/api/webhooks/gitlab/route.ts` (§4) and the whole
credential half of `src/lib/{github,gitlab}` (§2).

## 2. The headline: recipe §1.6 has a third outcome, and this is it

`gamification` established the check — **grep core for the feature's name before
costing the port**, because `pnpm arch` inspects what plugins import and nothing
inspects what core imports. There, the answer was a `core → feature` edge that
had to be **inverted**: core grew a port (`src/lib/db/test-hooks.ts`) and the
composition root registered the feature's listener.

Running the same grep here came back loud:

```
src/lib/auth/auth.ts              -> @/lib/github/oauth
src/lib/ai/codebase-intelligence.ts -> @/lib/github/content
src/lib/change-map/compute.ts     -> @/lib/github/content
```

Plus six action modules and five API routes. On the `gamification` reading that
is a large blocking core PR. It was neither — because **core was not calling a
feature.** It was calling the part of `src/lib/github` that had been *misfiled*
as a feature.

RFC §6.3 maps `scm` to `src/lib/github` + `src/lib/gitlab` + two action modules,
one entry, one destination. Reading the import lists (the `launch` lesson, at
directory scale) splits it exactly down the middle, with no module ambiguous:

| Module | Consumers | Verdict |
| --- | --- | --- |
| `github/oauth.ts` | `lib/auth/auth.ts`, 2 API routes, 2 actions | **core** |
| `github/token.ts` | `actions/repos.ts` | **core** |
| `github/webhooks.ts` | `api/webhooks/github` | **core** |
| `github/content.ts` | `lib/ai`, `lib/change-map`, `lib/templates`, 5 actions | **core** |
| `gitlab/oauth.ts` | 3 API routes, 2 actions | **core** |
| `gitlab/content.ts` | `actions/builds.ts` | **core** |
| `github/actions.ts` | `actions/github-actions.ts` | **plugin** |
| `github/workflow-yaml.ts` | `actions/github-actions.ts` + 1 component | **plugin** |
| `gitlab/pipelines.ts` | `actions/gitlab-pipelines.ts` | **plugin** |
| `gitlab/ci-yaml.ts` | `actions/gitlab-pipelines.ts` + 1 component | **plugin** |

Every core-half module is a credential boundary (OAuth authorize/exchange/
refresh, encrypted token resolution, webhook signature verification) or a read
performed with one. `core-scope.md` §2 puts those in core without argument, so
they stayed exactly where they are and `CORE_SRC_PATHS` grew two entries.
Every plugin-half module has **exactly one consumer: its own action module.**

**So the outcome of a §1.6 hit is one of three things, not one:**

1. **Invert it** — core genuinely calls a feature (`gamification`). Blocking
   core PR.
2. **Reclassify it** — what core calls was never the feature (`ci`). No code
   moves; the map was wrong.
3. **Stop** — the feature is a thin orchestration *of* core (`url-diff`).
   Extract the core module first.

Only the first is a blocking core change. Recipe §1.6 as written implies all
hits are, which would have priced this migration at roughly double.

The plugin is named `ci`, not `scm`, deliberately: core now owns the
source-control *credentials*, so a package called `scm` would misdescribe where
the boundary is.

## 3. The port: 9 methods, and the fifth copy of `requireTeamAdmin`

| # | Method | Group |
| --- | --- | --- |
| 1 | `requireTeamAdmin` | identity |
| 2 | `scmCredentials` | credential boundary |
| 3–6 | `createRunner`, `regenerateRunnerToken`, `deleteRunner`, `getRunner` | runner lifecycle |
| 7–8 | `publicAppUrl`, `probePublicUrl` | this deployment's own origin |
| 9 | `revalidate` | delivery |

Two things to carry forward.

**`requireTeamAdmin` is declared verbatim in `plugins/gamification/src/host.ts`,
same signature, same reasoning** ("give me the authorized team id", not "am I an
admin", so the check cannot be skipped). Counting `launch` and `playground`'s
`resolveActor` and `gamification`'s four, `core/identity` now retires **eight
methods across four plugins**. Recipe §1.5 already calls it the highest-value
phase-5 item; this is the fifth plugin paying for it rather than the first to
notice.

**But `currentActor` is *not* in this port, and that is new.** Every previous
user-scoped plugin needed a host method for "who is calling". This one does not,
because its actions call `runtime.contextFor(ciPlugin)` with **no scope request
at all** — `resolveScope` falls through to the app's `requireTeamAccess()` and
`ctx.team.id` is a session-authorized tenant that no argument influenced.
`explorer` and `app-map` pass a `repositoryId` because their work hangs off a
repo; CI configs hang off a *team*, and the team is the session's.

That is the cheapest correct tenancy available and it was sitting in the kernel
the whole time. Worth stating as a rule: **before declaring a `currentActor`-shaped
port method, check whether an empty `contextFor()` already answers it.** It also
means `tenancy: "team"` here is load-bearing rather than decorative — the
context is where the team comes from.

**`scmCredentials` is deliberately the weaker §3.1 shape** ("give me the
primitive"). The stronger form would mean core performing the GitHub Contents
call and the GitLab Repo Files call, which moves this plugin's entire reason for
existing into core — the boundary-drawn-wrong risk in its other direction.
`libs/github` settled the same question the same way: a REST client taking its
token as an argument is a library, and resolving *which* token is the boundary.
What the plugin cannot do is enumerate accounts, refresh a token, or name
another team's — `teamId` always originates from `requireTeamAdmin()` or
`ctx.team.id`.

## 4. The GitLab webhook: the first route that is not a bare re-export

Recipe §6 says an API route is "usually a *bare* re-export" and points at
`src/app/api/v1/launch/[...path]/route.ts` — 16 lines for a 681-line handler.
This one is the opposite ratio and the route **stayed in the app**.

Costing the alternative decided it. Moving the handler into the package needs
`getRepositoryByGitlabProjectId`, `getPullRequestByBranch`, `createPullRequest`,
`updatePullRequest`, `createAndRunBuild` and `markWebhookSeen` — **six more host
methods**, taking the port from 9 to 15 and dragging pull-request bookkeeping
across a boundary it has no reason to cross.

Reading the handler shows why: almost all of it is core's work. Exactly four
questions are the plugin's, and all four are questions about a *config row* —
the shared secret, whether the event type is enabled, whether the branch is in
the filter, and whether delivery is `ci_file` or `webhook`.
`resolveGitlabWebhookGate` answers those four and nothing else.

So **§6's page rule generalises to routes**: *the plugin owns the placement, the
app owns the thing placed* becomes *the plugin answers its own questions, the app
composes*. `launch` handed the whole request over because every line of it was
launch's. The deciding test is not "is it a route", it is **what fraction of the
handler belongs to the feature.**

One detail worth keeping: the gate returns the **expected** secret and the route
does the `timingSafeEqual`. The plugin never sees the presented token, because
comparing secrets is core's job.

## 5. Recipe §8's action-id count catches dead actions, not just the S1 trap

The count came back **10 ids for 13 exported actions**. Recipe §8 documents that
check as catching the S1 re-export trap, where a silently-empty result means the
module compiled to no exports. A *partial* mismatch turns out to mean something
else: Next.js only mints an id for an action reachable from a client boundary.

The three without ids were `getGithubActionConfigsAction`,
`getGitlabPipelineConfigsAction` and `previewGitlabCiYaml` — and all three were
already dead **before** the migration. The settings page read configs through
the query layer directly; both YAML previews are computed client-side. Each was
a live RPC endpoint maintained for no caller. They are deleted; the list reads
moved to `reads.ts`, which is what a server component actually wants.

Count is now 10/10. **A partial mismatch is a dead-action report; a zero is the
S1 trap.** Both are worth acting on, and the recipe only described the second.

## 6. Renaming tables is the normal case now

`gamification` renamed five of six and that read as bad luck against five clean
migrations. This renamed **both** of its two:

```
github_action_configs   -> ci_github_action_configs
gitlab_pipeline_configs -> ci_gitlab_pipeline_configs
```

`scripts/migrate.js` does the `ALTER TABLE … RENAME TO` before
`drizzle-kit push`, following `migrateGamificationTables()`. The stakes are
higher than a leaderboard: push resolves an unseen rename by dropping the old
table and creating the new one, and `gitlab_pipeline_configs.webhook_secret` is
**not recoverable** — its counterpart lives in the customer's GitLab project
hook, so losing this side turns every subsequent delivery into a 401 until
someone redeploys by hand.

Two in a row means recipe §2.4's check is the expected case, not the exception.

## 7. Three FKs into core, and one the hook cannot replace

These were the most core-referencing tables in the schema — `packages/db/src/schema/scm.ts`
existed as its own module precisely because they were the only two pointing at
`teams`, `runners` **and** `repositories`, which created two domain cycles. That
file's header already named itself as "the seam that extraction will cut along",
and it was right.

| Dropped FK | Did | Replaced by |
| --- | --- | --- |
| `team_id -> teams.id` | *restrict*: refused to delete a team with configs | `onTeamDeleted` |
| `repository_id -> repositories.id` | *cascade* | `onRepoDeleted` |
| `runner_id -> runners.id` | *set null* | **nothing** |

The first row is a **behaviour change, not a preservation**, and previous result
docs' framing ("the hook replaces the cascade") would be flattering here.
Deleting a team with a deployed config used to *fail* on the constraint; now it
succeeds and the hook removes the rows. That is the intended direction —
`core-scope.md` §6 is explicit that a plugin must not veto a tenant deletion —
but it is a change.

**The third row is a real gap.** `DeletionTarget` has three cases (team, repo,
user) and a runner is none of them, so deleting a runner now leaves a config
pointing at an id that does not resolve. It is contained by accident of how the
feature already reads: `getRunner` returns null and the validation panel already
renders that as *"Linked runner not found in database"*, which is exactly the
state; a redeploy fails cleanly. No credential is exposed. The honest fix is a
fourth `DeletionTarget`, which is a core change with its own review — recorded
in `plugins/ci/src/{host,deletion}.ts` rather than bolted onto this PR.

**Generalising: when you list the FKs you are about to drop (recipe §2.1), check
what each points at, not just whether it is `users` or `teams`.** A `restrict`
becomes a cascade, and a target with no `DeletionTarget` case becomes nothing at
all.

## 8. Smaller findings

- **A reclassification has a second half: CODEOWNERS.** Adding
  `src/lib/{github,gitlab}` to `CORE_SRC_PATHS` failed
  `tools/architecture/boundaries.test.ts`, which asserts every core path is
  owner-protected. Caught by `pnpm test`, not by review. Calling something core
  without a review gate is the one way to make the classification meaningless,
  and the ratchet already knew that.
- **The `libs/ui` promotion was three primitives and no core PR.** `switch`,
  `checkbox` and `popover` moved with re-export shims left behind, so no app
  import changed. `DiagramThumbnail` did **not** follow: it is built on
  `next/image`, which is app furniture rather than a design-system primitive, so
  it goes down as a `flowDiagram` prop alongside `connectAccountButton` (the
  OAuth connect button, which is core's — it holds the credential).
- **`getRunnerById` was unscoped.** The validation panel would have rendered
  another team's runner name and status had a config ever pointed at one. The
  host's `getRunner(runnerId, teamId)` filters. Nothing legitimate produces such
  a config, so this is a tightening rather than a fix for an observed bug — but
  **dropping the FK to `runners` is what made the missing filter visible**, which
  is the same mechanism as `api-test`'s guard-inside-the-write and
  `playground`'s `innerJoin`.
- **A deliberate asymmetry was preserved.** GitHub `auto` mode mints a *new*
  runner on every deploy; GitLab `auto` mode mints one only if there is not one
  yet. They have always differed. Reconciling them is a product decision, not a
  migration's (RFC §2: this is a move) — the divergence is now commented at both
  sites instead of being invisible.
- **Wiring takes `runtime`, `host` **and** `data`.** `explorer` does too, but for
  the routine reason (a deletion hook runs outside a scope). Here all three are
  load-bearing on distinct paths: actions use `contextFor`, the deletion hook and
  the webhook gate have no session and take the handle from the slot.
- **`crypto.randomBytes(32)` became `crypto.getRandomValues(new Uint8Array(32))`.**
  Same 256 bits; global Web Crypto rather than a `node:crypto` import the package
  would otherwise carry for one line.

## 9. Gates

```
pnpm install --frozen-lockfile   ✅  no forbidden dep in plugins/ci/package.json
pnpm arch                        ✅  target 0; current 20 (unchanged — see below)
pnpm lint                        ✅  0 errors, 37 warnings (all pre-existing)
pnpm types                       ✅
pnpm test                        ✅  114 files, 1676 passed
pnpm build                       ✅
action ids                       ✅  10 / 10 exported
```

`grep -rn 'from "@/' plugins/ci/src` → **0**.

The burndown did not move, and nothing was hiding: `scm`'s coupling was to core
*tables* and core *auth* reached through `src/lib/db/queries` and `src/lib/auth`
— both `CORE_SRC_PATHS`, both allowed. Recipe §1.5 already says to expect this
and that the port count is the metric from here. Both counting hazards were
checked (`grep -rn 'from "\./' src/server/actions/{github-actions,gitlab-pipelines}.ts`
→ nothing; `file` on every moved source → all `text`).

## 10. What was NOT verified

Same honesty §9 of the recipe asks for, and this one has more of it than most
because the feature's whole job is talking to somebody else's server.

- **No `pnpm db:push` against a real database, and therefore no exercise of the
  two renames.** `migrateCiTables()` is written to the shape
  `migrateGamificationTables()` proved and is idempotent by construction, but it
  has not run. It is also the single most destructive thing in this change if it
  is wrong — see §6 on `webhook_secret`.
- **No real GitHub or GitLab call.** Not one of `upsertWorkflowFile`,
  `setRepoSecret`, `upsertCiFile`, `setProjectVariable`, `upsertProjectHook` or
  `upsertPipelineSchedule` was exercised. They moved verbatim with no signature
  change, so the risk is in the *call sites* in `actions.ts`, which were
  restructured (the shared `serverUrlCheck`/`runnerCheck` helpers, the
  `scmCredentials` indirection).
- **No click-through of the settings cards.** 3,510 LOC of UI moved; it
  type-checks, it builds, and its client chunk is confirmed emitted, but no
  dialog was opened.
- **No deletion hook run.** `onTeamDeleted` / `onRepoDeleted` are covered by
  `src/lib/core/manifests.test.ts` only insofar as it asserts the hook *exists*.
- **The runner-deletion gap (§7) is described, not tested.** The claim that it
  renders as "Linked runner not found in database" is read off the code path,
  not observed.
- **No GitLab webhook delivery.** The gate's `UNCONFIGURED` defaults are
  reasoned to match the pre-migration `config: … | undefined` defaults by
  reading both; nothing posted a payload.
