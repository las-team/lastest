# Core + Plugins — Phase 1 spike results

**Status:** done. All three spikes answered against the real repo.
**Spike code:** throwaway, reverted. Nothing from this phase is in the tree.
**Measured on:** `claude/core-plugin-refactor-plan`, tip `6dfa0dbe`, Next 16.2.11,
drizzle-kit 0.31.8, pnpm 10.28.1.

These answer §9 phase 1 of [`core-plugin-refactor.md`](./core-plugin-refactor.md).
Two of the three come back **better than the RFC assumed**, and one exposes a
contradiction in §5 that has to be fixed before phase 2.

---

## S1 — Can a workspace package host a server action? **Yes.**

> *"Whether a `"use server"` module inside a `transpilePackages` workspace package
> produces a working action ID is **unverified** and is the first spike. […]
> Blocks the entire UI story."*

It works, and so does the rest of the UI story.

**Method.** Built a throwaway `plugins/_spike-s1` workspace package, added it to
`transpilePackages` and to the root `dependencies`, and ran a real `pnpm build`
(not a toy app — the actual 249k-LOC build). Verified against
`.next/server/server-reference-manifest.json`, which is the registry Next
consults to dispatch an incoming action request.

**Result.** The package's action is registered as a first-class server reference:

```json
"4016e4b4f59af630ae35f6b7e22946b454e6ab4f31": {
  "filename": "plugins/_spike-s1/src/operations.ts",
  "exportedName": "spikeDirect",
  "workers": { "app/(public)/spike-s1/page": { "moduleId": 607325 } }
}
```

Three further things were confirmed in the same build:

| Question | Result |
| --- | --- |
| `"use server"` module inside the package | works — registered action, dispatchable ID |
| `"use client"` component inside the package | works |
| Route page owned by the package, app-side file is one `export { default } from …` | works |

**So most of §8 evaporates.** The codegen fallback is not needed for server
actions, and route pages need only a one-line re-export rather than generated
component glue. That removes the RFC's "Risk: the codegen layer" almost entirely
— what remains is a generated *nav manifest*, which is a plain data array.

### The trap, if a shim is ever needed anyway

The obvious way to write the §8 fallback **silently produces a module with no
exports**:

```ts
"use server";
export { spikeViaShim } from "@lastest/plugin-spike-s1/plain"; // ← compiles to nothing
```

```
Export spikeViaShim doesn't exist in target module
The module has no exports at all.
```

The `"use server"` transform only promotes **locally declared** async functions
to server references; a re-export is not one. A shim has to declare wrappers:

```ts
"use server";
import { spikeViaShim as impl } from "@lastest/plugin-spike-s1/plain";
export async function spikeViaShim(msg: string) {
  return impl(msg);
}
```

That form was verified to work. Worth recording even though the fallback is no
longer the plan, because this is the failure mode someone will hit if they reach
for it.

### One consequence to plan for

The action ID is derived from the **module path** (`plugins/<id>/src/…`). Moving
a file between packages changes every action ID in it, so a client bundle served
just before a deploy will 404 its action calls just after. This is not new — the
same is true of `src/server/actions/*` today — but a phase-4 plugin move changes
*every* action ID in that feature at once, which is a larger blast radius than a
normal deploy. Land plugin moves when that feature is quiet, as §10 already says.

---

## S2 — Does drizzle-kit handle a schema glob across plugins? **Yes.**

**Method.** Added `plugins/_spike-s2/src/schema.ts` declaring a table with an FK
to the core `repositories` table, pointed a throwaway drizzle config at
`["./packages/db/src/schema.ts", "./plugins/*/src/schema.ts"]`, and ran
`drizzle-kit generate` into a scratch out-dir.

**Result.** The plugin table is picked up and the cross-package FK resolves:

```
spike_s2_findings 4 columns 0 indexes 1 fks
```

```sql
ALTER TABLE "spike_s2_findings"
  ADD CONSTRAINT "spike_s2_findings_repository_id_repositories_id_fk"
  FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id")
  ON DELETE cascade;
```

**Not verified:** `drizzle-kit push` against the live dev database. `push` shares
the same schema-loading path that `generate` exercises, so the risk is low — but
running it would have created `spike_s2_findings` in the developer's actual dev
DB, which is not a thing a spike should do. Confirm it on a scratch database
before phase 2 relies on it.

### S2 exposes a contradiction in §5

§5 says both of these, and they cannot both hold:

> *"A plugin may declare a FK **to** a core table."*
> *"`@lastest/db` stays out of plugin `dependencies`."*

Declaring `references(() => repositories.id)` requires importing the drizzle
table object for `repositories`. The spike had to write:

```ts
import { repositories } from "@lastest/db/schema"; // ← banned by §7.3
```

**The ban is aimed at the wrong thing.** Looking at what the package actually
exports:

- `@lastest/db` (root) — constructs a `postgres()` pool and exports a live `db`
  handle. *This* is what a plugin must never touch.
- `@lastest/db/schema` — table definitions only. No connection, no credentials,
  no query capability. Importing it grants a plugin nothing it could abuse.

**Proposed fix for phase 2:** `core/data` re-exports the core table objects that
plugins are permitted to FK to, and plugin schemas import from there. That keeps
`@lastest/db` out of plugin manifests entirely (so §7.4's pnpm-resolution
guarantee still bites) while making the allowed set of FK targets an explicit,
reviewable list in core rather than "all 97 tables". A plugin FK'ing to a table
core did not offer becomes a compile error, not a review catch.

---

## S3 — How much fits behind `BrowserHandle` without `withRawPage`? **All of it.**

> *"This exists because wrapping all of Playwright is not realistic on day one
> (qa-agent/crawl.ts and explorer/tester.ts use a wide slice of the API)."*

They do not. That premise is wrong, and it is wrong in the helpful direction.

**Method.** Flattened whitespace (so multi-line chains like `await page\n
.waitForLoadState(…)` are not missed) and extracted every Playwright host-side
call across all six direct-CDP offenders.

**Result — the complete union of Playwright APIs used by feature code:**

| Group | Calls |
| --- | --- |
| Lifecycle *(core-owned, plugins never see it)* | `connectOverCDP`, `browser.contexts/newContext/close`, `context.pages/newPage/close/storageState` |
| Navigation | `goto`, `url`, `title`, `waitForURL` |
| Waiting | `waitForLoadState("networkidle")`, `waitForSelector`, `waitForTimeout` |
| Acting | `locator().first().click/fill/selectOption`, `page.click`, `page.fill`, `keyboard.press` |
| Reading | `evaluate` |
| Viewport | `setViewportSize` |
| Observing | `page.on("console" \| "pageerror" \| "response")` |

That is **~14 distinct operations**, and roughly half of them are lifecycle calls
that move into core wholesale. An explicit check for the wider API — `route`,
`waitForEvent`, `frames`, `addInitScript`, `exposeFunction`, `tracing`, `hover`,
`dragAndDrop`, `cookies`, `emulateMedia`, and 15 others — found **zero** uses
outside `selectOption`.

**Conclusion: `withRawPage` is not needed on day one for any of the six files.**
A `BrowserHandle` covering the table above is sufficient. The escape hatch should
still exist (removing it makes the seventh feature's first unusual need a core PR
instead of a plugin PR), but §4.2's framing should flip: it is a rarely-used
release valve, not an expected default. The §10 risk *"`withRawPage` becomes the
default path"* is much smaller than feared — start the counter at 0 and treat any
increase as the signal.

### The one genuinely interesting shape

`page.on("console"|"pageerror"|"response")` is the only usage that is not a
simple request/response call, and all three files use it identically: attach
listeners, accumulate bounded lists of console errors and failed same-origin
`fetch`/`xhr` requests, reset per navigation, read the accumulator. `qa-agent`
has already factored this into `attachPageObservers(page, origin)` with
`.reset()` / `.endpoints()` / `.consoleErrors()`.

That is exactly the RFC's `collectEvidence(layers)` — the console and network
check layers — and it should be lifted into core as-is rather than redesigned.

### Second-order finding

`evaluate` deserves a note. It is one call in the table but it runs arbitrary
JavaScript in the page, so a `BrowserHandle` that exposes it is not a narrow
capability in the way `goto` is. It is still a real improvement over
`connectOverCDP` — a plugin can reach the *page*, but never the pod address, the
CDP socket, other contexts, or the EB's lifecycle — but "no plugin can do
anything unexpected in a browser" is not what R4 buys. What it buys is that no
plugin can leak, outlive, or over-allocate an EB. That is the honest claim.

---

## Net effect on the plan

| RFC assumption | Reality | Effect |
| --- | --- | --- |
| §8 `"use server"` across a package boundary is unverified, may block the UI story | Works, including client components and route pages | The phase-1 stop-and-re-scope branch is off the table |
| §8 needs committed codegen for actions and pages | Needs neither | Removes most of the "codegen layer" risk in §10 |
| §5 plugins FK to core tables *and* never import `@lastest/db` | Contradictory as written | `core/data` must re-export permitted FK targets |
| §4.2 `withRawPage` needed because features use a wide Playwright slice | 14 operations, no wide slice | `BrowserHandle` can be complete on day one |

**Phase 2 is unblocked, and slightly cheaper than estimated.**
