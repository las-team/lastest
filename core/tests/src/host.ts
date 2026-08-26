/**
 * The host port.
 *
 * `core/**` may never import `@/…` (`pnpm arch` enforces it), so every query
 * against `tests` and `functional_areas` is injected. Same shape and same
 * reason as `core/browser`'s `BrowserHost`.
 */

export interface TestCoverageRow {
  readonly name: string;
  readonly targetUrl: string | null;
}

export interface AreaPlanRow {
  readonly name: string;
  readonly plan: string;
}

export interface NewQuarantinedTest {
  readonly repositoryId: string;
  readonly functionalAreaId: string;
  readonly name: string;
  readonly code: string;
  readonly targetUrl: string;
}

export interface TestsHost {
  /** `null` when the repo does not exist. Never trust a plugin's own claim of ownership. */
  repoTeamId(repositoryId: string): Promise<string | null>;

  listCoverage(
    repositoryId: string,
  ): Promise<{ tests: TestCoverageRow[]; areaPlans: AreaPlanRow[] }>;

  /** Finds an area by exact name within the repo, or creates one. */
  resolveOrCreateArea(
    repositoryId: string,
    areaName: string,
  ): Promise<{ id: string }>;

  /** Inserts with `quarantined: true` unconditionally — the caller cannot turn that off. */
  createTest(input: NewQuarantinedTest): Promise<{ id: string }>;
}
