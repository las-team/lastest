/**
 * The tests capability — what a plugin may learn about, and add to, the suite.
 *
 * `tests` is the second-most-referenced table in the schema (24 inbound FKs,
 * `core-scope.md` §7) and it is a tenancy anchor: every row hangs off a
 * repository, which hangs off a team. That is why reaching it goes through a
 * function rather than through `ctx.data`, per §6.
 *
 * The surface is deliberately two methods wide. Everything else a feature
 * might want from `tests` — versions, results, assertions, run history — is
 * not here, because no plugin has asked for it yet and a capability is much
 * easier to widen than to narrow.
 */

/**
 * Existing coverage, as a *prompt input*.
 *
 * Names and URLs only, and that is not an oversight: the one consumer feeds
 * this to a planner so it does not re-plan flows that already have tests.
 * Returning `tests` rows would hand every plugin the whole record — including
 * `code`, which is the thing least worth exporting across a boundary.
 */
export interface TestCoverage {
  readonly tests: readonly {
    readonly name: string;
    readonly targetUrl: string | null;
  }[];
  readonly areaPlans: readonly {
    readonly name: string;
    readonly plan: string;
  }[];
}

/**
 * A machine-authored test, on its way into quarantine.
 *
 * Note what this type cannot express, because that is the design:
 *
 * - **no `id`** — core mints it. A plugin cannot collide with, or overwrite,
 *   an existing test by guessing its id.
 * - **no `quarantined` flag** — the method is `createQuarantined` and the
 *   column is set by core unconditionally. There is no argument that turns it
 *   off, so a plugin cannot inject unreviewed code into a live suite.
 * - **no `teamId`** — tenancy comes from the context the plugin was handed,
 *   not from anything it says. `repositoryId` is checked against it.
 * - **no author fields** — `createdByUserId` / `createdByBotId` are core's to
 *   set. A plugin cannot forge attribution.
 * - **no `functionalAreaId`** — only an area *name*, resolved (or created)
 *   inside the repo core already authorized. A plugin cannot attach a test to
 *   an area id belonging to another repository.
 */
export interface QuarantinedTestInput {
  readonly repositoryId: string;
  /** Resolved within the repo; created if absent. Length-capped by core. */
  readonly areaName: string;
  readonly name: string;
  readonly code: string;
  readonly targetUrl: string;
}

/** A reference to a created test. An id, not a row. */
export interface TestRef {
  readonly id: string;
}

export interface TestsCapability {
  /**
   * Existing test names and area plans for a repo.
   *
   * Resolves empty — not an error — when the repo is not in the caller's
   * team, for the same reason `ReposCapability.baseUrl` resolves null: a
   * distinguishable rejection is an existence oracle.
   */
  listCoverage(repositoryId: string): Promise<TestCoverage>;

  /**
   * Persist a flow as a **quarantined** test under a named area, creating the
   * area if it does not exist.
   *
   * Rejects if the repo is not in the caller's team, or if the input exceeds
   * core's size caps. Unlike the read above this one throws rather than
   * degrading, because silently not saving a user's work is worse than an
   * error, and the caller here already knows the repo id is good.
   */
  createQuarantined(input: QuarantinedTestInput): Promise<TestRef>;
}
