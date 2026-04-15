# =============================================================================
# Lastest - Visual Regression Testing Platform
# Multi-stage Dockerfile for production deployment
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Dependencies
# -----------------------------------------------------------------------------
FROM node:24-slim AS deps

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.28.1 --activate

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/runner/package.json ./packages/runner/
COPY packages/embedded-browser/package.json ./packages/embedded-browser/

# Install dependencies
RUN pnpm install --frozen-lockfile

# -----------------------------------------------------------------------------
# Stage 2: Builder
# -----------------------------------------------------------------------------
FROM node:24-slim AS builder

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
# Dummy secret for build-time page data collection (overridden at runtime)
ENV BETTER_AUTH_SECRET=build-time-placeholder

# Generate build info file
RUN node -e "\
  const pkg = require('./package.json');\
  const runner = require('./packages/runner/package.json');\
  const info = { gitHash: '$GIT_HASH', commitCount: '$GIT_COMMIT_COUNT', version: pkg.version, runnerVersion: runner.version };\
  require('fs').writeFileSync('build-info.json', JSON.stringify(info));"

# Run tests (includes Tesseract OCR verification)
RUN pnpm vitest run --dir src

# Build the application
RUN pnpm build

# Build embedded-browser
RUN cd packages/embedded-browser && npx tsup src/index.ts --format esm --dts

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
COPY --from=builder --chown=nextjs:nodejs /app/build-info.json ./build-info.json

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
# Postgres driver required by drizzle-kit push at container startup
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/.pnpm/postgres@3.4.8 ./node_modules/.pnpm/postgres@3.4.8
RUN ln -sf .pnpm/postgres@3.4.8/node_modules/postgres ./node_modules/postgres
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/.pnpm/esbuild@0.25.12 ./node_modules/.pnpm/esbuild@0.25.12
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/.pnpm/@esbuild+linux-x64@0.25.12 ./node_modules/.pnpm/@esbuild+linux-x64@0.25.12
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/.pnpm/esbuild-register@3.6.0_esbuild@0.25.12 ./node_modules/.pnpm/esbuild-register@3.6.0_esbuild@0.25.12
RUN ln -sf .pnpm/esbuild@0.25.12/node_modules/esbuild ./node_modules/esbuild && \
    ln -sf .pnpm/@esbuild+linux-x64@0.25.12/node_modules/@esbuild ./node_modules/@esbuild && \
    ln -sf .pnpm/esbuild-register@3.6.0_esbuild@0.25.12/node_modules/esbuild-register ./node_modules/esbuild-register

# Copy claude-agent-sdk (standalone prunes serverExternalPackages)
COPY --from=deps --chown=nextjs:nodejs \
  /app/node_modules/.pnpm/@anthropic-ai+claude-agent-sdk@0.2.98_zod@4.3.5/node_modules/@anthropic-ai/claude-agent-sdk \
  ./node_modules/.pnpm/@anthropic-ai+claude-agent-sdk@0.2.98_zod@4.3.5/node_modules/@anthropic-ai/claude-agent-sdk
RUN ln -sf .pnpm/@anthropic-ai+claude-agent-sdk@0.2.98_zod@4.3.5/node_modules/@anthropic-ai \
  ./node_modules/@anthropic-ai

# Copy tesseract.js + all its transitive deps (standalone prunes serverExternalPackages)
# Each subdep is a separate pnpm dir that tesseract.js symlinks to
COPY --from=deps --chown=nextjs:nodejs \
  /app/node_modules/.pnpm/tesseract.js@7.0.0 \
  ./node_modules/.pnpm/tesseract.js@7.0.0
COPY --from=deps --chown=nextjs:nodejs \
  /app/node_modules/.pnpm/tesseract.js-core@7.0.0 \
  ./node_modules/.pnpm/tesseract.js-core@7.0.0
COPY --from=deps --chown=nextjs:nodejs \
  /app/node_modules/.pnpm/bmp-js@0.1.0 \
  ./node_modules/.pnpm/bmp-js@0.1.0
COPY --from=deps --chown=nextjs:nodejs \
  /app/node_modules/.pnpm/zlibjs@0.3.1 \
  ./node_modules/.pnpm/zlibjs@0.3.1
COPY --from=deps --chown=nextjs:nodejs \
  /app/node_modules/.pnpm/wasm-feature-detect@1.8.0 \
  ./node_modules/.pnpm/wasm-feature-detect@1.8.0
COPY --from=deps --chown=nextjs:nodejs \
  /app/node_modules/.pnpm/regenerator-runtime@0.13.11 \
  ./node_modules/.pnpm/regenerator-runtime@0.13.11
COPY --from=deps --chown=nextjs:nodejs \
  /app/node_modules/.pnpm/is-url@1.2.4 \
  ./node_modules/.pnpm/is-url@1.2.4
COPY --from=deps --chown=nextjs:nodejs \
  /app/node_modules/.pnpm/node-fetch@2.7.0 \
  ./node_modules/.pnpm/node-fetch@2.7.0
RUN ln -sf .pnpm/tesseract.js@7.0.0/node_modules/tesseract.js ./node_modules/tesseract.js && \
    ln -sf .pnpm/tesseract.js-core@7.0.0/node_modules/tesseract.js-core ./node_modules/tesseract.js-core

# Install Claude Code CLI globally (for `docker exec ... claude login`)
RUN npm install -g @anthropic-ai/claude-code@latest 2>/dev/null || \
    ln -s /app/node_modules/@anthropic-ai/claude-agent-sdk/cli.js /usr/local/bin/claude

# Copy ws (used by activity-feed-server + embedded-browser)
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/.pnpm/ws@8.19.0/node_modules/ws ./node_modules/.pnpm/ws@8.19.0/node_modules/ws
RUN ln -sf .pnpm/ws@8.19.0/node_modules/ws ./node_modules/ws

# Copy embedded-browser dist + runtime deps
COPY --from=builder --chown=nextjs:nodejs /app/packages/embedded-browser/dist /app/embedded-browser/dist
COPY --from=builder --chown=nextjs:nodejs /app/packages/embedded-browser/package.json /app/embedded-browser/
RUN mkdir -p /app/embedded-browser/node_modules && \
    ln -s /app/node_modules/ws /app/embedded-browser/node_modules/ws && \
    ln -s /app/node_modules/playwright /app/embedded-browser/node_modules/playwright && \
    ln -s /app/node_modules/playwright-core /app/embedded-browser/node_modules/playwright-core

# Copy entrypoint and helper scripts
COPY --chown=nextjs:nodejs scripts/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
COPY --chown=nextjs:nodejs scripts/migrate.js /app/migrate.js
COPY --chown=nextjs:nodejs scripts/ws-proxy-preload.js /app/ws-proxy-preload.js

# Create storage directories
RUN mkdir -p /app/storage/screenshots /app/storage/baselines /app/storage/diffs /app/storage/traces /app/storage/videos /app/storage/planned /app/storage/bug-reports && \
    chown -R nextjs:nodejs /app

# Environment configuration
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# DATABASE_URL must be injected by the deployment — no default. Missing env is fatal at boot.
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Labels for Docker Hub
LABEL org.opencontainers.image.title="Lastest"
LABEL org.opencontainers.image.description="Visual regression testing platform with Playwright"
LABEL org.opencontainers.image.vendor="Lastest"
LABEL org.opencontainers.image.source="https://github.com/las-team/lastest"

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD wget -q --spider http://localhost:3000/api/health || exit 1

EXPOSE 3000 9223 9224

USER nextjs

# Volumes for persistent data
VOLUME ["/app/storage"]

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "--require", "./ws-proxy-preload.js", "server.js"]
