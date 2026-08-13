/**
 * The core surface App Map needs and core does not have yet.
 *
 * **Read this file first if you are reviewing the migration.** Nine methods,
 * and they fall into three groups that have very different futures:
 *
 * - **Five repo-discovery reads** (`listRoutes`, `listAreas`,
 *   `listAreaIdsWithTests`, `getCrawlDiscovery`, `listTrajectoryResults`).
 *   These are the whole reason App Map exists: it *merges* four discovery
 *   sources that all live on core tables. None of them is a boundary under
 *   `docs/architecture/core-scope.md` §2 — no tenancy decision, no capacity,
 *   no money, no credential — they are reads core has no capability for.
 *   All five collapse into one `ctx.discovery` capability the day someone
 *   builds it, which is the obvious future core PR and is deliberately **not**
 *   bundled here (RFC §7.2).
 *
 * - **One security boundary** (`fetchSitemapXml`). This one is *not* debt of
 *   the same kind. Outbound fetch to a tenant-supplied URL is an SSRF surface,
 *   and `core-scope.md` §2 puts it squarely in core: a feature getting it
 *   wrong lets a tenant reach the metadata service. `plugins/explorer`
 *   declares the same gap as `assertSafeOutboundUrl`. The two should land
 *   together as `core/security`, and until they do, injecting the primitive is
 *   how this package stays free of `@/…`.
 *
 * - **Three qa-agent seams** (`getActiveExploration`, `requestCoverage`,
 *   `startExploration`). These are not core at all — they are *another
 *   plugin*, reached the only legal way. See "Why the qa-agent calls are here"
 *   below.
 *
 * ### Why the qa-agent calls are here rather than as an import
 *
 * `src/server/actions/app-map.ts` used to `import { addQaTask, startQaAgent }
 * from "./qa-agent"`. That is the `plugin → plugin` edge RFC §3 forbids, and
 * it is worth noting the burndown never counted it: `crossPluginPatternsFor`
 * only matches `@/…` specifiers, and this one was a *relative* import between
 * two files in `src/server/actions/`. It was a real violation that the walker
 * could not see.
 *
 * RFC §4.3 gives two legal answers: promote the shared part, or go through
 * `ctx.jobs`. Neither is available yet — the shared part is 4,400 lines of
 * qa-agent, and `qa-agent` has no job handlers because it is not a plugin.
 * So the edge is declared here instead, and the composition root is where the
 * two features meet. That is a *demotion* of the coupling, not a removal:
 * these three become `ctx.jobs.enqueue("qa-agent.…")` when qa-agent migrates
 * (RFC §9 phase 4, last), and this comment is the note to whoever does it.
 *
 * ### What is deliberately NOT here
 *
 * - **Base-URL resolution.** It used to be `repo.branchBaseUrls?.[branch] ??
 *   envConfig?.baseUrl`, inlined twice. It is now `ctx.repos.baseUrl()` — a
 *   real capability. See `plugins/app-map/src/build-map.ts` for the one
 *   behaviour change that carries.
 * - **The plan's explorer quota.** `planConfig(team.plan).maxExplorers` is
 *   billing, and billing is core (§6.1). The plugin sends the *requested*
 *   count and the host clamps it; a plugin that could clamp its own quota is
 *   not a quota.
 * - **Repository selection.** Which repo the user is looking at is per-user
 *   app state. The route page resolves it and passes `repositoryId` in, which
 *   is also what upgrades the authorization: `contextFor({ repositoryId })`
 *   runs `requireRepoAccess`, where the old actions ran `requireTeamAccess`
 *   and then trusted the selection.
 */

/** A source-code route scan row, narrowed to what the map reads. */
export interface AppMapRouteRow {
  id: string;
  path: string;
  functionalAreaId: string | null;
  hasTest: boolean | null;
}

/** A functional area, narrowed to id → display name. */
export interface AppMapAreaRow {
  id: string;
  name: string;
}

/**
 * The QA agent's live-crawl output, as App Map reads it.
 *
 * Structurally narrower than core's `QaDiscovery` (`agent_sessions.metadata`).
 * Declared here rather than imported for the reason `plugins/rca/src/host.ts`
 * declares `RcaChangeMap`: the alternative is moving another plugin's metadata
 * payload types into `@lastest/eb-protocol` ahead of that plugin's own
 * migration. The compile-time assignment in `src/lib/core/app-map-host.ts` is
 * the assertion that this shape still matches core's real one — if the core
 * type drifts, the host stops type-checking.
 */
export interface AppMapCrawledPage {
  url: string;
  finalUrl?: string;
  title?: string | null;
  links?: Array<{ href: string }>;
  apiEndpoints?: Array<{ method: string; path: string }>;
}

export interface AppMapDiscovery {
  targetUrl?: string;
  crawledPages?: AppMapCrawledPage[];
}

/**
 * A screenshot captured during a run, narrowed to the two fields App Map
 * reads. Core's `CapturedScreenshot` also carries `atMs`, `title` and a full
 * `domSnapshot`; none of it is map data, and the narrow shape is what keeps
 * this package from needing `@lastest/db`.
 */
export interface AppMapCapturedScreenshot {
  path: string;
  label?: string;
}

/**
 * A trajectory-bearing test result. `screenshots` and `urlTrajectory` stay
 * `unknown` exactly as the core row types them — the map casts them at the
 * point of use, which is what `src/lib/app-map/build-map.ts` already did.
 */
export interface AppMapTrajectoryResult {
  testId: string | null;
  testName: string | null;
  screenshots: unknown;
  urlTrajectory: unknown;
  gitBranch: string | null;
  startedAt: Date | string | null;
}

/** An in-flight exploration run, so a page reload can resume its progress UI. */
export interface AppMapActiveExploration {
  sessionId: string;
  status: string;
  /** `agent_sessions.metadata.qaExplore`, narrowed to what the UI renders. */
  explore: AppMapExploreState | null;
}

export interface AppMapExploreState {
  pagesDiscovered: number;
}

/** Crawl strategy. Mirrors core's `ExploreStrategy`; see `AppMapDiscovery`. */
export type AppMapExploreStrategy = "breadth" | "depth" | "balanced";

export interface AppMapStartExplorationInput {
  repositoryId: string;
  targetUrl: string;
  /** *Requested* explorer count. The host clamps it to the plan's quota. */
  explorers: number;
  /** Crawl depth 1–6. */
  depth: number;
  strategy: AppMapExploreStrategy;
  /** Wall-clock budget in minutes (2/5/10/20 in the dialog). */
  maxMinutes: number;
  /** Free-text sign-in instructions — AI-extracted into structured creds. */
  authContext?: string;
  /** Optional structured credentials (used directly, no extraction). */
  email?: string;
  password?: string;
}

export interface AppMapHost {
  // ── Repo discovery reads → a future `ctx.discovery` ───────────────────────

  /** Source-of-record routes from the code scan. Never "extra" paths. */
  listRoutes(repositoryId: string): Promise<AppMapRouteRow[]>;

  /** Functional areas, for node area labels. */
  listAreas(repositoryId: string): Promise<AppMapAreaRow[]>;

  /**
   * Ids of the functional areas that have at least one test.
   *
   * Narrower on purpose: this used to be `getTestsByRepo(repositoryId)` — the
   * whole test rows, `code` column and all — reduced immediately to a set of
   * area ids. Handing a plugin every test to answer a yes/no question about
   * areas is the kind of over-fetch `ctx.tests.listCoverage` was written to
   * avoid, so the port asks the question it actually has.
   */
  listAreaIdsWithTests(repositoryId: string): Promise<string[]>;

  /** The latest QA-agent crawl for the repo, if one has ever run. */
  getCrawlDiscovery(repositoryId: string): Promise<AppMapDiscovery | null>;

  /** Latest-per-test results carrying a URL trajectory, preferring `branch`. */
  listTrajectoryResults(
    repositoryId: string,
    branch: string,
  ): Promise<AppMapTrajectoryResult[]>;

  // ── Security boundary → `core/security` ───────────────────────────────────

  /**
   * SSRF-guarded outbound GET for a sitemap document.
   *
   * Resolves `null` — never throws — for a blocked host, a non-2xx, a timeout
   * or a network error, because the caller is a server-component render that
   * degrades to "no sitemap source" rather than failing the page.
   *
   * The guard is the point. A plugin that could fetch arbitrary URLs itself
   * could reach `169.254.169.254` from inside the cluster; `core-scope.md` §2
   * is explicit that this is core's to own and not twenty features' to
   * re-implement.
   */
  fetchSitemapXml(
    url: string,
    opts?: { timeoutMs?: number },
  ): Promise<string | null>;

  // ── qa-agent seams → `ctx.jobs` once qa-agent is a plugin ─────────────────

  /** The repo's in-flight exploration, if any. */
  getActiveExploration(
    repositoryId: string,
  ): Promise<AppMapActiveExploration | null>;

  /**
   * Enqueue an "Ask QA agent to cover <page>" task for an uncovered node.
   * The Pro gate lives inside qa-agent (`assertQaAgentAccess`), not here.
   */
  requestCoverage(input: {
    repositoryId: string;
    path: string;
    url?: string;
  }): Promise<{ taskId: string }>;

  /**
   * Launch an exploration: a QA-agent run in mode "explore" (setup → login →
   * discover only). The host enforces the Pro gate, the one-active-session-
   * per-repo rule, and the plan's explorer quota.
   */
  startExploration(
    input: AppMapStartExplorationInput,
  ): Promise<{ sessionId: string }>;
}
