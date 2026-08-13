/**
 * Plugin-owned persistence.
 *
 * The rule, verbatim: *"ez ne exposálja a pluginek felé a core database-t […] a
 * pluginek soha nem használhatják a core tábláit (olvasásra sem! — tessék a
 * core-t hívni), a core meg leszarja hogy a pluginek mit tárolnak hol."*
 *
 * So `ctx.data` reaches **only the calling plugin's own tables**. There is no
 * read-only view of core entities here, and no FK from a plugin table to a core
 * table — both of which the RFC's §5 allowed. To learn something about a core
 * entity, a plugin calls a core function.
 *
 * See `docs/architecture/core-scope.md` §6 for the cost this carries: without an
 * FK there is no database-level cascade, so plugin rows outlive the team that
 * owned them unless deletion is driven explicitly. That is what
 * `DeletionHook` below exists for, and it is not optional.
 */

/**
 * A drizzle-ish query surface over the plugin's own schema.
 *
 * Typed loosely here because `@lastest/contracts` carries zero dependencies;
 * `@lastest/core-data` re-exports a properly-typed handle bound to the calling
 * plugin's schema. The point of the indirection is that the handle core hands
 * over is already scoped — a plugin cannot widen it to core tables, because the
 * object it holds was never connected to them.
 */
export interface PluginDatabase<TSchema = unknown> {
  readonly schema: TSchema;
  /**
   * Run a transaction over the plugin's own tables. Core owns the connection
   * pool — a plugin cannot open its own, so it cannot exhaust it.
   */
  transaction<T>(fn: (tx: PluginDatabase<TSchema>) => Promise<T>): Promise<T>;
}

/**
 * How a plugin's data gets deleted when the team or repo that owned it goes
 * away.
 *
 * Registered in the plugin manifest and driven by core's deletion path. This is
 * the price of the no-FK rule: the database will not cascade for us, so the
 * cascade has to be explicit. A test asserts every plugin that declares storage
 * also declares a hook — without that, "delete my account" quietly leaves rows
 * behind, which is a GDPR problem and not merely untidiness.
 */
export interface DeletionHook {
  /** Delete everything this plugin holds for the team. Must be idempotent. */
  onTeamDeleted?(teamId: string): Promise<void>;
  /** Delete everything this plugin holds for the repo. Must be idempotent. */
  onRepoDeleted?(repoId: string): Promise<void>;
  /**
   * Delete everything this plugin holds for the *user*. Must be idempotent.
   *
   * Added for `@lastest/plugin-launch`, the first plugin whose rows hang off a
   * user rather than off a tenant: a launch profile, vote, comment or reaction
   * belongs to a person, and that person can delete their account without any
   * team or repo being deleted. Before this existed, the only two targets were
   * team and repo, so such a plugin had no way to honour "delete my account"
   * at all — the FK to `users.id` that used to cascade is exactly what
   * `core-scope.md` §6 removes.
   *
   * A plugin implements only the targets it actually owns rows for. Most own
   * team/repo rows and nothing here; `launch` is the reverse.
   */
  onUserDeleted?(userId: string): Promise<void>;
}

export interface DataCapability<TSchema = unknown> {
  /** The plugin's own tables. Nothing else is reachable from here. */
  readonly db: PluginDatabase<TSchema>;
}
