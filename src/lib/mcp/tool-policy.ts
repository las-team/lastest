/**
 * OAuth scope → MCP tool-access level.
 *
 * The levels themselves (and what each one may call) live in
 * `@lastest/mcp-server`'s `policy.ts`, next to the tools they describe. This
 * module is only the mapping from the credential a caller presented to one of
 * those levels, plus the scope list the authorization server advertises.
 *
 * The rule is short on purpose:
 *
 *   API key                    → full   (the user's own credential, created by
 *                                        hand in Settings → Runners & API Access)
 *   OAuth + `lastest:write`    → write
 *   OAuth + `lastest:read`     → read
 *   OAuth with neither         → refused
 *
 * The last line matters. Returning `read` by default meant a client that asked
 * for `openid profile` — or one whose scope string failed to parse, since
 * `parseScopes` maps every falsy input to `[]` — got every build, test, diff
 * and coverage row the user can see, off a consent screen the user reads as
 * "sign in with Lastest". Data access now requires a scope that names it.
 *
 * There is no scope that grants `full`. Deleting a test, revoking a share and
 * publishing data to a public URL stay behind the user's own key, so no amount
 * of scope creep in a third-party agent platform's consent screen can reach
 * them. That is the property the AgentExchange security review cares about, and
 * it is enforced by construction rather than by a check somewhere.
 */
import type { ToolAccessLevel } from "@lastest/mcp-server";

/** Scope the authorization server will issue. Advertised in the AS metadata. */
export const MCP_OAUTH_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  /** Read builds, tests, diffs, coverage. The default. */
  "lastest:read",
  /** Additionally run tests, create/update tests, approve or reject diffs. */
  "lastest:write",
] as const;

export const MCP_WRITE_SCOPE = "lastest:write";
export const MCP_READ_SCOPE = "lastest:read";

/** Split a scope string (or the plugin's stored list) into scope values. */
export function parseScopes(
  scopes: string | string[] | null | undefined,
): string[] {
  if (!scopes) return [];
  const list = Array.isArray(scopes) ? scopes : scopes.split(/[\s,]+/);
  return list.map((s) => s.trim()).filter(Boolean);
}

/**
 * The tool surface an OAuth token with these scopes may see, or `null` when it
 * carries no Lastest scope at all and must be refused.
 *
 * `null` rather than a default level: "sign in with Lastest" and "read
 * everything in Lastest" are different consents, and only the second is
 * something a user can be said to have granted here.
 */
export function accessLevelForScopes(
  scopes: string | string[] | null | undefined,
): ToolAccessLevel | null {
  const list = parseScopes(scopes);
  if (list.includes(MCP_WRITE_SCOPE)) return "write";
  if (list.includes(MCP_READ_SCOPE)) return "read";
  return null;
}
