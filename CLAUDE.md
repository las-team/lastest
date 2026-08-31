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
- **Logging:** `import { getLogger } from "@/lib/logger"` (pino) in server code — `const log = getLogger("GC"); log.warn({ runnerId }, "stale runner")`. Production writes newline-delimited JSON to stdout; dev renders short readable lines. `LOG_LEVEL` overrides the level. Server-only — never import it from a `*-client.tsx`. Existing bare `console.*` calls still work: `src/lib/logger-console-bridge.ts` patches console onto pino at boot (production only, from `src/instrumentation.ts`), lifting a leading `[Prefix]` into `scope` and `Error` args into `err`. A pino `mixin` stamps `trace_id`/`span_id` on every record when a span is active (see Tracing below); with no SDK running it contributes nothing.
- **Tracing (OpenTelemetry):** **opt-in and Kubernetes-only** — off everywhere unless `OTEL_TRACING_ENABLED` is truthy AND the process is inside a k8s pod AND `OTEL_EXPORTER_OTLP_ENDPOINT` is set. OTLP over HTTP/protobuf, collector port 4318. Two services, one duplicated bootstrap: `src/otel.ts` (app, started first thing in `src/instrumentation.ts`) and `packages/pool-service/src/otel.ts` (pool service, preloaded via `--require dist/otel-bootstrap.cjs`). **They are deliberate copies — change both together**; `src/otel.test.ts` runs every sampler case against both and fails if they drift. Env: `OTEL_TRACING_ENABLED`, `OTEL_SERVICE_NAME`, `OTEL_EXCLUDE_PATHS`, `OTEL_TRACES_SAMPLER_ARG`, `OTEL_DIAG_LOG_LEVEL`.
  - **The gate (`otelGate()`) has THREE copies** — `src/otel.ts`, `packages/pool-service/src/otel.ts` and `dbTracingEnabled()` in `packages/db/src/tracing.ts` (which can import neither) — change all three together; `src/otel.test.ts` runs the same cases against all three. `OTEL_EXPORTER_OTLP_ENDPOINT` alone is deliberately NOT enough: an endpoint inherited from a shared ConfigMap or a stray `.env.local` key used to start exporting silently. The k8s half is detected via `KUBERNETES_SERVICE_HOST` (kubelet-injected in every pod, absent everywhere else). A flag that is set but cannot be honoured logs a warning; the default (no flag) is silent.
  - **Which image can trace:** `Dockerfile.app` and `packages/pool-service/Dockerfile` only — both k8s-only images, and `Dockerfile.app` carries the `node_modules/@opentelemetry/*` symlink fixup + build-time resolve check that `serverExternalPackages` needs. The root `Dockerfile` (single-container self-host / Zima) is deliberately untouched: `scripts/docker-entrypoint.sh` starts the bundled pool service **without** the `--require dist-pool/otel-bootstrap.cjs` preload, and the gate would refuse anyway. `Dockerfile.migrate` is untraced — `scripts/migrate.js` uses `postgres` directly and never loads `@lastest/db`'s instrumented client.
  - **The head records everything; the collector tail-samples.** The default sampler is `ExcludePathSampler(AlwaysOnSampler)` — deliberately NOT ParentBased. Path exclusion has to live in the **sampler**, not just `ignoreIncomingRequestHook`: Next emits its own span tree per request (`BaseServer.handleRequest`, `middleware GET`, `resolve segment modules`…), so suppressing only the outer `http` span leaves the rest as orphan roots — kubelet's health probes would still flood the collector. It reads both `url.path` (stable semconv) and `http.target` (what Next still emits); either alone misses half the spans.
  - Do NOT restore `ParentBasedSampler` as the default. Its unspecified `remoteParentNotSampled` branch defaults to `AlwaysOffSampler`, so an inbound `traceparent` with the sampled flag clear is dropped at the app — which makes **Traefik's `sampleRate` a hard ceiling on everything through the ingress**, and a trace dropped at the head can never be recovered by a tail sampler. Set Traefik's `sampleRate` to `1.0` to match, or its own spans go missing from the trace. `src/otel.test.ts` guards this specific regression.
  - `OTEL_TRACES_SAMPLER_ARG` < 1 is the **opt-out**: it re-enables parent-based head sampling for deployments with no tail-sampling collector (self-hosted, or a backend that ingests everything). At the default of 1 it does nothing, so neither k8s manifest sets it — both carry it commented out with the explanation. Despite the name it is NOT the spec's variable: its partner `OTEL_TRACES_SAMPLER` is ignored, because `NodeSDK` gets an explicit `sampler` and that beats env-based selection. `scripts/front-proxy.js` forwards `traceparent` untouched but emits no span of its own, so the proxy hop is invisible in the waterfall.
  - Tail sampling needs every span of a trace to reach the **same** collector instance, so more than one replica requires a `loadbalancing` exporter keyed by trace ID in front of the tail-sampling tier.
  - Spans are batched (`BatchSpanProcessor`, `batchConfigFromEnv()` in both otel.ts copies). Defaults are raised over the SDK's stock queue of 2048 because always-on recording multiplies volume; **overflow is silent** — the processor drops the excess and reports it only through `diag`, so set `OTEL_DIAG_LOG_LEVEL=warn` to see the drop counter. Tunable via the standard `OTEL_BSP_MAX_QUEUE_SIZE` / `OTEL_BSP_MAX_EXPORT_BATCH_SIZE` / `OTEL_BSP_SCHEDULE_DELAY` / `OTEL_BSP_EXPORT_TIMEOUT`.
  - OTel packages MUST stay in `serverExternalPackages` (app) and the pool bundle MUST stay CommonJS: instrumentation patches the module registry at `require()` time, and a webpack-bundled or ESM-imported `http`/`https` is a different object than the one patched — the failure mode is silently zero spans. This is why `packages/pool-service` builds `dist/main.cjs` + a separate `dist/otel-bootstrap.cjs` preload rather than one ESM bundle.
  - **DB queries are traced** via `packages/db/src/tracing.ts`, which wraps the postgres.js client in `packages/db/src/index.ts` — so the app and the pool service both get it from one place, covering reads, writes and transactions (Drizzle funnels everything through `client.unsafe`). One CLIENT span per statement, nested under the active request span. `OTEL_DB_TRACING=0` disables it; `OTEL_DB_STATEMENT=0` drops the statement text.
  - **Span attributes are NOT covered by pino's `REDACT_PATHS`** — that redaction runs on pino records only. DB spans therefore carry their own policy, enforced in `redactStatement()` and covered by `packages/db/src/tracing.test.ts`: bound parameters are never attached in any form, and the statement text is additionally scrubbed of inline string/numeric literals so a `sql.raw()` cannot leak one. Adding a new span attribute anywhere means re-checking it by hand against this.
  - Do NOT enable `drizzle-orm`'s own tracing. Its instrumentation points exist but its `otel` binding is declared and never assigned in 0.45.2, so it is dead code — and it sets `drizzle.query.params: JSON.stringify(params)`, which in this database means password hashes, session/bearer tokens and provider API keys on every span. `@opentelemetry/instrumentation-pg` does not apply either: it patches `pg`, and this codebase uses `postgres` (postgres.js).
  - **EB pods are deliberately not traced** — `k8s/embedded-browser-netpol.yaml` denies their egress to the cluster CIDRs, and the collector is inside one.
  - `packages/pool-service`, `packages/embedded-browser` and `scripts/front-proxy.js` still log `[Prefix] message` via `console.*`, so their output stays unstructured and uncorrelated until they move to pino.
- **Schema types:** use `$inferSelect` / `$inferInsert` patterns
- **Monorepo:** pnpm workspaces, pnpm 10.x
- **pnpm config:** `overrides` / `onlyBuiltDependencies` live in `pnpm-workspace.yaml` — never in a `package.json` `pnpm` block (deprecated)
- **Formatting/lint:** husky pre-commit runs `lint-staged` → `prettier --write` then `pnpm eslint` on staged files. Prettier auto-formats (and re-stages) on every commit — never `--list-different`/`--check` in `.lintstagedrc.json`, that only checks and blocks the commit instead of fixing.