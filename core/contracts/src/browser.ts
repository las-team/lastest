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
 * The Playwright `Page`, supplied through core rather than imported by the
 * plugin from `playwright` directly.
 *
 * `@lastest/contracts` carries zero dependencies by construction, so it cannot
 * name `Page` itself. Instead it names a *slot*, which `@lastest/core-browser`
 * fills by declaration merging:
 *
 * ```ts
 * declare module "@lastest/contracts" {
 *   interface DrivablePageTypeMap { default: import("playwright").Page }
 * }
 * ```
 *
 * The effect is that a plugin writing `session.page.goto(url)` gets full
 * Playwright typing with no `playwright` entry in its own manifest — while core
 * keeps control of the driver version, so an upgrade is one core PR rather than
 * twenty plugin PRs. Without core-browser in the program the slot stays
 * `unknown`, which fails closed: contracts alone never hands out a typed page.
 */
// Intentionally empty. Declaration merging can only *add* members, never
// change one, so a placeholder `default: unknown` here would make the
// augmentation a type error rather than an override. The conditional below is
// what supplies the fallback.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface DrivablePageTypeMap {}

export type DrivablePage = DrivablePageTypeMap extends { default: infer P }
  ? P
  : unknown;

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
   * Whether `storageStateId` actually got applied to this browser.
   *
   * A claim that asked for stored auth and did not get it still succeeds —
   * degrading to an unauthenticated browser is the established behaviour and
   * is usually still useful. But the *feature* often needs to know, because
   * "you are already signed in" and "sign in first" are different instructions
   * to give an agent, and getting it wrong wastes a whole run.
   *
   * `false` whenever no `storageStateId` was requested, so a plugin reading it
   * cannot mistake "did not ask" for "asked and failed" in the direction that
   * matters: nothing here ever claims authentication that was not applied.
   */
  readonly authApplied: boolean;

  /**
   * Extend the deadline, if the plan allows it. Returns the new deadline, or
   * rejects when the extension would exceed the tenant's budget — so "this run
   * needs longer" is a metered decision core makes, not one a plugin takes.
   */
  extendDeadline(byMs: number): Promise<number>;

  /**
   * An additional page in a fresh, isolated context **inside this same EB**,
   * seeded from the default context's current state.
   *
   * Added because `withBrowserSwarm` was the wrong primitive for the crawler
   * case it was designed for. A feature exploring N scenarios behind one login
   * wants N isolated contexts on one browser: that costs one pool slot and one
   * stream of run-minutes, where N sessions cost N of each for identical
   * behaviour. Charging a tenant N× for that is a money question, which makes
   * offering the cheap shape core's business.
   *
   * "Seeded from the default context" matters and cannot be expressed by
   * `storageStateId`: the state a crawler wants to share is the one produced by
   * *this run's* login, which may never have been persisted.
   *
   * Context lifetime stays core's — every context minted here is closed when
   * the `withBrowser` scope ends, so a plugin cannot leak one.
   */
  isolatedPage(): Promise<DrivablePage>;
}

export interface BrowserCapability {
  /**
   * Check the team's run-minute budget without claiming anything.
   *
   * `withBrowser`/`withBrowserSwarm` already run this same check before their
   * claim, so it is not required before every call — it exists for a plugin
   * that needs to know *before* committing to other, non-browser work (e.g.
   * persisting a session row) whether the run it is about to start would be
   * rejected for quota. Rejects the same way `withBrowser` does when the team
   * is over budget; resolves otherwise.
   */
  assertRunMinutes(): Promise<void>;

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

/**
 * The `name` a plugin sees on a browser-capability failure.
 *
 * A plugin cannot `instanceof` these: the classes live in `@lastest/core-browser`,
 * which is composition-root code no plugin may import. Matching on `err.name`
 * is the available option, and a bare string literal on both sides is a rename
 * away from silently degrading every claim failure to a generic message — the
 * plugin's branch would simply stop matching, with nothing failing to say so.
 *
 * Naming the set here restores the compile-time tie without costing anything at
 * runtime (this package stays types-only): `core/browser`'s error classes
 * declare `name: BrowserErrorName`, so a string that drifts out of this union
 * fails core's own typecheck, and a plugin annotating its comparison with the
 * same type fails when a member is removed.
 */
export type BrowserErrorName =
  | "NoBrowserAvailableError"
  | "BrowserDeadlineExceededError"
  | "DeadlineExtensionRefusedError"
  | "BrowserSessionClosedError";
