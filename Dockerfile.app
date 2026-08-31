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
# This image is also the only one wired for OpenTelemetry tracing: it is
# Kubernetes-only and opt-in (OTEL_TRACING_ENABLED) — see the OTel block in the
# runner stage below and src/otel.ts.
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

# Stage the Agent SDK's platform-native CLI binary at a fixed, arch-independent
# path. It ships as an optionalDependency, so only the variant matching this
# build's platform is installed (…-linux-x64-musl or …-linux-arm64-musl on this
# alpine/musl base) — a hardcoded COPY path in the runner stage would break the
# other architecture. `cp -RL` fails the build loudly if the optional dep ever
# stops resolving, instead of failing silently at runtime.
RUN mkdir -p /sdk-native && \
    cp -RL node_modules/.pnpm/@anthropic-ai+claude-agent-sdk-linux-*-musl@*/node_modules/@anthropic-ai/claude-agent-sdk-linux-*-musl /sdk-native/

# -----------------------------------------------------------------------------
# Stage 2: Builder
# -----------------------------------------------------------------------------
FROM node:24-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.28.1 --activate

COPY --from=deps /app/node_modules ./node_modules
# pnpm does not hoist: a workspace package's own devDependencies land in ITS
# node_modules/.bin, never the root's. `pnpm build` runs `pnpm --filter
# @lastest/mcp-server build` -> tsup, so that one package's node_modules has to
# come along. The other workspace deps (db, pool-service, eb-protocol, shared)
# need no such copy: the app imports them as source and everything they require
# at runtime is also a root dependency, so Node resolution walks up to
# /app/node_modules and finds it.
COPY --from=deps /app/packages/mcp-server/node_modules ./packages/mcp-server/node_modules
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
# A home dir (-h) is still needed: app-entrypoint.sh symlinks
# /home/nextjs/.claude → /app/storage/.claude (Agent SDK state) and that
# requires the home dir to exist.
# Alpine BusyBox tools: nologin lives at /sbin/nologin, -D = no password.
RUN addgroup -g 1002 nodejs && \
    adduser -u 1002 -G nodejs -s /sbin/nologin -h /home/nextjs -D nextjs

# Standalone build (includes its own pruned node_modules)
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
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
# (above) — nft traces its content but not the symlink.

# @anthropic-ai/claude-agent-sdk is a serverExternalPackage, so it needs the same
# two manual fixups playwright does above, plus one of its own:
#   1. nft traces the JS package's CONTENT into .pnpm/… but not its top-level
#      node_modules/@anthropic-ai/claude-agent-sdk symlink, so the bare specifier
#      `import("@anthropic-ai/claude-agent-sdk")` does not resolve without it.
#   2. The platform-native CLI binary that sdk.mjs spawns is an optionalDependency
#      nft never sees at all (staged at /sdk-native in the deps stage above).
# The binary goes in as a sibling under node_modules/@anthropic-ai/: sdk.mjs
# locates it with createRequire, and Node resolves the symlink to its .pnpm
# realpath first, so the lookup walks up to /app/node_modules and finds it there.
COPY --from=deps --chown=nextjs:nodejs /sdk-native/ ./node_modules/@anthropic-ai/
RUN set -e; \
    sdk=$(ls -d /app/node_modules/.pnpm/@anthropic-ai+claude-agent-sdk@*/node_modules/@anthropic-ai/claude-agent-sdk | head -1); \
    ln -sfn "$sdk" /app/node_modules/@anthropic-ai/claude-agent-sdk

# Resolve both the way the app does at runtime, so a broken layout fails the
# build instead of surfacing as "Native CLI binary not found" on a live pod.
RUN node --input-type=module -e "import { createRequire } from 'node:module'; const m = await import('@anthropic-ai/claude-agent-sdk'); if (typeof m.query !== 'function') throw new Error('claude-agent-sdk: missing query export'); const req = createRequire('/app/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs'); const arch = process.arch === 'arm64' ? 'arm64' : 'x64'; console.log('claude-agent-sdk OK:', req.resolve('@anthropic-ai/claude-agent-sdk-linux-' + arch + '-musl/claude'));"

# OpenTelemetry tracing (src/otel.ts). This is the ONLY app image that can
# trace: `otelGate()` requires KUBERNETES_SERVICE_HOST, so the root Dockerfile's
# single-container self-host image never loads any of this even if the OTLP env
# vars are present. Tracing additionally stays off until OTEL_TRACING_ENABLED is
# set — see k8s/app.yaml for the full env block.
#
# The OTel packages are serverExternalPackages (next.config.ts): webpack must
# not bundle them, because require-in-the-middle patches the module registry at
# `require()` time and a bundled copy of `http`/`undici` is a different object
# than the patched one — the failure mode is silently zero spans. That means
# src/otel.ts resolves them by BARE SPECIFIER at runtime, so they need the same
# top-level-symlink fixup playwright does above (nft traces the content into
# .pnpm/… but does not create node_modules/@opentelemetry/*). The list below is
# exactly next.config.ts's serverExternalPackages entries — @opentelemetry/
# resources and semantic-conventions are plain JS with nothing to patch, so
# webpack bundles them and they need no runtime resolution. Unpinned on
# purpose: the glob picks up whatever the lockfile resolved, so a version bump
# needs no edit here and `scripts/sync-docker-pins.mjs` has nothing to sync.
RUN set -e; \
    mkdir -p /app/node_modules/@opentelemetry; \
    for p in api sdk-node sdk-trace-node exporter-trace-otlp-proto \
             instrumentation-http instrumentation-undici; do \
      d=$(ls -d /app/node_modules/.pnpm/@opentelemetry+$p@*/node_modules/@opentelemetry/$p 2>/dev/null | head -1); \
      if [ -n "$d" ]; then ln -sfn "$d" /app/node_modules/@opentelemetry/$p; fi; \
    done

# Resolve them the way src/otel.ts does at runtime, so a broken layout fails the
# BUILD instead of degrading to a pod that boots fine and exports no traces.
RUN node -e "['@opentelemetry/api','@opentelemetry/sdk-node','@opentelemetry/sdk-trace-node','@opentelemetry/exporter-trace-otlp-proto','@opentelemetry/instrumentation-http','@opentelemetry/instrumentation-undici'].forEach((m) => require.resolve(m)); console.log('opentelemetry OK');"

# AI providers in this image: the Claude Agent SDK runs (its JS + native runtime
# are both present, see above); the 'claude-cli' provider does NOT — no `claude`
# on PATH and no interactive `claude login`, which is what AI_HOST_CLI_DISABLED=1
# below reports. Because there is no login, the SDK takes its credentials from
# the environment: set ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN (k8s/app.yaml
# wires both as optional secrets). Without either, the app reports the SDK as
# unconfigured and steers users to the Anthropic/OpenAI/OpenRouter API-key
# providers — see src/lib/ai/availability.ts.

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
# No `claude` binary on PATH and no interactive login: disables the 'claude-cli'
# provider only. The Agent SDK stays available (see above).
ENV AI_HOST_CLI_DISABLED=1
# Docker derives HOME from /etc/passwd for USER nextjs, but be explicit — the
# Agent SDK writes its state under $HOME/.claude, which app-entrypoint.sh
# redirects onto the /app/storage volume so it survives pod restarts.
ENV HOME=/home/nextjs
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
