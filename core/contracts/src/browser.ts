/**
 * The browser capability — the R4 boundary.
 *
 * Scope is deliberately *lifecycle only*. See `docs/architecture/core-scope.md`
 * §5: core owns the things that are boundaries (capacity, credentials, money,
 * tenancy) and hands the feature a page to orchestrate however it likes.
 *
 * Core owns:
 *   claim / release / teardown-on-throw   — a leaked EB is stolen capacity
 *   pool cap + plan-derived priority      — capacity, and plan-derived → money
 *   storage-state / credential injection  — the plugin passes an id, never a secret
 *   run-minute metering                   — money
 *   deadline enforcement                  — a plugin cannot hold an EB forever
 *   stream-URL grants                     — signed + expiring, never a pod address
 *
 * Core does NOT own: `goto`, `click`, DOM snapshots, evidence accumulation.
 * Those are orchestration. Spike S3 showed they are highly repetitive across
 * features, which makes them a good shared library (`libs/browser-kit`) — a
 * reason to be reusable, not a reason to be gate-kept.
 */

export interface Viewport {
  width: number;
  height: number;
}

export interface BrowserClaimOptions {
  /**
   * `interactive` competes for the reserved interactive slots; `build` is
   * subject to the build cap. Mirrors the pool service's own tiering.
   */
  readonly purpose?: "interactive" | "build";
  /** How long to wait for a free or newly-provisioned EB before giving up. */
  readonly claimTimeoutMs?: number;
  /**
   * Wall-clock budget for the callback. Core aborts and tears down when it
   * expires — a plugin cannot hold an EB by forgetting a timeout.
   */
  readonly deadlineMs?: number;
  readonly viewport?: Viewport;
  /**
   * Seed the browser with stored auth. The plugin passes an **id**; core
   * resolves and injects the credential material. The plugin never sees it.
   */
  readonly storageStateId?: string;
  /** Fired when the claim is queued behind the pool cap, for UI feedback. */
  readonly onQueued?: () => void;
}

export interface SwarmOptions extends BrowserClaimOptions {
  /** How many browsers to run at once. Core clamps this to the pool cap. */
  readonly count: number;
}

/**
 * The Playwright `Page`, re-exported through core rather than imported by the
 * plugin from `playwright` directly.
 *
 * Typed as `unknown` here because `@lastest/contracts` carries zero
 * dependencies by construction. `@lastest/core-browser` re-exports the real
 * `Page` type, so plugins get full typing from core and core keeps control of
 * the driver version — a Playwright upgrade is a core PR, not 20 plugin PRs.
 */
export type DrivablePage = unknown;

/**
 * A claimed EB. Everything on it is a capability core is prepared to vouch for;
 * notably absent is any way to obtain the CDP URL or the pod address.
 */
export interface BrowserSession {
  /** Opaque. Useful for logging and correlating; not an address. */
  readonly id: string;

  /**
   * The live page. Core made the connection and will close it; the plugin
   * drives it.
   *
   * This is a wide capability — `page.evaluate` runs arbitrary JavaScript in
   * the page. The claim R4 actually buys is narrower and worth stating exactly:
   * no plugin can leak, outlive, over-allocate, or escape the tenancy of an EB.
   * It is not "no plugin can do anything unexpected in a browser".
   */
  readonly page: DrivablePage;

  /** Already proxied and grant-signed, or null when streaming is off. */
  readonly streamUrl: string | null;

  /**
   * Extend the deadline, if the plan allows it. Returns the new deadline, or
   * rejects when the extension would exceed the tenant's budget — so "this run
   * needs longer" is a metered decision core makes, not one a plugin takes.
   */
  extendDeadline(byMs: number): Promise<number>;
}

export interface BrowserCapability {
  /**
   * Claim an EB, run `fn`, release it — including on throw, on deadline, and on
   * abort.
   */
  withBrowser<T>(
    opts: BrowserClaimOptions,
    fn: (session: BrowserSession) => Promise<T>,
  ): Promise<T>;

  /**
   * Same, N at once, for swarm-style crawlers.
   *
   * Settled results in input order: one branch failing must not cancel the
   * others, because partial progress is the normal, useful outcome for a
   * crawler — which is how `explorer` already runs its scenario pool.
   */
  withBrowserSwarm<T>(
    opts: SwarmOptions,
    fn: (session: BrowserSession, index: number) => Promise<T>,
  ): Promise<PromiseSettledResult<T>[]>;
}
