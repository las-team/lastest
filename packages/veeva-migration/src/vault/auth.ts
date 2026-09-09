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
import { getLogger, type Logger } from "../logger";
import { toVaultError, VaultRequestError } from "./errors";
import type { VaultHttp } from "./http";
import { defaultSleep, type SleepFn } from "./retry";
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
  now?: () => number;
  sleep?: SleepFn;
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
  /** `users/me` as validated after the last auth (undefined for access-token sessions until `me()` runs). */
  user: VaultUser | undefined;
  versionFallback: VersionFallbackInfo | undefined;
  /** Timestamps of auth calls inside the guard window. */
  private authCalls: number[] = [];
  private keepAliveTimer: ReturnType<typeof setInterval> | undefined;
  private inflight: Promise<VaultSession> | undefined;
  private readonly now: () => number;
  private readonly sleep: SleepFn;
  private readonly log: Logger;
  private readonly rate: { max: number; windowMs: number };
  private readonly keepAliveIntervalMs: number;

  constructor(private readonly opts: VaultAuthOptions) {
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? defaultSleep;
    this.log = opts.logger ?? getLogger("Vault", { vault_dns: opts.vaultDns });
    this.rate = opts.authRateLimit ?? { max: 20, windowMs: 60_000 };
    this.keepAliveIntervalMs = opts.keepAliveIntervalMs ?? 10 * 60_000;
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

  /** Force a new session (INVALID_SESSION_ID, post-downtime). Concurrent callers share one call. */
  async reauthenticate(): Promise<VaultSession> {
    if (this.inflight) return this.inflight;
    this.inflight = this.doAuthenticate().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  private async doAuthenticate(): Promise<VaultSession> {
    const { auth } = this.opts;
    const http = this.opts.http;
    let session: VaultSession;
    switch (auth.kind) {
      case "password":
        session = await this.passwordAuthWithFallback(auth);
        break;
      case "oauth":
        session = await this.oauthAuth(auth);
        break;
      case "accessToken":
        session = await this.accessTokenAuth();
        break;
    }
    this.session = session;
    if (auth.kind !== "accessToken") {
      // §2.5.1: "Validate Session User" right after auth — confirms the session
      // and the migration user's id; a mismatch is only logged here (preflight
      // raises VT_MIGRATION_USER_MISMATCH against target.migrationUserId).
      const me = await this.me();
      this.user = me;
      if (me.id && session.userId && me.id !== session.userId)
        this.log.warn(
          { session_user_id: session.userId, me_user_id: me.id },
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

  private async passwordAuth(auth: {
    username: string;
    password: string;
  }): Promise<VaultSession> {
    await this.guardAuthCall();
    const http = this.opts.http;
    const form = new URLSearchParams({
      username: auth.username,
      password: auth.password,
      vaultDNS: this.opts.vaultDns,
    });
    const res = await http.request({
      method: "POST",
      path: "/auth",
      body: form,
      noAuth: true,
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
      this.session = session;
      let available: string[] = [];
      try {
        available = await this.availableVersions();
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
    await this.guardAuthCall();
    const http = this.opts.http;
    const host = auth.loginHost ?? "login.veevavault.com";
    const form = new URLSearchParams({ vaultDNS: this.opts.vaultDns });
    if (auth.clientId) form.set("client_id", auth.clientId);
    const res = await http.request({
      method: "POST",
      path: `https://${host}/auth/oauth/session/${encodeURIComponent(auth.profileId)}`,
      body: form,
      noAuth: true,
      headers: { Authorization: `Bearer ${auth.idpToken}` },
    });
    return sessionFromAuthResponse(
      res.body,
      this.opts.vaultDns,
      http.apiVersion,
    );
  }

  private async accessTokenAuth(): Promise<VaultSession> {
    // No auth call: the token is the credential. Validate it with users/me.
    const http = this.opts.http;
    const me = await this.me();
    this.user = me;
    const vaultId = this.opts.configuredVaultId ?? 0;
    if (!vaultId)
      this.log.warn(
        "accessToken auth carries no vaultId — set target.vaultId to enable vault_membership composition",
      );
    return {
      sessionId: "",
      userId: me.id,
      vaultId,
      vaultDns: this.opts.vaultDns,
      vaultIds: [],
      apiVersion: http.apiVersion,
    };
  }

  /** `GET /objects/users/me` — validates the session and returns the migration user. */
  async me(): Promise<VaultUser> {
    const res = await this.opts.http.request({
      method: "GET",
      path: "/objects/users/me",
    });
    return parseUserEnvelope(res.body);
  }

  /** `GET https://{vaultDNS}/api` (needs a session). */
  async availableVersions(): Promise<string[]> {
    const res = await this.opts.http.request({
      method: "GET",
      path: "/api",
      absolute: true,
    });
    return parseVersionsResponse(res.body);
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
