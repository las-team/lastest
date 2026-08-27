/**
 * Who is calling `/api/mcp`, and how much of the tool surface they get.
 *
 * Two credentials are accepted, and they are not equivalent:
 *
 *   **API key** (`sessions.kind = 'api'`, created in Settings → Runners & API
 *   Access). This is the user themselves — a key they generated and pasted into
 *   their own agent. Access level `full`.
 *
 *   **OAuth 2.1 access token**, issued by the `mcp` plugin to a client that
 *   registered itself dynamically. This is a third party the user connected
 *   once, so it gets `read` or `write` depending on the scopes it was granted,
 *   and never `full`. See `./tool-policy.ts`.
 *
 * The OAuth branch mints a loopback grant rather than forwarding the access
 * token onward: `/api/v1` does not accept OAuth tokens, precisely so that the
 * scope-derived tool policy cannot be sidestepped by calling the REST API
 * directly. See `./loopback-grant.ts`.
 *
 * On failure the 401 carries a real `WWW-Authenticate` header pointing at the
 * protected-resource metadata (RFC 9728). That header is what lets an agent
 * platform discover the authorization server and start the OAuth dance on its
 * own — without it, "paste the URL and connect" cannot work.
 */
import type { ToolAccessLevel } from "@lastest/mcp-server";
import { auth } from "@/lib/auth/auth";
import { verifyBearerToken } from "@/lib/auth/api-key";
import { accessLevelForScopes } from "@/lib/mcp/tool-policy";
import { mintLoopbackGrant } from "@/lib/mcp/loopback-grant";

export interface McpCaller {
  /** Credential to put on loopback calls to `/api/v1`. */
  loopbackToken: string;
  accessLevel: ToolAccessLevel;
  userId: string;
  /** "api-key" or the OAuth client id — used for logging only. */
  client: string;
}

export type McpAuthResult =
  | { ok: true; caller: McpCaller }
  | { ok: false; status: number; detail: string };

/** RFC 9728 metadata URL for this deployment's MCP resource. */
export function protectedResourceMetadataUrl(origin: string): string {
  return `${origin}/.well-known/oauth-protected-resource`;
}

export function wwwAuthenticate(origin: string, error?: string): string {
  const parts = [
    `Bearer realm="lastest"`,
    `resource_metadata="${protectedResourceMetadataUrl(origin)}"`,
  ];
  if (error) parts.push(`error="${error}"`);
  return parts.join(", ");
}

/**
 * Resolve the request's credential.
 *
 * Order matters only for cost: an OAuth token lookup is one indexed read, an
 * API key is one indexed read plus a team fetch, and the two token spaces do
 * not overlap, so trying OAuth first costs a miss on the API-key path and
 * nothing else.
 */
export async function authenticateMcpRequest(
  req: Request,
): Promise<McpAuthResult> {
  const header = req.headers.get("authorization");
  if (!header?.toLowerCase().startsWith("bearer ")) {
    return {
      ok: false,
      status: 401,
      detail:
        "Missing Bearer token. Connect with OAuth, or create an API key in Settings → Runners & API Access.",
    };
  }
  const token = header.slice(7).trim();

  // --- OAuth 2.1 access token -------------------------------------------
  const oauth = await auth.api
    .getMcpSession({ headers: req.headers })
    .catch(() => null);
  if (oauth) {
    // better-auth's getMcpSession looks the token up but does NOT check its
    // expiry, so an expired token would otherwise keep working forever.
    const expiresAt = oauth.accessTokenExpiresAt
      ? new Date(oauth.accessTokenExpiresAt)
      : null;
    if (!expiresAt || expiresAt.getTime() <= Date.now()) {
      return {
        ok: false,
        status: 401,
        detail: "Access token expired. Refresh it and retry.",
      };
    }
    if (!oauth.userId) {
      return { ok: false, status: 401, detail: "Access token has no subject." };
    }
    const loopbackToken = mintLoopbackGrant(
      oauth.userId,
      oauth.clientId ?? "unknown",
    );
    if (!loopbackToken) {
      // No ENCRYPTION_KEY: fail closed rather than fall back to a credential
      // we cannot sign.
      return {
        ok: false,
        status: 503,
        detail:
          "This instance is not configured for OAuth MCP access (ENCRYPTION_KEY is unset).",
      };
    }
    return {
      ok: true,
      caller: {
        loopbackToken,
        accessLevel: accessLevelForScopes(oauth.scopes),
        userId: oauth.userId,
        client: oauth.clientId ?? "unknown",
      },
    };
  }

  // --- API key -----------------------------------------------------------
  const session = await verifyBearerToken(token);
  if (!session) {
    return {
      ok: false,
      status: 401,
      detail: "Invalid or expired credential.",
    };
  }
  return {
    ok: true,
    caller: {
      loopbackToken: token,
      accessLevel: "full",
      userId: session.user.id,
      client: "api-key",
    },
  };
}
