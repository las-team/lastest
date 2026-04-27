# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Critical Rules

- **ALWAYS use `pnpm`** — never `npm` or `npx`
- **NEVER run `pnpm db:reset`** without asking the user first (drops all PostgreSQL tables)

## Commands

```bash
pnpm dev                        # Dev server on localhost:3000 (host Next.js)
pnpm build                      # Production build
pnpm lint                       # ESLint
pnpm test                       # Unit tests (vitest)
pnpm test -- src/lib/diff       # Tests in specific directory
pnpm db:push                    # Push schema changes to DB
pnpm db:studio                  # Drizzle Studio

# Host postgres (one-time, persists in named volume)
docker run -d --name lastest-dev-db -p 5432:5432 \
  -e POSTGRES_USER=lastest -e POSTGRES_PASSWORD=lastest -e POSTGRES_DB=lastest \
  -v lastest-pgdata:/var/lib/postgresql/data \
  postgres:17-alpine

# k3d cluster — hosts dynamically-provisioned EB Job pods only (no app, no db)
pnpm stack                      # create k3d cluster + build/import EB image
pnpm stack:refresh              # rebuild EB image + import (alias of stack:refresh:eb)
pnpm stack:refresh:eb           # same
pnpm stack:status               # cluster + EB jobs/pods + host /api/health
pnpm stack:logs                 # tail EB pod logs (default; only EB lives in cluster)
pnpm stack:logs:eb              # explicit
pnpm stack:stop                 # delete cluster (pnpm stack:purge also drops .k8s-secrets.yaml)

# Deploy targets (homeservers — unchanged)
pnpm deploy:olares              # k8s deploy to Olares
pnpm deploy:zima                # docker-compose deploy to ZimaBoard/CasaOS
pnpm deploy:npm                 # publish @lastest/runner
pnpm deploy:all                 # zima + olares + npm
```

## Local Dev (host app + k3d EB provisioning)

The dev architecture is: **`pnpm dev` on the host**, postgres on the host (docker), and **EB pods provisioned dynamically into a local k3d cluster**.

- Manifests in `k8s/` (`namespace.yaml`, `embedded-browser-rbac.yaml`, `embedded-browser-job.yaml` reference). Scripts in `scripts/k3d-*.sh`.
- The EB provisioner (`src/lib/eb/provisioner.ts:127-168`) detects host mode: when `KUBERNETES_SERVICE_HOST` is unset, it shells out to `kubectl config view --raw --minify -o json` and uses the current kubeconfig context (`k3d-lastest`) to talk to the cluster. No in-pod ServiceAccount required.
- EB pods reach the host app via `host.k3d.internal:3000` — `k3d-up.sh` installs a CoreDNS override that pins the name to the Docker bridge gateway, so the resolution works on Linux without Docker Desktop.
- The provisioner inlines `SYSTEM_EB_TOKEN` / `LASTEST_URL` / `EB_IMAGE` into each Job spec from the host process env, so no in-cluster Secret is needed for EB lifecycle.
- Required `.env.local` keys for the host dev flow:
  - `EB_PROVISIONER=kubernetes`
  - `EB_NAMESPACE=lastest`
  - `EB_IMAGE=lastest-embedded-browser:latest`
  - `LASTEST_URL=http://host.k3d.internal:3000`
  - `SYSTEM_EB_TOKEN=<random hex>` (single token, or comma-list with the EB-facing token first)
  - `DATABASE_URL=postgresql://lastest:lastest@localhost:5432/lastest`
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
