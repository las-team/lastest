# Brief: migrate `explorer` to a plugin (pilot)

This is the **pilot** for the core/plugin refactor. The contract it exercises will
be reused by ~19 more features, so the shape it establishes matters more than
finishing quickly. It doubles as the template for every later migration.

Use the text below as the task prompt.

---

## PREREQUISITE — read this before starting

**`core/browser` and `core/data` must exist and be merged first.** Today `core/`
contains only `contracts` and `kernel`. Explorer cannot be migrated without an
implementation of `BrowserCapability` and `DataCapability` to call.

A previous attempt at this migration was started without them and drifted: it
spent its time extracting `libs/ai-kit`, `libs/cron`, `libs/ui` and
`libs/browser-kit` instead of migrating explorer, because those were the only
parts it could make progress on. That work is not wrong, but it is not this task.
**If the prerequisite is not met, stop and say so rather than finding adjacent
work.**

---

## The prompt

You are migrating the `explorer` feature into a plugin package in the lastest
repo (visual regression testing platform: Next.js 16, Drizzle, pnpm, Playwright).

### Read first, in this order

1. `CLAUDE.md` — repo conventions. ALWAYS `pnpm`, NEVER `npm`/`npx`. Never run
   `pnpm db:reset`.
2. `docs/architecture/core-scope.md` — **the governing document. It supersedes §6
   of the RFC.** Pay attention to §2 (the bar for core), §3 (the three tiers),
   §5 (browser is lifecycle-only) and §6 (plugins never touch core tables).
3. `docs/architecture/core-plugin-spikes.md` — S1 proves `"use server"`,
   `"use client"` and route pages all work inside a workspace package, so no
   codegen is needed. S3 lists explorer's exact Playwright surface.
4. `docs/architecture/core-plugin-refactor.md` — the original RFC, for §4.3
   (composition) and §7 (enforcement). Note its status header.
5. `core/contracts/src/` and `core/kernel/src/` — the contract you implement
   against. `registry.test.ts` shows the rules the kernel enforces at boot.

### Scope — the measured vertical slice

| Path | Size |
| --- | --- |
| `src/lib/explorer/` | 1,674 LOC, 18 files |
| `src/server/actions/explorer-agent.ts` | 1,817 LOC |
| `src/components/explorer/` | 1,247 LOC |
| `src/app/(app)/explorer/page.tsx` | app route |
| `src/app/api/explorer-agent/[sessionId]/route.ts` | API route |
| `explorerTriggers`, and explorer's slice of `agentSessions` | in `packages/db/src/schema/agents.ts` |

All of it moves to `plugins/explorer/`. This is a **move, not a copy** — delete
the originals. Leaving both copies is worse than either.

### The five boundary violations you must eliminate

`pnpm arch` currently reports exactly these for explorer. After the migration
they must all be gone, and `pnpm arch:baseline` must show the total drop from 42:

```
cross-plugin  @/lib/playwright/ranger    src/lib/explorer/planner.ts:5
cross-plugin  @/lib/playwright/ranger    src/lib/explorer/research.ts:1
browser       playwright                 src/lib/explorer/tester.ts:1
cross-plugin  @/lib/scheduling/cron      src/server/actions/explorer-agent.ts:12
cross-plugin  @/lib/qa-agent/auth        src/server/actions/explorer-agent.ts:26
```

### Exit criteria (RFC §9 phase 2)

- `plugins/explorer/package.json` lists **no `playwright`, no `@lastest/db`, no
  `@lastest/pool-service`**. The manifest is the proof (RFC §7.4) — with pnpm's
  strict layout, a banned import fails to resolve rather than merely linting.
- No `@/...` imports anywhere in `plugins/explorer/`.
- `pnpm arch` reports **0 violations in the target layout**.
- Explorer behaves identically in the app.

### The four hard problems

**1. EB usage.** `src/lib/explorer/tester.ts` calls `chromium.connectOverCDP(cdpUrl)`
directly (~lines 435 and 469), and `explorer-agent.ts` manages claim/release
(~lines 337-405: `claimSessionEb` / `releaseSessionEb` / `applyAuthToEb`).

All of that becomes `ctx.browser.withBrowser(...)`. Note that `core/browser` is
deliberately **lifecycle-only** (core-scope.md §5): explorer keeps its own
driving code — `goto`, `act`, DOM snapshots, evidence accumulation — it just
receives a page from core instead of connecting to a pod itself. Do not push
driving logic into core; that boundary was set deliberately.

`runScenariosConcurrent` maps onto `withBrowserSwarm`. Its storage-state sharing
across contexts is the interesting case — check the contract covers it, and say
so if it does not.

**2. Data.** Per core-scope.md §6 the rule is absolute: explorer reads **only its
own tables** via `ctx.data`. No reading core tables, not even read-only, and no
FK from a plugin table to a core table. It currently reads repositories, storage
states and agent sessions directly.

Because there is no FK, there is no cascade. `resolveRegistry()` will **reject**
a plugin declaring `schema` without a `deletion` hook — implement it properly,
not as a stub.

**3. Cross-plugin imports.** For each of the four above, choose and document:
promote genuinely-shared pure logic into a `libs/` package (the third tier —
core-scope.md §3), or compose asynchronously via `ctx.jobs`. `@/lib/scheduling/cron`
is probably a lib; `@/lib/qa-agent/auth` is probably a job. Justify each.

**4. UI.** Spike S1 proved the route page and client components can live in the
package with a one-line `export { default } from "..."` on the app side. Use
that. No codegen.

### The highest-value output

**Enumerate every core-entity read explorer used to do directly, and what core API
each one needs.** Explorer touches repositories, storage states, agent sessions,
AI settings and more. Under the no-read rule each becomes a core function that
does not exist yet.

That list is worth more than the migration itself: it is the first real
measurement of how big the core API surface has to be, which determines whether
the remaining ~19 features are a quarter of work or considerably more. Produce it
even if the migration itself stalls.

### Hard constraints

- **No new external npm dependencies.** Do not add or upgrade anything resolving
  from the registry — active npm worms make every new package a risk.
  `workspace:*` links inside this repo are fine. Reuse the EXACT version ranges
  already in the root `package.json` so pnpm resolves to already-locked versions.
  Verify and report:
  ```
  git diff -- pnpm-lock.yaml | grep -cE "^\+.*(resolution:|integrity)"   # MUST be 0
  ```
  A non-zero count means a tarball was fetched — stop and report instead of
  proceeding.
- **Do not touch `core/**` in this change.** Core and plugin changes must be
  separate PRs (RFC §7.2, enforced by CI). If explorer needs a core capability
  that does not exist, that is a **separate, earlier PR** — report it, do not
  sneak it in.
- Do not weaken the boundary rules to make things pass. If something genuinely
  does not fit, say so.

### Verification — run these yourself, all must pass

```
pnpm install --frozen-lockfile
pnpm lint          # 0 errors
pnpm test          # existing suite must stay green; explorer's tests move too
pnpm types         # clean
pnpm build         # the real proof the Next.js integration works
pnpm arch          # target layout 0 violations
```

`pnpm build` passing is the single most important signal. Do not claim success
without having run these.

### Reporting

Be blunt about what did not work. Specifically:

- The core API list described above.
- Each cross-plugin import and how you resolved it.
- Anything that did not fit the contract, and what you had to bend.
- What is incomplete or unverified.

A partial migration honestly reported is far more useful than a claim of success
that does not build. Do not commit — leave the work in place and report the paths.
