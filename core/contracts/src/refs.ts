/**
 * The small value types that cross every capability boundary.
 *
 * These are deliberately *references*, not entities: a plugin gets an id, a
 * plan and a set of entitlements, never a `teams` row. Widening one of these
 * into "the whole record" is how core detail leaks into plugins, so each field
 * added here should have to justify itself.
 */

/** Billing tiers, mirroring `teams.plan`. */
export type Plan =
  | "free"
  | "demo"
  | "trial"
  | "starter"
  | "growth"
  | "pro"
  | "self-hosted";

/**
 * The team a plugin is acting for. Resolved by core from the caller's session
 * *before* the plugin runs, so a plugin can never widen its own scope: there is
 * no `setTeam`, and every capability is bound to this team.
 */
export interface TeamRef {
  readonly id: string;
  /**
   * Display name. Here because any plugin that names the tenant to a human
   * (a notification, a public page, an outbound webhook) needs it, and the
   * alternative was every such plugin declaring a host method that does auth
   * *and* enrichment in one call — which is how the wiring shapes diverged
   * before this field existed (see `plugins/share/src/host.ts` history).
   */
  readonly name: string;
  /** URL-safe identity, for plugins that mint slugs or paths from the tenant. */
  readonly slug: string;
  readonly plan: Plan;
  /**
   * Coarse feature gates, resolved from the plan. A plugin asks
   * `team.entitlements.has("ai")` rather than reading the plan and
   * reimplementing the mapping — otherwise every plugin becomes a place where
   * billing rules can drift.
   */
  readonly entitlements: ReadonlySet<string>;
}

/**
 * The authenticated user a scope was resolved from — present only when the
 * scope came from a session, absent on background paths (a cron trigger, a
 * job resuming, a deletion hook).
 *
 * Still a *reference*, not an entity: an id to attribute writes to and an
 * email to name the author in outbound messages. No role (RBAC stays a host
 * question — see `plugin-migration-recipe.md` §1.7), no cookie, no profile.
 */
export interface ActorRef {
  readonly userId: string;
  readonly email: string;
}

/** The repository in scope, when there is one. */
export interface RepoRef {
  readonly id: string;
  readonly teamId: string;
  readonly name: string;
  /** Display identity ("owner/name"), for plugins that name the repo to a
   *  human — same justification as `TeamRef.name`. */
  readonly fullName: string;
  readonly defaultBranch: string | null;
}

/**
 * Structural subset of the app's pino logger. Typed structurally rather than
 * imported so `@lastest/contracts` keeps zero dependencies.
 */
export interface Logger {
  trace(obj: object, msg?: string): void;
  trace(msg: string): void;
  debug(obj: object, msg?: string): void;
  debug(msg: string): void;
  info(obj: object, msg?: string): void;
  info(msg: string): void;
  warn(obj: object, msg?: string): void;
  warn(msg: string): void;
  error(obj: object, msg?: string): void;
  error(msg: string): void;
}
