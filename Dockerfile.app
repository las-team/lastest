# =============================================================================
# Lastest — Next.js app image ONLY (minimal, split-services layout)
#
# This is the "app" half of a 4-image production deployment:
#   Dockerfile.app                  <- this file (Next.js app)
#   packages/pool-service/Dockerfile <- EB pool service (own k8s Deployment)
#   packages/embedded-browser/Dockerfile <- EB Job pod image
#   packages/ocr-service/Dockerfile <- OCR sidecar
#
# Unlike the root Dockerfile (single-container: app + bundled pool-service +
# bundled embedded-browser process-mode fallback, used for Zima/self-host),
# this image runs ONLY the Next.js server. It never spawns the EB pool
# service in-process — point it at a separately deployed pool service via
# EB_POOL_SERVICE_URL (+ EB_POOL_SERVICE_TOKEN). No tests run at build time
# (run `pnpm test` in CI instead) and no other package's dist is copied in.
#
# Build (repo root as context):
#   docker build -f Dockerfile.app -t lastest-app:latest .
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Dependencies
# -----------------------------------------------------------------------------
FROM node:24-alpine AS deps

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.28.1 --activate

# Only the workspace packages the app actually depends on (see root
# package.json "dependencies") — not runner, embedded-browser, ocr-service,
# or vscode-extension.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/eb-protocol/package.json ./packages/eb-protocol/
COPY packages/db/package.json ./packages/db/
COPY packages/pool-service/package.json ./packages/pool-service/
COPY packages/mcp-server/package.json ./packages/mcp-server/

RUN pnpm install --frozen-lockfile

# -----------------------------------------------------------------------------
# Stage 2: Builder
# -----------------------------------------------------------------------------
FROM node:24-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.28.1 --activate

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN rm -rf packages/runner packages/embedded-browser packages/ocr-service packages/vscode-extension

ARG GIT_HASH=unknown
ARG GIT_COMMIT_COUNT=0
# Stable key so Server Action IDs survive rebuilds (otherwise Next.js mints a
# random key per build and every redeploy invalidates open tabs).
ARG NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=""
# Inlined into the client bundle by Next at build time; per-target umami site.
ARG NEXT_PUBLIC_UMAMI_WEBSITE_ID=""
# Next evaluates next.config.ts rewrites() at build time and bakes the result
# into routes-manifest.json — runtime UMAMI_INTERNAL_URL is too late, the
# /_umami/* rewrite must be present when `next build` runs.
ARG UMAMI_INTERNAL_URL=""

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_GIT_HASH=$GIT_HASH
ENV NEXT_PUBLIC_GIT_COMMIT_COUNT=$GIT_COMMIT_COUNT
ENV NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=$NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
ENV NEXT_PUBLIC_UMAMI_WEBSITE_ID=$NEXT_PUBLIC_UMAMI_WEBSITE_ID
ENV UMAMI_INTERNAL_URL=$UMAMI_INTERNAL_URL
# Dummy secret for build-time page data collection (overridden at runtime)
ENV BETTER_AUTH_SECRET=build-time-placeholder

RUN node -e "\
  const pkg = require('./package.json');\
  const info = { gitHash: '$GIT_HASH', commitCount: '$GIT_COMMIT_COUNT', version: pkg.version };\
  require('fs').writeFileSync('build-info.json', JSON.stringify(info));"

# `pnpm build` already builds @lastest/mcp-server before `next build` (see
# root package.json). No embedded-browser build, no pool-service build, no
# test run — those belong to their own images / CI.
RUN pnpm build

# -----------------------------------------------------------------------------
# Stage 3: Production Runner
#
# In the k8s split-services topology this image targets, the app only ever
# speaks to remote embedded-browser pods over `chromium.connectOverCDP()`
# (ranger, qa-agent, inject-storage-state, play-agent) — which needs the
# playwright JS package (copied in below), NOT a local Chromium binary or its
# system libraries. The single local `chromium.launch()` (quickstart
# storage-capture's self-hosted fallback) is gated off in Kubernetes mode
# (isKubernetesMode()), so it never executes here. Using node:alpine instead of
# mcr.microsoft.com/playwright drops ~1.8GB of base image.
# -----------------------------------------------------------------------------
FROM node:24-alpine AS runner

WORKDIR /app

# C.UTF-8 is valid on Alpine/musl — no locale packages needed. Node ships full
# ICU, so Intl/date formatting is independent of the system locale; UTF-8 byte
# handling is all the app needs (screenshot rendering, where en_US mattered for
# the Playwright base, now happens entirely in the EB pod).
ENV LANG=C.UTF-8
ENV TZ=UTC

# Service account: no interactive login shell (nologin). The passwd shell is
# only consulted for `su - nextjs` / login sessions — never by the ENTRYPOINT,
# Node's child_process, or `docker exec -it … sh` (which names the command).
# A home dir (-h) is still needed: the shared entrypoint symlinks
# /home/nextjs/.claude → /app/storage/.claude and that requires the home dir.
# Alpine BusyBox tools: nologin lives at /sbin/nologin, -D = no password.
RUN addgroup -g 1002 nodejs && \
    adduser -u 1002 -G nodejs -s /sbin/nologin -h /home/nextjs -D nextjs

# Standalone build (includes its own pruned node_modules)
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# Drop @anthropic-ai/claude-agent-sdk from the traced bundle. It's a
# serverExternalPackage (which forces nft to include it — outputFileTracingExcludes
# can't remove it), but this API-key-only image must NOT ship it
# (AI_HOST_CLI_DISABLED=1). The app only reaches it via a guarded `await import()`
# (src/lib/ai/claude-agent-sdk.ts), which then fails gracefully to "use an
# API-key provider". Version-agnostic glob so a dependency bump keeps working.
RUN rm -rf ./node_modules/.pnpm/@anthropic-ai+claude-agent-sdk@* \
           ./node_modules/@anthropic-ai/claude-agent-sdk
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/build-info.json ./build-info.json

# next.config.ts serverExternalPackages (playwright, playwright-core). nft's
# standalone trace handles these asymmetrically (verified against a real build):
#   - playwright-core@1.57.0: traced in FULL (~6.9M) — no content copy needed.
#   - playwright@1.57.0 (thin wrapper): only a ~12K stub is traced, MISSING its
#     index.js entry, so `require("playwright")` fails without the real package.
# So copy ONLY the wrapper, rely on the trace for playwright-core, and recreate
# the top-level symlinks (nft never creates those) into the pnpm store.
# Keep the pinned versions in sync via `node scripts/sync-docker-pins.mjs Dockerfile.app`.
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/.pnpm/playwright@1.57.0/node_modules/playwright ./node_modules/.pnpm/playwright@1.57.0/node_modules/playwright
RUN ln -sf .pnpm/playwright@1.57.0/node_modules/playwright ./node_modules/playwright && \
    ln -sf .pnpm/playwright-core@1.57.0/node_modules/playwright-core ./node_modules/playwright-core

# NOTE: no drizzle-kit / drizzle-orm / postgres / esbuild / schema copies here.
# Database migrations do NOT run at app-pod boot in the split-services layout —
# they run once per deploy as a dedicated k8s Job (Dockerfile.migrate +
# k8s/migrate-job.yaml). Everything the app SERVER imports at runtime
# (drizzle-orm, postgres via @lastest/db, all workspace-package source) is
# already traced into the Next standalone bundle copied above. The only manual
# step for a serverExternalPackage is re-linking playwright's top-level symlink
# (above) — nft traces its content but not the symlink. claude-agent-sdk is the
# inverse: also traced in, but deliberately deleted above (API-key-only image).

# API-key-only AI: this image ships neither the Claude Code CLI binary nor
# the @anthropic-ai/claude-agent-sdk runtime (a serverExternalPackage nft
# traces into the bundle, so it's deleted above; the app only lazy-imports it
# behind a guarded try/catch, see src/lib/ai/claude-agent-sdk.ts). AI_HOST_CLI_DISABLED
# below makes the app report the 'claude-cli' / 'claude-agent-sdk' providers
# as unavailable — use the Anthropic/OpenAI/OpenRouter API-key providers.

# OCR runs in the dedicated ocr-service container (packages/ocr-service) —
# tesseract.js is not shipped in this image. Set OCR_SERVICE_URL to enable.
# The EB pool service runs in its own container (packages/pool-service) —
# point EB_POOL_SERVICE_URL / EB_POOL_SERVICE_TOKEN at it.

# Slim entrypoint: storage dirs + exec. No boot-time migrate, no in-process
# pool service (both handled by their own k8s workloads — see app-entrypoint.sh).
COPY --chown=nextjs:nodejs scripts/app-entrypoint.sh /app-entrypoint.sh
RUN chmod +x /app-entrypoint.sh
COPY --chown=nextjs:nodejs scripts/front-proxy.js /app/front-proxy.js

RUN mkdir -p /app/storage/screenshots /app/storage/baselines /app/storage/diffs /app/storage/traces /app/storage/videos /app/storage/planned /app/storage/bug-reports && \
    chown -R nextjs:nodejs /app

ARG NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=""
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=$NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
# API-key-only image: no claude CLI / Agent SDK runtime on board (see above)
ENV AI_HOST_CLI_DISABLED=1
# DATABASE_URL must be injected by the deployment — no default. Missing env is fatal at boot.
# EB_POOL_SERVICE_URL must point at the pool-service Deployment/Service
# (e.g. http://lastest-pool:9500) — this image never runs it in-process.
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

LABEL org.opencontainers.image.title="Lastest App"
LABEL org.opencontainers.image.description="Lastest visual regression platform — Next.js app only (split-services layout)"
LABEL org.opencontainers.image.vendor="Lastest"
LABEL org.opencontainers.image.source="https://github.com/las-team/lastest"

# node:alpine ships no curl — use node's global fetch for the healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "fetch('http://localhost:3000/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

EXPOSE 3000

USER nextjs

VOLUME ["/app/storage"]

ENTRYPOINT ["/app-entrypoint.sh"]
# front-proxy owns :3000 and spawns Next's standalone server on 127.0.0.1:3001
# (PORT/HOSTNAME are overridden for the child by front-proxy itself).
CMD ["node", "front-proxy.js", "--", "node", "server.js"]
