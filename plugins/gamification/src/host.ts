import type { ActorKind } from "./schema";

/**
 * The core surface Beat-the-Bot needs and core does not have yet.
 *
 * **Eight methods** (nine until `currentActor` was retired by
 * `runtime.contextFor()` + `ctx.actor`), grouped into four things — one
 * identity boundary, one feature flag on a core table, two reads of core
 * entities, and one delivery mechanism:
 *
 * | # | Method | Group | Retired by |
 * | --- | --- | --- | --- |
 * | 1 | `requireTeamAdmin` | identity (authorization) | `core/identity` |
 * | 2 | `resolveActorProfiles` | identity (display data) | `core/identity` |
 * | 3 | `listTeamMemberIds` | identity (membership) | `core/identity` |
 * | 4 | `isEnabledForTeam` | a flag on `teams` | `ctx.team.entitlements` |
 * | 5 | `setEnabledForTeam` | authorized write to `teams` | `ctx.team` |
 * | 6 | `getTestCreator` | core entity read | `ctx.tests` |
 * | 7 | `stampTestCreator` | authorized write to `tests` | a widened `ctx.tests` |
 * | 8 | `emitActivityEvent` | delivery | **`ctx.events`** — see below |
 *
 * ### Three of eight are identity, and that is now the fourth plugin saying so
 *
 * `launch` and `playground` each declared a `resolveActor` and a batched user
 * lookup; `playground`'s entire three-method port was already a duplicate of
 * `launch`'s. "Who is calling" came off this port when `ctx.actor` landed —
 * the session paths resolve it through `contextFor` now — but "are they an
 * admin of this team", "who are these ids" and "who is in this team" remain.
 * RBAC is deliberately not on `PluginContext` (recipe §1.7), so a
 * `core/identity` capability is still the phase-5 answer for the rest.
 *
 * ### `emitActivityEvent` is a capability this plugin cannot reach
 *
 * `ctx.events` exists — `@lastest/plugin-events` provides it, and this is the
 * first migrated feature that genuinely wants it. It cannot have it, and the
 * reason is worth recording rather than working around silently.
 *
 * A capability is built from a `ContextScope`, which the kernel gets from
 * `resolveScope`. `awardScore()` is called from six app call sites that
 * already hold an authorized `teamId` and pass it in — but `ScopeRequest.teamId`
 * is documented in `core/kernel/src/runtime.ts` as *background paths only*,
 * trusted precisely because only core's scheduler and job worker set it:
 * "honouring it from a user request would be a tenancy escape, which is the one
 * thing this whole exercise exists to prevent".
 *
 * So taking `ctx.events` here would have meant either threading a
 * request-supplied `teamId` through `contextFor` — the exact escape that
 * comment forbids — or inventing a session-derived scope that the six callers
 * do not all have. Both are worse than a port method. What is actually missing
 * is a way for `resolveScope` to accept a team id the *caller has already
 * authorized*, distinct from one it is asked to trust blindly. That is a
 * kernel change, and it is the reason this plugin declares
 * `capabilities: ["data"]` and not `["data", "events"]`.
 */

/** The public slice of a person, for the leaderboard. */
export interface ActorProfile {
  readonly name: string | null;
  readonly email: string | null;
  readonly avatarUrl: string | null;
}

/**
 * One row for the activity feed. Mirrors `emitAndPersistActivityEvent`'s
 * argument, narrowed to the fields this feature sets — recipe §6.1's "narrow,
 * don't promote", since `ActivityEventType` belongs to core.
 */
export interface GamificationActivityEvent {
  readonly teamId: string;
  readonly eventType:
    | "score:awarded"
    | "score:penalty"
    | "achievement:unlocked"
    | "beat_the_bot"
    | "season:started"
    | "season:ended"
    | "blitz:started"
    | "blitz:ended";
  readonly summary: string;
  readonly detail: Record<string, unknown>;
  readonly artifactId: string;
  readonly artifactLabel: string;
}

export interface GamificationHost {
  /**
   * Assert the caller administers their team, and return its id. Throws the
   * app's own authorization error.
   *
   * Shaped as "give me the authorized team id", not "am I an admin", so the
   * plugin has no way to *skip* the check: every admin action starts from this
   * return value and there is no other route to a team id on those paths.
   * Recipe §3.1.
   */
  requireTeamAdmin(): Promise<string>;

  /** Display data for a batch of user ids. Missing users are absent. */
  resolveActorProfiles(
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, ActorProfile>>;

  /**
   * Every member of a team. The leaderboard shows members with no score row
   * yet at zero points, which used to be a `getTeamMembers()` call inside the
   * feature's own query module.
   */
  listTeamMemberIds(teamId: string): Promise<readonly string[]>;

  /** `teams.gamification_enabled` — the feature gate every award checks. */
  isEnabledForTeam(teamId: string): Promise<boolean>;

  /** Flip the gate. Authorized inside the host, per recipe §3.1. */
  setEnabledForTeam(teamId: string, enabled: boolean): Promise<void>;

  /**
   * Who authored a test, for regression/flake attribution. Was a read of
   * `tests.created_by_user_id` / `created_by_bot_id` inside this feature's
   * query module; a plugin may not read a core table at all.
   */
  getTestCreator(
    testId: string,
  ): Promise<{ kind: ActorKind; id: string } | null>;

  /**
   * Stamp a test's creator. Called by the `onTestCreated` listener when it had
   * to resolve the actor itself, so later regression scoring can find them.
   */
  stampTestCreator(
    testId: string,
    actor: { kind: ActorKind; id: string },
  ): Promise<void>;

  /**
   * Append to the team activity feed. Best-effort by contract — the caller
   * treats a rejection as non-fatal, exactly as it did before the migration.
   *
   * This is `ctx.events` in everything but name; see the file header for why
   * it cannot be `ctx.events` yet.
   */
  emitActivityEvent(event: GamificationActivityEvent): Promise<void>;

  /** Next.js path revalidation. The plugin owns which paths, not how. */
  revalidate(paths: readonly string[]): void;
}
