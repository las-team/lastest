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
pnpm format                     # Prettier --write (whole repo)
pnpm format:check               # Prettier --check (CI-style)
pnpm test                       # Unit tests (vitest)
pnpm test -- src/lib/diff       # Tests in specific directory
pnpm db:push                    # Push schema changes to DB
pnpm db:studio                  # Drizzle Studio

# Host postgres (persists in `lastest-pgdata` named volume; defined in ./docker-compose.yml)
docker compose up -d

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

The dev architecture is: **`pnpm dev` on the host**, postgres on the host (docker), and **EBs provisioned dynamically as local child processes of the pool service** (the default; a k3d-cluster mode exists for parity testing).

- **EB pool service** (`packages/pool-service/`): a standalone singleton process owning the browser-capacity plane — EB provisioning, pool caps/warm pool/launch throttle, idle+stale EB reapers. The app calls it over HTTP via `@lastest/pool-service/client` (defaults `http://127.0.0.1:9500`, optional `EB_POOL_SERVICE_TOKEN` bearer auth). **In dev, run `pnpm pool` in a second terminal alongside `pnpm dev`** — without it, provisioning-dependent flows degrade to "no browser available". In Docker the entrypoint starts it automatically (`EB_POOL_SERVICE_DISABLED=1` to opt out when running it as its own k8s Deployment).
- **Provisioner modes** (`provisionerMode()` in `packages/pool-service/src/common.ts`, env `EB_PROVISIONER`):
  - `process` — **default in a dev checkout** (when `EB_PROVISIONER` is unset or `none`): the pool service spawns `packages/embedded-browser` as local child processes (`src/process-provisioner.ts`) via tsx. No cluster, no Docker, no extra env needed beyond `ENCRYPTION_KEY` + `DATABASE_URL`. Each EB gets a port block from `EB_PROCESS_PORT_BASE` (default 9300, stride 20: stream=P, health=P+1, cdp=P+2, cdp-proxy=P+12) and registers back over `127.0.0.1`. Effective pool cap is `min(ebPoolMax, EB_PROCESS_POOL_MAX=4)`; warm pool defaults to 0. Requires Playwright Chromium on the host (`pnpm --filter @lastest/embedded-browser exec playwright install chromium`).
  - `kubernetes` — set `EB_PROVISIONER=kubernetes` explicitly: one k8s Job per EB into a local k3d cluster (`pnpm stack`; manifests in `k8s/`, scripts in `scripts/k3d-*.sh`). When `KUBERNETES_SERVICE_HOST` is unset the provisioner shells out to `kubectl config view` and uses the current kubeconfig context (`k3d-lastest`). EB pods reach the host app via `host.k3d.internal:3000` (CoreDNS override installed by `k3d-up.sh`). Also needs `EB_NAMESPACE=lastest`, `EB_IMAGE=lastest-embedded-browser:latest`, `LASTEST_URL=http://host.k3d.internal:3000`.
  - `none` — no dynamic provisioning (static EB fleets only, e.g. Zima compose replicas). The default outside a dev checkout; force with `EB_PROVISIONER=disabled`.
- Both dynamic modes inject a **per-session `EB_BOOTSTRAP_TOKEN`** (HMAC-signed with `ENCRYPTION_KEY`, bound to the EB's instanceId, TTL = its deadline) — dynamic EBs never receive a fleet-wide secret (process mode also withholds `DATABASE_URL`/`ENCRYPTION_KEY` from child env). `SYSTEM_EB_TOKEN` remains accepted at auto-register ONLY for static fleets. The pool service therefore needs the same `ENCRYPTION_KEY` as the app.
- Required `.env.local` keys for the host dev flow (process mode):
  - `ENCRYPTION_KEY=<64 hex chars>` (shared by app + pool service; signs stream grants and EB bootstrap tokens)
  - `DATABASE_URL=postgresql://lastest:lastest@localhost:5432/lastest`
  - `SYSTEM_EB_TOKEN` only for static-fleet EBs; dynamic EBs use per-session bootstrap tokens
- All built images + cluster containers carry `com.docker.compose.project=lastest` so Docker Desktop groups them as one stack.
- **EB stream proxy:** `scripts/front-proxy.js` owns the public port (:3000) in every deployment; it spawns Next on 127.0.0.1:3001 (the command after `--`) and reverse-proxies HTTP to it. WebSocket upgrades for `/api/embedded/stream/ws` are terminated by the front proxy itself (Next never sees them — no upgrade-listener races); all other upgrades (dev HMR) tunnel through untouched. The upstream EB pod address is dynamic per-session, so this can never be a static ingress route. It authorizes upgrades with an HMAC-signed grant carrying the upstream pod address (`src/lib/eb/stream-grant.ts`), minted by `toProxyStreamUrl()` behind `requireAuth()`. Never key it on an EB-held credential (`EB_BOOTSTRAP_TOKEN` / legacy `SYSTEM_EB_TOKEN`): every EB pod holds one. The verifier is duplicated in the front proxy (a dependency-free script with no TS loader) — change both together; `src/lib/eb/stream-grant.test.ts` cross-checks them in a child process, and `src/lib/eb/front-proxy.test.ts` exercises the proxy end-to-end.

## Architecture

Visual regression testing platform: Next.js 16 App Router, PostgreSQL (Drizzle ORM), Playwright.

**Core flow:** Record browser interactions → Run tests → Diff screenshots → Review/approve baselines

**Key paths:**

- `packages/db/src/schema.ts` — all tables (~3700 lines; `@/lib/db/schema` re-exports)
- `src/lib/db/queries.ts` — barrel re-export of all query modules
- `src/lib/db/queries/` — domain-focused query modules:
  - `tests.ts` — tests, test runs, results, versions, assertions
  - `areas.ts` — functional areas, tree/hierarchy
  - `builds.ts` — builds, build summaries, build status, a11y score trends
  - `visual-diffs.ts` — visual diffs, baselines, ignore regions, planned screenshots
  - `step-comparisons.ts` — per-(build, test, step) multi-layer verdicts + evidence (v1.13)
  - `change-maps.ts` — build-level Change Map (Verify phase, v1.14+)
  - `layer-baselines.ts` / `layer-feedback.ts` — per-layer baselines + step feedback (Verify, v1.14+)
  - `repositories.ts` — repos, PRs, github/gitlab accounts
  - `settings.ts` — playwright, environment, diff, AI, notification settings
  - `routes.ts` — routes, scan status, route suggestions
  - `schedules.ts` — cron-based scheduled test runs
  - `background-jobs.ts` — background jobs
  - `auth.ts` — teams, users, sessions, oauth, tokens, invitations
  - `storage.ts` — team storage usage/quota + run-minute usage/quota
  - `billing.ts` — team billing snapshot, stripe webhook event log
  - `setup.ts` — setup/teardown scripts, configs, steps, resolution
  - `storage-states.ts` — browser storage state management
  - `runners.ts` — runners, runner commands
  - `integrations.ts` — spec imports, google sheets, compose, agent sessions
  - `gitlab-pipelines.ts` — GitLab pipeline configs
  - `github-actions.ts` — GitHub Actions integration
  - `csv-sources.ts` — CSV test-data sources
  - `fixtures.ts` — test fixtures
  - `gamification.ts` / `awards.ts` — seasons, Bug Blitz, leaderboard scoring; repo awards
  - `activity-events.ts` — activity events + live SSE broadcast
  - `launch.ts` — launch cohorts/gating
  - `public-shares.ts` / `demo-notes.ts` — public `/r/<slug>` share links + AI demo notes
  - `inspector.ts` — inspector cache
  - `analytics.ts` — usage analytics
  - `misc.ts` — selector stats, bug reports, review todos
- `src/lib/execution/executor.ts` — test executor (~1800 lines)
- `src/lib/verify/` — check-modes system: 9 layers (visual, text, dom, network, console, a11y, design, perf, url) × enforce/log/disable; case-status derivation
- `src/lib/design-system/` — design-token comparison engine (the "design" check layer)
- `src/lib/url-diff/` — URL trajectory capture + diffing, rate-limit, SSRF guards
- `src/lib/billing/` — Stripe billing: plans, live catalog, webhook sync
- `src/lib/playwright/` — recorder, runner, server manager, OCR, assertion-parser, selector-analysis ("Analyze URL")
- `src/lib/diff/` — pixelmatch diffing + SHA256 baseline hashing
- `src/lib/ai/` — AI providers: claude-cli, openrouter, claude-agent-sdk, anthropic-direct, openai, ollama + failure-triage
- `src/lib/a11y/` — WCAG 2.2 AA compliance scoring (wcag-score.ts)
- `src/lib/scheduling/` — cron parser + scheduler for automated test runs
- `src/server/actions/` — server actions for all domain ops
- `src/lib/ws/` — runner-channel server plumbing (registry, event fan-out, step state)
- `packages/db/` — drizzle schema + Postgres client (`@lastest/db`), shared by app and pool service; `src/lib/db/{index,schema}.ts` are re-export shims
- `packages/pool-service/` — EB pool service (separate process, `pnpm pool`): k8s provisioning, pool caps, warm pool, EB reapers; app consumes `@lastest/pool-service/client`
- `packages/eb-protocol/` — canonical wire protocol app ↔ runners (`@lastest/eb-protocol`): command/response messages, stream messages, persisted jsonb payload shapes (schema.ts re-exports these)
- `packages/runner/` — remote runner CLI (npm package via tsup)
- `packages/mcp-server/` — MCP server for AI agent integration (`@lastest/mcp-server`)
- `packages/embedded-browser/` — containerized browser with CDP live streaming
- `packages/vscode-extension/` — VS Code extension (esbuild)

## Billing (Stripe)

- `@better-auth/stripe` plugin wired in `src/lib/auth/auth.ts`; no-op when `STRIPE_SECRET_KEY` is unset (self-hosted stays free)
- Plans: `free` / `starter` / `growth` / `pro` (+ legacy `demo`/`trial`), monthly + yearly — defined in `src/lib/billing/plans.ts`; run-minute quotas + project limits per tier
- Live catalog fetched from Stripe (`src/lib/billing/catalog.ts`, 10-min TTL, webhook-invalidated); static fallback from `plans.ts` when Stripe unreachable
- `subscriptions` table is plugin-managed — read-only from app code; `stripe_webhook_events` is the app-owned idempotency/forensic log
- Webhooks flip `teams.plan` immediately (no admin gate) via `src/lib/billing/webhook-sync.ts`; upgrades prorate now, downgrades apply at period end via Subscription Schedule
- Provision/refresh the Stripe catalog + portal config: `STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-provision-test.mjs` (re-runnable; re-run after flipping `EARLY_ADOPTER_PRICING`)
- Env: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_AUTOMATIC_TAX` (optional), `EARLY_ADOPTER_PRICING` (default `true`)

## Schema Changes

1. Edit `packages/db/src/schema.ts` (`src/lib/db/schema.ts` is a re-export shim)
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
- **pnpm config:** `overrides` / `onlyBuiltDependencies` live in `pnpm-workspace.yaml` — never in a `package.json` `pnpm` block (deprecated)
- **Formatting/lint:** husky pre-commit runs `lint-staged` → `prettier --write` then `pnpm eslint` on staged files. Prettier auto-formats (and re-stages) on every commit — never `--list-different`/`--check` in `.lintstagedrc.json`, that only checks and blocks the commit instead of fixing.

## Gotchas

- `VisualDiffWithTestStatus` type must stay in sync with `getVisualDiffsWithTestStatus` query select
- Test code signature: `export async function test(page, baseUrl, screenshotPath, stepLogger)` — runner strips TS annotations
- Docker entrypoint runs `drizzle-kit push --force` on startup
