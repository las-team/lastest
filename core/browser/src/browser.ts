import { randomUUID } from "node:crypto";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import type {
  BrowserCapability,
  BrowserClaimOptions,
  BrowserSession,
  Logger,
  SwarmOptions,
  TeamRef,
} from "@lastest/contracts";

// Side-effect import: fills the contract's `DrivablePage` slot with the real
// Playwright `Page`. Without it `session.page` is `unknown` everywhere.
import "./page-type";

import { Deadline } from "./deadline";
import {
  BrowserDeadlineExceededError,
  BrowserSessionClosedError,
  DeadlineExtensionRefusedError,
  NoBrowserAvailableError,
} from "./errors";
import {
  DEFAULT_CLAIM_TIMEOUT_MS,
  DEFAULT_DEADLINE_MS,
  maxHoldFor,
  type BrowserHost,
  type ClaimedEb,
} from "./host";

/**
 * `session → cdpUrl`, module-private and weakly held.
 *
 * This is the whole mechanism behind `AiCallOptions.browserTools`. A plugin
 * that wants an agentic browsing loop passes core the *session object* it
 * already holds; only `resolveSessionCdpUrl` — exported from
 * `@lastest/core-browser/internal`, which `pnpm arch` forbids a plugin from
 * importing — turns that object back into an address.
 *
 * Three properties make it a boundary rather than a hiding place:
 *
 *   - **The key is the object, not an id.** There is no string a plugin could
 *     construct, guess or replay to look one up. A forged `{ id, page, … }`
 *     resolves to `undefined`, and the caller rejects rather than falling back
 *     to a host-process browser.
 *   - **It is a `WeakMap`.** The entry dies with the session; nothing accretes
 *     for the process lifetime and nothing outlives the claim it describes.
 *   - **It is deleted at teardown.** A session handed on after its
 *     `withBrowser` scope ended resolves to `undefined` too, so "still live" is
 *     enforced here rather than trusted from the caller.
 */
const CDP_BY_SESSION = new WeakMap<BrowserSession, string>();

/**
 * Resolve a live session back to its CDP endpoint. **Composition-root only.**
 *
 * Re-exported from `@lastest/core-browser/internal` rather than from the
 * package root, and that subpath is on `FORBIDDEN_PLUGIN_IMPORTS` in
 * `tools/architecture/boundaries.mjs` — so a plugin reaching for it fails
 * `pnpm arch` and `pnpm lint`, not just review.
 *
 * Returns `undefined` for a session that was never issued here, or one whose
 * `withBrowser` scope has already ended.
 */
export function resolveSessionCdpUrl(
  session: BrowserSession,
): string | undefined {
  return CDP_BY_SESSION.get(session);
}

/**
 * The session a plugin receives.
 *
 * Identical to the contract's `BrowserSession` — the `page` and `isolatedPage`
 * types resolve to the real Playwright `Page` through the augmentation in
 * `./page-type`, so there is nothing left to widen here. The alias exists only
 * so core-side code can be explicit about which side of the boundary it is on.
 */
export type CoreBrowserSession = BrowserSession;

export interface BrowserScope {
  readonly team: TeamRef;
  readonly log: Logger;
}

export interface BrowserFactoryOptions {
  /**
   * Ceiling on `withBrowserSwarm({ count })`. The pool cap lives in the pool
   * service, not here, so the app passes it in at wiring time — core clamps
   * rather than trusting the caller, because a plugin asking for 200 browsers
   * is a capacity incident regardless of intent.
   */
  readonly maxSwarm?: number;
}

export function createBrowserCapability(
  host: BrowserHost,
  scope: BrowserScope,
  opts: BrowserFactoryOptions = {},
): BrowserCapability {
  const maxSwarm = Math.max(1, opts.maxSwarm ?? 4);
  const { team, log } = scope;

  async function claimOne(
    claimOpts: BrowserClaimOptions,
  ): Promise<ClaimedEb | null> {
    const timeoutMs = claimOpts.claimTimeoutMs ?? DEFAULT_CLAIM_TIMEOUT_MS;
    return host.claim({
      teamId: team.id,
      plan: team.plan,
      purpose: claimOpts.purpose ?? "interactive",
      timeoutMs,
      onQueued: claimOpts.onQueued,
    });
  }

  /**
   * Everything between a successful claim and its release.
   *
   * The `finally` is the whole point of the capability: release happens on
   * return, on throw, on deadline and on abort. A plugin cannot skip it,
   * because it never held the runner id that release needs.
   */
  async function runClaim<T>(
    claim: ClaimedEb,
    claimOpts: BrowserClaimOptions,
    fn: (session: CoreBrowserSession) => Promise<T>,
  ): Promise<T> {
    const budgetMs = maxHoldFor(team.plan);
    // Clamp rather than honour: `deadlineMs` is a plugin-supplied number and
    // holding shared capacity longer than the plan allows is a money decision.
    const deadlineMs = Math.min(
      claimOpts.deadlineMs ?? DEFAULT_DEADLINE_MS,
      budgetMs,
    );
    const startedAt = Date.now();
    const deadline = new Deadline(deadlineMs);
    const sessionId = randomUUID();

    let browser: Browser | undefined;
    const isolatedContexts: BrowserContext[] = [];
    let closed = false;
    let liveSession: CoreBrowserSession | undefined;

    const teardown = async () => {
      if (closed) return;
      closed = true;
      // Revoke the address before anything else: a session that outlives its
      // scope must stop resolving even if the CDP disconnect below hangs.
      if (liveSession) CDP_BY_SESSION.delete(liveSession);
      await Promise.all(
        isolatedContexts.map((ctx) => ctx.close().catch(() => {})),
      );
      // Over `connectOverCDP` this disconnects the CDP session only — it does
      // not terminate the EB's Chromium. Releasing the pool slot is what frees
      // the capacity, and that happens below.
      await browser?.close().catch(() => {});
    };

    log.debug(
      { sessionId, runnerId: claim.runnerId, deadlineMs },
      "browser claimed",
    );

    try {
      browser = await chromium.connectOverCDP(claim.cdpUrl);

      let authApplied = false;
      if (claimOpts.storageStateId) {
        // Resolution and injection both happen host-side; the credential does
        // not pass through core, let alone through the plugin.
        authApplied = await host
          .applyAuth(claim.cdpUrl, claimOpts.storageStateId, team.id)
          .catch((err) => {
            // Degrading to an unauthenticated browser is the established
            // behaviour and is usually still useful. It must be visible.
            log.warn({ sessionId, err }, "storage state injection failed");
            return false;
          });
      }

      const context = browser.contexts()[0] ?? (await browser.newContext());
      if (claimOpts.viewport) {
        await context
          .pages()[0]
          ?.setViewportSize(claimOpts.viewport)
          .catch(() => {});
      }
      const page = context.pages()[0] ?? (await context.newPage());

      const session: CoreBrowserSession = {
        id: sessionId,
        page,
        streamUrl: host.streamGrant(claim.streamUrl, claim.instanceId),
        authApplied,

        async extendDeadline(byMs) {
          if (closed) throw new BrowserSessionClosedError();
          const target = deadline.deadline + byMs;
          const ceiling = startedAt + budgetMs;
          if (target > ceiling) {
            throw new DeadlineExtensionRefusedError(team.plan, budgetMs);
          }
          return deadline.extendTo(target);
        },

        /**
         * A fresh context inside the *same* EB, seeded from the default
         * context's current state.
         *
         * This is what a crawler wants and `withBrowserSwarm` is not: N
         * isolated contexts on one browser costs one pool slot and one stream
         * of run-minutes, where N sessions cost N of each for identical
         * behaviour. Context lifetime is core's, not the plugin's — every one
         * created here is closed at teardown.
         */
        async isolatedPage() {
          if (closed || !browser) throw new BrowserSessionClosedError();
          const snapshot = await context.storageState().catch(() => undefined);
          const isolated = await browser.newContext(
            snapshot ? { storageState: snapshot } : {},
          );
          isolatedContexts.push(isolated);
          return isolated.newPage();
        },
      };

      // Registered *after* the session is fully built, so nothing can observe a
      // half-constructed entry, and torn down in `teardown()` below.
      CDP_BY_SESSION.set(session, claim.cdpUrl);
      liveSession = session;

      const onExpiry = deadline.whenExpired().then(async () => {
        log.warn({ sessionId, deadlineMs }, "browser deadline exceeded");
        // Tear down first: recovering the capacity is the point, and it is what
        // makes the plugin's next page call fail rather than hang.
        await teardown();
        throw new BrowserDeadlineExceededError(deadlineMs);
      });

      return await Promise.race([fn(session), onExpiry]);
    } finally {
      // `clear()` before teardown so a deadline that fires during teardown does
      // not race it. It also drops the expiry listener, which is what keeps the
      // losing side of the race from becoming an unhandled rejection.
      deadline.clear();
      await teardown();
      await host.release(claim.runnerId).catch((err) => {
        // A failed release leaks a pool slot until the reaper catches it. That
        // is exactly the incident this package exists to prevent, so it is an
        // error, not a debug line.
        log.error(
          { sessionId, runnerId: claim.runnerId, err },
          "EB release failed",
        );
      });
    }
  }

  return {
    async assertRunMinutes() {
      await host.assertRunMinutes(team.id);
    },

    async withBrowser(claimOpts, fn) {
      // Checked before the claim so an out-of-budget team never occupies a pool
      // slot it is not entitled to in the first place.
      await host.assertRunMinutes(team.id);
      const claim = await claimOne(claimOpts);
      if (!claim) {
        throw new NoBrowserAvailableError(
          claimOpts.claimTimeoutMs ?? DEFAULT_CLAIM_TIMEOUT_MS,
        );
      }
      return runClaim(claim, claimOpts, fn);
    },

    /**
     * N browsers at once.
     *
     * Before reaching for this: if the work is N pages against *one* origin
     * with shared auth, `session.isolatedPage()` does it on a single EB. This
     * is for work that genuinely needs N separate browsers.
     */
    async withBrowserSwarm(swarmOpts: SwarmOptions, fn) {
      await host.assertRunMinutes(team.id);
      const count = Math.max(1, Math.min(swarmOpts.count, maxSwarm));
      if (count < swarmOpts.count) {
        log.warn(
          { requested: swarmOpts.count, granted: count },
          "swarm clamped to the pool ceiling",
        );
      }

      const claims = await Promise.all(
        Array.from({ length: count }, () => claimOne(swarmOpts)),
      );

      // Settled, in input order: one branch failing must not cancel the others,
      // because partial progress is the normal useful outcome for a crawler.
      return Promise.allSettled(
        claims.map((claim, index) => {
          if (!claim) {
            return Promise.reject(
              new NoBrowserAvailableError(
                swarmOpts.claimTimeoutMs ?? DEFAULT_CLAIM_TIMEOUT_MS,
              ),
            );
          }
          return runClaim(claim, swarmOpts, (session) => fn(session, index));
        }),
      );
    },
  };
}

/** The `browser` capability factory the kernel injects. */
export function createBrowserFactory(
  host: BrowserHost,
  opts: BrowserFactoryOptions = {},
) {
  return (_pluginId: string, scope: BrowserScope): BrowserCapability =>
    createBrowserCapability(host, scope, opts);
}
