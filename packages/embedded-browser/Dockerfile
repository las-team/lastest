FROM mcr.microsoft.com/playwright:v1.57.0-noble

WORKDIR /app

# Copy pre-built dist (built locally via pnpm build) and production package.json
COPY packages/embedded-browser/dist/ ./dist/
COPY packages/embedded-browser/package.json ./

# Install only production dependencies (skip workspace deps — they're bundled by tsup)
RUN sed -i '/"@lastest\/shared": "workspace:\*"/d' package.json && npm install --omit=dev

# Expose streaming port and health check port
EXPOSE 9223 9224

# Health check
HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
  CMD wget -q --spider http://localhost:9224/health || exit 1

CMD ["node", "dist/index.js"]
