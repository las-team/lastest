import "server-only";

import { VaultProfiler } from "@lastest/coverage-model";
import type { VaultConnectorConfig } from "@/lib/db/schema";
import { connectorFetch } from "./fetch";
import { VAULT_OAUTH_SESSION_HOST } from "./definitions";

export interface VerifyResult {
  ok: boolean;
  /** Shown next to the connector on success — what we actually reached. */
  detail?: string;
  /** Already safe to persist and display. Never contains a secret. */
  error?: string;
}

const TIMEOUT_MS = 30_000;

export function vaultBaseUrl(config: VaultConnectorConfig): string {
  return `https://${config.vaultDns.replace(/^https?:\/\//i, "").replace(/\/+$/, "")}`;
}

/**
 * Verify a `vault-password` connector.
 *
 * Delegates to `VaultProfiler.testConnection()` rather than issuing its own
 * `POST /api/{version}/auth`. There must be exactly one Vault auth
 * implementation: the profiler's already handles the response shape and the
 * 401-re-auth behaviour, and a second one would drift from it silently.
 */
export async function verifyVaultPassword(
  config: VaultConnectorConfig,
  secrets: Record<string, string>,
): Promise<VerifyResult> {
  const username = secrets.username ?? "";
  const password = secrets.password ?? "";
  if (!username || !password) {
    return { ok: false, error: "User name and password are required" };
  }
  const profiler = new VaultProfiler({
    baseUrl: vaultBaseUrl(config),
    apiVersion: config.apiVersion,
    username,
    password,
    fetchImpl: connectorFetch,
    timeoutMs: TIMEOUT_MS,
  });
  const result = await profiler.testConnection();
  return result.ok
    ? { ok: true, detail: `Authenticated as ${username}` }
    : { ok: false, error: result.error };
}

/**
 * Verify a `vault-oauth` connector by exchanging an IdP bearer token for a
 * Vault session id.
 *
 * This is the SSO path, which is most of pharma: the Vault itself never sees a
 * password, and the token the customer pastes is issued by their own IdP. The
 * exchange happens at Veeva's fixed login host, not at the customer's Vault
 * DNS — a detail that is easy to get wrong and produces a confusing 404.
 */
export async function verifyVaultOAuth(
  config: VaultConnectorConfig,
  secrets: Record<string, string>,
): Promise<VerifyResult> {
  const token = secrets.idpToken ?? "";
  if (!token) return { ok: false, error: "An IdP access token is required" };
  if (!config.oauthProfileId) {
    return { ok: false, error: "An OAuth/OIDC profile id is required" };
  }

  const body = new URLSearchParams();
  if (config.oauthClientId) body.set("client_id", config.oauthClientId);
  // Scopes the session to this org's Vault rather than whatever the profile
  // defaults to.
  body.set("vaultDNS", config.vaultDns);

  try {
    const res = await connectorFetch(
      `${VAULT_OAUTH_SESSION_HOST}/auth/oauth/session/${encodeURIComponent(
        config.oauthProfileId,
      )}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: body.toString(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    const json = (await res.json().catch(() => ({}))) as {
      responseStatus?: string;
      sessionId?: string;
      vaultId?: string | number;
      errors?: Array<{ message?: string }>;
    };
    if (json.responseStatus !== "SUCCESS" || !json.sessionId) {
      const msg =
        json.errors
          ?.map((e) => e.message)
          .filter(Boolean)
          .join("; ") || `HTTP ${res.status}`;
      return { ok: false, error: `Vault OAuth exchange failed: ${msg}` };
    }
    return {
      ok: true,
      detail: json.vaultId
        ? `Session issued for Vault ${json.vaultId}`
        : "Session issued",
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * The vault id reported by an OAuth exchange, so `config.discoveredVaultId` can
 * be filled in without a second round trip. Returns undefined when the response
 * did not carry one — informational only, never load-bearing.
 */
export function extractVaultId(detail: string | undefined): string | undefined {
  const m = detail?.match(/Vault (\S+)$/);
  return m?.[1];
}
