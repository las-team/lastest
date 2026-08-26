/**
 * The core surface explorer needs and core does not have yet.
 *
 * **Read this file first if you are reviewing the migration.** The pilot
 * originally measured eight methods here — every one something the feature
 * used to do by reaching straight into a core table. Three of those have since
 * landed as real capabilities and left this file: `listCoverage` and
 * `createQuarantinedTest` are now `ctx.tests`, and `emitActivity` is now
 * `ctx.events` (a provider plugin, not core — `core-scope.md` §4). `resolveTargetUrl`
 * moved to `ctx.repos.baseUrl`, called directly from `actions.ts` where the old
 * host method was.
 *
 * **Six remain.** One (`getSettings`) is not a core API at all — a table that
 * should have moved and did not. The other five are real, waiting on core PRs
 * this migration's brief explicitly forbade bundling in (RFC §7.2: core and
 * plugin changes are separate PRs). `createIssue` is the newest of them: core
 * files a verify case as a GitHub issue today, from a server action a plugin
 * cannot call, so filing an explorer finding needed the same reach declared
 * here rather than a second OAuth-token holder in a feature package.
 *
 * ### Why a port and not `ctx`, for what is left
 *
 * `docs/architecture/core-scope.md` §6: *"To learn anything about a core
 * entity it calls a core function."* For `resolveExistingAuth`,
 * `assertSafeOutboundUrl`, `createIssue` and the field-crypto pair, that function does not
 * exist yet, so the gap is declared here as a port the composition root fills
 * — the same shape `core/browser` uses for `BrowserHost`, for the same reason:
 * injecting the primitive keeps this package free of `@/…` imports.
 * `BrowserHost` is a permanent seam; this one is scaffolding that shrinks as
 * each core PR lands.
 */

export interface ExplorerExistingAuth {
  /** Opaque id. Core resolves it into credential material; explorer never
   *  sees the material, only passes the id back on the browser claim. */
  storageStateId?: string;
  setupTestId?: string;
  defaultSetupInUse: boolean;
}

/**
 * The shape of an explorer activity event, as it crosses into `ctx.events`.
 *
 * No `teamId` or `repositoryId` here — the events provider attributes those
 * from the resolved `ProviderScope` (`ctx.team`/`ctx.repo`), not from anything
 * the plugin says. That is the tenancy argument in `core-scope.md` §6, applied
 * to a provider plugin instead of core itself.
 */
export interface ExplorerActivityEvent {
  sessionId: string;
  type:
    | "step:start"
    | "step:complete"
    | "substep:update"
    | "artifact:created"
    | "session:start"
    | "session:complete"
    | "session:error";
  summary: string;
  stepId?: string;
  detail?: Record<string, unknown>;
  artifact?: { type: "test"; id: string; label: string };
}

/**
 * What filing a finding as an issue needs from the tracker, and what comes
 * back.
 *
 * Deliberately provider-agnostic and body-agnostic: the plugin renders the
 * markdown (it is the only thing that knows what a finding *is* — see
 * `domain/issue-body.ts`), core owns the credential and the API call. That
 * split is `core-scope.md` §2.4 read literally — a GitHub installation token
 * is a credential, so a feature must never hold one — and it is the same shape
 * core already uses for a verify case in `src/server/actions/verify-issues.ts`.
 */
export interface ExplorerIssueRequest {
  /** Proven repo scope. Comes from `ctx.repo.id`, never from the client. */
  repositoryId: string;
  title: string;
  /** Rendered markdown. Core posts it verbatim. */
  body: string;
  labels: string[];
}

/**
 * Who would be filing, and where.
 *
 * Two facts the body composer needs and a plugin has no route to: the repo's
 * `owner/name` on the provider (`RepoRef` carries an id and a short name by
 * design) and the signed-in reviewer's email for attribution. The precedent is
 * `ShareHost`, which returns the same pair for the same reason.
 *
 * `connected: false` is the answer, not an error — the findings panel uses it
 * to offer a Connect-GitHub link before the reviewer writes a note they would
 * lose.
 */
export interface ExplorerIssueContext {
  connected: boolean;
  repoFullName: string | null;
  reporterEmail: string | null;
  /** Why filing is unavailable, when `connected` is false. */
  error?: string;
  code?: string;
}

export interface ExplorerIssueResult {
  ok: boolean;
  issueUrl?: string;
  issueNumber?: number;
  error?: string;
  /** `"github_not_connected"` when the team has no GitHub account attached —
   *  the UI keys off it to offer a Connect link instead of a dead-end error. */
  code?: string;
}

export interface ExplorerSettings {
  maxIterations: number;
  /** Comma-separated persisted rotation, e.g. `"normal,curious,psycho"`. */
  styleRotation: string | null;
}

export interface ExplorerHost {
  /**
   * **→ nowhere. These should be plugin-owned, and are not.**
   *
   * `ai_settings.explorer_max_iterations` and `explorer_style_rotation` are
   * this feature's own configuration sitting in a core table, for the
   * historical reason that the AI settings page was where the form already
   * was. Under §6 they belong in `explorer_triggers` or a settings row of the
   * plugin's own, and moving them is a data migration plus a settings-UI
   * change — deliberately not smuggled into this PR.
   *
   * Listed here rather than quietly dropped because dropping them would leave
   * two live controls in the settings UI that silently do nothing, which is a
   * worse outcome than one honest line of debt.
   */
  getSettings(repositoryId: string): Promise<ExplorerSettings>;

  /**
   * **→ `core/browser` (credentials).**
   *
   * "Does this repo already have usable stored auth, and what is its id."
   * Used to be `findExistingAuthSetup()` in `@/lib/qa-agent/auth`, reading
   * `setup_steps` and `storage_states` — a cross-plugin import *and* a core
   * read. It belongs next to `BrowserClaimOptions.storageStateId`, which is
   * the only thing the answer is ever used for.
   */
  resolveExistingAuth(repositoryId: string): Promise<ExplorerExistingAuth>;

  /**
   * **→ `core/security`.**
   *
   * SSRF guard on an operator-supplied target URL. Rejects with a
   * human-readable message. This is a boundary under §2 by any reading — a
   * feature getting it wrong lets a tenant reach the metadata service — so it
   * should never have been a plugin's to reimplement or to forget.
   */
  assertSafeOutboundUrl(url: string): Promise<void>;

  /**
   * **→ `core/data` (field-level encryption).**
   *
   * Target-app passwords live in explorer's own tables, but *how* they are
   * encrypted at rest is a credential concern (§2.4) and must not be twenty
   * plugins' independent choice of cipher. `ctx.data` hands over a query
   * surface and says nothing about column encryption; until it does, the
   * plugin borrows the app's field crypto through here.
   *
   * Synchronous and total: a decrypt failure returns the input unchanged, so a
   * key rotation degrades to "login stops working" rather than "the session
   * row cannot be read at all".
   */
  encryptField(plaintext: string): string;
  decryptField(stored: string): string;

  /**
   * **→ `core/integrations` (issue trackers).**
   *
   * File one issue on the repository's tracker and return its URL. The repo's
   * provider, the team's OAuth token and the HTTP call are all core's; the
   * plugin supplies a title, a body it rendered itself, and labels.
   *
   * Never throws for an expected failure — a missing GitHub connection, a
   * non-GitHub repo or a rejected POST all come back as `{ ok: false }` with a
   * message the findings panel can show, because "could not file" must not
   * lose the finding the reviewer was looking at.
   */
  createIssue(req: ExplorerIssueRequest): Promise<ExplorerIssueResult>;

  /** Whether this repo can accept a filed issue, and the two attribution
   *  facts the body needs. Never throws — see `ExplorerIssueContext`. */
  issueContext(repositoryId: string): Promise<ExplorerIssueContext>;
}
