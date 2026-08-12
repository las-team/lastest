import type { DiffMetadata } from "@lastest/eb-protocol";

/**
 * The core surface RCA needs and core does not expose yet.
 *
 * RCA owns no tables. Every input it fuses — the build's visual diffs, the
 * build's Change Map, the functional area of a test, whether a test has ever
 * gone green — is a *core* fact living on a core table, and the verdict it
 * produces is written back into a core column (`visual_diffs.metadata.rca`).
 * That makes this plugin the pure case of `core-scope.md` §6: *"to learn
 * anything about a core entity it calls a core function."*
 *
 * None of these six are boundaries in the `core-scope.md` §2 sense — nothing
 * here can exhaust a shared resource, bypass metering, or leak a credential.
 * They are read/write helpers over core tables that core has no capability for
 * yet. `ctx.tests` covers *test* entities but not visual diffs, change maps or
 * area lookups, so the gap is declared here rather than papered over with a
 * `@lastest/db` import.
 *
 * Tenancy is not this port's job and must not become it. Every method is
 * called from `run.ts` *after* `contextFor()` has resolved a scope, which is
 * where `requireRepoAccess` runs — see `actions.ts`. A method here that took a
 * `teamId` from its caller would be re-deciding a question the kernel already
 * answered, which is the failure mode `core-scope.md` §6 warns about.
 */

/**
 * The slice of a visual-diff row RCA reads.
 *
 * Structural and narrow on purpose: the real row has ~30 columns, and naming
 * only these five is what lets the package compile without importing the table
 * type from `@lastest/db`. Core's row satisfies it by construction.
 */
export interface RcaVisualDiff {
  id: string;
  testId: string;
  metadata: DiffMetadata | null | undefined;
  classification: string | null;
  pixelDifference: number | null;
  percentageDifference: string | number | null;
}

/**
 * The two fields of the build Change Map the classifier actually reads.
 *
 * Core's `ChangeMap` (`packages/db/src/schema/runs.ts`) is a nine-field
 * aggregate of four signal sources; RCA uses the code-flagged areas and the
 * changed file paths and ignores the rest. Declaring the narrow shape here
 * rather than moving the whole type into `@lastest/eb-protocol` keeps a core
 * type core — structural typing means core's value is assignable as-is.
 */
export interface RcaChangeMap {
  files: { path: string }[];
  areas: { areaId: string; areaName: string; sources: string[] }[];
}

export interface RcaHost {
  /**
   * The build's visual diffs. RCA filters to the changed ones itself — the
   * predicate is a heuristic detail, not something core should encode.
   */
  listBuildVisualDiffs(buildId: string): Promise<RcaVisualDiff[]>;

  /** The build's Change Map, or null when it was never computed. */
  getBuildChangeMap(buildId: string): Promise<RcaChangeMap | null>;

  /**
   * `testId → functionalAreaId` for the given tests.
   *
   * The one call that replaced a direct `drizzle-orm` query in the pre-plugin
   * code (`src/lib/rca/run.ts` used `db.select().from(tests)` with `inArray`),
   * and the reason `rca::db` was a counted violation.
   */
  getTestAreaIds(testIds: string[]): Promise<Map<string, string | null>>;

  /** Which of these tests have at least one prior `status='passed'` result. */
  getTestsWithAnyPassedResult(testIds: string[]): Promise<Set<string>>;

  /** Persist a recomputed metadata blob onto one visual diff. */
  updateDiffMetadata(diffId: string, metadata: DiffMetadata): Promise<void>;

  /**
   * The repository a build belongs to, or null.
   *
   * Not an authorization check — it is the *lookup* that lets `actions.ts` ask
   * the kernel to authorize. It reaches `@/lib/change-map/compute`, which the
   * boundary map still lists as **unclassified**: neither core (§6.1) nor a
   * plugin (§6.3). Whoever classifies `change-map` inherits this method.
   */
  resolveRepoIdForBuild(buildId: string): Promise<string | null>;
}
