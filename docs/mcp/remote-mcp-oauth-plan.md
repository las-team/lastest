# Remote MCP + OAuth — Phase 2 plan (deferred)

> Status: **deferred / not scheduled.** The in-product **MCP create-mode** ships now using the
> existing stdio `@lastest/mcp-server` + bearer API key, which is fully accepted by every MCP
> client today. This doc captures the future "remote / hosted connector" build so we can pick it
> up when the decision gate below trips.

## When to build this (decision gate)

Build only when **either** is true:

- (a) Meaningful **cloud / multi-tenant** usage where users can't run `npx` or manage API keys themselves.
- (b) We want a **listable, zero-install connector** in the claude.ai and ChatGPT connector directories.

Until then, the shipped stdio + API-key path is the accepted standard and costs zero infra.

## Current state (works today, keep it)

- `@lastest/mcp-server` — **stdio** transport, bearer API key (`--api-key` → `Authorization: Bearer`),
  50 `lastest_*` tools that call the app's `/api/v1/*` REST endpoints.
- Accepted by: Claude Code (`claude mcp add`), Cursor, Windsurf, Cline (JSON config),
  Claude Desktop (local config). Custom-connector auth is **optional** on claude.ai today.
- Tool definitions live in `packages/mcp-server/src/server.ts`; HTTP client in
  `packages/mcp-server/src/client.ts`.

## What the spec / clients expect for _remote_ (2026)

- **Transport: Streamable HTTP** — a single endpoint handling POST (+ optional SSE stream).
  The old HTTP+SSE transport is deprecated. Clients negotiate `MCP-Protocol-Version: 2025-06-18`.
- **Auth: OAuth 2.1 + PKCE.** The resource server publishes **Protected Resource Metadata**
  (RFC 9728) at `/.well-known/oauth-protected-resource`; clients discover the authorization
  server, then register via **Dynamic Client Registration** (RFC 7591) or the newer
  **Client ID Metadata Documents** mechanism.
- **Claude Desktop** connects to remote servers only via **Settings → Connectors** (not local
  config); the Claude **API MCP connector** supports remote Streamable-HTTP/SSE servers, never stdio.

## Target architecture

1. **Shared tool registry.** Factor the 50 tool definitions out of `packages/mcp-server` into a
   shared module so both the stdio binary and a new in-app HTTP handler register identical tools.
2. **Remote endpoint.** Next.js route handler `POST /api/mcp` (App Router) speaking Streamable HTTP
   via the `@modelcontextprotocol/sdk` server + a Streamable-HTTP transport. Tools call the same
   query/action layer the REST API already uses.
3. **Auth — two tiers:**
   - **Tier A (lightweight, ~days):** the remote endpoint accepts the **existing bearer API key**
     (reuse `verifyBearerToken`, `src/lib/auth/api-key.ts`). Users paste **URL + key** into Claude
     Desktop Connectors / Cursor. No OAuth server. Unlocks "remote, no npx" with near-zero new auth code.
   - **Tier B (full OAuth, ~weeks):** real OAuth 2.1 / PKCE for one-click hosted connectors.
     **Reuse better-auth** (already wired in `src/lib/auth/auth.ts`) — evaluate its OIDC-provider /
     MCP plugin to act as the authorization server so we don't hand-roll token issuance. Add
     `/.well-known/oauth-protected-resource`, DCR or Client-ID-Metadata support, PKCE, a consent
     screen, and scope→team/repo mapping. Map issued tokens to the same session/team model used by
     `verifyBearerToken`.
4. **Scopes / tenancy:** tie tokens to `teamId` / `userId` (mirror `SessionData`); per-repo scoping optional.

## Client acceptance matrix (target)

| Client                        | stdio + key (now) | Tier A (URL + key) | Tier B (OAuth) |
| ----------------------------- | ----------------- | ------------------ | -------------- |
| Claude Code                   | ✅                | ✅                 | ✅ (best)      |
| Cursor / Windsurf / Cline     | ✅                | ✅                 | ✅             |
| Claude Desktop Connectors     | via local config  | ✅ paste URL + key | ✅ one-click   |
| claude.ai / ChatGPT directory | ❌                | ❌                 | ✅ required    |

## Effort / risk

- **Tier A:** small-medium (endpoint + transport + reuse bearer auth). Risk: Streamable-HTTP
  transport wiring, streaming long-running tool calls.
- **Tier B:** medium-large (OAuth provider, metadata endpoints, consent, DCR, security review).
  Risk: spec churn, security surface, redirect-URI registration for hosted connectors.
- **Self-hosted instances:** document that remote / OAuth needs a public HTTPS origin and a
  correctly-set `NEXT_PUBLIC_APP_URL`.

## Recommendation

Ship the Part-1 UI now (done). If/when the gate trips, do **Tier A first** (most of the remote
benefit for a fraction of the cost), then **Tier B** only for connector-directory distribution.

## Sources

- MCP authorization spec / Streamable HTTP & OAuth 2.1 adoption (2026):
  [mcp.directory](https://mcp.directory/blog/oauth-21-for-remote-mcp-servers-streamable-http-explained-2026),
  [stackoverflow.blog](https://stackoverflow.blog/2026/01/21/is-that-allowed-authentication-and-authorization-in-model-context-protocol/),
  [Zylos research](https://zylos.ai/research/2026-03-08-mcp-remote-evolution-streamable-http-enterprise-adoption).
- Claude custom connectors / auth optional / remote via Connectors:
  [support.claude.com](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp),
  [platform.claude.com (MCP connector)](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector),
  [code.claude.com/docs/mcp](https://code.claude.com/docs/en/mcp).
