/**
 * The core surface explorer needs and core does not have yet.
 *
 * **Read this file first if you are reviewing the migration.** It is the
 * measurement the pilot was run to produce: every method below is something the
 * feature used to do by reaching straight into a core table, and every one of
 * them is now a named, typed, reviewable call. There are eight. That number,
 * not the LOC moved, is what predicts the cost of the remaining ~19 features.
 *
 * ### Why a port and not `ctx`
 *
 * `docs/architecture/core-scope.md` §6 is unambiguous: *"To learn anything
 * about a core entity it calls a core function."* Those core functions do not
 * exist. `CapabilityMap` in `@lastest/contracts` is a closed interface, so
 * there is no honest way to add `ctx.tests` or `ctx.repos` from outside `core/`
 * — and the brief for this migration forbids touching `core/` in the same
 * change (RFC §7.2).
 *
 * So the gap is declared here instead, as a port the composition root fills.
 * This is the same shape `core/browser` uses for `BrowserHost`, for the same
 * stated reason: injecting the primitive keeps the package free of `@/…`
 * imports. The difference is worth being blunt about — `BrowserHost` is a
 * permanent seam between core and the app, whereas **this one is temporary
 * scaffolding**. Every method is a core PR waiting to be written, and the
 * plugin still transitively reads core tables through it. What the port buys is
 * that the reads are now *enumerable and finite* instead of scattered across
 * 1,800 lines of server action.
 *
 * Each method names the core module that should own it. When that module
 * lands, the method leaves this interface and the plugin calls `ctx` instead.
 */

export interface ExplorerExistingAuth {
  /** Opaque id. Core resolves it into credential material; explorer never
   *  sees the material, only passes the id back on the browser claim. */
  storageStateId?: string;
  setupTestId?: string;
  defaultSetupInUse: boolean;
}

export interface ExplorerCoverage {
  tests: Array<{ name: string; targetUrl: string | null }>;
  areaPlans: Array<{ name: string; plan: string }>;
}

export interface KeptTestInput {
  repositoryId: string;
  areaName: string;
  name: string;
  code: string;
  targetUrl: string;
}

export interface ExplorerActivityEvent {
  teamId: string;
  repositoryId: string;
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
   * **→ `core/repos` (or a `baseUrl` field on `RepoRef`).**
   *
   * The app's base URL for a repo/branch, for a scheduled run that has no user
   * to ask. Used to read `repositories.branchBaseUrls` + `environment_settings`
   * directly. `RepoRef` carries `defaultBranch` but not the URL, which is the
   * one field a browser-driving plugin cannot do without.
   */
  resolveTargetUrl(
    repositoryId: string,
    branch?: string | null,
  ): Promise<string | null>;

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
   * **→ `core/tests`.**
   *
   * Existing coverage, so the planner does not re-plan flows that already have
   * tests. Names and URLs only — this is a prompt input, not a data feed.
   */
  listCoverage(repositoryId: string): Promise<ExplorerCoverage>;

  /**
   * **→ `core/tests`.**
   *
   * Persist a passing flow as a quarantined test under a named area, creating
   * the area if needed. The single core *write* explorer performs, and the one
   * that makes "keep as test" work at all.
   */
  createQuarantinedTest(input: KeptTestInput): Promise<{ id: string }>;

  /**
   * **→ the `events` provider plugin** (`core-scope.md` §4 — fan-out is a
   * delivery mechanism, not a boundary, so it is explicitly *not* core).
   *
   * Fire-and-forget: an activity event that fails to persist must never fail
   * the exploration that emitted it.
   */
  emitActivity(event: ExplorerActivityEvent): void;

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
}
