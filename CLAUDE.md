# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Critical Rules

- **ALWAYS use `pnpm`** — never `npm` or `npx`
- **NEVER run `pnpm db:reset`** without asking the user first (drops all PostgreSQL tables)

## Commands

```bash
pnpm dev                        # Dev server on localhost:3000
pnpm build                      # Production build
pnpm lint                       # ESLint
pnpm test                       # Unit tests (vitest)
pnpm test -- src/lib/diff       # Tests in specific directory
pnpm db:push                    # Push schema changes to DB
pnpm db:studio                  # Drizzle Studio

# Embedded Browser (local dev)
docker compose -f docker-compose.eb.yml up -d --build  # Rebuild + start

# Local k3s stack (dynamic EB provisioning via k3d)
pnpm stack                      # bootstrap: build images + create k3d cluster + deploy
pnpm stack:stop                 # teardown (pnpm stack:purge also drops .k8s-secrets.yaml)
pnpm stack:refresh              # rebuild app image + rolling restart
pnpm stack:refresh:eb           # rebuild EB image + restart app so new Jobs use it
pnpm stack:refresh:all          # EB then app
pnpm stack:status               # cluster + workloads + /api/health
pnpm stack:logs [app|eb|all]    # tail pod logs (default: app)
```

## k3s Local Dev (dynamic EB provisioning)

- Manifests in `k8s/` (`app-deployment.yaml`, `postgres.yaml`, `embedded-browser-rbac.yaml`, …). Scripts in `scripts/k3d-*.sh`.
- The EB provisioner (`src/lib/eb/provisioner.ts`) only runs **inside** a k8s pod — it reads the mounted SA token. `pnpm dev` on the host cannot exercise `EB_PROVISIONER=kubernetes`.
- Service DNS is hard-coded: `lastest-app.lastest.svc.cluster.local:3000`. Override via `LASTEST_URL` only.
- `scripts/_generate-secrets.sh` auto-merges OAuth / Resend / Twenty keys from `.env.local` into the k8s Secret. DB URL + `BETTER_AUTH_SECRET` + `SYSTEM_EB_TOKEN` stay k8s-owned.
- All built images + cluster containers carry `com.docker.compose.project=lastest` so Docker Desktop groups them as one stack.

## Architecture

Visual regression testing platform: Next.js 16 App Router, PostgreSQL (Drizzle ORM), Playwright.

**Core flow:** Record browser interactions → Run tests → Diff screenshots → Review/approve baselines

**Key paths:**
- `src/lib/db/schema.ts` — all tables (~1680 lines)
- `src/lib/db/queries.ts` — barrel re-export of all query modules
- `src/lib/db/queries/` — domain-focused query modules:
  - `tests.ts` — tests, functional areas, test runs, results, versions, assertions
  - `builds.ts` — builds, build summaries, build status, a11y score trends
  - `visual-diffs.ts` — visual diffs, baselines, ignore regions, planned screenshots
  - `repositories.ts` — repos, PRs, github/gitlab accounts
  - `settings.ts` — playwright, environment, diff, AI, notification settings
  - `routes.ts` — routes, scan status, route suggestions
  - `suites.ts` — suites, functional area tree, hierarchy
  - `schedules.ts` — cron-based scheduled test runs
  - `background-jobs.ts` — background jobs
  - `auth.ts` — teams, users, sessions, oauth, tokens, invitations
  - `setup.ts` — setup/teardown scripts, configs, steps, resolution
  - `storage-states.ts` — browser storage state management
  - `runners.ts` — runners, runner commands
  - `integrations.ts` — spec imports, google sheets, compose, agent sessions
  - `fixtures.ts` — test fixtures
  - `github-actions.ts` — GitHub Actions integration
  - `analytics.ts` — usage analytics
  - `misc.ts` — selector stats, bug reports, review todos
- `src/lib/execution/executor.ts` — test executor (~650 lines)
- `src/lib/playwright/` — recorder, runner, server manager, OCR, assertion-parser
- `src/lib/diff/` — pixelmatch diffing + SHA256 baseline hashing
- `src/lib/ai/` — AI providers: claude-cli, openrouter, claude-agent-sdk, anthropic-direct, ollama + failure-triage
- `src/lib/a11y/` — WCAG 2.2 AA compliance scoring (wcag-score.ts)
- `src/lib/scheduling/` — cron parser + scheduler for automated test runs
- `src/server/actions/` — server actions for all domain ops
- `src/lib/ws/` — WebSocket protocol for remote runners
- `packages/runner/` — remote runner CLI (npm package via tsup)
- `packages/mcp-server/` — MCP server for AI agent integration (`@lastest/mcp-server`)
- `packages/embedded-browser/` — containerized browser with CDP live streaming
- `packages/vscode-extension/` — VS Code extension (esbuild)

## Schema Changes

1. Edit `src/lib/db/schema.ts`
2. Update `DEFAULT_*` constants at top of schema for new settings fields
3. Run `pnpm db:push`
4. Update queries in the relevant `src/lib/db/queries/*.ts` module (barrel re-exported from `queries.ts`)

## Conventions

- **UI:** shadcn/ui (New York) + Tailwind CSS v4 (CSS-first, OKLCH colors, `@theme inline` in `globals.css`) + lucide-react icons + sonner toasts
- **Imports:** always `@/` alias, never relative
- **Client components:** named `*-client.tsx`
- **Server actions:** call `revalidatePath()` after mutations; use `requireRepoAccess()` / `requireTeamAccess()` for auth
- **Auth guards:** `requireAuth()`, `requireTeamAccess()`, `requireRepoAccess()`, `requireAdmin()` in `src/lib/auth/`
- **Auth:** better-auth for UI (email/password + GitHub/GitLab/Google OAuth); DB-backed session tokens (`verifyBearerToken()`) for programmatic API access
- **Image processing:** `pngjs` + `pixelmatch` — do NOT use `sharp`
- **Password hashing:** `@node-rs/argon2` (not bcrypt)
- **Settings auto-save:** 500ms debounce — when adding fields, update `originalValues`, `hasChanges`, `doSave`, and `useEffect` deps
- **AI settings:** `getAISettings()` returns `DEFAULT_AI_SETTINGS` when no DB record — all new fields must be in the default
- **Schema types:** use `$inferSelect` / `$inferInsert` patterns
- **Monorepo:** pnpm workspaces, pnpm 10.x

## Gotchas

- `VisualDiffWithTestStatus` type must stay in sync with `getVisualDiffsWithTestStatus` query select
- Test code signature: `export async function test(page, baseUrl, screenshotPath, stepLogger)` — runner strips TS annotations
- Docker entrypoint runs `drizzle-kit push --force` on startup
