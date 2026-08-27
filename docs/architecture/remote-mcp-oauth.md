# Remote MCP: Streamable HTTP + OAuth 2.1

What this is: `/api/mcp` is a Streamable HTTP MCP endpoint that a third party
can connect to knowing nothing but its URL. It exists so agent platforms —
Salesforce Agentforce first, but the same machinery serves ChatGPT and Claude
web — can use Lastest without a human generating and pasting an API key, and
without those platforms getting the same privileges that key carries.

It is Phases 1 and 2 of `agentexchange-listing-plan.md`.

## The shape

```
agent platform                        Lastest
     │
     │ 1. POST /api/mcp  (no credential)
     │──────────────────────────────────────▶  401
     │◀──── WWW-Authenticate: Bearer resource_metadata="…"      (RFC 9728)
     │
     │ 2. GET /.well-known/oauth-protected-resource
     │◀──── { resource: …/api/mcp, authorization_servers: [origin] }
     │
     │ 3. GET /.well-known/oauth-authorization-server            (RFC 8414)
     │◀──── { authorization_endpoint: /oauth/mcp/authorize, … }
     │
     │ 4. POST /api/auth/mcp/register                            (RFC 7591)
     │◀──── { client_id }
     │
     │ 5. browser → /oauth/mcp/authorize → /login → /oauth/consent
     │◀──── code (PKCE S256)
     │
     │ 6. POST /api/auth/mcp/token
     │◀──── { access_token, refresh_token, scope }
     │
     │ 7. POST /api/mcp  Authorization: Bearer <access_token>
     │◀──── the tool subset that scope allows
```

Steps 4-6 are better-auth's `mcp` plugin (`src/lib/auth/auth.ts`), backed by
three tables in `packages/db/src/schema/identity.ts`
(`oauth_applications`, `oauth_access_tokens`, `oauth_consents`).

## The four decisions worth knowing

### 1. An OAuth token is not an API key

They resolve to different **access levels**, and the difference is the point.

| Credential | Level | Sees |
| --- | --- | --- |
| API key (`sessions.kind='api'`) | `full` | Everything |
| OAuth + `lastest:write` | `write` | Read, run tests, author tests, approve/reject diffs |
| OAuth, anything else | `read` | Read only |

No scope grants `full`. Deletes, share revocation and publishing a public
`/r/<slug>` link are unreachable over OAuth at any scope — not gated, *absent*.

The table lives in `packages/mcp-server/src/policy.ts`, next to the tools it
describes, and is applied at registration time by `defineTool()`: a restricted
caller's `lastest_test` advertises `action: "list" | "get"` and nothing else.
Filtering the schema rather than rejecting the call matters because an agent
picks tools by reading schemas — one that can see `delete` keeps trying it.
`policy.test.ts` fails when the table stops describing the real tool surface.

Observed end-to-end: 16 tools at `read`, 27 at `write`, 29 at `full`.

### 2. OAuth tokens are not accepted by `/api/v1`

The MCP tools do their work by calling this app's own REST API, which keeps one
implementation of every ownership and capability guard. An API-key caller's key
is simply reused for those loopback calls.

An OAuth caller has no key, and teaching `/api/v1` to accept access tokens would
undo everything above: a `lastest:read` token that authenticates directly
against the REST API can delete a test, because the tool policy lives one layer
up. So `verifyBearerToken()` does not know about OAuth tokens at all.

Instead `/api/mcp` mints a **loopback grant** (`src/lib/mcp/loopback-grant.ts`):
an HMAC-signed, 60-second credential naming a user, created on the server, spent
on the server, never present in any response. Same construction and the same
fail-closed rule as the EB stream grant — no `ENCRYPTION_KEY`, no grants, 503.

### 3. Consent is not optional

better-auth only shows its consent screen when the client sends
`prompt=consent`, and many MCP clients don't. Combined with anonymous dynamic
client registration, that would let an app that registered itself seconds ago
get a token the moment a signed-in user follows a link, silently.

So the advertised `authorization_endpoint` is **ours** —
`src/app/oauth/mcp/authorize/route.ts` — which pins `prompt=consent` on and
forwards everything else untouched. The consent screen
(`src/app/oauth/consent/`) names the client, shows its `client_id` (a
dynamically registered client can call itself anything), lists what the grant
allows in terms of consequences, and lists what it will never allow.

### 4. Discovery uses the public origin, the loopback uses the internal one

Every deployment runs behind `scripts/front-proxy.js`, so `req.url` inside a
route is `http://127.0.0.1:3001`. Advertising that as the issuer points every
client at an unreachable host. The discovery documents and the
`WWW-Authenticate` header therefore use `getPublicUrl(req)`; the loopback
`LastestClient` deliberately keeps `req.url`'s origin, so tool calls don't take
a pointless round trip back out through the proxy.

## Files

| Path | Role |
| --- | --- |
| `src/app/api/mcp/route.ts` | The endpoint |
| `src/lib/mcp/remote-auth.ts` | Credential → access level |
| `src/lib/mcp/tool-policy.ts` | Scope → access level; the advertised scope list |
| `src/lib/mcp/loopback-grant.ts` | Server-only credential for `/api/v1` calls |
| `src/lib/mcp/discovery.ts` | RFC 8414 / RFC 9728 documents |
| `src/app/.well-known/oauth-*/` | Where those documents are served |
| `src/app/oauth/mcp/authorize/route.ts` | Consent-forcing front door |
| `src/app/oauth/consent/` | Consent screen |
| `packages/mcp-server/src/policy.ts` | The access-level table |
| `packages/mcp-server/src/http-server.ts` | Standalone `--transport http` server |

## Gotchas

- **better-auth's `getMcpSession()` does not check token expiry.** It looks the
  row up and returns it. `remote-auth.ts` checks `accessTokenExpiresAt` itself;
  without that a token works forever. Covered by `remote-auth.test.ts`.
- **`/api/mcp` and `/.well-known/` must be in `PUBLIC_PATHS`** in `src/proxy.ts`.
  They are bearer-only or anonymous and carry no cookie, so otherwise the proxy
  answers with a 307 to `/login` and the whole discovery chain dies on step 1.
- **`@lastest/mcp-server` resolves to `dist/`** from the app. Changing the
  package's types means running `pnpm --filter @lastest/mcp-server build` before
  the app typechecks.
- **Rotating `ENCRYPTION_KEY` invalidates in-flight loopback grants.** They live
  60 seconds, so this is a non-event, but it is the same key as everything else.

## Not built

- No UI for reviewing or revoking OAuth connections.
  `getOAuthConnectionsForUser()` exists in `src/lib/db/queries/auth.ts` for it;
  Settings → Runners & API Access is the obvious home.
- No token-endpoint rate limiting beyond whatever fronts the app.
- Registration is anonymous, per RFC 7591 and per what agent platforms expect.
  Nothing prunes `oauth_applications` rows that never completed a flow.
