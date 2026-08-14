export type {
  BuildA11yViolationRow,
  CapturedScreenshot,
  DemoNotes,
  RepoAward,
  StepComparisonEvidence,
  StepVerdict,
  VideoCaption,
} from "./types";
import type {
  BuildA11yViolationRow,
  CapturedScreenshot,
  DemoNotes,
  RepoAward,
  StepComparisonEvidence,
  StepVerdict,
  VideoCaption,
} from "./types";
import type {
  DomDiffResult,
  StepTiming,
  WebVitalsSample,
} from "@lastest/eb-protocol";

/**
 * The core surface the share plugin needs and core does not expose yet.
 *
 * Costed before starting (`plugin-migration-recipe.md` §1.5): **15 methods**.
 * That is the largest port of any phase-4 migration so far (`app-map`,
 * `gamification` and `ci` share the previous high at 9), and the reason is
 * structural, not sloppiness — this page renders almost the same evidence
 * the in-app build-detail view does (builds, tests, test runs, visual diffs,
 * step comparisons, a11y, awards, demo notes), just for an anonymous
 * visitor. §1.5's "coordination shows up in the port count" is the honest
 * read: the /r/<slug> page *is* a coordinator, not a computer. It is also
 * right at the recipe's own stop line ("> ~15: STOP") rather than
 * comfortably under it — see the migration result doc for why this one was
 * still worth doing rather than deferred like `url-diff`.
 *
 * Grouped by what each method is, the way the recipe asks:
 *
 * - **Identity (3):** `requireRepoAccess`, `requireTeamAccess`,
 *   `requireTestAccess`. Do auth *and* return the actor in one call — see the
 *   note on `ShareRepoActor` below for why this plugin does not use
 *   `runtime.contextFor()` the way `ci`/`rca`/`app-map` do.
 * - **Publish-flow reads/writes (2):** `getBuildPublishInfo`,
 *   `resolveOrCreateBuildForTest`.
 * - **Render-flow reads (5):** `getBuildRenderContext` (the big one — build +
 *   test + test run + visual diffs + test results + step comparisons, all in
 *   one call, mirroring how `plugins/rca/src/host.ts` collapsed its own
 *   diff/change-map reads), `getOwnerTeamFlags`, `getPlatformStats`,
 *   `getBuildA11yViolations`, `getRepoAward`, `getDemoNotes`. That is 6, not
 *   5 — see the note below on why it is not fewer.
 * - **Claim-flow writes (3):** `findOrCreateClaimRepo`, `cloneShareIntoRepo`,
 *   `setSelectedRepository`.
 * - **Notification (1):** `sendShareNotification`.
 *
 * Three things this port does NOT contain, and why:
 *
 * - **No `readStorageFile` / video byte access.** `resolveTestVideoUrl` /
 *   `resolveResultVideoUrl` moved to `@lastest/video-fallback` instead of
 *   becoming a host method — they touch no core table and no auth boundary,
 *   just a filesystem convention `src/server/actions/tests.ts` (an
 *   unrelated feature) also depends on. `core-scope.md` §3's "useful to
 *   many ≠ core" test says library, and the recipe's mechanical check (read
 *   its import list: `fs/promises` and `path`, nothing else) agrees.
 * - **No AI capability, no captions read/write.** `src/lib/share/captions.ts`
 *   and `generate-captions.ts` — the vision pass that authors
 *   `build_demo_notes.payload.captions` — did NOT migrate with this plugin.
 *   They relocated to `src/lib/demo-captions/` instead: reading their
 *   consumer list (`src/server/actions/captions.ts`, never listed in this
 *   plugin's `PSEUDO_PLUGINS` `actions` entry) rather than their old
 *   directory shows they are a distinct authoring pipeline that happens to
 *   write into the same core column this plugin *reads*. Pulling AI + a
 *   screenshot-bytes read into this port for a feature that isn't the one
 *   migrating would have added ~4 methods to answer a question nobody asked
 *   yet. `getDemoNotes` below is READ-only for exactly this reason.
 * - **No sitemap enrichment.** `listPublicSharesForSitemap`'s joins into
 *   `builds`/`tests`/`testResults` moved to `src/app/sitemap.ts` itself,
 *   which composes the plugin's own-table list
 *   (`listIndexablePublicShares`) with direct `@/lib/db/queries` calls — it
 *   is app code, so it may. See `plugin-migration-recipe.md` §6.2's "the
 *   plugin answers its own questions, the app composes," one level up: here
 *   the plugin's only question is "which shares are indexable."
 */

/**
 * The caller, already authenticated AND enriched with what a publish/claim
 * action needs beyond `ctx.team`/`ctx.repo` — user id, user email, team name,
 * repo name. None of those are on `PluginContext` (`TeamRef` carries no
 * `name`, `RepoRef` carries no email/id for the caller), so getting them via
 * `runtime.contextFor()` plus a second lookup would still need a method like
 * this one, just a smaller one. Doing the auth check AND the enrichment in a
 * single call is the same move `api-test`'s `createTest` made
 * (`plugin-migration-recipe.md` §3.1: "the guard is inside the write, not
 * beside it") — there is exactly one path to a `ShareRepoActor`, and it
 * cannot be obtained without passing the check.
 *
 * This is why `wiring.ts` carries `data` straight from the wiring slot rather
 * than a `runtime` + `contextFor()`: every action already gets its
 * authorization from one of these two methods, so a second, kernel-level
 * check would be redundant rather than additive.
 */
export interface ShareRepoActor {
  readonly userId: string;
  readonly userEmail: string;
  readonly teamId: string;
  readonly teamName: string;
  readonly repoName: string;
}

export interface ShareTeamActor {
  readonly userId: string;
  readonly teamId: string;
  readonly teamSlug: string;
}

export interface SharePublishInfo {
  readonly repositoryId: string;
  readonly testRunId: string | null;
  /** Hostname of a representative test's target URL, for the share's
   *  "which product is this" display. Null when nothing resolves one. */
  readonly targetDomain: string | null;
  /** The scoped test's name, when a `scopedTestId` was given — carried
   *  through to the Discord notification. Null for a build-wide publish. */
  readonly scopedTestName: string | null;
}

/** The slice of `builds` this page renders. Narrowed per
 *  `plugin-migration-recipe.md` §6.1 — core's type, not this plugin's. */
export interface ShareBuild {
  readonly id: string;
  readonly testRunId: string | null;
  readonly baseUrl: string | null;
  readonly changesDetected: number | null;
  readonly totalTests: number | null;
  readonly passedCount: number | null;
  readonly failedCount: number | null;
  readonly overallStatus: string;
  readonly completedAt: Date | null;
  readonly createdAt: Date | null;
  readonly elapsedMs: number | null;
  readonly triggerType: string | null;
  readonly a11yScore: number | null;
  readonly a11yViolationCount: number | null;
  readonly a11yTotalRulesChecked: number | null;
  readonly designSystemScore: number | null;
  /** Read only by `deriveShareFacts` (`./demo-facts.ts`) to decide whether
   *  the share can claim "authenticated walkthrough". */
  readonly buildSetupTestId: string | null;
}

export interface ShareTest {
  readonly name: string;
  readonly code: string;
  readonly targetUrl: string | null;
  /** Same "authenticated walkthrough" signal as `ShareBuild.buildSetupTestId`
   *  — a test wired to a login-setup test. */
  readonly setupTestId: string | null;
}

export interface ShareTestRun {
  readonly repositoryId: string | null;
  readonly gitBranch: string | null;
  readonly gitCommit: string | null;
}

export interface ShareVisualDiff {
  id: string;
  buildId: string;
  testResultId: string | null;
  testId: string;
  stepLabel: string | null;
  baselineImagePath: string | null;
  currentImagePath: string | null;
  diffImagePath: string | null;
  status: string;
  pixelDifference: number | null;
  percentageDifference: string | null;
  classification: string | null;
  plannedImagePath: string | null;
  plannedDiffImagePath: string | null;
  mainBaselineImagePath: string | null;
  mainDiffImagePath: string | null;
  domDiff: DomDiffResult | null;
  testResultStatus: string | null;
  testName: string | null;
}

export interface ShareTestResult {
  testId: string | null;
  status: string | null;
  screenshotPath: string | null;
  videoPath: string | null;
  durationMs: number | null;
  screenshots: CapturedScreenshot[] | null;
  webVitals: WebVitalsSample[] | null;
  stepTimings: StepTiming[] | null;
}

export interface ShareStepComparison {
  id: string;
  testId: string;
  stepLabel: string | null;
  stepIndex: number | null;
  verdict: StepVerdict;
  layers: StepComparisonEvidence;
}

export interface ShareBuildRenderContext {
  build: ShareBuild;
  test: ShareTest | null;
  testRun: ShareTestRun | null;
  diffs: ShareVisualDiff[];
  results: ShareTestResult[];
  stepComparisons: ShareStepComparison[];
}

export interface ClaimSourceTest {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly targetUrl: string | null;
  readonly executionMode: string | null;
}

export interface ShareHost {
  // ── Identity ──────────────────────────────────────────────────────────
  requireRepoAccess(repositoryId: string): Promise<ShareRepoActor>;
  requireTeamAccess(): Promise<ShareTeamActor>;

  /**
   * `listTestShares`'s "resolve the test's repo, then authorize" in one
   * call — the fifteenth method, and the one place this port could not reuse
   * `getBuildPublishInfo` (that takes a buildId, this takes a testId, and
   * the test may have no build yet). Null when the test does not exist or
   * has no repository, mirroring the pre-plugin code's soft "return []"
   * rather than a thrown error — the caller distinguishes "nothing to
   * authorize" from "authorized" by the null, and from "unauthorized" by
   * whatever `requireRepoAccess` itself throws for a mismatched team.
   */
  requireTestAccess(testId: string): Promise<ShareRepoActor | null>;

  // ── Publish flow ──────────────────────────────────────────────────────
  /**
   * The repo + run + a representative target domain for a build. Replaces
   * `getBuild` + `getTestRun` + (optionally) `getTest` + a scan of the run's
   * first result for a fallback domain — every one of those was a direct
   * `queries.*` call in the pre-plugin `publishBuildShare`/`listBuildShares`.
   */
  getBuildPublishInfo(
    buildId: string,
    scopedTestId?: string | null,
  ): Promise<SharePublishInfo | null>;

  /**
   * `publishLatestTestShare`'s "find or synthesize a build for this test's
   * most recent run" — a WRITE (it may `createBuild`), which is why it
   * cannot be a plain read. Returns null when the test has never produced a
   * run with results.
   */
  resolveOrCreateBuildForTest(
    testId: string,
  ): Promise<{ repositoryId: string; buildId: string } | null>;

  // ── Render flow ───────────────────────────────────────────────────────
  /** Everything the page renders about one build/test pairing, in one call.
   *  `testId: null` renders the build-wide view. */
  getBuildRenderContext(target: {
    buildId: string;
    testId: string | null;
  }): Promise<ShareBuildRenderContext | null>;

  /** Feature flags of the team that owns a share's repository. The share
   *  page has no session, so it reads the OWNER's flags, not the anonymous
   *  visitor's. */
  getOwnerTeamFlags(
    repositoryId: string | null,
  ): Promise<{ earlyAdopterMode: boolean } | null>;

  /** Platform-wide "test runs completed" count for the social-proof strip.
   *  Deliberately not scoped to this share — see the query's own comment in
   *  the pre-plugin code. The "products tested" half of the same strip is
   *  this plugin's own aggregate (`countDistinctPublicTargetDomains`, its
   *  own table) and is not here. */
  getPlatformStats(): Promise<{ testRunsCompleted: number }>;

  /** Slim a11y violation rows for the WCAG panel — already the share-safe
   *  projection `src/lib/db/queries/builds.ts` produces for this exact
   *  caller today. */
  getBuildA11yViolations(buildId: string): Promise<BuildA11yViolationRow[]>;

  /** The repo's current award tier, or null. Cross-feature read into the
   *  (not yet migrated) `awards` pseudo-plugin's data — see `host.ts`'s file
   *  header and `docs/architecture/core-plugin-refactor.md`'s note that
   *  `awards` wants `share` migrated first. */
  getRepoAward(repositoryId: string): Promise<RepoAward | null>;

  /**
   * Two reads bundled into one call because they answer related but
   * different questions about the same build:
   *
   * - `notes`: the UX-summary prose, preferring the repo's LATEST notes (so
   *   a re-run's fresher summary flows into an existing share) with a
   *   fallback to the build's own row.
   * - `buildCaptions`: the `<video>` subtitle track, which must come from
   *   THIS build's OWN notes and never the repo-latest fallback — captions
   *   are time-coded to a specific recording, and borrowing a sibling
   *   build's cues would desync the track.
   *
   * READ only — see the file header for why writing captions is
   * deliberately not here.
   */
  getDemoNotes(
    buildId: string,
    repositoryId: string | null,
  ): Promise<{ notes: DemoNotes | null; buildCaptions: VideoCaption[] }>;

  // ── Claim flow ────────────────────────────────────────────────────────
  /** Idempotent: returns the claiming team's existing repo of this name if
   *  one exists (a prior claim of the same share), else creates one. */
  findOrCreateClaimRepo(
    teamId: string,
    teamSlug: string,
    repoName: string,
  ): Promise<{ repositoryId: string }>;

  /**
   * Resolve the share's source test(s) — the single test for a test-scoped
   * share, or every distinct test in the build's run for a build-wide one —
   * and copy each (plus its active baselines) into the claimer's repo.
   * Idempotent per test (matches by name+code before creating). Does its own
   * baseline FILE copy under `storage/screenshots/` — the plugin never gets
   * a filesystem path, only test ids back.
   *
   * Takes the share's own `testId`/`buildId` rather than a pre-resolved test
   * list: the resolution (`getPublicShareContext` + `loadTestsFromRun` in
   * the pre-plugin code) is core-table work with nothing for the plugin to
   * decide, so it lives entirely on this side of the boundary — "do the
   * thing," not "give me the primitive" (§3.1).
   */
  cloneShareIntoRepo(input: {
    shareTestId: string | null;
    shareBuildId: string;
    sourceRepositoryId: string | null;
    targetRepositoryId: string;
    createdByUserId: string;
  }): Promise<{ testIds: string[] }>;

  /** Lands the claimer in the new repo so `/tests` shows what they just
   *  claimed. */
  setSelectedRepository(userId: string, repositoryId: string): Promise<void>;

  // ── Notification ──────────────────────────────────────────────────────
  /** Best-effort Discord ping on a genuinely new publish. Wraps the SSRF
   *  guard (`assertSafeOutboundUrl`) the pre-plugin code already had —
   *  moving the guard itself is out of scope here, it stays a core security
   *  boundary this method calls. */
  sendShareNotification(
    webhookUrl: string,
    payload: ShareNotificationPayload,
  ): Promise<{ success: boolean; error?: string }>;
}

export interface ShareNotificationPayload {
  shareUrl: string;
  slug: string;
  targetDomain: string | null;
  repoName: string;
  publishedByEmail: string;
  teamName: string;
  scopedTestName: string | null;
  outreachHook: string | null;
  testingStruggles: Array<{ label: string; note: string }>;
}
