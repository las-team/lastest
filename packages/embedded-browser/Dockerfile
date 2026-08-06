FROM mcr.microsoft.com/playwright:v1.57.0-noble

WORKDIR /app

# System ffmpeg for video watermarking (the Playwright-bundled ffmpeg is a
# stripped build without drawtext/overlay filters and no VP9 encoder).
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

# Copy pre-built dist (built locally via pnpm build) and production package.json.
# Owned by pwuser so the non-root runtime can read its own app tree.
COPY --chown=pwuser:pwuser packages/embedded-browser/dist/ ./dist/
COPY --chown=pwuser:pwuser packages/embedded-browser/package.json ./

# Install only production dependencies (skip workspace deps — they're bundled by tsup).
# npm writes node_modules as root, so fix ownership afterwards so pwuser can
# read/execute the install tree without ever running as root.
RUN sed -i '/"@lastest\/[a-z-]*": "workspace:\*"/d' package.json \
  && npm install --omit=dev \
  && chown -R pwuser:pwuser /app

# Run as the non-root image user (pwuser, uid 1001) shipped by the Playwright
# base image. Running as root forced Chromium into --no-sandbox mode, leaving
# both untrusted user code and untrusted web content un-sandboxed as root.
USER pwuser

# Expose CDP port, streaming port, and health check port
EXPOSE 9222 9223 9224

# Health check
HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
  CMD wget -q --spider http://localhost:9224/health || exit 1

CMD ["node", "dist/index.js"]
