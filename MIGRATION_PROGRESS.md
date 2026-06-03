# Auth Sub-Zone Migration — Progress Tracker

## Status: IN PROGRESS (P0 Phase — Hooks Migrated, Ready for Review/Commit)

### Completed

- [x] Codebase exploration and analysis
- [x] P0.1: Database setup in cloud-auth (`packages/cloud-auth/src/lib/db/`)
  - `index.ts` — Drizzle connection (same DB as main app)
  - `schema.ts` — Auth tables only (users, sessions, oauth_accounts, verification, password_reset_tokens, email_verification_tokens, user_invitations, user_consents, teams, github_accounts)
  - `queries.ts` — Auth queries only (users, teams, sessions, invitations, consents, github_accounts, etc.)
- [x] P0.2: BetterAuth server instance in cloud-auth (`packages/cloud-auth/src/lib/auth-server.ts`)
  - Stripped main-app-specific hooks (GitHub sync, demo seeding, CRM sync) — then re-added all hooks
  - Full hooks: password hashing, email/password reset, OAuth providers, session config
  - User creation hooks: demo mode assignment, invitation acceptance, team creation, CRM sync
  - Account hooks: GitHub account sync
- [x] P0.3: Email module in cloud-auth (`packages/cloud-auth/src/lib/email.ts`)
  - sendEmail, sendPasswordResetEmail, sendInvitationEmail
  - URLs now point to AUTH_ZONE for reset/invite, APP_URL for logo/footer
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
- [x] P0.9: Hooks fully migrated to cloud-auth
  - Demo mode: `isDemoEmail()`, `getOrCreateDemoTeam()` in cloud-auth
  - GitHub sync: `syncGithubAccount()` with `getGitHubUser()` in cloud-auth
  - CRM sync: `syncUserToTwentyCRM()` in cloud-auth
  - All hooks in cloud-auth auth-server.ts (account.create, account.update, user.create)
- [x] P0.10: Email duplication eliminated
  - Main app `src/lib/email/index.ts` re-exports from cloud-auth
  - Auth-triggered emails use AUTH_ZONE URLs
- [x] P0.11: Single BetterAuth instance
  - Main app `src/lib/auth/auth.ts` re-exports from cloud-auth
  - Main app `src/app/api/auth/[...all]/route.ts` imports from cloud-auth with rate limiting
  - Main app has cloud-auth as workspace dependency + transpilePackage
- [x] Dependencies added to cloud-auth: drizzle-orm, postgres, @node-rs/argon2, resend, uuid

### Next: STOP HERE for review and git commit

### Remaining P0

- [ ] Verify builds pass with new cloud-auth dependency
- [ ] Test demo sign-in flow (ensureDemoEnvironment + auth hook)
- [ ] Test GitHub OAuth flow (syncGithubAccount hook)

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

### Session 2 (2026-06-02)

- Added github_accounts schema and queries to cloud-auth
- Added demo.ts utilities to cloud-auth (isDemoEmail, getOrCreateDemoTeam)
- Added twenty-crm.ts to cloud-auth (syncUserToTwentyCRM)
- Added github.ts to cloud-auth (getGitHubUser)
- Migrated all hooks to cloud-auth auth-server.ts (demo, GitHub sync, CRM)
- Updated cloud-auth email.ts to use AUTH_ZONE URLs for reset/invite
- Added cloud-auth as workspace dependency to main app
- Added cloud-auth to main app transpilePackages
- Updated main app auth API route to import from cloud-auth with rate limiting
- Replaced main app auth.ts with re-export from cloud-auth
- Replaced main app email/index.ts with re-export from cloud-auth
- Removed middleware auth check (getSessionCookie) — auth now handled at route level via getCurrentSession() which forwards to cloud-auth
- Fixed login loop: middleware couldn't read session cookies set by cloud-auth (different port)
- Removed getSessionCookie() from src/proxy.ts — auth checks moved to route/action level
- Main app auth directory cleaned up: demo.ts re-exports isDemoEmail/getOrCreateDemoTeam from cloud-auth
