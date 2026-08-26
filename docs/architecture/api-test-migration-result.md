# API tests migration — result

**Status:** done and building. `pnpm install --frozen-lockfile`, `pnpm arch`,
`pnpm lint`, `pnpm types`, `pnpm test` and `pnpm build` all pass.
**Recipe:** [`plugin-migration-recipe.md`](./plugin-migration-recipe.md).
**Phase:** the fourth plugin of RFC §9 phase 4, after
[`rca`](./rca-migration-result.md),
[`app-map`](./app-map-migration-result.md) and
[`launch`](./launch-migration-result.md).
**Committed** as two commits, core prep first (`afb99910`), migration on top
(`8f0df0e5`) — the §7.2 split.

---

## 1. The headline

`api-test` is a workspace package. `plugins/api-test/package.json` lists
`@lastest/ai-kit`, `@lastest/contracts`, `@lastest/eb-protocol`,
`@lastest/kernel`, `@lastest/ui`, `ajv` and `sonner` — and no `playwright`, no
`@lastest/db`, no `drizzle-orm`, no `@lastest/pool-service`, no AI SDK. There is
no `@/…` import anywhere under `plugins/api-test/`. `pnpm arch` reports **0
violations in the target layout**.

The moved surface, ~2,200 LOC vertical:

| Was | Now |
| --- | --- |
| `src/lib/api-test/runner.ts` + `.test.ts` | `plugins/api-test/src/runner.ts` |
| `src/lib/api-test/redact.ts` + `.test.ts` | `plugins/api-test/src/redact.ts` |
| `src/lib/api-test/from-network.ts` + `.test.ts` | `plugins/api-test/src/from-network.ts` |
| `src/lib/api-test/generator.ts` | `plugins/api-test/src/generator.ts` |
| `src/lib/api-test/evidence.ts` | `plugins/api-test/src/evidence.ts` |
| `src/lib/api-test/types.ts` | `plugins/api-test/src/types.ts` (now re-exports from `@lastest/eb-protocol`) |
| `src/server/actions/api-tests.ts` | `plugins/api-test/src/actions.ts` (minus `validateDiffAction`, §6) |
| `src/components/api-tests/api-test-{dialog,form}.tsx` | `plugins/api-test/src/ui/` |
| `src/components/api-tests/validate-diff-dialog.tsx` | `src/components/validate-diff/` — **not this feature**, §6 |
| — | `plugins/api-test/src/{index,host,wiring}.ts` |

36 unit tests moved with the code and pass unmodified apart from import paths.
Four new ones were added, and §4 argues they are the most interesting artifact
of the migration.

**The build is the evidence, not the claim.**
`server-reference-manifest.json` carries **3 action ids** whose module is
`plugins/api-test/src/actions.ts` — `createApiTest`, `updateApiTest`,
`generateApiTestDefinitionAction`, the whole action surface. Spike S1 holds for
a fourth package.

## 2. Port size: 5. And the shape matters more than the number

Costed before starting, per recipe §1.5. Five methods, in three groups:

| # | Method | Group | Retired by |
| --- | --- | --- | --- |
| 1 | `fetchGuarded` | security boundary | `core/security` |
| 2 | `createTest` | authorized write into `tests` | a widened `ctx.tests` |
| 3 | `updateTest` | authorized write into `tests` | a widened `ctx.tests` |
| 4 | `aiSupportsJson` | AI preflight read | one field on `ctx.ai.budget()` |
| 5 | `apiLayerHint` | AI preflight read | a `ctx.repos`/codebase-intel read |

So the running table is now `launch` **4**, `api-test` **5**, `rca` **6**,
`app-map` **9**, `url-diff` **~22 (never migrated)**.

The recipe's advice to *group* the port after counting it pays off here more
than in any previous migration: five methods collapse to **three items of
debt**, and one of the three is shared with two plugins that already shipped.

### 2.1 The raw survey said 16, and 11 of those were not port methods

A first pass over the imports counted sixteen distinct app symbols. The
difference between 16 and 5 is exactly the two categories recipe §1.5 warns
about, plus one this migration adds:

- **Type-only imports (8).** `ApiTestDefinition`, `ApiAssertion`,
  `ApiAssertionKind`, `ApiAuth`, `ApiTestResultData`, `ApiAssertionResultData`
  were promoted; `NetworkRequest`, `EvidenceItem` and `FunctionalArea` were
  narrowed. §3 covers which got which treatment and why.
- **`@/components/ui` primitives (7).** Six were already in `@lastest/ui`;
  `Separator` moved there in the prep commit. Not a port method, and not a core
  PR — `libs/` carries no review gate.
- **Auth guards (3).** `requireRepoCapability`, `requireRepoAccess`,
  `requireTestOwnership` looked like three methods and became **zero**, because
  they moved *inside* the two write methods rather than alongside them. That is
  §5, and it is the part of this migration worth copying.

## 3. Whose type is it — promote or narrow, five times

Recipe §6.1 got exercised harder here than anywhere so far, because API tests
sit on core rows. Both branches were used, and the deciding question was always
"whose type is it".

**Promoted to `@lastest/eb-protocol` (core PR):** `ApiAuth`, `ApiAssertion`,
`ApiAssertionKind`, `ApiTestDefinition`, `ApiAssertionResultData`,
`ApiTestResultData`. These are the plugin's *own* jsonb payloads — it is the
only thing that writes them and the only thing that reads them — and they land
in core columns (`tests.api_definition`, `test_results.api_result`). Same call
as `rca`'s verdict shapes. `packages/db/src/schema/tests.ts` re-exports all six,
so **no app import path changed**: the 13 files that say
`import type { ApiTestDefinition } from "@/lib/db/schema"` still say that.

**Narrowed in the package (no core change):**

| Core type | Narrowed to | Where the assertion lives |
| --- | --- | --- |
| `NetworkRequest` (17 fields) | `CapturedRequest` (7) | the three call sites that pass a real `NetworkRequest` |
| `EvidenceItem` (11 layers) | `ApiEvidenceItem` (`layer: "api"`) | the `push` in `src/server/actions/builds.ts` |
| `FunctionalArea` (11 columns) | `ApiTestAreaOption` (`id`, `name`) | the dialog's `areas` prop at each mount |

Each narrow is *stricter* than what it replaced — `ApiEvidenceItem` pins the
layer this producer has always emitted — and none needed a `satisfies` clause,
because the assignment at the call site already is one. If core drops a field or
changes a type, the app stops compiling; the package alone would not notice, and
that is precisely why the assertion has to live on the app side.

## 4. What the boundary actually bought: the SSRF guard, and four tests

This is the migration's real result, and it is not "the burndown moved" (§7).

**Before.** `src/lib/api-test/runner.ts` — feature code — imported
`assertSafeOutboundUrl`, `SsrfBlockedError` and `createSsrfSafeDispatcher`, ran
the pre-flight check itself behind an opt-out flag, and separately attached the
connect-time dispatcher to its own `fetch`. Both halves of an SSRF control,
owned by the feature that the control exists to constrain.

**After.** The engine calls `host.fetchGuarded(url, req)`. The package contains
no `fetch`, no dispatcher and no guard — there is nothing to skip, because there
is nothing to skip *with*. `core-scope.md` §2 reason 2 in one refactor.

Two details worth recording:

- **The `skipSsrfCheck` flag is gone.** Its doc comment said it was set by "the
  load runner"; there is no load runner, and `grep` found zero callers. Removing
  an unused way to disable an SSRF check while moving that check into core was
  the only defensible reading. No behaviour change — nothing set it.
- **The port method is "do the request", not "give me the guard".** Handing the
  plugin `assertSafeOutboundUrl` would have satisfied the import rule and
  changed nothing about who can forget to call it. `plugins/explorer` currently
  has the weaker shape (it takes the primitive); when `core/security` lands,
  that is worth revisiting.

**And the tests.** `runApiTest` had no coverage at all — the assertion evaluator
was well tested, `resolveApiUrl` was tested, and the band between them and "a
build ran" was empty, because covering it meant mocking global `fetch` *and* an
undici `Agent`. With the transport injected, a stub host is four lines, and four
tests now cover URL resolution + auth application, an SSRF block reported as a
failed test rather than a throw, response-snippet redaction, and the
short-circuit on an unresolvable URL.

That is a claim worth being careful about: **the boundary did not make the code
more testable by being a boundary.** It made it more testable because
"inject the thing that talks to the world" is good design, and the boundary
forced the question. A migration that had passed the whole `@/lib/security`
module through the port would have satisfied `pnpm arch` and produced none of
this.

## 5. Authorization moved to where it cannot be forgotten

The old server actions opened with a guard:

```ts
export async function createApiTest(input) {
  await requireRepoCapability(input.repositoryId, "tests:write");
  // …
  await queries.createTest({ … });
}
```

That is the conventional shape and it has a conventional failure mode: the guard
and the write are two statements, and a fifth action added later can have the
second without the first. Nothing enforces the pairing.

Now the guard is *inside* the only thing that can perform the write:

```ts
// src/lib/core/api-test-host.ts — app side
async createTest(input) {
  await requireRepoCapability(input.repositoryId, "tests:write");
  return { id: (await queries.createTest({ … })).id };
}
```

and `plugins/api-test/src/actions.ts` has no guard at all, because it has no
other way to reach `tests`. The plugin cannot write an unauthorized row by
forgetting a line — there is no line to forget.

This is the same call `app-map` made for qa-agent's Pro gate and the explorer
quota ("a plugin that could clamp its own quota is not a quota"), applied to
RBAC. It is also forced rather than chosen: `Capability` / `requireRepoCapability`
are not on `PluginContext` and should not be, so the host is the only place they
could live.

**The redaction went the same way, and that one is a credential boundary.**
`tests.code` is human-visible and snapshotted into `test_versions`; an
`ApiTestDefinition` can carry a live bearer token. The old actions rendered the
redacted string themselves and passed it to `createTest`. Now the host takes the
*definition* and calls `renderApiDefinitionForCode` itself. The plugin still owns
the redaction logic — it is knowledge about `ApiAuth`, its own type — but core
owns the decision to apply it, so a caller cannot choose to pass an unredacted
`code`.

## 6. Two things that turned out not to be this feature

Read a feature's import list, not its directory name — `launch`'s lesson, and it
applied twice here.

**`validateDiffAction` was never an API test.** It maps a pasted git diff to
affected tests and runs a scoped *build*. It lived in
`src/server/actions/api-tests.ts` because of shared E-series feature numbering
and nothing else. Carrying it into the plugin would have needed a
"run a build and poll it" host method — RFC §4.3's coupling in a nicer coat, and
the single biggest thing that could have pushed this port from 5 to 6+. It moved
to `src/server/actions/validate-diff-action.ts` in the prep commit, next to the
`validateDiffCore` it wraps, along with its dialog.

(Mechanical note for the next person: `validate-diff.ts` could not simply take
the `"use server"` directive, because such a module may only export async
functions and it exports its result types. Hence a separate one-function file.)

**`create_test` needed adding to the AI action-type allowlist.** The generator
has always logged its spend under `AIActionType: "create_test"`.
`createAiFactory` in `src/lib/core/ai-capability.ts` drops unknown action types
(the column is an enum), and its allowlist contained only the three
`explorer_*` values — so going through `ctx.ai` would have *silently* stopped
attributing these calls. Caught by reading the capability rather than by any
gate. Worth a look for every future plugin that declares `capabilities: ["ai"]`.

## 7. The burndown did not move, again — and this time it is honest

`pnpm arch` was 21 before and is **21 after**; `tools/architecture/baseline.json`
is untouched because it had no `api-test::*` key to remove.

Unlike `app-map`, that is not hiding anything. Both of §1.5's counting hazards
were checked explicitly:

- **Relative imports between server-action modules.**
  `src/server/actions/api-tests.ts` had one non-local import,
  `@/server/actions/validate-diff` — an `@/…` path the walker *does* see, into a
  module that is unclassified rather than a pseudo-plugin, so it was correctly
  not counted. It is also the import §6 deleted.
- **Binary files.** `file plugins/api-test/src/*` reports every module as text.
  No NUL-byte blind spot like `app-map`'s `build-map.ts`.

So `api-test` genuinely had zero counted violations going in. The reason is
worth stating, because it predicts the rest of the list: **the burndown counts
forbidden *imports*, and this feature's coupling was to core *tables* and core
*auth*, which no rule counts.** It reached `tests` through
`src/lib/db/queries` — the sanctioned path — and `queries` is `CORE_SRC_PATHS`.
A feature can be entirely built on other people's data and score zero.

## 8. First plugin whose data is entirely in core tables

Every phase-4 plugin so far either owned tables (`launch`: 7, `a11y`: 1) or
computed everything on read (`app-map`, `rca`, `design-system`). `api-test` is
the first that *persists* and owns nothing: an API test is a `tests` row with
`testType: "api"` and an `apiDefinition` jsonb; its result is a
`test_results.api_result` jsonb.

Consequences, all of which fell out cleanly:

- **No `schema`, no `deletion` hook.** Deleting a team already cascades its
  tests via the existing FKs. `resolveRegistry` requires a hook only when
  `schema` is declared, so nothing to write and nothing to get wrong.
- **`core-scope.md` §6 is load-bearing rather than decorative.** "A plugin does
  not reach a core table, it calls a core function" is the entire design of the
  port, not a rule that happened not to bind.
- **`ctx.tests` did not fit, and should not have been stretched to.** It has two
  methods and `createQuarantined` is *deliberately* incapable of expressing an
  un-quarantined write, an `apiDefinition`, or an update. Widening a capability
  to fit its second consumer is a core PR with its own review; declaring the gap
  in a host port is this one. Recipe §3's "a port method that turns out to be
  general is a candidate for promotion — as its own PR, never bundled" is
  exactly this case, and `createTest`/`updateTest` are now the second data point
  arguing for a real `ctx.tests` write surface.

## 9. What I did not verify

Per recipe §9, stated plainly rather than implied:

- **No runtime click-through.** The app was never started. Creating an API test
  from the dialog, editing one, generating one with AI, seeding one from a
  captured network request in the diff viewer / verify focus view / test detail
  page — none of it was exercised against a running server. The build proves
  Next.js can *dispatch* the three actions; it does not prove they behave.
- **No API test was executed.** `runApiTest` is covered by unit tests with a
  stub transport. The real `fetchGuarded` — `assertSafeOutboundUrl` plus a live
  `createSsrfSafeDispatcher` — was not run against any URL, blocked or allowed.
  The code is a faithful move of what `src/lib/api-test/runner.ts` did, but
  "faithful move" is an argument, not a test.
- **No AI call.** `generateApiTest` now goes through `ctx.ai.generate()` rather
  than `generateWithAI(aiConfigFromSettings(...))`. Types line up and the
  `create_test` attribution was restored deliberately (§6), but no model was
  called and no `ai_prompt_logs` row was inspected. **This is the most likely
  place for a behaviour difference to be hiding**, because it is the one call
  whose plumbing changed rather than moved.
- **No `pnpm db:push`.** No schema change was made — the type promotion is pure
  TypeScript, and `drizzle-kit` sees identical column definitions — so there
  should be nothing to push. Not confirmed against a database.
- **The v1 REST surface was not called.** `POST /api/v1/tests/generate-api` now
  routes through the plugin's action (so that `contextFor` can resolve
  `ctx.ai`), which means its authorization path changed from
  `verifyRepoOwnership` alone to `verifyRepoOwnership` *and* `requireRepoAccess`.
  Both resolve the same bearer session through `getCurrentSession`, and the
  second is strictly redundant rather than different — but it was not exercised
  with a real token.

## 10. For whoever migrates the next one

- **Cost the port, then group it — but also ask what each method *is*.** A port
  of 5 that includes one security primitive is healthier than a port of 5 that
  includes five reads, because the security one is shared with two other
  plugins and retires all three at once.
- **Prefer "do the thing" over "give me the primitive" in a host method.**
  `fetchGuarded` vs. `assertSafeOutboundUrl` is the difference between a
  boundary and a re-export.
- **Look for guards that can move *inside* a write.** Any port method that
  performs a mutation is an opportunity to make its authorization structural
  instead of conventional. Three of this feature's sixteen surveyed symbols
  disappeared that way.
- **Check the `ai-capability` action-type allowlist** before declaring
  `capabilities: ["ai"]`. It silently drops what it does not recognise.
- **A zero burndown is normal now, not suspicious.** The cheap structural wins
  were spent at 31 → 22. What remains is coupling the walker was never designed
  to see: core tables, core auth, and behaviour reached through the query layer.
  The number will keep not moving; the host-port count is the honest metric from
  here.
