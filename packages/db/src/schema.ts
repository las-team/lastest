/**
 * Drizzle schema barrel.
 *
 * The tables used to live in this file — all 98 of them, in ~5,800 lines. They
 * now live in `./schema/*.ts`, one module per domain, and this file re-exports
 * every one of them. That is deliberate: `@lastest/db/schema` (and its app-side
 * shim `@/lib/db/schema`) are imported in hundreds of places, and the split was
 * a pure move — no table, column, index, constraint, type or DEFAULT_* constant
 * changed, and `drizzle-kit generate` emits byte-identical SQL before and after.
 *
 * WHERE TO ADD A TABLE — pick the module by what the row *is*, not by which
 * feature touches it. Each module's own header states its rule. The one
 * structural constraint: the module graph is acyclic and `./schema/shared` is
 * its sink, so a type used by two domains goes in `shared` rather than being
 * imported sideways.
 *
 *   pnpm schema:graph        # per-table FK map + would-be import cycles
 *
 * After editing a module: `pnpm db:push`, then update the matching query module
 * under `src/lib/db/queries/`.
 */

// Runner wire-protocol types (defined in @lastest/eb-protocol, stored verbatim
// in jsonb columns, historically imported from here).
export * from "./schema/eb-protocol";

// Cross-domain jsonb column types. Imports nothing; every other module may
// import it. This is what keeps the module graph acyclic.
export * from "./schema/shared";

// ── Core ────────────────────────────────────────────────────────────────────
// Teams, users, sessions, auth tokens, billing.
export * from "./schema/identity";
// Repositories, connected SCM accounts, pull requests, filed issues.
export * from "./schema/repos";
// GitHub Actions / GitLab pipeline config. Its own module because keeping it in
// `repos` is what creates the identity ⇄ repos and repos ⇄ runs cycles.
export * from "./schema/scm";
// Test definitions, versions, results, routes, fixtures, per-test caches.
export * from "./schema/tests";
// Builds, schedules, runners, background jobs, build-level artifacts.
export * from "./schema/runs";
// Visual diffs, baselines, per-layer step comparisons and feedback.
export * from "./schema/visual";
// Per-repo settings, setup/teardown, storage states, external data sources.
export * from "./schema/settings";

// ── Feature surfaces (RFC §7 marks both for extraction into plugins) ─────────
// QA agent / explorer / app map / RCA session state.
export * from "./schema/agents";
// Activity feed, gamification, Launch directory, shares, playground, feedback.
export * from "./schema/growth";
