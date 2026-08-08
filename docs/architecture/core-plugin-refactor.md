# RFC: Core + Plugins

**Status:** proposed — not started
**Author:** planning doc, no code changes in this PR
**Supersedes:** nothing

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

### Phase 2 — Kernel + first plugin (~3 weeks)

Build `@lastest/contracts`, `@lastest/kernel`, `core/browser`, and migrate **one**
plugin end to end.

**Pilot: `explorer`.** Rationale: ~5,100 LOC (large enough to be a real proof, small
enough to finish), and it exercises every capability at once — EB (direct-CDP
offender in `tester.ts`), AI, background jobs, its own tables
(`explorerTriggers`), an API route, an app route, components, and server actions.
`qa-agent` is the flagship but at 13,700 LOC it is the wrong thing to learn on.
`app-map` is easier but has no EB usage, so it would prove nothing about R4.

Exit criteria: `plugins/explorer` has no `@/` imports, no `playwright` dependency, no
`@lastest/db` dependency; explorer works identically in the app; the ESLint rules are
**error**-level for `plugins/**`.

### Phase 3 — Check-layer plugins (~1 week)

Convert `CheckLayer` from a closed union to a registry; move `design-system` and
`a11y` out as plugins. Small, high-signal, and it makes the highest-churn category of
change (new check layer) plugin-local.

### Phase 4 — Roll out (~2–3 months, one PR per plugin)

In rough order of increasing pain: `rca`, `url-diff`, `app-map`, `share`, `launch`,
`gamification`, `playground`, `api-test`, `demo`, `data-sources`, `scm`,
`scheduling`, then the `src/lib/playwright` split (§6.2), then `qa-agent` last —
by which point the contract will have been through a dozen features.

Each plugin is one PR that touches only `plugins/<id>/**` plus generated glue and
deletions from `src/`. If a plugin needs a new core capability, that is a **separate,
earlier PR** — which is exactly the workflow being asked for.

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
