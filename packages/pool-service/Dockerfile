# Lastest EB Pool Service — standalone singleton owning the browser-capacity
# plane (EB provisioning, pool caps/warm pool/launch throttle, idle+stale EB
# reapers). Runs as its own single-replica Deployment in k8s (only it holds
# Job-create RBAC — see k8s/pool-service.yaml); the app talks to it over HTTP
# via @lastest/pool-service/client (EB_POOL_SERVICE_URL / _TOKEN).
#
# Self-contained: builds the TypeScript inside the image (esbuild bundles
# @lastest/db + @lastest/eb-protocol + @lastest/shared straight from source,
# so the runtime stage ships two dependency-free CommonJS bundles — no
# node_modules at all). Build context is the repo root:
#   docker build -f packages/pool-service/Dockerfile -t lastest-pool-service:latest .

# -----------------------------------------------------------------------------
# Stage 1: Builder — only the workspace packages the bundle needs
# -----------------------------------------------------------------------------
FROM node:24-slim AS builder

WORKDIR /build

RUN corepack enable && corepack prepare pnpm@10.28.1 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/eb-protocol/package.json ./packages/eb-protocol/
COPY packages/db/package.json ./packages/db/
COPY packages/pool-service/package.json ./packages/pool-service/

RUN pnpm install --frozen-lockfile

COPY packages/shared/ ./packages/shared/
COPY packages/eb-protocol/ ./packages/eb-protocol/
COPY packages/db/ ./packages/db/
COPY packages/pool-service/ ./packages/pool-service/

RUN pnpm --filter @lastest/pool-service build

# -----------------------------------------------------------------------------
# Stage 2: Runtime — bare node, no node_modules (fully bundled by esbuild)
# -----------------------------------------------------------------------------
FROM node:24-slim

WORKDIR /app

RUN groupadd --gid 1002 nodejs && \
    useradd --uid 1002 --gid nodejs --shell /bin/bash --create-home pool

COPY --from=builder --chown=pool:nodejs /build/packages/pool-service/dist/main.cjs ./main.cjs
# OpenTelemetry preload — see src/otel-bootstrap.ts for why it is a separate
# CommonJS bundle rather than an import inside main.cjs.
COPY --from=builder --chown=pool:nodejs /build/packages/pool-service/dist/otel-bootstrap.cjs ./otel-bootstrap.cjs

ENV NODE_ENV=production
# DATABASE_URL must be injected by the deployment — no default.
# ENCRYPTION_KEY must match the app's (signs stream grants + EB bootstrap tokens).
ENV EB_POOL_PORT=9500
# Default HOST is 127.0.0.1 (fine for loopback single-container mode) — a
# container needs 0.0.0.0 to be reachable from the app's Service DNS name.
ENV EB_POOL_HOST=0.0.0.0

EXPOSE 9500

# node:slim has no wget/curl — use node's global fetch for the healthcheck
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:9500/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

LABEL org.opencontainers.image.title="Lastest EB Pool Service"
LABEL org.opencontainers.image.description="EB provisioning/pool-capacity plane for the Lastest visual regression platform"
LABEL org.opencontainers.image.source="https://github.com/las-team/lastest"
LABEL com.docker.compose.project="lastest"

USER pool

# `--require` here rather than ENV NODE_OPTIONS on purpose: NODE_OPTIONS would
# also apply to the HEALTHCHECK's `node -e` above and to every process-mode EB
# child this service spawns, booting a throwaway OTel SDK in each.
#
# The preload itself is inert unless OTEL_TRACING_ENABLED is truthy AND the
# process is inside a Kubernetes pod AND a collector endpoint is set (see
# `otelGate()` in src/otel.ts) — this image is k8s-only, so that is the only
# place tracing can come on. The single-container self-host image bundles the
# same `main.cjs` but never loads this preload (scripts/docker-entrypoint.sh).
CMD ["node", "--require", "/app/otel-bootstrap.cjs", "main.cjs"]
