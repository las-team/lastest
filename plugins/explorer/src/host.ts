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
 * **Five remain.** One (`getSettings`) is not a core API at all — a table that
 * should have moved and did not. The other four are real, waiting on core PRs
 * this migration's brief explicitly forbade bundling in (RFC §7.2: core and
 * plugin changes are separate PRs).
 *
 * ### Why a port and not `ctx`, for what is left
 *
 * `docs/architecture/core-scope.md` §6: *"To learn anything about a core
 * entity it calls a core function."* For `resolveExistingAuth`,
 * `assertSafeOutboundUrl` and the field-crypto pair, that function does not
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
}
