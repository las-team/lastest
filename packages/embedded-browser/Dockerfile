FROM mcr.microsoft.com/playwright:v1.57.0-noble

WORKDIR /app

# System ffmpeg for video watermarking (the Playwright-bundled ffmpeg is a
# stripped build without drawtext/overlay filters and no VP9 encoder).
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

# Copy pre-built dist (built locally via pnpm build) and production package.json
COPY packages/embedded-browser/dist/ ./dist/
COPY packages/embedded-browser/package.json ./

# Install only production dependencies (skip workspace deps — they're bundled by tsup)
RUN sed -i '/"@lastest\/shared": "workspace:\*"/d' package.json && npm install --omit=dev

# Expose CDP port, streaming port, and health check port
EXPOSE 9222 9223 9224

# Health check
HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
  CMD wget -q --spider http://localhost:9224/health || exit 1

CMD ["node", "dist/index.js"]
