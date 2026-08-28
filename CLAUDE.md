# CLAUDE.md

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
pnpm db:push                    # Push schema changes to DB (scripts/migrate.js:
                                # plugin-table renames FIRST, then drizzle-kit
                                # push --force). Never use db:push:raw on a DB
                                # with data — bare drizzle-kit push cannot see a
                                # rename and DROPS the old plugin tables.
pnpm db:studio                  # Drizzle Studio

# Host postgres (persists in `lastest-pgdata` named volume; defined in ./docker-compose.yml)
docker compose up -d

# OCR service container (packages/ocr-service) — REQUIRED for OCR features
# (ocr-text selectors, text-region-aware diffing); the app has no in-process
# Tesseract. Part of the default compose stack; set
# OCR_SERVICE_URL=http://localhost:8891 in .env.local.
pnpm ocr:up                     # docker compose up -d --build ocr
pnpm ocr:down

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

## Billing (Stripe)

- `@better-auth/stripe` plugin wired in `src/lib/auth/auth.ts`; no-op when `STRIPE_SECRET_KEY` is unset (self-hosted stays free)
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
- **Logging:** `import { getLogger } from "@/lib/logger"` (pino) in server code — `const log = getLogger("GC"); log.warn({ runnerId }, "stale runner")`. Production writes newline-delimited JSON to stdout; dev renders short readable lines. `LOG_LEVEL` overrides the level. Server-only — never import it from a `*-client.tsx`. Existing bare `console.*` calls still work: `src/lib/logger-console-bridge.ts` patches console onto pino at boot (production only, from `src/instrumentation.ts`), lifting a leading `[Prefix]` into `scope` and `Error` args into `err`.
- **Schema types:** use `$inferSelect` / `$inferInsert` patterns
- **Monorepo:** pnpm workspaces, pnpm 10.x
- **pnpm config:** `overrides` / `onlyBuiltDependencies` live in `pnpm-workspace.yaml` — never in a `package.json` `pnpm` block (deprecated)
- **Formatting/lint:** husky pre-commit runs `lint-staged` → `prettier --write` then `pnpm eslint` on staged files. Prettier auto-formats (and re-stages) on every commit — never `--list-different`/`--check` in `.lintstagedrc.json`, that only checks and blocks the commit instead of fixing.