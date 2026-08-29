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

- **EB pool service** (`packages/pool-service/`): a standalone singleton process owning the browser-capacity plane — EB provisioning, pool caps/warm pool/launch throttle, idle+stale EB reapers. The app calls it over HTTP via `@lastest/pool-service/client` (defaults `http://127.0.0.1:9500`, optional `EB_POOL_SERVICE_TOKEN` bearer auth). **In dev, run `pnpm dev:pool` in a second terminal alongside `pnpm dev`** — without it, provisioning-dependent flows degrade to "no browser available". In Docker the entrypoint starts it automatically (`EB_POOL_SERVICE_DISABLED=1` to opt out when running it as its own k8s Deployment). Capacity accounting has no in-memory counter: the ledger is the backend itself (live k8s Jobs labeled `app=lastest-eb` / live child processes), read fresh under a provision lock in `provisionOneEB()` — so it survives service restarts and can't overshoot `ebPoolMax`.
- **Provisioner modes** (`provisionerMode()` in `packages/pool-service/src/common.ts`, env `EB_PROVISIONER`):
  - `process` — **default in a dev checkout** (when `EB_PROVISIONER` is unset or `none`): the pool service spawns `packages/embedded-browser` as local child processes (`src/process-provisioner.ts`) via tsx. No cluster, no Docker, no extra env needed beyond `ENCRYPTION_KEY` + `DATABASE_URL`. Each EB gets a port block from `EB_PROCESS_PORT_BASE` (default 9300, stride 20: stream=P, health=P+1, cdp=P+2, cdp-proxy=P+12) and registers back over `127.0.0.1`. Effective pool cap is `min(ebPoolMax, EB_PROCESS_POOL_MAX=4)`; warm pool defaults to 0, and builds never prewarm (`prewarmForBuild` is a service-side no-op in this mode) — each claim spawns exactly one EB on demand (~2-5s). Requires Playwright Chromium on the host (`pnpm --filter @lastest/embedded-browser exec playwright install chromium`).
  - `kubernetes` — set `EB_PROVISIONER=kubernetes` explicitly: one k8s Job per EB into a local k3d cluster (`pnpm stack`; manifests in `k8s/`, scripts in `scripts/k3d-*.sh`). When `KUBERNETES_SERVICE_HOST` is unset the provisioner shells out to `kubectl config view` and uses the current kubeconfig context (`k3d-lastest`). EB pods reach the host app via `host.k3d.internal:3000` (CoreDNS override installed by `k3d-up.sh`). Also needs `EB_NAMESPACE=lastest`, `EB_IMAGE=lastest-embedded-browser:latest`, `LASTEST_URL=http://host.k3d.internal:3000`.
  - `none` — no dynamic provisioning (static EB fleets only, e.g. Zima compose replicas). The default outside a dev checkout; force with `EB_PROVISIONER=disabled`.
- **Tenant priority classes (kubernetes mode):** EB Jobs can carry a per-tenant `priorityClassName` — `lastest-eb-restricted` for free tiers (`free`/`demo`/`trial`), `lastest-eb-unrestricted` for paying ones (`starter`/`growth`/`pro`). The pool service reads `teams.plan` fresh at provision time from the `teamId` the caller passes (`provisionEB`/`prewarmForBuild`/`claimOrProvisionPoolEB`); every unknown (no teamId, unknown team, DB error, warm-pool launch) falls back to restricted. **Off unless enabled** with `EB_PRIORITY_CLASSES=1` (or by setting `EB_PRIORITY_CLASS_RESTRICTED`/`EB_PRIORITY_CLASS_UNRESTRICTED`) — the API server rejects a Job naming a PriorityClass the cluster doesn't have, and the classes are created by the cluster repo, not here.
- Both dynamic modes inject a **per-session `EB_BOOTSTRAP_TOKEN`** (HMAC-signed with `ENCRYPTION_KEY`, bound to the EB's instanceId, TTL = its deadline) — dynamic EBs never receive a fleet-wide secret (process mode also withholds `DATABASE_URL`/`ENCRYPTION_KEY` from child env). `SYSTEM_EB_TOKEN` remains accepted at auto-register ONLY for static fleets. The pool service therefore needs the same `ENCRYPTION_KEY` as the app.
- Required `.env.local` keys for the host dev flow (process mode):
  - `ENCRYPTION_KEY=<64 hex chars>` (shared by app + pool service; signs stream grants and EB bootstrap tokens)
  - `OCR_SERVICE_URL=http://localhost:8891` (OCR container from docker-compose; without it OCR features are disabled)
  - `DATABASE_URL=postgresql://lastest:lastest@localhost:5432/lastest`
  - `SYSTEM_EB_TOKEN` only for static-fleet EBs; dynamic EBs use per-session bootstrap tokens
- All built images + cluster containers carry `com.docker.compose.project=lastest` so Docker Desktop groups them as one stack.
- **EB stream proxy:** `scripts/front-proxy.js` owns the public port (:3000) in every deployment; it spawns Next on 127.0.0.1:3001 (the command after `--`) and reverse-proxies HTTP to it. WebSocket upgrades for `/api/embedded/stream/ws` are terminated by the front proxy itself (Next never sees them — no upgrade-listener races); all other upgrades (dev HMR) tunnel through untouched. The upstream EB pod address is dynamic per-session, so this can never be a static ingress route. It authorizes upgrades with an HMAC-signed grant carrying the upstream pod address (`src/lib/eb/stream-grant.ts`), minted by `toProxyStreamUrl()` behind `requireAuth()`. Never key it on an EB-held credential (`EB_BOOTSTRAP_TOKEN` / legacy `SYSTEM_EB_TOKEN`): every EB pod holds one. The verifier is duplicated in the front proxy (a dependency-free script with no TS loader) — change both together; `src/lib/eb/stream-grant.test.ts` cross-checks them in a child process, and `src/lib/eb/front-proxy.test.ts` exercises the proxy end-to-end.
- **EB stream credential:** the browser holds NO stream credential — only the opaque grant, which is a capability for one pod that expires with it. The EB's stream port is guarded by `STREAM_AUTH_TOKEN`, derived per instance as `HMAC(ENCRYPTION_KEY→"eb-stream-auth-v1", instanceId)` (`deriveStreamAuthToken()` in `packages/pool-service/src/common.ts`, duplicated in the front proxy). The pool service injects it at provision time; the front proxy re-derives it from the `i` (instanceId) field of the grant and presents it as an `x-stream-token` **header**, so it appears in no request line or access log. `embedded_sessions.instanceId` carries it from auto-register (where it is bound to the pod's `EB_BOOTSTRAP_TOKEN`) into the grant — it is only persisted when a bootstrap token vouched for it, never when self-asserted under a static-fleet `SYSTEM_EB_TOKEN`. Static fleets have no provisioner and fall back to a fleet-wide `STREAM_AUTH_TOKEN` env var set on both the proxy and every EB. An EB with no token configured refuses all upgrades (500) — fail closed, since a NetworkPolicy is only enforced by some CNIs and must never be the sole guard on the stream port.
- **EB isolation:** `k8s/embedded-browser-netpol.yaml` holds two policies for `app=lastest-eb` pods. `lastest-eb-ingress` is default-deny inbound, admitting only the app pod on 9223 (stream), 9224 (health) and 9232 (CDP proxy) — never 9222 (Chromium's own localhost CDP). Enforcing inter-EB isolation on the *ingress* side is deliberate: the destination EB refuses the connection, so it holds regardless of the cluster's pod CIDR. `lastest-eb-egress` allows DNS, the in-cluster app on :3000, and the public internet minus the metadata range and the cluster CIDRs. Caveats in the file header: it is a no-op under non-enforcing CNIs (k3d/flannel — `scripts/k3d-up.sh` does not apply it), the `except` CIDRs are k3s defaults that need changing per cluster, and kubelet probes plus `kubectl port-forward` originate off-pod.

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
  - `coverage.ts` — data-driven coverage: dimensions, occurring cells, cell↔run attribution
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
- `libs/coverage-model/` (`@lastest/coverage-model`) — the **pure** half of data-driven coverage: dimension profiling, the cells that actually occur, the weight formula, the t-way (default pairwise) stopping rule with its explanation, matrix expansion, the `rowFilter` grammar, the spec renderer, and the read-only SUT profilers (`VaultProfiler` over VQL, `RestProfiler` over JSON collections; VQL identifiers are allowlisted, never escaped). No DB, no storage, no clock. Its value types and `DEFAULT_*` policies live here too — `packages/db/src/schema/{coverage,tests}.ts` import and re-export them, so `@/lib/db/schema` still exports `CoverageStopPolicy`, `MatrixPolicy`, `DEFAULT_COVERAGE_*` etc. unchanged (same arrangement as `@lastest/eb-protocol`). Row types stay in the schema; the package narrows them (`CellLike`, `DimensionLike`, `TestVariableLike`)
  - `budget.ts` — replaces the QA agent's hardcoded `MAX_PLAN_ITEMS` cap with a coverage-derived item budget, feeds the planner a ranked list of uncovered cells, and produces the stop explanation. The wall-clock ceiling is **injected** (`hardCap`), not imported — the planner owns it, the model measures a data space
- `src/lib/coverage/` — the **stateful** half: `syncCoverage()` / `ensureFreshCoverage()` orchestration, snapshots and trend, cell↔run attribution, and the SUT profilers' persistence. Derivation always reconciles (prunes stale cells) rather than appending. Reads data sources through `src/lib/core/data-sources-reads.ts` (the `data-sources` plugin owns both the row and the uploaded CSV blob, and resolves the **full** file rather than the 1,000-row UI cache — profiling a sample as though it were the population is the bug that read exists to prevent)
  - Matrix execution — one test × N data rows = N runs in one build. Expansion happens in `src/lib/execution/matrix-expand.ts` at the top of `executeTests()`, rewriting matrix vars to `sourceRowMode:'fixed'` so the rest of the executor is unaware of matrices
- `src/lib/core/coverage-reads.ts` — the composition root's way in, for callers that are not core (the QA agent's planner). Same shape as `share-reads.ts` / `data-sources-reads.ts`
- `src/app/(app)/coverage/` — the Coverage screen, which is **also** the App Map: `@lastest/plugin-app-map` renders the canvas (Map / Screens / Flows) as the default view, and coverage adds two peer views (Data — breakdown / dimensions / trend / matrix / specification / sources; Gaps) plus a rail beside the canvas scoped to the selected page. `/app-map` redirects here. The plugin never sees a coverage type: it takes the two views as opaque `ReactNode` slots and the rail as a component, with data reaching the rail through `coverage-context.tsx` (the same shape as `exploreProgressPanel`). Per-page attribution is `src/lib/coverage/page-attribution.ts` — a cell is attributed to a page when one run both exercised the cell and walked the page, so only *covered* cells can be placed on the map. CSV upload profiles in place. `scripts/extract-coverage-sample.mjs` produces sample data sets from Lastest's own DB for exercising the model
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
- `packages/pool-service/` — EB pool service (separate process, `pnpm dev:pool`): k8s/process provisioning, pool caps, warm pool, EB reapers; app consumes `@lastest/pool-service/client`
- `packages/eb-protocol/` — canonical wire protocol app ↔ runners (`@lastest/eb-protocol`): command/response messages, stream messages, persisted jsonb payload shapes (schema.ts re-exports these)
- `packages/runner/` — remote runner CLI (npm package via tsup)
- `packages/mcp-server/` — MCP server for AI agent integration (`@lastest/mcp-server`)
- `packages/embedded-browser/` — containerized browser with CDP live streaming
- `packages/ocr-service/` — Tesseract OCR container, the ONLY OCR backend (no in-process Tesseract in the app); app-side facade in `src/lib/ocr/` requires `OCR_SERVICE_URL` — unset means OCR features are disabled. The service wakes on demand and auto-sleeps after idle
- `packages/vscode-extension/` — VS Code extension (esbuild)
- `plugins/ci/` — CI provider integration (`@lastest/plugin-ci`): GitHub Actions workflow + GitLab pipeline config, YAML generation, deployment to the customer's repo, setup validation. Owns `ci_github_action_configs` / `ci_gitlab_pipeline_configs`. The OAuth/token/webhook-verification half of `src/lib/{github,gitlab}` stayed in core — see `docs/architecture/ci-migration-result.md`

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
- **Logging:** `import { getLogger } from "@/lib/logger"` (pino) in server code — `const log = getLogger("GC"); log.warn({ runnerId }, "stale runner")`. Production writes newline-delimited JSON to stdout; dev renders short readable lines. `LOG_LEVEL` overrides the level. Server-only — never import it from a `*-client.tsx`. Existing bare `console.*` calls still work: `src/lib/logger-console-bridge.ts` patches console onto pino at boot (production only, from `src/instrumentation.ts`), lifting a leading `[Prefix]` into `scope` and `Error` args into `err`. A pino `mixin` stamps `trace_id`/`span_id` on every record when a span is active (see Tracing below); with no SDK running it contributes nothing.
- **Tracing (OpenTelemetry):** off unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set — OTLP over HTTP/protobuf, collector port 4318. Two services, one duplicated bootstrap: `src/otel.ts` (app, started first thing in `src/instrumentation.ts`) and `packages/pool-service/src/otel.ts` (pool service, preloaded via `--require dist/otel-bootstrap.cjs`). **They are deliberate copies — change both together**; `src/otel.test.ts` runs every sampler case against both and fails if they drift. Env: `OTEL_SERVICE_NAME`, `OTEL_EXCLUDE_PATHS`, `OTEL_TRACES_SAMPLER_ARG`, `OTEL_DIAG_LOG_LEVEL`.
  - **The head records everything; the collector tail-samples.** The default sampler is `ExcludePathSampler(AlwaysOnSampler)` — deliberately NOT ParentBased. Path exclusion has to live in the **sampler**, not just `ignoreIncomingRequestHook`: Next emits its own span tree per request (`BaseServer.handleRequest`, `middleware GET`, `resolve segment modules`…), so suppressing only the outer `http` span leaves the rest as orphan roots — kubelet's health probes would still flood the collector. It reads both `url.path` (stable semconv) and `http.target` (what Next still emits); either alone misses half the spans.
  - Do NOT restore `ParentBasedSampler` as the default. Its unspecified `remoteParentNotSampled` branch defaults to `AlwaysOffSampler`, so an inbound `traceparent` with the sampled flag clear is dropped at the app — which makes **Traefik's `sampleRate` a hard ceiling on everything through the ingress**, and a trace dropped at the head can never be recovered by a tail sampler. Set Traefik's `sampleRate` to `1.0` to match, or its own spans go missing from the trace. `src/otel.test.ts` guards this specific regression.
  - `OTEL_TRACES_SAMPLER_ARG` < 1 is the **opt-out**: it re-enables parent-based head sampling for deployments with no tail-sampling collector (self-hosted, or a backend that ingests everything). At the default of 1 it does nothing. `scripts/front-proxy.js` forwards `traceparent` untouched but emits no span of its own, so the proxy hop is invisible in the waterfall.
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

## Gotchas

- `VisualDiffWithTestStatus` type must stay in sync with `getVisualDiffsWithTestStatus` query select
- Test code signature: `export async function test(page, baseUrl, screenshotPath, stepLogger)` — runner strips TS annotations
- OCR always goes through the `src/lib/ocr` facade, which talks HTTP to `packages/ocr-service` (`OCR_SERVICE_URL` required; no in-process tesseract.js in the app). tesseract.js v6+ only returns `text` by default; bbox/word data needs the explicit `{ blocks: true }` output option (handled inside the service).
- Docker entrypoint runs `drizzle-kit push --force` on startup
