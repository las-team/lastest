# Auth Sub-Zone Separation Report

## Current State

The architecture already has partial separation in place:

- **Main app**: `src/` on port 3000
- **Auth sub-zone**: `packages/cloud-auth/` on port 3001
- **Shared**: `packages/shared/` (`@lastest/shared`)

The `next.config.ts:92-118` already rewrites `/login`, `/register`, `/forgot-password`, `/reset-password`, `/invite` to `${AUTH_ZONE}`. The main app's `src/proxy.ts` middleware redirects unauthenticated requests to `/login`.

## What Needs to Move to the Auth Sub-Zone

### 0. Drizzle ORM Setup

- **Target**: `packages/cloud-auth/src/lib/db/` — Drizzle schema + query functions for auth/user/team tables only
- **Note**: The main app's `src/lib/db/queries.ts` has 100+ functions spanning both auth and platform tables. After this split, it becomes two files:
  - `packages/cloud-auth/src/lib/db/queries.ts` — auth/user/team tables (`users`, `sessions`, `oauth_accounts`, `verification`, `password_reset_tokens`, `email_verification_tokens`, `user_invitations`, `user_consents`, `teams`, `roles`, `team_members`)
  - `src/lib/db/queries.ts` — platform tables only (`builds`, `tests`, `runs`, `specs`, `repos`, `coverage`, etc.)

### 1. BetterAuth Server Configuration (`src/lib/auth/auth.ts`)

- **Current**: `betterAuth()` instance lives in the main app, directly accessing `@/lib/db/schema`, `@/lib/db`, `@/lib/email`
- **Target**: Move the `betterAuth()` server instance to `packages/cloud-auth/src/lib/auth-server.ts`
- **Why**: The auth server is the single source of truth for session creation, OAuth flows, password hashing. It should not be compiled into every main-app route.
- **Note**: `packages/cloud-auth` already has `better-auth` as a dependency but doesn't yet host the server instance.

### 2. Password Hashing (`src/lib/auth/password.ts` / embedded in `auth.ts:106-114`)

- **Current**: Argon2id hashing inline in `auth.ts`
- **Target**: Move to `packages/cloud-auth/src/lib/auth/password.ts`
- **Why**: Pure utility, no dependencies on main app code

### 3. Email Sending (`src/lib/email/index.ts`)

- **Current**: `sendPasswordResetEmail`, `sendInvitationEmail` used by both main app and auth flows
- **Target**: Move to `packages/cloud-auth/src/lib/email.ts`
- **Why**: Password reset and invitation emails are auth-triggered events. The email templates reference auth URLs (e.g., `/reset-password?token=...`, `/invite?token=...`) which should point to the sub-zone.
- **Note**: `sendInvitationEmail` is used by `inviteUser` in `src/server/actions/users.ts`. Since that action moves to cloud-auth, the email function moves with it. Verify that `src/app/api/auth/reset-password/route.ts` and similar password routes also move to cloud-auth.

### 4. Auth UI Pages (Partial)

- **Already in cloud-auth**: `login/`, `register/`, `forgot-password/`, `reset-password/`, `invite/`, `consent/`
- **Gap**: The cloud-auth pages proxy server actions to the main app via REST (`/api/v1/auth/check-email`, `/api/v1/consent/record`). These should become direct DB calls instead.

### 5. Email Templates

- **Current**: Inline HTML in `src/lib/email/index.ts`
- **Target**: Move to `packages/cloud-auth/src/lib/email-templates/`
- **Why**: Tightly coupled to auth URL patterns (`/reset-password`, `/invite`)

### 6. Team/User/Role Management (`src/server/actions/users.ts`)

- **Functions**: `getUsers`, `inviteUser`, `updateUserRole`, `removeUser`, `cancelInvitation`, `resendInvitation`
- **Target**: Move to `packages/cloud-auth/src/server/actions/team-members.ts`
- **Why**: These are user lifecycle operations. Cloud-auth is the authoritative owner of user state.
- **Exposure**: Expose as REST endpoints under `/api/v1/team-members/` so the main app settings page can display team member lists.

### 7. Account Management (`src/server/actions/account.ts`)

- **Function**: `deleteMyAccount`
- **Target**: Move to `packages/cloud-auth/src/server/actions/account.ts`
- **Exposure**: REST endpoint `DELETE /api/v1/account`

### 8. Consent/Compliance (`src/server/actions/consent.ts`)

- **Functions**: `checkEmailExists`, `recordRegistrationConsent`, `updateMarketingConsent`, `getMyConsents`, `dismissConsentBanner`
- **Target**: Move to `packages/cloud-auth/src/server/actions/consent.ts`
- **Exposure**: REST endpoints `GET/POST/PATCH /api/v1/consents/*`

### 9. API Token Management (`src/server/actions/api-tokens.ts`)

- **Functions**: `listApiTokens`, `createApiToken`, `revokeApiToken`
- **Target**: Move to `packages/cloud-auth/src/server/actions/api-tokens.ts`
- **Why**: These are authorization credentials issued by the auth system (MCP server, VSCode extension tokens).
- **Exposure**: REST endpoints `GET/POST /api/v1/api-tokens/*`

### 10. Capabilities & Authorization (`src/lib/auth/capabilities.ts`, `src/lib/auth/ownership.ts`)

- **Current**: Role + plan + status → capability set mapping, entity ownership guards
- **Target**: Move to `packages/cloud-auth/src/lib/auth/`
- **Why**: Capabilities mapping (role+plan+status → permissions) is authz policy, not business logic. Ownership guards are authz enforcement. Both belong in cloud-auth.

### 11. Bearer Token Verification (`src/lib/auth/api-key.ts`)

- **Current**: `verifyBearerToken()` queries the DB directly for session tokens
- **Target**: Move to `packages/cloud-auth/src/lib/auth/api-key.ts`
- **Why**: Token verification is an auth operation. The main app should call the auth sub-zone to verify tokens.

### 12. Database Schema (`src/lib/db/schema.ts`)

- **Auth-related tables**: `users`, `sessions`, `oauth_accounts`, `verification`, `password_reset_tokens`, `email_verification_tokens`, `user_invitations`, `user_consents`
- **Target**: Move auth-specific schema into `packages/cloud-auth/src/lib/db/schema.ts` so they are tightly coupled with the auth server. If the main app needs data, promote a REST API and make the main app use that.

### 13. Middleware (`src/proxy.ts`)

- **Current**: Checks session cookie, redirects to `/login`, sets CSP nonces
- **Target**: Needs modification to:
  - Skip auth check for paths rewritten to AUTH_ZONE (already partially done via `PUBLIC_PATHS`)
  - Handle cross-zone cookie sharing (`sameSite=None` + `domain=.lastest.cloud`)
  - The CSP nonce injection should only apply to main-app responses, not auth-zone responses
- **After split**, `src/proxy.ts` should only handle:
  - CSP nonce injection for main-app responses
  - Redirect unauthenticated requests to `${AUTH_ZONE}/login` (not `/login`)
  - Forward auth cookies to the sub-zone
- The sub-zone itself needs its own lightweight middleware (or BetterAuth's built-in session handling) for its own routes.

## What Goes into `@lastest/shared`

### 1. Shared Types (`packages/shared/src/types/auth.ts` — new)

```typescript
export interface SessionUser { id: string; email: string; name: string; teamId: string | null; role: string; ... }
export interface SessionData { user: SessionUser; sessionId: string; team?: Team | null }
export type UserRole = 'owner' | 'admin' | 'member' | 'viewer'
export type Capability = 'tests:write' | 'recording:write' | ...
```

### 2. Shared Auth Client Config (`packages/shared/src/lib/auth-client-config.ts` — new)

- The `createAuthClient({})` call, provider configurations
- Currently duplicated in `src/lib/auth/auth-client.ts` and `packages/cloud-auth/src/lib/auth-client.ts` (both are empty right now)

### 3. Auth UI Components (`packages/shared/src/components/auth/` — partial)

- **Already exists**: `auth-brand-header.tsx`
- **Should add**: `login-form.tsx`, `register-form.tsx`, `social-buttons.tsx` (currently in cloud-auth pages inline)

## Cross-Zone Communication Pattern

The current pattern (cloud-auth → main app via `fetch` with cookie forwarding) is correct but ad-hoc. Standardize it:

| Cloud-Auth Action                            | Main App Endpoint (to be created) | Status      |
| -------------------------------------------- | --------------------------------- | ----------- |
| `checkEmailExists`                           | `POST /api/v1/auth/check-email`   | Implemented |
| `recordRegistrationConsent`                  | `POST /api/v1/consent/record`     | Implemented |
| `getInvitationByToken`                       | `GET /api/v1/invitations/:token`  | Implemented |
| Session resolution                           | `GET /api/v1/auth/session`        | Implemented |
| `getUsers` / `inviteUser` / `updateUserRole` | `GET/POST /api/v1/team-members/*` | Missing     |
| `deleteMyAccount`                            | `DELETE /api/v1/account`          | Missing     |
| `listApiTokens` / `createApiToken`           | `GET/POST /api/v1/api-tokens/*`   | Missing     |
| `getMyConsents` / `updateMarketingConsent`   | `GET/PATCH /api/v1/consents/*`    | Missing     |
| `verifyBearerToken` (for API clients)        | `GET /api/v1/auth/verify-token`   | Missing     |

## What Needs to Be Rewritten in the Main App

1. **Session resolution**: Replace `auth.api.getSession()` (which requires local `betterAuth` instance) with a call to `AUTH_ZONE/api/v1/auth/session`. The `getCurrentSession()` in `src/lib/auth/session.ts` currently depends on the local `auth` instance at line 16.

2. **OAuth Connect endpoints** (`src/app/api/connect/github/route.ts`, `src/app/api/connect/gitlab/route.ts`): These are platform features (connect GitHub repos, not GitHub login). Keep in main app.

3. **Google Sheets OAuth** (`src/app/api/auth/google-sheets/`): Platform feature. Keep in main app.

4. **`/oauth/authorize`** (`src/app/oauth/authorize/route.ts`): Launch token minting. Keep in main app — it's a platform OAuth flow, not user authentication.

5. **Onboarding** (`src/app/(onboarding)/`): Platform feature (select repo, connect GitHub, configure). Keep in main app. The cloud-auth `consent/` page handles ToS acceptance, then redirects to main app `/onboarding`.

6. **Settings page** (`src/app/(app)/settings/`): Contains auth-related sections (API tokens, delete account, team members) but is fundamentally a platform settings page. Keep in main app — it will call cloud-auth REST endpoints to display/manage this data.

## Summary: Migration Priority

| Priority | Item                                                  |
| -------- | ----------------------------------------------------- |
| **P0**   | Database (Drizzle setup in cloud-auth, split queries) |
| **P0**   | BetterAuth server instance                            |
| **P0**   | Session resolution proxy                              |
| **P0**   | Middleware update                                     |
| **P1**   | Email module                                          |
| **P1**   | Standardize REST endpoints (cross-zone API)           |
| **P2**   | Shared types                                          |
| **P2**   | Bearer token verification                             |
| **P3**   | Auth UI components                                    |

## Key Architecture Decision

The auth sub-zone is the single source of truth for everything authentication and authorization, including the database tables. The main app calls REST APIs to get data if it needs to.

NOTE: This is a long running refactor, record a memory of the todos, what's done etc. so another session can pick it up later.
NOTE:
