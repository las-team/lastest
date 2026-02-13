# =============================================================================
# Lastest2 - Visual Regression Testing Platform
# Multi-stage Dockerfile for production deployment
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Dependencies
# -----------------------------------------------------------------------------
FROM node:20-slim AS deps

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
FROM node:20-slim AS builder

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

# Set production environment for build
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Build the application
RUN pnpm build

# -----------------------------------------------------------------------------
# Stage 3: Production Runner (with Playwright)
# -----------------------------------------------------------------------------
FROM mcr.microsoft.com/playwright:v1.57.0-noble AS runner

WORKDIR /app

# Install Node.js 20 (Playwright image may have older version)
RUN apt-get update && apt-get install -y curl && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd --gid 1002 nodejs && \
    useradd --uid 1002 --gid nodejs --shell /bin/bash --create-home nextjs

# Copy standalone build (includes node_modules)
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Copy drizzle for schema push capability
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY --from=builder --chown=nextjs:nodejs /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/src/lib/db/schema.ts ./src/lib/db/schema.ts

# Copy drizzle-kit and its deps for migrations
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/drizzle-kit ./node_modules/drizzle-kit
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/bindings ./node_modules/bindings
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/file-uri-to-path ./node_modules/file-uri-to-path
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/prebuild-install ./node_modules/prebuild-install
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/node-addon-api ./node_modules/node-addon-api

# Copy entrypoint script
COPY --chown=nextjs:nodejs scripts/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Create data directories
RUN mkdir -p /app/data /app/public/screenshots /app/public/baselines && \
    chown -R nextjs:nodejs /app

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
VOLUME ["/app/data", "/app/public/screenshots", "/app/public/baselines"]

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "server.js"]
