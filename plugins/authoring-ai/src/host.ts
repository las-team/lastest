/**
 * The core surface (and two sideways, unmigrated-neighbour surfaces)
 * `authoring-ai` needs and cannot reach on its own.
 *
 * See `docs/architecture/authoring-ai-migration-result.md` for the costing.
 * Grouped by what each method actually is, per recipe §1.5:
 *
 *   - `buildSeedFixture` / `getCodebaseIntelligence` — the shared exploration
 *     context every agent primes its prompt with (env, setup steps, known
 *     routes, prior codebase-intelligence scan).
 *   - Test reads/writes (`getTestForHealing`, `updateTestCode`) — the row an
 *     API test *is*, same shape `api-test`'s port already established.
 *   - Functional-area reads/writes — the planner's output sink.
 *   - `getRoutesByRepo` — known routes for the route planner.
 *   - `getRepoSpecFiles` — GitHub credential custody stays here; the plugin
 *     never sees `account.accessToken`. `@lastest/github` (a `libs/*`
 *     package) does the actual REST calls, invoked from the host
 *     implementation, not from the plugin.
 *   - `summarizeDomChanges` — `src/lib/diff` is core; the healer gets a
 *     rendered string, never the raw snapshot-diffing internals.
 *   - `getCurrentBranchForRepo` — genuinely unclassified (see the result
 *     doc §6: not a `core-scope.md` §2 boundary, not yet worth the
 *     eight-call-site refactor to `libs/git-utils`). Declared here rather
 *     than reclassified.
 *   - `validateGeneratedTest` — the static TS-diagnostic check only;
 *     `runValidationWithRetry`'s retry *policy* is the plugin's own
 *     (`validation.ts`), since it just calls back into the plugin's LLM
 *     loop and guards nothing.
 *   - `aiScanRoutes` / `extractUserStoriesFromFiles` / `syncAreaPlanAndSpecs`
 *     — the three sideways calls into `ai-routes.ts` / `spec-import.ts` /
 *     `specs.ts`, none of them core, none of them migrated. Recipe §1.6.2:
 *     a host method filled by the composition root, the same shape
 *     `app-map` used for its own calls into an unmigrated neighbour. A host
 *     method here does not make those three features migratable — that
 *     debt is unchanged by this PR.
 *
 * What is **not** here: any AI provider config or CDP endpoint. Those are
 * `ctx.ai.generate({ browserTools })` and `ctx.browser.withBrowser(...)` —
 * real capabilities, declared in the manifest, not host-port scaffolding.
 */

export interface AuthoringAiSeedFixture {
  /** The seed test code block for agents to use as a starting point. */
  readonly seedPrompt: string;
  readonly baseUrl: string;
  readonly hasLoginSetup: boolean;
}

export interface AuthoringAiIntelligence {
  readonly framework?: string;
  readonly cssFramework?: string;
  readonly selectorStrategy?: string;
  readonly authMechanism?: string;
  readonly testingRecommendations?: string[];
}

export interface AuthoringAiTest {
  readonly code: string;
  /** Opaque — only ever round-tripped into `summarizeDomChanges`. */
  readonly domSnapshot: unknown;
}

export interface AuthoringAiTestResult {
  readonly errorMessage: string | null;
  readonly domSnapshot: unknown;
}

export interface AuthoringAiRoute {
  readonly path: string;
  readonly functionalAreaId: string | null;
}

export interface AuthoringAiArea {
  readonly id: string;
  readonly name: string;
  readonly agentPlan: string | null;
}

export type AuthoringAiValidation =
  | { readonly valid: true }
  | { readonly valid: false; readonly feedback: string };

export type AuthoringAiRepoSpecFiles =
  | {
      readonly ok: true;
      readonly files: readonly { path: string; content: string }[];
    }
  | {
      readonly ok: false;
      readonly reason: "no-repository" | "no-github-account" | "no-spec-files";
    };

/** The slice of `aiScanRoutes`'s discovery result the code planner reads. */
export interface AuthoringAiCodeScanResult {
  readonly success: boolean;
  readonly error?: string;
  readonly functionalAreas?: ReadonlyArray<{
    readonly name: string;
    readonly description?: string;
    readonly routes: ReadonlyArray<{
      readonly path: string;
      readonly description?: string;
      readonly testSuggestions?: readonly string[];
    }>;
  }>;
}

/** The slice of `extractUserStoriesFromFiles`'s result the spec planner reads. */
export interface AuthoringAiSpecExtractionResult {
  readonly success: boolean;
  readonly error?: string;
  readonly stories?: ReadonlyArray<{
    readonly title: string;
    readonly description: string;
    readonly acceptanceCriteria: ReadonlyArray<{
      readonly description: string;
      readonly testName?: string;
    }>;
  }>;
}

export interface AuthoringAiHost {
  /** Env config, setup-step seed test, known routes, prior intelligence. */
  buildSeedFixture(repositoryId: string): Promise<AuthoringAiSeedFixture>;

  /** Prior codebase-intelligence scan, independent of the seed fixture. */
  getCodebaseIntelligence(
    repositoryId: string,
  ): Promise<AuthoringAiIntelligence | undefined>;

  getTestForHealing(testId: string): Promise<AuthoringAiTest | null>;
  getLatestTestResult(testId: string): Promise<AuthoringAiTestResult | null>;
  /** Persists `code` as a new version, tagged `"ai_fix"`. */
  updateTestCode(
    testId: string,
    code: string,
    branch: string | undefined,
  ): Promise<void>;

  getFunctionalAreaPlan(functionalAreaId: string): Promise<string | null>;
  getFunctionalAreasByRepo(repositoryId: string): Promise<AuthoringAiArea[]>;
  getOrCreateFunctionalArea(
    repositoryId: string,
    name: string,
    description?: string,
  ): Promise<{ id: string }>;
  saveAreaPlan(functionalAreaId: string, plan: string): Promise<void>;

  getRoutesByRepo(repositoryId: string): Promise<AuthoringAiRoute[]>;

  getRepoSpecFiles(
    repositoryId: string,
    branch: string,
  ): Promise<AuthoringAiRepoSpecFiles>;

  /** Null when the two snapshots have no interesting difference. */
  summarizeDomChanges(
    baseline: unknown,
    current: unknown,
  ): Promise<string | null>;

  getCurrentBranchForRepo(repositoryId: string): Promise<string | null>;

  validateGeneratedTest(code: string): Promise<AuthoringAiValidation>;

  /** Sideways: `src/server/actions/ai-routes.ts`, unmigrated. */
  aiScanRoutes(
    repositoryId: string,
    branch: string,
    intelligence?: AuthoringAiIntelligence,
  ): Promise<AuthoringAiCodeScanResult>;

  /** Sideways: `src/server/actions/spec-import.ts`, its own oversized entry. */
  extractUserStoriesFromFiles(
    repositoryId: string,
    branch: string,
    filePaths: string[],
  ): Promise<AuthoringAiSpecExtractionResult>;

  /** Sideways: `src/server/actions/specs.ts`, unmigrated. */
  syncAreaPlanAndSpecs(
    functionalAreaId: string,
    repositoryId: string,
  ): Promise<{ specsCreated: number; planCreated: boolean }>;
}
