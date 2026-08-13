/**
 * The core surface the playground needs and core does not have yet.
 *
 * **Three methods** — the smallest port of any migration so far (`launch` 4,
 * `api-test` 5, `rca` 6, `app-map` 9). The reason is the same one
 * `plugin-migration-recipe.md` §1.5 gives for launch: the playground *owns*
 * almost everything it touches. One table, a vendored scoring registry, its own
 * ranking maths. It computes; it does not coordinate.
 *
 * ### All three are already in `LaunchHost`, and that is the finding
 *
 * `resolveActor`, `rateLimit` and a batched user lookup are declared verbatim
 * one directory over, in `plugins/launch/src/host.ts`. This is not a port that
 * *contains* a shared gap the way `api-test`'s `fetchGuarded` did — it is a
 * port that is *entirely* a shared gap, the second independent declaration of
 * the same three needs by the second untenanted plugin.
 *
 * Read against the recipe's rule that a port grouping into fewer items is
 * healthier than its raw count suggests, this port's honest size is **zero
 * new debt items**. It adds nothing to the phase-5 backlog; it doubles the
 * evidence for what is already on it. Concretely, one `core/identity` PR
 * exposing "resolve a bearer token to a person" and "display data for these
 * user ids" plus one `core/rate-limit` capability would retire *both* ports
 * completely — six methods, two plugins, zero remaining. That is a better
 * argument for building them than either plugin made alone, and it is the
 * argument to make before `share` and `gamification`, which have the same
 * user-scoped shape and will otherwise declare a third copy.
 *
 * ### What is deliberately NOT here
 *
 * - **`hasScope`.** The host returns `scopes` already parsed; whether
 *   `playground:score` is in that list is this feature's enforcement decision.
 *   A port method for it would move a policy check to the app.
 * - **`err` / `fail`.** The response shape is this board's contract with its
 *   own frontend, so it lives in `src/api/responses.ts` — moved out of
 *   `@/lib/http/board-responses`, whose doc comment had already noticed that a
 *   shared `fail()` enumerating two features' failure codes was the shape of a
 *   module that should have been two.
 * - **`isAdmin`.** `LaunchHost.resolveActor` returns it because the launch
 *   board has staff-only endpoints. This one has none, so the actor that
 *   crosses the boundary here is strictly narrower — the role never leaves
 *   core, and there is nothing in this package that could grow a role check.
 * - **Anything to do with a team.** There is no `TeamRef` in this file and
 *   none in the plugin: `tenancy: "none"`, see `index.ts`.
 */

/**
 * The caller, already authenticated and already reduced to what the board
 * needs to decide anything.
 *
 * `scopes: null` means an unscoped credential — a staff cookie session or an
 * API token — which passes every scope check. A handoff token minted by
 * `/oauth/authorize` always carries a non-null (possibly empty) list.
 */
export interface PlaygroundActor {
  readonly userId: string;
  readonly emailVerified: boolean;
  readonly scopes: readonly string[] | null;
}

/**
 * What the board is allowed to know about a person.
 *
 * Two fields, each earning its place:
 *
 * - `name` renders the leaderboard. Never an email — the board is public.
 * - `createdAtMs` is the floor the client-reported `earnedAtEpochMs` is
 *   clamped to. Without it a client could backdate an achievement to 1970 and
 *   take the "first to get there" tie-break from everyone.
 *
 * The row *existing* is itself information: `resolveUsers` omits users it
 * cannot find, which is what replaced the `innerJoin(users)` the leaderboard
 * query used to do.
 */
export interface PlaygroundUser {
  readonly name: string | null;
  /** Account creation, epoch ms. Null when core has no timestamp for it. */
  readonly createdAtMs: number | null;
}

/** Verdict from `PlaygroundHost.rateLimit`. */
export interface PlaygroundRateLimit {
  readonly allowed: boolean;
  /** Milliseconds until the next slot opens. 0 when allowed. */
  readonly retryAfterMs: number;
}

export interface PlaygroundHost {
  /**
   * Resolve the caller from the request's `Authorization` header, falling back
   * to the app's cookie session. Returns null when neither identifies anyone —
   * which is not an error here, because the leaderboard is public.
   */
  resolveActor(authorization: string | null): Promise<PlaygroundActor | null>;

  /**
   * Sliding-window rate limit against a shared in-process limiter.
   *
   * A limiter a feature can define its own store for is not a limiter — the
   * window is the plugin's policy (`PLAYGROUND_CONFIG`), the counter is not.
   *
   * Returns `retryAfterMs` rather than a bare boolean, unlike
   * `LaunchHost.rateLimit`: this route's 429 carries a computed `Retry-After`
   * derived from the bucket's oldest hit, and collapsing that to a fixed
   * header value would have been a behaviour change smuggled in by a port
   * signature. Worth noting for whoever unifies the two — the wider shape is
   * the one to keep.
   */
  rateLimit(key: string, limit: number, windowMs: number): PlaygroundRateLimit;

  /**
   * Batched lookup of the core `users` rows behind a set of ids. Users that do
   * not exist are absent from the map.
   *
   * Replaces two things at once: the `innerJoin(users, …)` inside the old
   * `src/lib/db/queries/playground.ts` leaderboard aggregate, and the
   * `queries.getUserById()` the route called to find an account's creation
   * time. A plugin may not read a core table at all (`core-scope.md` §6), not
   * even for a display name, so both became one lookup on this side of the
   * line.
   */
  resolveUsers(
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, PlaygroundUser>>;
}
