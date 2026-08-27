/**
 * OAuth discovery documents for the remote MCP endpoint.
 *
 * An agent platform is handed one thing: the URL `https://<host>/api/mcp`. From
 * there it has to find out, unaided, that the resource is OAuth-protected, who
 * the authorization server is, and how to register itself. That chain is:
 *
 *   1. `POST /api/mcp` with no credential → 401 carrying
 *      `WWW-Authenticate: Bearer resource_metadata="…"` (RFC 9728).
 *   2. `GET /.well-known/oauth-protected-resource` → names this resource and
 *      its authorization server.
 *   3. `GET /.well-known/oauth-authorization-server` → RFC 8414 metadata with
 *      the authorize/token/register endpoints.
 *   4. `POST …/mcp/register` → RFC 7591 dynamic client registration.
 *
 * Both documents are built from the *request's* origin rather than a configured
 * base URL, so a self-hosted instance, a preview deployment and localhost all
 * advertise themselves correctly with no env var to set. The endpoints they
 * point at are the ones better-auth's `mcp` plugin mounts under `/api/auth`;
 * `discovery.test.ts` asserts the two stay in step.
 */
import { MCP_OAUTH_SCOPES } from "@/lib/mcp/tool-policy";

/** Where better-auth mounts the `mcp` plugin's OAuth endpoints. */
export const MCP_OAUTH_BASE = "/api/auth/mcp";

/**
 * Our own front door for authorization. It forwards to
 * `${MCP_OAUTH_BASE}/authorize` with `prompt=consent` pinned on, so a client
 * that never asks for consent still cannot get a token without the user seeing
 * what they are approving. See that route for why.
 */
export const MCP_AUTHORIZE_PATH = "/oauth/mcp/authorize";

/** The MCP resource this authorization server protects. */
export const MCP_RESOURCE_PATH = "/api/mcp";

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}${MCP_AUTHORIZE_PATH}`,
    token_endpoint: `${origin}${MCP_OAUTH_BASE}/token`,
    registration_endpoint: `${origin}${MCP_OAUTH_BASE}/register`,
    scopes_supported: [...MCP_OAUTH_SCOPES],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    // Public clients only — MCP clients cannot keep a secret, and PKCE is what
    // actually protects the code exchange.
    token_endpoint_auth_methods_supported: [
      "none",
      "client_secret_basic",
      "client_secret_post",
    ],
    // S256 only. `plain` is disabled in the plugin config for the same reason
    // OAuth 2.1 drops it.
    code_challenge_methods_supported: ["S256"],
    service_documentation:
      "https://github.com/las-team/lastest/wiki/MCP-Server",
  };
}

export function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}${MCP_RESOURCE_PATH}`,
    authorization_servers: [origin],
    // Only the two that mean anything here. `openid`/`profile`/`email`/
    // `offline_access` are accepted but say nothing about Lastest data.
    scopes_supported: ["lastest:read", "lastest:write"],
    bearer_methods_supported: ["header"],
    resource_documentation:
      "https://github.com/las-team/lastest/wiki/MCP-Server",
  };
}

/**
 * Discovery documents are fetched cross-origin by clients running in a browser,
 * and they are entirely public — they contain no user data and no secrets.
 */
export const DISCOVERY_HEADERS: Record<string, string> = {
  "content-type": "application/json",
  "cache-control": "public, max-age=3600",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers":
    "Content-Type, Authorization, MCP-Protocol-Version",
  "access-control-max-age": "86400",
};

export function discoveryResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: DISCOVERY_HEADERS });
}
