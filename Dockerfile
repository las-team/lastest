# =============================================================================
# Lastest2 - Visual Regression Testing Platform
# Multi-stage Dockerfile for production deployment
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Dependencies
# -----------------------------------------------------------------------------
FROM node:24-slim AS deps

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.28.1 --activate

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/runner/package.json ./packages/runner/

# Install dependencies
RUN pnpm install --frozen-lockfile

# -----------------------------------------------------------------------------
# Stage 2: Builder
# -----------------------------------------------------------------------------
FROM node:24-slim AS builder

# Install build dependencies for native modules
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.28.1 --activate

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/runner/node_modules ./packages/runner/node_modules

# Copy source code
COPY . .

# Git info (passed via --build-arg since .git is excluded)
ARG GIT_HASH=unknown
ARG GIT_COMMIT_COUNT=0

# Set production environment for build
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_GIT_HASH=$GIT_HASH
ENV NEXT_PUBLIC_GIT_COMMIT_COUNT=$GIT_COMMIT_COUNT

# Build the application
RUN pnpm build

# -----------------------------------------------------------------------------
# Stage 3: Production Runner (with Playwright)
# -----------------------------------------------------------------------------
FROM mcr.microsoft.com/playwright:v1.57.0-noble AS runner

WORKDIR /app

# Install locale and set timezone for deterministic rendering
RUN apt-get update && apt-get install -y --no-install-recommends locales && \
    sed -i '/en_US.UTF-8/s/^# //g' /etc/locale.gen && locale-gen && \
    rm -rf /var/lib/apt/lists/*
ENV LANG=en_US.UTF-8
ENV LC_ALL=en_US.UTF-8
ENV TZ=UTC

# Create non-root user
RUN groupadd --gid 1002 nodejs && \
    useradd --uid 1002 --gid nodejs --shell /bin/bash --create-home nextjs

# Copy standalone build (includes node_modules)
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Copy full playwright packages for runtime (standalone prunes them since they're dynamically loaded)
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/.pnpm/playwright@1.57.0/node_modules/playwright ./node_modules/.pnpm/playwright@1.57.0/node_modules/playwright
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/.pnpm/playwright-core@1.57.0/node_modules/playwright-core ./node_modules/.pnpm/playwright-core@1.57.0/node_modules/playwright-core
RUN ln -sf .pnpm/playwright@1.57.0/node_modules/playwright ./node_modules/playwright && \
    ln -sf .pnpm/playwright-core@1.57.0/node_modules/playwright-core ./node_modules/playwright-core

# Copy drizzle config and drizzle-kit for schema push on startup
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY --from=builder --chown=nextjs:nodejs /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/src/lib/db/schema.ts ./src/lib/db/schema.ts
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/drizzle-kit ./node_modules/drizzle-kit
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/.bin/drizzle-kit ./node_modules/.bin/drizzle-kit
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/.pnpm/esbuild@0.25.12 ./node_modules/.pnpm/esbuild@0.25.12
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/.pnpm/@esbuild+linux-x64@0.25.12 ./node_modules/.pnpm/@esbuild+linux-x64@0.25.12
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/.pnpm/esbuild-register@3.6.0_esbuild@0.25.12 ./node_modules/.pnpm/esbuild-register@3.6.0_esbuild@0.25.12
RUN ln -sf .pnpm/esbuild@0.25.12/node_modules/esbuild ./node_modules/esbuild && \
    ln -sf .pnpm/@esbuild+linux-x64@0.25.12/node_modules/@esbuild ./node_modules/@esbuild && \
    ln -sf .pnpm/esbuild-register@3.6.0_esbuild@0.25.12/node_modules/esbuild-register ./node_modules/esbuild-register

# Copy claude-agent-sdk (standalone prunes serverExternalPackages)
COPY --from=deps --chown=nextjs:nodejs \
  /app/node_modules/.pnpm/@anthropic-ai+claude-agent-sdk@0.2.19_zod@4.3.5/node_modules/@anthropic-ai/claude-agent-sdk \
  ./node_modules/.pnpm/@anthropic-ai+claude-agent-sdk@0.2.19_zod@4.3.5/node_modules/@anthropic-ai/claude-agent-sdk
RUN ln -sf .pnpm/@anthropic-ai+claude-agent-sdk@0.2.19_zod@4.3.5/node_modules/@anthropic-ai \
  ./node_modules/@anthropic-ai

# Make claude CLI available for `docker exec ... claude login`
RUN ln -s /app/node_modules/@anthropic-ai/claude-agent-sdk/cli.js /usr/local/bin/claude

# Copy entrypoint script
COPY --chown=nextjs:nodejs scripts/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Create data directories
RUN mkdir -p /app/data /app/storage/screenshots /app/storage/baselines /app/storage/diffs /app/storage/traces /app/storage/videos /app/storage/planned /app/storage/bug-reports /home/nextjs/.claude && \
    chown -R nextjs:nodejs /app && \
    chown nextjs:nodejs /home/nextjs/.claude

# Environment configuration
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_PATH=/app/data/lastest2.db
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Labels for Docker Hub
LABEL org.opencontainers.image.title="Lastest2"
LABEL org.opencontainers.image.description="Visual regression testing platform with Playwright"
LABEL org.opencontainers.image.vendor="Lastest2"
LABEL org.opencontainers.image.source="https://github.com/lastest2/lastest2"

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD wget -q --spider http://localhost:3000/api/health || exit 1

EXPOSE 3000

USER nextjs

# Volumes for persistent data
VOLUME ["/app/data", "/app/storage"]

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "server.js"]
