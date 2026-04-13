# 23 — API Tokens

## Summary

Long-lived Bearer tokens for programmatic access to the Lastest REST API (`/api/v1/*`). Used by the MCP server, VS Code extension, CI scripts, and cross-instance migration.

## How It Works

API tokens are stored as `sessions` rows with `kind='api'`. They authenticate via the `Authorization: Bearer lastest_api_*` header and go through `verifyBearerToken()` in the API route handler.

## Token Format

```
lastest_api_<64-hex-chars>
```

Generated with `crypto.randomBytes(32)`.

## UI

Settings → API Tokens section:

- Create token with a label (e.g. "MCP Server", "CI Pipeline")
- Token shown once on creation — not retrievable after
- List tokens with label, creation date, last-used date
- Revoke individual tokens

## Key Files

| Path | Role |
|------|------|
| `src/server/actions/api-tokens.ts` | `createApiToken()`, `listApiTokens()`, `revokeApiToken()` |
| `src/lib/auth/api-key.ts` | `verifyBearerToken()` — validates token against sessions table |
| `src/components/api-tokens/api-tokens-section.tsx` | Token management UI |
| `src/app/api/v1/[...slug]/route.ts` | Auth middleware checking session or Bearer token |
