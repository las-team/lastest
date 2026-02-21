# Feature Spec: Custom Authentication System

## Overview

Replaces better-auth library integration with a custom auth implementation supporting email/password with Argon2id hashing, OAuth (GitHub, GitLab, Google), password reset flow, secure session management, and invitation-based team joining.

## Password Authentication

### Hashing
- **Algorithm**: Argon2id (OWASP-compliant)
- **Memory**: 19 MiB, Time cost: 2, Parallelism: 1
- **Library**: `@node-rs/argon2` (native binding)
- **Validation**: 8-128 characters

### API (`src/lib/auth/password.ts`)
```typescript
hashPassword(password: string): Promise<string>
verifyPassword(hashedPassword: string, password: string): Promise<boolean>
validatePassword(password: string): { valid: boolean; error?: string }
```

## Session Management

### Configuration
- **Lifetime**: 30 days
- **Cookie**: `session_token`, httpOnly, secure (prod), sameSite: "lax"
- **Tracking**: IP address (x-forwarded-for/x-real-ip), user-agent, timestamps

### Key Functions (`src/lib/auth/session.ts`)
| Function | Description |
|----------|-------------|
| `createSessionToken(userId, request)` | Create new session |
| `setSessionCookie(token)` | Set HTTP-only cookie |
| `getCurrentSession()` | Retrieve with expiry validation |
| `getCurrentUser()` | Get user from session |
| `requireAuth()` | Protect routes (403 if no session) |
| `requireTeamAccess()` | Check team membership |
| `requireTeamAdmin()` | Check admin/owner role |
| `requireRepoAccess(repoId)` | Check repo access in team |
| `logout()` | Delete session and clear cookie |

## OAuth Providers

### GitHub
- **Scopes**: `repo read:user`
- **Flow**: Initiate → Callback → Exchange token → Fetch user (email fallback from `/user/emails`)
- **Files**: `src/lib/github/oauth.ts`, `src/app/api/auth/github/{route,callback/route}.ts`

### GitLab
- **Scopes**: `api read_user read_repository`
- **Self-hosted**: Supports via `GITLAB_INSTANCE_URL` env var (default: `https://gitlab.com`)
- **Token refresh**: Stores `refreshToken` and `tokenExpiresAt`
- **Files**: `src/lib/gitlab/oauth.ts`, `src/app/api/auth/gitlab/{route,callback/route}.ts`

### Google
- **Scopes**: `openid email profile`
- **Files**: `src/app/api/auth/google/{route,callback/route}.ts`

### Common OAuth Flow
1. Redirect to `/api/auth/{provider}` to initiate
2. Provider redirects to `/api/auth/{provider}/callback?code=...&state=...`
3. Exchange code for access token
4. Fetch user profile from provider API
5. Link or create account (check existing linked account → check email match → create new)
6. Create session and redirect to dashboard

## Password Reset

### Flow
1. User submits email at `/forgot-password`
2. Server creates `PasswordResetToken` (if account exists)
3. Email sent with reset link (requires `sendPasswordResetEmail` implementation)
4. UI shows success regardless of email match (prevents enumeration)
5. User clicks link → `/reset-password?token=...`
6. Validates token (exists, not expired, not used)
7. Hashes new password with Argon2id
8. **Invalidates all existing sessions** (force logout everywhere)
9. Marks token as used

### Database: `verification` Table
| Column | Type | Description |
|--------|------|-------------|
| `id` | text PK | UUID |
| `identifier` | text | User email or ID |
| `value` | text | Token value |
| `expiresAt` | text | Expiration timestamp |
| `createdAt` | text | Timestamp |
| `updatedAt` | text | Timestamp |

## Registration

### Direct Registration
- Email → Password → Name → Validate → Check email uniqueness → Auto-create team (user as owner) → Create session
- **Endpoint**: `POST /api/auth/register`

### Invitation Flow
- `GET /api/auth/invite/validate?token=...` — Validates token, returns email/role/expiry
- `POST /api/auth/invite/accept` — Creates user in specified team with specified role
- Invited users get `emailVerified: true` automatically

## UI Components

| Component | File | Purpose |
|-----------|------|---------|
| `LoginForm` | `src/components/auth/login-form.tsx` | Email/password + OAuth |
| `RegisterForm` | `src/components/auth/register-form.tsx` | Registration form |
| `SocialButtons` | `src/components/auth/social-buttons.tsx` | OAuth provider buttons |
| `UserMenu` | `src/components/auth/user-menu.tsx` | Avatar dropdown with logout |

## Key Files
| File | Purpose |
|------|---------|
| `src/lib/auth/password.ts` | Argon2id hashing |
| `src/lib/auth/session.ts` | Session management, auth guards |
| `src/lib/auth/index.ts` | Exports |
| `src/app/api/auth/*/route.ts` | 11 API route files |
| `src/app/(auth)/*/page.tsx` | Login, register, forgot-password, reset-password, invite pages |

## Environment Variables
```bash
BETTER_AUTH_SECRET          # Session encryption (auto-generated if not set)
GITHUB_CLIENT_ID            # GitHub OAuth
GITHUB_CLIENT_SECRET
GITLAB_CLIENT_ID            # GitLab OAuth
GITLAB_CLIENT_SECRET
GITLAB_INSTANCE_URL         # Self-hosted GitLab (default: https://gitlab.com)
GOOGLE_CLIENT_ID            # Google OAuth
GOOGLE_CLIENT_SECRET
```
