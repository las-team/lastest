# Plugin migration recipe (RFC §9 phase 4)

**Status:** written for the first phase-4 wave (`rca`, `url-diff`, `app-map`),
generalised from the explorer pilot ([`explorer-migration-result.md`](./explorer-migration-result.md))
and the two check-layer plugins.
**Audience:** whoever migrates the next feature out of `src/` into `plugins/<id>/`.

This is the *how*. The *why* is [`core-plugin-refactor.md`](./core-plugin-refactor.md)
§3–§7 and [`core-scope.md`](./core-scope.md); read those first if you have not.

---

## 0. The three rules you are being paid to keep

1. **No `@/…` import anywhere under `plugins/<id>/`.** The package cannot see the
   Next.js app. What it needs from the app arrives injected.
2. **No `playwright`, `@lastest/db`, `@lastest/pool-service`, `pg`, `postgres`, or
   an AI SDK in the plugin's `package.json`.** pnpm's strict layout turns that
   manifest into the enforcement — not a lint rule someone can disable.
3. **No plugin → plugin import.** Compose through core, a shared `libs/*` package,
   or a host port filled at the composition root.

`pnpm arch` checks all three. `Target layout (core/** + plugins/**)` must stay at
**0 violations** — that number is not a ratchet, it is a hard zero.

## 1. What "done" looks like

- `plugins/<id>/` is a workspace package with one `definePlugin` manifest.
- `src/lib/<id>/` and `src/server/actions/<id>.ts` are **deleted**, not left as
  shims. Every consumer imports `@lastest/plugin-<id>/…` instead.
- The plugin's entry is gone from `PSEUDO_PLUGINS` in
  `tools/architecture/boundaries.mjs` — that deletion *is* the graduation, and it
  is what drops the burndown.
- Behaviour is identical. This is a move, not a rewrite (RFC §2).

## 1.5 Cost the host port BEFORE you start

Count the distinct core functions the feature calls. That number is the host
port's size, and it is the single best predictor of whether the migration is
worth doing yet.

| Port size | Verdict |
| --- | --- |
| ≤ ~8 | Go. This is a feature sitting *on* core. |
| ~8–15 | Go, but expect most of the port to be one missing capability. |
| > ~15 | **Stop.** The port would be bigger than the feature. |

A port larger than the feature it serves is not a boundary — it is core
re-exported through a keyhole. It satisfies "no `@/…` imports" while proving
nothing, which is the §10 risk of drawing the boundary wrong. When the count
comes out that high, the feature is a thin *orchestration of* core rather than
a consumer of it, and the real task is extracting the core module it
orchestrates, as its own PR, first.

Measured so far: `rca` **6** (done), `app-map` **9** (done), `url-diff` **~22**
(never migrated — reclassified as core, RFC §9 phase 4).

> **Count core functions the feature *calls*. Nothing else.** A first pass over
> `app-map` counted 20 distinct imported symbols and would have stopped the
> migration; the real port was **9**. The 11-symbol difference was type-only
> imports (which get narrowed or promoted — §3.1) and `@/components/ui`
> primitives (which go to `libs/ui` — §5). Neither is a port method.
>
> Then group what is left. `app-map`'s nine were five reads of one missing
> capability, one security boundary, and three calls into an unmigrated
> neighbour — three items of debt, not nine. A port of 9 that groups into 3
> is healthier than a port of 6 that groups into 6.

> **Counting hazard 1 — the walker's blind spot.** `pnpm arch` reporting zero
> violations for a feature does not mean it has none.
> `crossPluginPatternsFor()` builds its patterns from `@/…` aliases, so a
> `plugin → plugin` import written as a *relative* path inside
> `src/server/actions/` is invisible to it. `app-map` graduated with a clean
> burndown while holding exactly such an import
> (`import { addQaTask, startQaAgent } from "./qa-agent"`). Always run
> `grep -rn 'from "\./' src/server/actions/<feature>.ts` as part of the survey.

> **Counting hazard 2 — binary files.** `plugins/app-map/src/build-map.ts`
> (formerly `src/lib/app-map/build-map.ts`) contains literal NUL
> bytes (deliberate `\0` separators in an edge key, line ~217). `grep` treats
> such a file as binary and **silently reports nothing** — no match, no
> warning. That made an early survey of this exact feature undercount its
> imports by seven. Before trusting a grep-based survey, run
> `file <path>`: anything reported as `data` rather than `text` is invisible to
> your search. `grep -a` reads it correctly.

## 2. Pick the shape: does the plugin own tables?

| | Owns tables | Owns no tables |
| --- | --- | --- |
| Manifest | `capabilities: ["data"]`, `schema: () => import("./schema")`, `deletion: …` | neither |
| Template | `plugins/a11y`, `plugins/explorer` | `plugins/design-system`, `plugins/events` |
| Table names | must be `<id>_`-prefixed; `core/data` validates at boot | n/a |

`resolveRegistry` refuses to boot a plugin that declares `schema` without
`deletion` — plugin tables carry no FK to core tables, so `ON DELETE CASCADE`
does not exist for them and the hook is the only thing that makes account
deletion complete ([`core-scope.md`](./core-scope.md) §6).

**A feature that only reads core tables owns no tables.** It reaches them
through a capability (`ctx.tests`, `ctx.repos`, `ctx.storage`) or, where core has
no API yet, through a **host port**.

## 3. The host port — the honest escape hatch

When the feature needs something core does not expose yet, declare it as an
interface in `plugins/<id>/src/host.ts` and let the composition root fill it from
`src/lib/core/<id>-host.ts`.

```ts
// plugins/<id>/src/host.ts — the gap, stated out loud
export interface RcaHost {
  listDiffsForBuild(buildId: string): Promise<RcaDiffInput[]>;
}
```

```ts
// src/lib/core/<id>-host.ts — the app fills it, using @/… freely
import type { RcaHost } from "@lastest/plugin-rca/host";
export const appRcaHost: RcaHost = { … };
```

Two things make this legitimate rather than a loophole:

- The plugin still holds **no** `@/…` import, no DB handle and no pod address.
  It has a named, typed, greppable list of everything it needs from outside.
- The port is **countable**. `explorer` started at eight methods and is at five;
  the count going down is the phase-5 burndown. A port method that turns out to
  be general is a candidate for promotion into a real core capability — as its
  own PR (RFC §7.2), never bundled with a plugin migration.

Write the file header the way `plugins/explorer/src/host.ts` does: say which
methods are permanent seams and which are scaffolding waiting on a core PR.

## 4. Wiring — why `Symbol.for` and not a module-level `let`

A plugin's `"use server"` module is *imported by Next.js*, never constructed, so
there is no moment at which to pass it arguments. `configure<Name>()` is called
once by `src/lib/core/runtime.ts` and the actions read what it left.

The slot must be a realm-wide `Symbol.for(...)` key on `globalThis`. Next.js can
place a server action's module and the module that wired it in **different
bundles**; two copies of a module-level `let` is a failure that only appears in a
production build. Copy `plugins/design-system/src/wiring.ts` (host only) or
`plugins/explorer/src/wiring.ts` (host + runtime + data).

## 5. Shared pure logic goes to `libs/`, not to core

When two features need the same dependency-free helper, the answer is a `libs/*`
package — the third tier from [`core-scope.md`](./core-scope.md) §3. Core is for
things that break *everyone* when a feature gets them wrong (tenancy, capacity,
money, credentials, the registry). Shared code that guards nothing is a library,
and putting it in core is how the RFC's core got to nine modules.

The explorer pilot created `libs/page-map` and `libs/cron` this way. Keep libs
free of `@/…` and free of plugin imports — `pnpm arch` enforces both.

If the helper *is* a security boundary (an SSRF guard, crypto, a quota check),
it belongs in core instead, and it is a separate PR.

## 6. Routes and actions cross the package boundary fine (spike S1)

- **Server actions:** a `"use server"` module inside a `transpilePackages`
  package produces real, dispatchable action ids. Export them from
  `plugins/<id>/src/actions.ts`. No codegen, no shim.
  *Gotcha:* `export { x } from "pkg"` inside a `"use server"` file compiles to a
  module with **no exports** — declare wrapper functions if you ever need to
  re-export.
- **Route pages:** the page component lives in the package
  (`plugins/<id>/src/ui/page.tsx`, exported as `./page`). The app's
  `src/app/(app)/<path>/page.tsx` keeps only the *composition* — resolving the
  selected repository, plan gating, and handing down app UI the plugin may not
  import. See `src/app/(app)/explorer/page.tsx` for the pattern and for the
  reasoning about what is legitimate to pass down.
- **`"use client"` components** inside the package work. Import shadcn
  primitives from `@lastest/ui`, not from `@/components/ui`. A primitive that
  is not there yet moves in — definition to `libs/ui`, re-export shim left at
  `src/components/ui/<name>.tsx` so no app import changes. `libs/` carries no
  CODEOWNERS gate, so this is not a core PR.
- **App UI a plugin cannot import goes down as a prop.** `app-map` handed its
  live-progress panel down as `exploreProgressPanel` (a `ComponentType`) and
  qa-agent's cancel action as `onCancelExploration`, the same way
  `src/app/(app)/explorer/page.tsx` hands down `browserViewer`. The rule:
  **the plugin owns the placement, the app owns the thing placed.** A render
  prop is not a loophole — the plugin still learns nothing about what it
  mounted.

### 6.1 Types the plugin may not import: narrow, or promote?

Both are legitimate; the deciding question is *whose type is it*.

| | Do this | Precedent |
| --- | --- | --- |
| The type is the plugin's own payload | **Promote** it to `@lastest/eb-protocol` (a core PR) | `rca` — its verdict shapes |
| The type belongs to core or to another unmigrated feature | **Narrow** it: declare the fields you read in `host.ts`, and let a `satisfies` clause in `src/lib/core/<id>-host.ts` be the assertion that it still matches | `rca`'s `RcaChangeMap`; `app-map`'s `AppMapDiscovery` |

Narrowing is not a fork as long as the assertion exists: if core's shape
drifts, the host file stops type-checking. Promoting *another* feature's
payload types ahead of that feature's own migration is presumptuous — and
narrowing is why `app-map` needed no core change at all.

## 7. Registration checklist

| File | Edit |
| --- | --- |
| `plugins/<id>/package.json` | deps honest — this is the enforcement (§7.4) |
| `package.json` (root) | `"@lastest/plugin-<id>": "workspace:*"` |
| `next.config.ts` | add to `transpilePackages` |
| `src/lib/core/manifests.ts` | import + append to `MANIFESTS` |
| `src/lib/core/runtime.ts` | import `configure<Name>` + call it in `getPluginRuntime` |
| `src/lib/core/<id>-host.ts` | the app's fill for the host port, if there is one |
| `tools/architecture/boundaries.mjs` | **delete** the `PSEUDO_PLUGINS` entry |
| `tools/architecture/baseline.json` | regenerate with `pnpm arch:baseline` — but see below |

The baseline only needs regenerating if the count actually moved. `app-map`
graduated without changing it (§1.5's first counting hazard), and a baseline
rewritten to the same number is noise in the diff.

## 8. Gates

```
pnpm install --frozen-lockfile   # new package resolves; no forbidden dep pulled in
pnpm arch                        # target layout must be 0; current layout must not rise
pnpm lint
pnpm types
pnpm test
pnpm build                       # the real check that actions + route pages still resolve
```

`pnpm build` is the one that matters. Type-checking a package in isolation will
not tell you whether Next.js can still dispatch the action.

Better than "the build passed" — count the action ids it produced:

```
node -e "const m=require('./.next/server/server-reference-manifest.json');
console.log(Object.values(m.node).filter(v =>
  JSON.stringify(v).includes('plugins/<id>/src/actions')).length)"
```

That number must equal the number of exported actions. `app-map` expected 5 and
got 5. A silently-empty result is what the S1 re-export trap looks like from
the outside.

## 9. Write down what you did *not* verify

Every migration so far has shipped with unexercised paths — no runtime click-through,
no `db:push` against a dev database, no real browser. Say so explicitly in the
result doc, the way [`explorer-migration-result.md`](./explorer-migration-result.md)
§6 does. A migration that claims more than it checked is worse than one that
admits the gap, because the next person believes it.
