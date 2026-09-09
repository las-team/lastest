/**
 * Salesforce OAuth token exchange (§2.1.1).
 *
 * - JWT Bearer (default): RS256 assertion signed with `node:crypto`
 *   (`iss` = consumer key, `sub` = integration username, `aud` =
 *   `source.auth.aud` or, by default, the origin of `source.loginUrl` —
 *   Salesforce validates the audience against the token endpoint host, so a
 *   sandbox on `test.salesforce.com` must not send `login.salesforce.com`;
 *   `exp` = now + ≤ 3 min). No refresh token — the exchange is
 *   simply re-run when a request comes back `401 INVALID_SESSION_ID`.
 * - Client credentials: `grant_type=client_credentials` with
 *   `client_id`/`client_secret` form fields on the **My Domain** token URL.
 * - Username-password is forbidden (retired 20 Feb 2027) and rejected with a
 *   clear `auth`-class error before any network call.
 *
 * The response's `id` is the identity URL `…/id/{orgId}/{userId}`; the
 * 18-char org id is parsed from it (§2.1.1, `runs.source_org_id`).
 */
import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { getLogger } from "../logger";
import { to18 } from "../transform/ids";
import { SfdcApiError, parseErrorBody, toSfdcError } from "./errors";

export type FetchFn = typeof globalThis.fetch;

export interface SfdcJwtAuthConfig {
  kind: "jwt";
  clientId: string;
  username: string;
  /**
   * `aud` claim (login/test/My Domain login URL, §2.1.1). Default: the
   * origin of `loginUrl`, so sandboxes (`test.salesforce.com`) and My Domain
   * token endpoints get a matching audience without extra config.
   */
  aud?: string;
  privateKeyPath?: string;
  /** PEM private key text (wins over `privateKeyPath`). */
  privateKey?: string;
}

export interface SfdcClientCredentialsAuthConfig {
  kind: "clientCredentials";
  clientId: string;
  clientSecret: string;
}

/** Any other `kind` (e.g. `password`) is rejected at construction time. */
export type SfdcAuthConfig =
  | SfdcJwtAuthConfig
  | SfdcClientCredentialsAuthConfig
  | { kind: string; [k: string]: unknown };

export interface SfdcSession {
  accessToken: string;
  instanceUrl: string;
  /** Identity URL (`https://login.salesforce.com/id/{orgId}/{userId}`). */
  identityUrl: string;
  /** 18-char org id parsed from `identityUrl`. */
  orgId: string;
  /** 18-char user id parsed from `identityUrl`. */
  userId: string;
  tokenType: string;
  /** Epoch ms when the token was issued (local clock). */
  issuedAt: number;
  /** `POST /services/oauth2/token` `Date` header, when present (ISO). */
  serverDate?: string;
}

export interface SfdcAuthenticatorOptions {
  loginUrl: string;
  auth: SfdcAuthConfig;
  fetch?: FetchFn;
  /** Clock (epoch ms) — injectable for tests. */
  now?: () => number;
  /** JWT lifetime in seconds, capped at 180 (§2.1.1 `exp = now + ≤ 3 min`). */
  jwtLifetimeSec?: number;
  /** Token endpoint timeout (ms), default 60 000. */
  timeoutMs?: number;
}

export interface SfdcAuthenticator {
  readonly kind: "jwt" | "clientCredentials";
  /** Current session, authenticating on first use. */
  getSession(): Promise<SfdcSession>;
  /**
   * Re-run the token exchange. When `staleToken` is given and the current
   * session already has a different token (another caller refreshed
   * meanwhile) the current session is returned without a new exchange.
   */
  refresh(staleToken?: string): Promise<SfdcSession>;
  /** Drop the cached session (next `getSession()` re-authenticates). */
  invalidate(): void;
  /** Number of successful token exchanges so far. */
  readonly exchanges: number;
}

const JWT_MAX_LIFETIME_SEC = 180;
const FORBIDDEN_KINDS = new Set([
  "password",
  "usernamePassword",
  "username-password",
  "username_password",
]);

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

/** Build and sign the RS256 JWT bearer assertion (§2.1.1). */
export function buildJwtAssertion(input: {
  clientId: string;
  username: string;
  aud: string;
  privateKey: string;
  nowMs: number;
  lifetimeSec?: number;
}): string {
  const lifetime = Math.min(
    JWT_MAX_LIFETIME_SEC,
    Math.max(1, Math.floor(input.lifetimeSec ?? JWT_MAX_LIFETIME_SEC)),
  );
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: input.clientId,
      sub: input.username,
      aud: input.aud,
      exp: Math.floor(input.nowMs / 1000) + lifetime,
    }),
  );
  const signingInput = `${header}.${claims}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  let signature: Buffer;
  try {
    signature = signer.sign(input.privateKey);
  } catch (e) {
    throw new SfdcApiError(
      `Cannot sign JWT assertion with the configured private key: ${e instanceof Error ? e.message : String(e)}`,
      { errorCode: "INVALID_PRIVATE_KEY", errorClass: "auth", cause: e },
    );
  }
  return `${signingInput}.${base64url(signature)}`;
}

/** Decode the (unverified) claims of a JWT — test/diagnostic helper. */
export function decodeJwtClaims(jwt: string): Record<string, unknown> {
  const part = jwt.split(".")[1] ?? "";
  const pad = part.length % 4 === 0 ? "" : "=".repeat(4 - (part.length % 4));
  return JSON.parse(
    Buffer.from(
      part.replace(/-/g, "+").replace(/_/g, "/") + pad,
      "base64",
    ).toString("utf8"),
  ) as Record<string, unknown>;
}

/** Parse `https://login.salesforce.com/id/{orgId}/{userId}` → 18-char ids. */
export function parseIdentityUrl(identityUrl: string): {
  orgId: string;
  userId: string;
} {
  const m =
    /\/id\/([A-Za-z0-9]{15,18})\/([A-Za-z0-9]{15,18})\/?(?:[?#].*)?$/.exec(
      identityUrl,
    );
  if (!m)
    throw new SfdcApiError(
      `Cannot parse org id from identity URL: ${identityUrl}`,
      { errorCode: "INVALID_IDENTITY_URL", errorClass: "auth" },
    );
  return { orgId: to18(m[1]), userId: to18(m[2]) };
}

function isMyDomain(loginUrl: string): boolean {
  try {
    const host = new URL(loginUrl).hostname.toLowerCase();
    return host !== "login.salesforce.com" && host !== "test.salesforce.com";
  } catch {
    return false;
  }
}

/**
 * Default JWT `aud`: the origin of the configured login URL (§2.1.1 —
 * `login` | `test` | My Domain). Falls back to the trimmed URL when it does
 * not parse (the token exchange will then surface the real error).
 */
export function defaultAudience(loginUrl: string): string {
  try {
    return new URL(loginUrl).origin;
  } catch {
    return loginUrl.replace(/\/+$/, "");
  }
}

function tokenUrl(loginUrl: string): string {
  return `${loginUrl.replace(/\/+$/, "")}/services/oauth2/token`;
}

/**
 * Create the authenticator. Validation of the auth *kind* happens here so a
 * forbidden flow fails at construction, before any network I/O.
 */
export function createSfdcAuthenticator(
  opts: SfdcAuthenticatorOptions,
): SfdcAuthenticator {
  const log = getLogger("Sfdc");
  const fetchFn: FetchFn =
    opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const now = opts.now ?? (() => Date.now());
  const auth = opts.auth;

  if (FORBIDDEN_KINDS.has(auth.kind) || "password" in auth) {
    throw new SfdcApiError(
      `source.auth.kind '${auth.kind}' is not supported: the OAuth username-password flow is retired (blocked on new orgs, removed 20 Feb 2027). Use kind: jwt (JWT Bearer) or kind: clientCredentials (§2.1.1).`,
      { errorCode: "UNSUPPORTED_AUTH_FLOW", errorClass: "auth" },
    );
  }
  if (auth.kind !== "jwt" && auth.kind !== "clientCredentials") {
    throw new SfdcApiError(
      `source.auth.kind '${auth.kind}' is unknown; expected jwt or clientCredentials`,
      { errorCode: "UNSUPPORTED_AUTH_FLOW", errorClass: "auth" },
    );
  }
  if (auth.kind === "clientCredentials" && !isMyDomain(opts.loginUrl)) {
    throw new SfdcApiError(
      `Client-credentials flow must use the org's My Domain token URL (source.loginUrl = https://<mydomain>.my.salesforce.com), not ${opts.loginUrl} (§2.1.1)`,
      {
        errorCode: "CLIENT_CREDENTIALS_REQUIRES_MY_DOMAIN",
        errorClass: "auth",
      },
    );
  }
  if (auth.kind === "jwt" && !auth.privateKey && !auth.privateKeyPath) {
    throw new SfdcApiError(
      "JWT bearer auth needs source.auth.privateKey or source.auth.privateKeyPath",
      { errorCode: "MISSING_PRIVATE_KEY", errorClass: "auth" },
    );
  }

  const url = tokenUrl(opts.loginUrl);
  const timeoutMs = opts.timeoutMs ?? 60_000;
  let session: SfdcSession | null = null;
  let inflight: Promise<SfdcSession> | null = null;
  let privateKeyCache: string | null = null;
  let exchanges = 0;

  async function loadPrivateKey(cfg: SfdcJwtAuthConfig): Promise<string> {
    if (privateKeyCache) return privateKeyCache;
    if (cfg.privateKey) privateKeyCache = cfg.privateKey;
    else {
      try {
        privateKeyCache = await readFile(cfg.privateKeyPath as string, "utf8");
      } catch (e) {
        throw new SfdcApiError(
          `Cannot read source.auth.privateKeyPath (${cfg.privateKeyPath}): ${e instanceof Error ? e.message : String(e)}`,
          { errorCode: "MISSING_PRIVATE_KEY", errorClass: "auth", cause: e },
        );
      }
    }
    return privateKeyCache;
  }

  async function formBody(): Promise<URLSearchParams> {
    if (auth.kind === "jwt") {
      const cfg = auth as SfdcJwtAuthConfig;
      const assertion = buildJwtAssertion({
        clientId: cfg.clientId,
        username: cfg.username,
        aud: cfg.aud ?? defaultAudience(opts.loginUrl),
        privateKey: await loadPrivateKey(cfg),
        nowMs: now(),
        lifetimeSec: opts.jwtLifetimeSec,
      });
      return new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      });
    }
    const cfg = auth as SfdcClientCredentialsAuthConfig;
    return new URLSearchParams({
      grant_type: "client_credentials",
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    });
  }

  async function exchange(): Promise<SfdcSession> {
    const body = await formBody();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    if (typeof timer === "object" && "unref" in timer) timer.unref();
    let res: Response;
    try {
      res = await fetchFn(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: body.toString(),
        signal: controller.signal,
      });
    } catch (e) {
      throw toSfdcError(e, { method: "POST", url });
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const errors = parseErrorBody(json ?? text);
      const code = errors[0]?.errorCode ?? `HTTP_${res.status}`;
      const desc = errors[0]?.message ?? text.slice(0, 300);
      let hint = "";
      if (/hasn't approved this consumer|has not approved/i.test(desc))
        hint =
          " — pre-authorize the integration user on the connected app (profile/permission set) or complete the one-time OAuth approval.";
      else if (/audience/i.test(desc))
        hint =
          " — check source.auth.aud (login.salesforce.com, test.salesforce.com or the My Domain login URL; Spring '26 sandboxes may reject test.salesforce.com).";
      else if (/expired|exp\b/i.test(desc) && auth.kind === "jwt")
        hint = " — the JWT exp claim is rejected; check the host clock.";
      throw new SfdcApiError(
        `Salesforce token exchange failed (${code}): ${desc}${hint}`,
        {
          status: res.status,
          errorCode: code,
          errors,
          errorClass:
            res.status >= 500 || res.status === 429 ? "retryable" : "auth",
          method: "POST",
          url,
        },
      );
    }
    const o = (json ?? {}) as Record<string, unknown>;
    if (
      typeof o.access_token !== "string" ||
      typeof o.instance_url !== "string"
    ) {
      throw new SfdcApiError(
        "Salesforce token response lacks access_token / instance_url",
        {
          status: res.status,
          errorCode: "INVALID_TOKEN_RESPONSE",
          errorClass: "auth",
          method: "POST",
          url,
        },
      );
    }
    const identityUrl = typeof o.id === "string" ? o.id : "";
    const { orgId, userId } = parseIdentityUrl(identityUrl);
    exchanges++;
    const s: SfdcSession = {
      accessToken: o.access_token,
      instanceUrl: o.instance_url.replace(/\/+$/, ""),
      identityUrl,
      orgId,
      userId,
      tokenType: typeof o.token_type === "string" ? o.token_type : "Bearer",
      issuedAt: now(),
      serverDate: res.headers.get("date") ?? undefined,
    };
    log.info(
      { orgId, instanceUrl: s.instanceUrl, flow: auth.kind, exchanges },
      "Salesforce session established",
    );
    return s;
  }

  function runExchange(): Promise<SfdcSession> {
    if (inflight) return inflight;
    inflight = exchange()
      .then((s) => {
        session = s;
        return s;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  }

  return {
    kind: auth.kind,
    get exchanges() {
      return exchanges;
    },
    async getSession() {
      return session ?? runExchange();
    },
    async refresh(staleToken?: string) {
      if (
        staleToken !== undefined &&
        session &&
        session.accessToken !== staleToken
      )
        return session; // someone else already refreshed
      if (inflight) return inflight;
      session = null;
      return runExchange();
    },
    invalidate() {
      session = null;
    },
  };
}
