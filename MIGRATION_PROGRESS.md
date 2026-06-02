# Auth Sub-Zone Migration — Progress Tracker

## Status: IN PROGRESS (P0 Phase — Ready for Review/Commit)

### Completed
- [x] Codebase exploration and analysis
- [x] P0.1: Database setup in cloud-auth (`packages/cloud-auth/src/lib/db/`)
  - `index.ts` — Drizzle connection (same DB as main app)
  - `schema.ts` — Auth tables only (users, sessions, oauth_accounts, verification, password_reset_tokens, email_verification_tokens, user_invitations, user_consents, teams)
  - `queries.ts` — Auth queries only (users, teams, sessions, invitations, consents, etc.)
- [x] P0.2: BetterAuth server instance in cloud-auth (`packages/cloud-auth/src/lib/auth-server.ts`)
  - Stripped main-app-specific hooks (GitHub sync, demo seeding, CRM sync)
  - Kept: password hashing, email/password reset, OAuth providers, session config, user creation hooks (team/invite)
- [x] P0.3: Email module in cloud-auth (`packages/cloud-auth/src/lib/email.ts`)
  - sendEmail, sendPasswordResetEmail, sendInvitationEmail (duplicated from main app)
- [x] P0.4: Session resolution proxy in main app
  - `src/lib/auth/session.ts` now fetches from AUTH_ZONE/api/auth/session
  - Falls back to Bearer token auth for API clients
- [x] P0.5: Cloud-auth REST API endpoints
  - `GET /api/auth/session` — Session resolution
  - `POST /api/auth/check-email` — Email existence check
  - `POST /api/consents/record` — Registration consent recording
  - `GET /api/invitations/[token]` — Invitation lookup
  - `GET /api/auth/terms-status` — Terms acceptance check
- [x] P0.6: Cloud-auth session resolver updated
  - Uses local BetterAuth server instead of proxying to main app
- [x] P0.7: Cloud-auth consent actions updated
  - Direct DB calls instead of proxying to main app
- [x] P0.8: Middleware update
  - `src/proxy.ts` redirects to AUTH_ZONE/login instead of /login
  - Skips auth check for paths rewritten to auth sub-zone
- [x] Dependencies added to cloud-auth: drizzle-orm, postgres, @node-rs/argon2, resend, uuid

### Next: STOP HERE for review and git commit

### Remaining P0
- [ ] Remove old auth.ts from main app (or make it a thin re-export)
- [ ] Remove old email/index.ts from main app (keep for non-auth emails)

### P1: Email & REST APIs (NOT STARTED)
- [ ] Move team/user/role management actions to cloud-auth
- [ ] Create REST endpoints for team-members, account, api-tokens, consents
- [ ] Main app settings page calls cloud-auth REST endpoints

### P2: Shared Types & Bearer Tokens (NOT STARTED)
- [ ] Create shared auth types in @lastest/shared
- [ ] Move bearer token verification to cloud-auth

### P3: Auth UI Components (NOT STARTED)
- [ ] Extract shared auth UI components

---

## Session Log

### Session 1 (2026-06-01)
- Explored full codebase structure
- Created cloud-auth DB layer (schema, queries, connection)
- Moved BetterAuth server to cloud-auth
- Created REST API endpoints in cloud-auth
- Updated main app session.ts to proxy to cloud-auth
- Updated middleware to redirect to AUTH_ZONE
- Updated cloud-auth consent actions to use direct DB
