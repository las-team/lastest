/**
 * Vault authentication & session (§2.5.1).
 *
 *  - password: `POST /api/{version}/auth` (form `username`, `password`,
 *    `vaultDNS`) → verify `vaultId` / `vaultIds[].url` against the configured
 *    DNS (a user's default vault may differ);
 *  - accessToken (26R2+): `Authorization: Bearer {token}`, validated with
 *    `GET /objects/users/me`;
 *  - oauth: `POST https://login.veevavault.com/auth/oauth/session/{oath_oidc_profile_id}`
 *    (path spelling verbatim) with the IdP bearer token;
 *  - auth burst guard: ≤ 20 auth calls / min (waits, never exceeds);
 *  - wrong `apiVersion` fails auth with a MALFORMED_URL-style error → retry
 *    once on the previous release, then `GET /api` lists the versions offered
 *    (`versionFallback` is surfaced for preflight's VT_API_VERSION_MISSING);
 *  - keep-alive every 10 min while idle, `DELETE /session` at run end.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { getLogger, type Logger } from "../logger";
import { toVaultError, VaultRequestError } from "./errors";
import type { VaultHttp, VaultHttpResponse, VaultRequest } from "./http";
import {
  backoffDelayMs,
  DEFAULT_VAULT_RETRY_POLICY,
  defaultSleep,
  type RandomFn,
  type SleepFn,
  type VaultRetryPolicy,
} from "./retry";
import type { VaultSession, VaultUser } from "./types";

export type VaultAuthConfig =
  | { kind: "password"; username: string; password: string }
  | { kind: "accessToken"; token: string }
  | {
      kind: "oauth";
      /** `oath_oidc_profile_id` path segment (spelling verbatim, §2.5.1). */
      profileId: string;
      idpToken: string;
      clientId?: string;
      /** Defaults to `login.veevavault.com`. */
      loginHost?: string;
    };

export interface VaultAuthOptions {
  http: VaultHttp;
  vaultDns: string;
  auth: VaultAuthConfig;
  /** `target.vaultId` when configured — compared with the authenticated vault (warning only). */
  configuredVaultId?: number;
  /** Auth burst limit (default 20 / 60 s). */
  authRateLimit?: { max: number; windowMs: number };
  /** Keep-alive period (default 10 min). */
  keepAliveIntervalMs?: number;
  /** Retry auth once on the previous release when the configured version is rejected (default true). */
  versionFallback?: boolean;
  /**
   * Backoff for retryable auth failures (§8.1 defaults). Every attempt goes
   * through the auth burst guard; `API_LIMIT_EXCEEDED` waits a full guard
   * window instead of the jittered delay.
   */
  retry?: Partial<VaultRetryPolicy>;
  now?: () => number;
  sleep?: SleepFn;
  random?: RandomFn;
  logger?: Logger;
}

export interface VersionFallbackInfo {
  configured: string;
  effective: string;
  /** Versions `GET /api` actually offers (empty when the probe failed). */
  available: string[];
}

/** `v26.2 → v26.1`, `v26.1 → v25.3` (three releases a year). */
export function previousApiVersion(version: string): string {
  const m = /^v(\d+)\.(\d+)$/.exec(version);
  if (!m) return version;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  return minor > 1 ? `v${major}.${minor - 1}` : `v${major - 1}.3`;
}

/** Sort `v25.3, v26.1 …` ascending. */
export function sortApiVersions(versions: string[]): string[] {
  const key = (v: string) => {
    const m = /^v(\d+)\.(\d+)$/.exec(v);
    return m ? Number(m[1]) * 100 + Number(m[2]) : -1;
  };
  return [...versions].sort((a, b) => key(a) - key(b));
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return undefined;
  }
}

/** Parse the `users/me` envelope: `{users:[{user:{…}}]}` or `{user:{…}}` or `{data:{…}}`. */
export function parseUserEnvelope(body: unknown): VaultUser {
  const o = (body ?? {}) as Record<string, unknown>;
  let u: unknown = o.user ?? o.data;
  if (!u && Array.isArray(o.users) && o.users.length) {
    const first = o.users[0] as Record<string, unknown>;
    u = first.user ?? first;
  }
  if (!u || typeof u !== "object")
    throw new VaultRequestError(
      "UNEXPECTED_ERROR",
      "users/me returned no user object",
      { errorClass: "fatal" },
    );
  const user = u as Record<string, unknown>;
  const id = Number(user.id);
  return {
    ...user,
    id: Number.isFinite(id) ? id : 0,
    user_name__v: String(user.user_name__v ?? ""),
  };
}

/** Auth envelope → `VaultSession`, verifying the vault matches the configured DNS. */
export function sessionFromAuthResponse(
  body: unknown,
  vaultDns: string,
  apiVersion: string,
): VaultSession {
  const o = (body ?? {}) as Record<string, unknown>;
  const sessionId = typeof o.sessionId === "string" ? o.sessionId : "";
  if (!sessionId)
    throw new VaultRequestError(
      "UNEXPECTED_ERROR",
      "auth response carried no sessionId",
      { errorClass: "fatal" },
    );
  const vaultIdsRaw = Array.isArray(o.vaultIds) ? o.vaultIds : [];
  const vaultIds = vaultIdsRaw
    .filter((v) => v && typeof v === "object")
    .map((v) => {
      const e = v as Record<string, unknown>;
      return {
        id: Number(e.id),
        name: String(e.name ?? ""),
        url: String(e.url ?? ""),
      };
    });
  const vaultId = Number(o.vaultId);
  const dns = vaultDns.toLowerCase();
  const matching = vaultIds.find((v) => hostOf(v.url) === dns);
  if (vaultIds.length && !matching)
    throw new VaultRequestError(
      "VAULT_DNS_MISMATCH",
      `The authenticated user has no membership in ${vaultDns} (vaults: ${vaultIds.map((v) => hostOf(v.url) ?? v.url).join(", ")})`,
      { errorClass: "fatal" },
    );
  if (matching && Number.isFinite(vaultId) && matching.id !== vaultId)
    throw new VaultRequestError(
      "VAULT_DNS_MISMATCH",
      `Session was issued for vault ${vaultId}, but ${vaultDns} is vault ${matching.id} — the user's default vault differs; pass vaultDNS`,
      { errorClass: "fatal" },
    );
  return {
    sessionId,
    userId: Number(o.userId) || 0,
    vaultId: Number.isFinite(vaultId) ? vaultId : (matching?.id ?? 0),
    vaultDns,
    vaultIds,
    apiVersion,
  };
}

/** Parse `GET /api` → `{values: {"v26.2": "https://…/api/v26.2"}}`. */
export function parseVersionsResponse(body: unknown): string[] {
  const o = (body ?? {}) as Record<string, unknown>;
  const values = o.values;
  if (values && typeof values === "object" && !Array.isArray(values))
    return sortApiVersions(Object.keys(values as Record<string, unknown>));
  if (Array.isArray(values))
    return sortApiVersions(values.map((v) => String(v)));
  return [];
}

function isVersionRejection(err: VaultRequestError): boolean {
  return (
    err.type.startsWith("MALFORMED_URL") ||
    err.type.startsWith("METHOD_NOT_SUPPORTED") ||
    err.httpStatus === 404
  );
}

export class VaultAuth {
  session: VaultSession | undefined;
  /** `users/me` as validated by the last auth (set together with `session`, never before validation succeeded). */
  user: VaultUser | undefined;
  versionFallback: VersionFallbackInfo | undefined;
  /** Timestamps of auth calls inside the guard window. */
  private authCalls: number[] = [];
  private keepAliveTimer: ReturnType<typeof setInterval> | undefined;
  private inflight: Promise<VaultSession> | undefined;
  /** Set while `doAuthenticate()` runs, so a re-entrant `reauthenticate()` can be refused. */
  private readonly authScope = new AsyncLocalStorage<true>();
  private readonly now: () => number;
  private readonly sleep: SleepFn;
  private readonly random: RandomFn;
  private readonly log: Logger;
  private readonly rate: { max: number; windowMs: number };
  private readonly keepAliveIntervalMs: number;
  private readonly retryPolicy: VaultRetryPolicy;

  constructor(private readonly opts: VaultAuthOptions) {
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? defaultSleep;
    this.random = opts.random ?? Math.random;
    this.log = opts.logger ?? getLogger("Vault", { vault_dns: opts.vaultDns });
    this.rate = opts.authRateLimit ?? { max: 20, windowMs: 60_000 };
    this.keepAliveIntervalMs = opts.keepAliveIntervalMs ?? 10 * 60_000;
    this.retryPolicy = { ...DEFAULT_VAULT_RETRY_POLICY, ...opts.retry };
  }

  /** Value for the `Authorization` header (raw session id, or `Bearer` for access tokens). */
  authorization(): string | undefined {
    if (this.opts.auth.kind === "accessToken")
      return `Bearer ${this.opts.auth.token}`;
    return this.session?.sessionId;
  }

  /** Number of auth calls made inside the current guard window. */
  get authCallsInWindow(): number {
    this.pruneAuthCalls();
    return this.authCalls.length;
  }

  private pruneAuthCalls(): void {
    const cutoff = this.now() - this.rate.windowMs;
    this.authCalls = this.authCalls.filter((t) => t > cutoff);
  }

  /** Wait until an auth call is allowed by the 20/min guard, then record it. */
  private async guardAuthCall(): Promise<void> {
    this.pruneAuthCalls();
    if (this.authCalls.length >= this.rate.max) {
      const waitMs = this.authCalls[0] + this.rate.windowMs - this.now() + 1;
      this.log.warn(
        { code: "VT_AUTH_RATE_GUARD", wait_ms: waitMs, max: this.rate.max },
        "auth burst limit reached — waiting before re-authenticating",
      );
      await this.sleep(Math.max(1, waitMs));
      this.pruneAuthCalls();
    }
    this.authCalls.push(this.now());
  }

  /** Cached session; authenticates on first use. Concurrent callers share one auth call. */
  async authenticate(): Promise<VaultSession> {
    if (this.session) return this.session;
    return this.reauthenticate();
  }

  /**
   * Force a new session (INVALID_SESSION_ID, post-downtime). Concurrent
   * callers share one call. Called from inside the auth flow itself (a hook,
   * or a transport path that slipped past `noAuth`) it throws instead of
   * returning the in-flight promise — awaiting that would never settle.
   */
  async reauthenticate(): Promise<VaultSession> {
    if (this.authScope.getStore())
      throw new VaultRequestError(
        "INVALID_SESSION_ID",
        "re-authentication requested from inside the authentication flow — the freshly issued session was rejected",
        { errorClass: "fatal" },
      );
    if (this.inflight) return this.inflight;
    this.inflight = this.authScope
      .run(true, () => this.doAuthenticate())
      .catch((e: unknown) => {
        // The previous session (if any) triggered this re-auth, so it is
        // dead; forget it so the next authenticate() re-runs the full flow.
        this.session = undefined;
        this.user = undefined;
        throw e;
      })
      .finally(() => {
        this.inflight = undefined;
      });
    return this.inflight;
  }

  private async doAuthenticate(): Promise<VaultSession> {
    const { auth } = this.opts;
    const http = this.opts.http;
    let session: VaultSession;
    let user: VaultUser | undefined;
    switch (auth.kind) {
      case "password":
        session = await this.passwordAuthWithFallback(auth);
        break;
      case "oauth":
        session = await this.oauthAuth(auth);
        break;
      case "accessToken": {
        const r = await this.accessTokenAuth();
        session = r.session;
        user = r.user;
        break;
      }
    }
    if (auth.kind !== "accessToken") {
      // §2.5.1: "Validate Session User" right after auth — confirms the session
      // and the migration user's id; a mismatch is only logged here (preflight
      // raises VT_MIGRATION_USER_MISMATCH against target.migrationUserId).
      // The session is committed only once this succeeds: a session that
      // failed validation must never be handed out by authenticate().
      user = await this.fetchMe(session.sessionId);
      if (user.id && session.userId && user.id !== session.userId)
        this.log.warn(
          { session_user_id: session.userId, me_user_id: user.id },
          "users/me id differs from the auth response userId",
        );
    }
    if (
      this.opts.configuredVaultId !== undefined &&
      session.vaultId &&
      this.opts.configuredVaultId !== session.vaultId
    )
      this.log.warn(
        {
          configured_vault_id: this.opts.configuredVaultId,
          vault_id: session.vaultId,
        },
        "target.vaultId differs from the authenticated vault",
      );
    this.session = session;
    this.user = user;
    this.log.info(
      {
        vault_id: session.vaultId,
        user_id: session.userId,
        api_version: http.apiVersion,
        auth_kind: auth.kind,
      },
      "Vault session established",
    );
    return session;
  }

  /**
   * Send an auth call: every attempt passes the 20/min guard and is recorded;
   * retryable failures back off (§8.1), `API_LIMIT_EXCEEDED` — the auth burst
   * limit itself (§2.5.1) — waits a full guard window. The transport's own
   * retry loop is bypassed because it would re-send outside the guard.
   */
  private async authRequest(
    req: Omit<VaultRequest, "noAuth" | "retry" | "replayOnSessionError">,
  ): Promise<VaultHttpResponse> {
    const policy = this.retryPolicy;
    for (let attempt = 1; ; attempt++) {
      await this.guardAuthCall();
      try {
        return await this.opts.http.request({
          ...req,
          noAuth: true,
          retry: false,
        });
      } catch (raw) {
        const err = toVaultError(raw);
        if (!err.retryable || attempt >= policy.maxAttempts) throw err;
        let delayMs = err.type.toUpperCase().startsWith("API_LIMIT_EXCEEDED")
          ? this.rate.windowMs
          : backoffDelayMs(attempt, policy, this.random);
        if (err.retryAfterMs !== undefined)
          delayMs = Math.min(policy.capMs, Math.max(delayMs, err.retryAfterMs));
        this.log.warn(
          {
            code: "VT_AUTH_RETRY",
            error_type: err.type,
            attempt,
            delay_ms: delayMs,
            http_status: err.httpStatus,
          },
          "auth call failed with a retryable error — waiting before the next attempt",
        );
        await this.sleep(delayMs);
      }
    }
  }

  private async passwordAuth(auth: {
    username: string;
    password: string;
  }): Promise<VaultSession> {
    const http = this.opts.http;
    const form = new URLSearchParams({
      username: auth.username,
      password: auth.password,
      vaultDNS: this.opts.vaultDns,
    });
    const res = await this.authRequest({
      method: "POST",
      path: "/auth",
      body: form,
    });
    return sessionFromAuthResponse(
      res.body,
      this.opts.vaultDns,
      http.apiVersion,
    );
  }

  private async passwordAuthWithFallback(auth: {
    username: string;
    password: string;
  }): Promise<VaultSession> {
    const http = this.opts.http;
    const configured = http.apiVersion;
    try {
      return await this.passwordAuth(auth);
    } catch (raw) {
      const err = toVaultError(raw);
      if (
        this.opts.versionFallback === false ||
        !isVersionRejection(err) ||
        this.versionFallback
      )
        throw err;
      const fallback = previousApiVersion(configured);
      this.log.warn(
        { configured_version: configured, fallback_version: fallback },
        "auth rejected the configured apiVersion — retrying on the previous release",
      );
      http.apiVersion = fallback;
      let session: VaultSession;
      try {
        session = await this.passwordAuth(auth);
      } catch {
        http.apiVersion = configured;
        throw err;
      }
      let available: string[] = [];
      try {
        available = await this.fetchVersions(session.sessionId);
      } catch (e) {
        this.log.warn(
          { err: toVaultError(e).message },
          "could not list available API versions",
        );
      }
      this.versionFallback = { configured, effective: fallback, available };
      this.log.warn(
        {
          code: "VT_API_VERSION_MISSING",
          configured_version: configured,
          effective_version: fallback,
          available_versions: available,
        },
        "configured apiVersion is not offered by this vault",
      );
      return session;
    }
  }

  private async oauthAuth(auth: {
    profileId: string;
    idpToken: string;
    clientId?: string;
    loginHost?: string;
  }): Promise<VaultSession> {
    const http = this.opts.http;
    const host = auth.loginHost ?? "login.veevavault.com";
    const form = new URLSearchParams({ vaultDNS: this.opts.vaultDns });
    if (auth.clientId) form.set("client_id", auth.clientId);
    const res = await this.authRequest({
      method: "POST",
      path: `https://${host}/auth/oauth/session/${encodeURIComponent(auth.profileId)}`,
      body: form,
      headers: { Authorization: `Bearer ${auth.idpToken}` },
    });
    return sessionFromAuthResponse(
      res.body,
      this.opts.vaultDns,
      http.apiVersion,
    );
  }

  private async accessTokenAuth(): Promise<{
    session: VaultSession;
    user: VaultUser;
  }> {
    // No auth call: the token is the credential. Validate it with users/me —
    // an invalid token fails here with INVALID_SESSION_ID (no replay: there is
    // nothing to re-authenticate with).
    const http = this.opts.http;
    const user = await this.fetchMe(this.authorization() ?? "");
    const vaultId = this.opts.configuredVaultId ?? 0;
    if (!vaultId)
      this.log.warn(
        "accessToken auth carries no vaultId — set target.vaultId to enable vault_membership composition",
      );
    return {
      session: {
        sessionId: "",
        userId: user.id,
        vaultId,
        vaultDns: this.opts.vaultDns,
        vaultIds: [],
        apiVersion: http.apiVersion,
      },
      user,
    };
  }

  /**
   * Build a request issued by the auth flow itself: the `Authorization`
   * header is passed explicitly (the session is not committed yet) and
   * `noAuth` keeps the transport from re-entering `reauthenticate()`.
   */
  private authFlowRequest(
    req: Omit<VaultRequest, "noAuth" | "replayOnSessionError">,
    authorization: string | undefined,
  ): VaultRequest {
    if (authorization === undefined) return req;
    return {
      ...req,
      noAuth: true,
      headers: { ...req.headers, Authorization: authorization },
    };
  }

  private async fetchMe(authorization?: string): Promise<VaultUser> {
    const res = await this.opts.http.request(
      this.authFlowRequest(
        { method: "GET", path: "/objects/users/me" },
        authorization,
      ),
    );
    return parseUserEnvelope(res.body);
  }

  private async fetchVersions(authorization?: string): Promise<string[]> {
    const res = await this.opts.http.request(
      this.authFlowRequest(
        { method: "GET", path: "/api", absolute: true },
        authorization,
      ),
    );
    return parseVersionsResponse(res.body);
  }

  /** `GET /objects/users/me` — validates the session and returns the migration user (cheap health check). */
  async me(): Promise<VaultUser> {
    return this.fetchMe();
  }

  /** `GET https://{vaultDNS}/api` (needs a session). */
  async availableVersions(): Promise<string[]> {
    return this.fetchVersions();
  }

  /** `POST /keep-alive`. */
  async keepAlive(): Promise<void> {
    if (!this.session && this.opts.auth.kind !== "accessToken") return;
    await this.opts.http.request({ method: "POST", path: "/keep-alive" });
  }

  /** `DELETE /session`; stops the keep-alive timer and forgets the session. */
  async endSession(): Promise<void> {
    this.stopKeepAlive();
    if (!this.session) return;
    try {
      if (this.opts.auth.kind !== "accessToken")
        await this.opts.http.request({
          method: "DELETE",
          path: "/session",
          retry: false,
          replayOnSessionError: false,
        });
    } catch (e) {
      this.log.debug({ err: toVaultError(e).message }, "endSession failed");
    } finally {
      this.session = undefined;
      this.user = undefined;
    }
  }

  /** Start the 10-minute keep-alive timer (unref'd; idempotent). */
  startKeepAlive(): void {
    if (this.keepAliveTimer) return;
    this.keepAliveTimer = setInterval(() => {
      this.keepAlive().catch((e) =>
        this.log.warn({ err: toVaultError(e).message }, "keep-alive failed"),
      );
    }, this.keepAliveIntervalMs);
    (this.keepAliveTimer as { unref?: () => void }).unref?.();
  }

  stopKeepAlive(): void {
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    this.keepAliveTimer = undefined;
  }

  get keepAliveRunning(): boolean {
    return this.keepAliveTimer !== undefined;
  }

  /** Clear the cached session without calling Vault (e.g. after an unrecoverable error). */
  forgetSession(): void {
    this.session = undefined;
  }
}
