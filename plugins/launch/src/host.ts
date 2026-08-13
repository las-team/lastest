/**
 * The core surface the launch board needs and core does not have yet.
 *
 * **Four methods** — the smallest port of any migration so far (`rca` 6,
 * `app-map` 9). That is not because launch is small; it is 2,800 LOC across a
 * lib, a query module and a 681-line REST route. It is because launch *owns*
 * almost everything it touches: seven tables, its own ranking maths, its own
 * cohort state machine. The recipe's rule of thumb held exactly —
 * `plugin-migration-recipe.md` §1.5, "the cheap plugins are the ones that
 * compute; the expensive ones are the ones that coordinate".
 *
 * The four fall into three groups:
 *
 * - **One identity boundary** (`resolveActor`). Turning a bearer token into a
 *   person is `core-scope.md` §2's credentials clause, and the code that does
 *   it moved to `@/lib/auth/board-actor` in the core PR ahead of this one. The
 *   plugin gets the *result* — a user id, whether their email is verified,
 *   whether they are staff, and the granted scopes already parsed. It never
 *   sees the token, the session row, or the cookie.
 *
 * - **Two shared-resource boundaries** (`sourceIp`, `rateLimit`). Trusting
 *   `X-Forwarded-For` incorrectly is how every IP-based gate on this board
 *   gets bypassed, and a rate limiter a feature can define its own window for
 *   is not a rate limiter. Both are core primitives (`src/lib/security`,
 *   `src/lib/rate-limit`) injected rather than imported, exactly as
 *   `plugins/app-map` injects `fetchSitemapXml`.
 *
 * - **One core read** (`resolveUserNames`). The comment list shows author
 *   names, which used to be a `leftJoin(users)` inside
 *   `src/lib/db/queries/launch.ts`. Under `core-scope.md` §6 a plugin may not
 *   read a core table at all, not even for a display name — so the join is
 *   gone and this is what replaced it. It is the one method here that is
 *   plainly debt: it wants to be `ctx.identity.names()`, or nothing at all if
 *   the board ever stores a display name of its own.
 *
 * ### What is deliberately NOT here
 *
 * - **`hasScope`.** The host returns `scopes` already parsed, and whether
 *   `launch:vote` is in that list is the plugin's own enforcement decision.
 *   A port method for it would have moved a policy check to the app.
 * - **`err` / `fail`.** The board's HTTP error shape is its API contract with
 *   its own frontend, so it lives in `src/api/responses.ts`. The playground's
 *   copy stays in `@/lib/http/board-responses`; the pair used to be one
 *   function whose doc comment had to enumerate both features' failure codes.
 * - **Anything to do with a team.** There is no `TeamRef` in this file and
 *   none in the plugin. See `index.ts` — launch is the first untenanted
 *   plugin, and pretending otherwise would have meant inventing a fake scope
 *   just to satisfy `contextFor`.
 */

/**
 * The caller, already authenticated and already reduced to what the board
 * needs to decide anything.
 *
 * `scopes: null` means an unscoped credential — a staff cookie session or an
 * API token — which passes every scope check. A handoff token minted by
 * `/oauth/authorize` always carries a non-null (possibly empty) list.
 */
export interface LaunchActor {
  readonly userId: string;
  readonly emailVerified: boolean;
  /** Derived from the user's role by the host; the plugin never sees the role. */
  readonly isAdmin: boolean;
  readonly scopes: readonly string[] | null;
}

export interface LaunchHost {
  /**
   * Resolve the caller from the request's `Authorization` header, falling back
   * to the app's cookie session. Returns null when neither identifies anyone —
   * which is not an error on this board, because reads are public.
   */
  resolveActor(authorization: string | null): Promise<LaunchActor | null>;

  /**
   * The client IP, extracted from proxy headers by core's own parser. Every
   * per-IP gate on this board (vote velocity, event dedupe, suspicious-cluster
   * vote clearing) is only as trustworthy as this one function.
   */
  sourceIp(headers: Headers): string | null;

  /**
   * Fixed-window rate limit against a shared in-process limiter. Returns true
   * when the call is allowed.
   */
  rateLimit(key: string, limit: number, windowMs: number): boolean;

  /**
   * Display names for comment authors, keyed by user id. Missing or deleted
   * users are simply absent from the map — the board renders `null`, which is
   * what the old `leftJoin` produced for them too.
   */
  resolveUserNames(
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, string | null>>;
}
