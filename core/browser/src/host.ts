import type { Plan } from "@lastest/contracts";

/**
 * The host port.
 *
 * `core/browser` owns the *policy* — when a claim is allowed, how long it may
 * be held, that it is always released, that the plugin never sees a pod
 * address. It does not own the *primitives*: pool claim/release, grant signing,
 * run-minute metering and storage-state decryption already exist in this repo
 * and are used by code that is not going to become a plugin.
 *
 * Injecting them rather than importing them is what keeps this package free of
 * `@/…` imports, which is the difference between core being a boundary and core
 * being another name for the app. It also makes the lifecycle testable without
 * a cluster, which is the only way these guarantees get tested at all.
 *
 * Note what is *not* on this port: nothing returns a credential. `applyAuth`
 * takes an id and does the resolution host-side, so no secret ever crosses back
 * into core, let alone into a plugin.
 */

export interface ClaimedEb {
  /** Pool runner id — the handle used to release. Never given to a plugin. */
  readonly runnerId: string;
  /** CDP endpoint. Core connects to it; a plugin must never receive it. */
  readonly cdpUrl: string;
  /** Raw upstream stream URL, pre-grant. Also never given to a plugin. */
  readonly streamUrl: string | null;
  /** Provisioner instance id; null for static-fleet EBs. */
  readonly instanceId: string | null;
}

export interface HostClaimRequest {
  readonly teamId: string;
  readonly plan: Plan;
  readonly purpose: "interactive" | "build";
  readonly timeoutMs: number;
  readonly onQueued?: () => void;
}

export interface BrowserHost {
  /**
   * Claim an EB, or resolve `null` when none became available inside the
   * timeout. Implementations are expected to start metering here — the release
   * below settles it.
   */
  claim(req: HostClaimRequest): Promise<ClaimedEb | null>;

  /** Release and settle metering. Must be safe to call on an unknown runner. */
  release(runnerId: string): Promise<void>;

  /**
   * Reject when the team has no run minutes left. Called before a claim so an
   * out-of-budget team never occupies pool capacity in the first place.
   */
  assertRunMinutes(teamId: string): Promise<void>;

  /**
   * Resolve a stored credential by id and apply it to the live EB. Returns
   * whether enough material was applied to consider the browser authenticated.
   *
   * The plugin passes the id; the secret is resolved and injected entirely
   * host-side. Core never holds it either.
   */
  applyAuth(cdpUrl: string, storageStateId: string): Promise<boolean>;

  /**
   * Turn an upstream stream URL into a signed, expiring grant safe to hand to a
   * browser. Returns null when no grant can be signed, which reads to the UI as
   * "no stream" — the correct outcome, since an unsigned connection would be
   * refused anyway.
   */
  streamGrant(
    streamUrl: string | null,
    instanceId: string | null,
  ): string | null;
}

/**
 * How long a plan may hold one EB, in total, including extensions.
 *
 * Plan-derived, therefore money, therefore core's decision rather than the
 * plugin's — a feature must not be able to opt itself into holding shared
 * capacity for an hour by passing a bigger number.
 */
export const MAX_HOLD_MS: Readonly<Record<Plan, number>> = {
  free: 5 * 60_000,
  demo: 5 * 60_000,
  trial: 10 * 60_000,
  starter: 15 * 60_000,
  growth: 30 * 60_000,
  pro: 60 * 60_000,
  "self-hosted": 60 * 60_000,
};

/** Default hold when the caller does not ask for one. */
export const DEFAULT_DEADLINE_MS = 5 * 60_000;

/** Default wait for a free or newly-provisioned EB. */
export const DEFAULT_CLAIM_TIMEOUT_MS = 5 * 60_000;

export function maxHoldFor(plan: Plan): number {
  return MAX_HOLD_MS[plan] ?? MAX_HOLD_MS.free;
}
