import "server-only";

import { createSign } from "node:crypto";
import type { SalesforceConnectorConfig } from "@/lib/db/schema";
import { connectorFetch } from "./fetch";
import type { VerifyResult } from "./vault-client";

const TIMEOUT_MS = 30_000;

/** Salesforce's JWT-bearer grant type, per RFC 7523. */
const JWT_GRANT = "urn:ietf:params:oauth:grant-type:jwt-bearer";

/**
 * Salesforce rejects an assertion whose `exp` is more than 5 minutes from its
 * own clock. Requesting 3 leaves room for a slow round trip without ever
 * looking like a replay.
 */
const JWT_LIFETIME_SECONDS = 180;

export interface TokenResult extends VerifyResult {
  /** Where API traffic must go — NOT the login URL. */
  instanceUrl?: string;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Turn a Salesforce OAuth error response into something a user can act on.
 *
 * `invalid_grant` is the single most common failure and says nothing by itself.
 * For the JWT flow it is almost always clock skew, which is invisible unless
 * someone tells you to look at it — so we do.
 */
function explainOAuthError(
  status: number,
  json: { error?: string; error_description?: string },
  isJwt: boolean,
): string {
  const code = json.error ?? `HTTP ${status}`;
  const desc = json.error_description ?? "";
  if (json.error === "invalid_grant" && isJwt) {
    return `${code}: ${desc || "the assertion was rejected"}. Check the server clock — the assertion's exp must be within 5 minutes of Salesforce time — and confirm the run-as user is pre-authorized for this app.`;
  }
  if (json.error === "invalid_client_id" || json.error === "invalid_client") {
    return `${code}: ${desc || "the consumer key or secret was not accepted"}. Note that Salesforce disabled new Connected App creation in Spring '26 — a new integration needs an External Client App.`;
  }
  return desc ? `${code}: ${desc}` : code;
}

async function requestToken(
  loginUrl: string,
  body: URLSearchParams,
  isJwt: boolean,
): Promise<TokenResult> {
  try {
    const res = await connectorFetch(
      `${loginUrl.replace(/\/+$/, "")}/services/oauth2/token`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: body.toString(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    const json = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      instance_url?: string;
      error?: string;
      error_description?: string;
    };
    if (!res.ok || !json.access_token) {
      return { ok: false, error: explainOAuthError(res.status, json, isJwt) };
    }
    return {
      ok: true,
      // The token itself is deliberately NOT returned. Verification only needs
      // to know the exchange worked; holding the token would mean deciding
      // where to store it, and a Salesforce access token is a bearer credential
      // with no reason to outlive this function.
      instanceUrl: json.instance_url,
      detail: json.instance_url
        ? `Token issued for ${json.instance_url}`
        : "Token issued",
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** OAuth 2.0 client credentials — server-to-server, no user session. */
export async function verifySalesforceClientCredentials(
  config: SalesforceConnectorConfig,
  secrets: Record<string, string>,
): Promise<TokenResult> {
  const secret = secrets.consumerSecret ?? "";
  if (!config.consumerKey || !secret) {
    return { ok: false, error: "Consumer key and secret are required" };
  }
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: config.consumerKey,
    client_secret: secret,
  });
  return requestToken(config.loginUrl, body, false);
}

/**
 * OAuth 2.0 JWT bearer — a signed assertion instead of a shared secret.
 *
 * `aud` must be the login host the assertion is presented to (production vs
 * sandbox), which is why it is derived from `loginUrl` rather than hardcoded.
 */
export async function verifySalesforceJwtBearer(
  config: SalesforceConnectorConfig,
  secrets: Record<string, string>,
): Promise<TokenResult> {
  const privateKey = secrets.privateKey ?? "";
  if (!config.consumerKey || !config.jwtSubject || !privateKey) {
    return {
      ok: false,
      error: "Consumer key, run-as user and private key are required",
    };
  }

  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: config.consumerKey,
      sub: config.jwtSubject,
      aud: config.loginUrl.replace(/\/+$/, ""),
      exp: Math.floor(Date.now() / 1000) + JWT_LIFETIME_SECONDS,
    }),
  );

  let assertion: string;
  try {
    const signer = createSign("RSA-SHA256");
    signer.update(`${header}.${claims}`);
    assertion = `${header}.${claims}.${base64url(signer.sign(privateKey))}`;
  } catch {
    // Deliberately not echoing the crypto error: its message can quote the key
    // material it failed to parse.
    return {
      ok: false,
      error:
        "The private key could not be used to sign. Expected an unencrypted RSA key in PEM format.",
    };
  }

  const body = new URLSearchParams({ grant_type: JWT_GRANT, assertion });
  return requestToken(config.loginUrl, body, true);
}
