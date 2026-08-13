# Shared-dependency promotions — result

**Status:** done. `pnpm install`, `pnpm arch`, `pnpm lint`, `pnpm types`,
`pnpm test` and `pnpm build` all pass.
**Rule applied:** RFC §4.3 — *"Shared pure logic → promote into a core module"*,
refined by [`core-scope.md`](./core-scope.md) §3 into **promote into `libs/`**
unless the thing genuinely guards something.
**Burndown: 31 → 22.** `cross-plugin` **17 → 8**.
**Not committed.**

---

## 1. Why this, and why now

After [`app-map`](./app-map-migration-result.md) the burndown had not moved in
two migrations. The reason was visible in the report: the remaining
`cross-plugin` violations were not twenty different mistakes, they were **a
handful of shared modules that several features each reached across for**.

Counted by *module imported* rather than by importing feature:

| Module | Violations it caused | Importing pseudo-plugins |
| --- | --- | --- |
| `@/lib/github/content` | **6** | `qa-agent`, `scheduling`, `authoring-ai`, `data-sources` |
| everything else | 1 each | — |

One module was 19% of the entire burndown. Migrating features one at a time
would never have removed it: each migration would have converted the import
into a host-port method and carried the same coupling across the boundary in a
nicer coat.

## 2. What moved

Three new packages under `libs/` — the third tier, importable by core and
plugins alike, **no CODEOWNERS gate** (`core-scope.md` §3).

| New package | From | Kills | Why it is a library |
| --- | --- | --- | --- |
| `@lastest/github` | `src/lib/github/content.ts` | 6 | Zero imports. Every function takes `accessToken` as its first argument — it resolves no credential, opens no DB. Host is the literal `api.github.com`, so no SSRF surface either. |
| `@lastest/test-templates` | `src/lib/playwright/quickstart-templates.ts` (+ its test) | 1 | Zero imports, renders strings. Both `quickstart-agent` and `qa-agent` render from it. |
| `@lastest/route-scan` | `src/lib/scanner/` (3 files) | 1 | Route discovery over a repo tree. Imports only `@lastest/github`. No DB, no browser, no credential resolution. |

Plus one import that needed no move at all:

- **`@/lib/scheduling/cron` → `@lastest/cron`** in `qa-agent.ts` (**1**).
  `src/lib/scheduling/cron.ts` has been a 13-line re-export shim over
  `libs/cron` since the explorer pilot. `qa-agent` was importing the shim path,
  so the walker counted a `qa-agent → scheduling` edge that had not existed in
  substance for two phases. **Check for this before designing a port method:** a
  one-line import change was worth as much as a migration.

`src/lib/github/content.ts` stays as a re-export shim so the nine non-plugin app
consumers are untouched — the `libs/ui` pattern. `src/lib/scanner/` and
`quickstart-templates.ts` needed no shim: every consumer was a pseudo-plugin
file, so all of them point at the lib directly and the old paths are gone.

## 3. Two RFC classifications this contradicts, deliberately

- **§6.3 filed `src/lib/scanner` under the `scheduling` plugin.** Scanning is
  not scheduling; the grouping was convenience. Two features consume it, and it
  guards nothing.
- **§6.2 filed `quickstart-templates.ts` under the `quickstart` plugin.** §6.2
  says of itself that it "is the one most likely to be wrong on the first
  attempt". It was, here — `qa-agent` renders from the same four helpers.

Both entries are removed from `PSEUDO_PLUGINS`. Neither feature lost anything:
the code they own is what is left behind.

## 4. What was NOT promoted, and why

`@/lib/share/video-fallback` looks identical to the three above — 66 lines,
only `fs/promises` and `path`, one `quickstart → share` violation. It is **not**
in `libs/`.

It resolves paths under `storage/videos/<repositoryId>/` by joining a
caller-supplied id into a filesystem path. That is two things a gate-free
library must not be: it is storage-path resolution, which is core
(`src/lib/storage` is CODEOWNERS-owned, RFC §6.1), and `path.join(root, id)`
with an untrusted `id` is a traversal shape. Today the ids come from database
rows so it is not exploitable, but "not exploitable given today's callers" is
exactly the property a boundary is supposed to not depend on.

Its destination is `core/artifacts`/`src/lib/storage`, and that is a **core PR**
(RFC §7.2). Left counted rather than moved somewhere convenient — a violation
you can see is better than a boundary drawn wrong.

The same test failed for `@/lib/quickstart/quickstart-notes` (`demo → quickstart`)
for a simpler reason: it imports `@/lib/db/queries` and `@/lib/ai`. It is not
shared logic, it is a feature. That one wants `ctx.jobs`.

## 5. What is left, and what each remaining class needs

22 violations, and they are now cleanly separated by *what would fix them*:

| Class | Count | Fix |
| --- | --- | --- |
| `browser` — `playwright` in feature code | 7 | Adopt `ctx.browser` / `core/browser`. One per feature, at migration time. |
| `db` — `drizzle-orm` in feature code | 6 | Move the query into `src/lib/db/queries/*`, the `rca` precedent. Core PR each. |
| `cross-plugin` — "run the other feature" | 6 | `ctx.jobs.enqueue` / events. Needs both features migrated. |
| `cross-plugin` — a real shared dep | 1 | `video-fallback` → core (§4). |
| `cross-plugin` — `@/server/actions/spec-import` | 1 | Ditto: jobs. |
| `pool-service` | 1 | `ctx.browser`. |

**There is no promotion work left.** Every remaining `cross-plugin` violation
is either a feature calling another feature's *behaviour* (which wants jobs,
not an import) or the one storage item in §4. That is a useful thing to know
before the next migration: the cheap structural wins are spent, and the
remaining number is real coupling.

## 6. What I did NOT verify

- **No runtime exercise.** Nothing scanned a repo, rendered a template or
  fetched a GitHub tree. `pnpm build` proves resolution across three new
  package boundaries; it proves nothing about behaviour.
- **The moves are byte-identical** apart from module docblocks and, for
  `@lastest/route-scan`, a new `src/index.ts` barrel. `git diff -M` shows the
  renames. `quickstart-templates`' 11 unit tests moved with it and pass.
- **`@lastest/github`'s cache keying was left alone.** It is keyed by
  `owner/repo/ref` and not by token, so two callers asking for the same repo
  share an entry for 5 minutes. `owner`/`repo` are populated from repos the
  user's own OAuth token can list (`src/server/actions/repos.ts:44`), so this
  is not a cross-tenant read — the residual window is *stale permissions*
  (access revoked inside the TTL is not noticed). Documented in the package
  header, not fixed: this was a move.
- **No `db:push`, no schema change** — none of these packages touch data.
