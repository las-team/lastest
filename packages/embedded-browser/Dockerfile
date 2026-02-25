FROM mcr.microsoft.com/playwright:v1.50.0-noble

WORKDIR /app

# Copy package files
COPY packages/embedded-browser/package.json ./
COPY packages/embedded-browser/tsconfig.json ./

# Install dependencies
RUN npm install --production

# Copy source and build
COPY packages/embedded-browser/src/ ./src/
RUN npx tsup src/index.ts --format esm --dts

# Expose streaming port and health check port
EXPOSE 9223 9224

# Health check
HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
  CMD wget -q --spider http://localhost:9224/health || exit 1

CMD ["node", "dist/index.js"]
