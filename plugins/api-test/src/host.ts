/**
 * The core surface API tests need and core does not have yet.
 *
 * **Read this file first if you are reviewing the migration.** Five methods,
 * in three groups with very different futures:
 *
 * - **One security boundary** (`fetchGuarded`). An API test is, definitionally,
 *   an outbound HTTP request to a tenant-supplied URL issued by the server —
 *   the SSRF surface, and `core-scope.md` §2 puts it in core. This plugin is
 *   the *third* to declare the same gap: `plugins/explorer` asks for
 *   `assertSafeOutboundUrl`, `plugins/app-map` for `fetchSitemapXml`, and now
 *   this. Three declarers of one primitive is the signal §4.3 describes for
 *   promotion — `core/security` is the obvious next core PR, and it is
 *   deliberately **not** bundled here (RFC §7.2).
 *
 *   Note what the method *is*, though: not "hand me the guard", but "do the
 *   request for me". `runApiTest` never sees a dispatcher and cannot skip the
 *   check by calling `fetch` itself, because the package does not have the
 *   guard to skip. That is stronger than what `src/lib/api-test/runner.ts` had,
 *   where the SSRF pre-flight and the connect-time re-validation were two
 *   separate opt-in call sites in feature code.
 *
 * - **Two authorized writes** (`createTest`, `updateTest`). API tests are rows
 *   in `tests`, a core table with 24 inbound FKs — `core-scope.md` §6 is
 *   explicit that a plugin does not reach one, it calls a core function. The
 *   existing `ctx.tests` capability does not fit: it has exactly two methods
 *   (`listCoverage`, `createQuarantined`) and `createQuarantined` is
 *   deliberately incapable of expressing what this needs — no `apiDefinition`,
 *   no un-quarantined write, no update at all. Widening a capability to fit its
 *   second consumer is a core PR; declaring the gap is this one.
 *
 *   **The authorization lives on the host side, not here.** `createTest` runs
 *   `requireRepoCapability(repositoryId, "tests:write")` and `updateTest` runs
 *   `requireTestOwnership(id)`, both inside `src/lib/core/api-test-host.ts`.
 *   That is the same call `plugins/app-map` made for qa-agent's Pro gate and
 *   the explorer quota: a plugin that could decide its own authorization is
 *   not being authorized. It is also why these are not just
 *   `ctx.data`-shaped — RBAC capabilities are not on `PluginContext` at all.
 *
 * - **Two AI preflight reads** (`aiSupportsJson`, `apiLayerHint`). The
 *   generation itself is `ctx.ai.generate()` — a real capability, so the
 *   provider key and the spend attribution never come near this package. What
 *   is left over is the two questions `AiCapability` cannot answer today:
 *   whether the configured provider can be held to a JSON response at all, and
 *   what kind of API layer the repo's source code has. Both are reads, neither
 *   is a boundary, and the first is a one-field widening of
 *   `ctx.ai.budget()` whenever someone wants it.
 *
 * ### What is deliberately NOT here
 *
 * - **Redaction.** `renderApiDefinitionForCode` stays in the package (it is
 *   knowledge about `ApiAuth`, which is this plugin's own type) but the *host*
 *   calls it, at the moment of persistence, rather than the plugin passing a
 *   pre-rendered `code` string down. A plugin that could choose what lands in
 *   the human-visible, version-snapshotted `tests.code` column could choose to
 *   put a live bearer token there. Now it cannot: the host takes a definition
 *   and renders the column itself. See `src/lib/core/api-test-host.ts`.
 *
 * - **Running a build.** `validateDiffAction` used to live in
 *   `src/server/actions/api-tests.ts` and does not belong to this feature at
 *   all; it moved to the app in the preceding core PR rather than becoming a
 *   sixth port method. RFC §4.3: a host method that wraps another feature is
 *   the coupling in a nicer coat.
 *
 * - **Repository selection.** As with `app-map`, the caller passes
 *   `repositoryId` and `contextFor({ repositoryId })` runs the app's
 *   `requireRepoAccess` inside `resolveScope`.
 */

import type { ApiTestDefinition } from "@lastest/eb-protocol";

// ── Security boundary → `core/security` ─────────────────────────────────────

export interface GuardedRequest {
  method: string;
  headers: Record<string, string>;
  /** Already-serialized body, or undefined for a bodyless request. */
  body?: string;
  timeoutMs: number;
}

/**
 * The outcome of a guarded request.
 *
 * A blocked host, a timeout and a transport error are all `ok: false` with a
 * human-readable `error`, because that is exactly how the runner reports them:
 * an API test that cannot reach its target is a *failed test*, not a thrown
 * exception. Keeping the discrimination in the return type rather than in
 * exception classes is what lets this package stay free of `SsrfBlockedError`,
 * which lives in the app.
 */
export type GuardedResponse =
  | {
      ok: true;
      status: number;
      /** Lowercased header names. */
      headers: Record<string, string>;
      text: string;
    }
  | { ok: false; error: string };

// ── Authorized writes into the core `tests` table ───────────────────────────

export interface CreateApiTestInput {
  repositoryId: string;
  name: string;
  definition: ApiTestDefinition;
  functionalAreaId?: string | null;
}

export interface UpdateApiTestInput {
  /** Absent leaves the name unchanged. */
  name?: string;
  definition: ApiTestDefinition;
}

/** A reference to a test. An id, not a row — same shape as `ctx.tests`. */
export interface ApiTestRef {
  id: string;
}

// ── AI preflight ────────────────────────────────────────────────────────────

export interface ApiTestHost {
  /**
   * Issue one SSRF-guarded outbound request and read the whole response.
   *
   * The guard is not optional and not visible: the host validates the URL,
   * re-validates the resolved IP at connect time (DNS-rebinding defence) and
   * enforces `timeoutMs`. `url` is whatever the tenant typed, resolved against
   * the repo's base URL by the plugin — so it must be treated as hostile.
   */
  fetchGuarded(url: string, req: GuardedRequest): Promise<GuardedResponse>;

  /**
   * Persist a new API test. Rejects unless the session holds `tests:write` on
   * the repo. The host renders the redacted `tests.code` column itself.
   */
  createTest(input: CreateApiTestInput): Promise<ApiTestRef>;

  /**
   * Update an API test's definition, writing a `manual_edit` version snapshot.
   * Rejects unless the session owns the test.
   */
  updateTest(id: string, input: UpdateApiTestInput): Promise<void>;

  /**
   * Can the repo's configured AI provider be held to a JSON response?
   *
   * False for `claude-cli`, which streams prose. The generator refuses up front
   * with a specific message rather than letting a JSON parse fail three
   * seconds and one billable call later. A one-field widening of
   * `ctx.ai.budget()` the day core wants it.
   */
  aiSupportsJson(repositoryId: string): Promise<boolean>;

  /**
   * One-line description of the repo's detected API layer (REST/GraphQL/tRPC),
   * from codebase intelligence, for grounding the generator prompt.
   *
   * Best-effort: resolves `null` for a repo with no connected SCM account, and
   * never throws — a missing hint degrades the prompt, it does not fail the
   * request.
   */
  apiLayerHint(repositoryId: string): Promise<string | null>;
}
