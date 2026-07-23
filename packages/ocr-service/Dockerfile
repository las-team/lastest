# Lastest OCR Service — standalone Tesseract OCR container.
# Self-contained: builds the TypeScript inside the image, so a plain
# `docker compose up -d` works with no local pre-build. Build context is the
# repo root:
#   docker build -f packages/ocr-service/Dockerfile -t lastest-ocr-service:latest .

# -----------------------------------------------------------------------------
# Stage 1: Builder (dev deps + tsup)
# -----------------------------------------------------------------------------
FROM node:24-slim AS builder

WORKDIR /build

COPY packages/ocr-service/package.json packages/ocr-service/tsconfig.json packages/ocr-service/tsup.config.ts ./
COPY packages/ocr-service/src/ ./src/

# npm (not pnpm) on purpose: the package has no workspace deps, and npm avoids
# needing the monorepo lockfile in the image build (same pattern as the EB
# image's runtime install).
RUN npm install && npx tsup

# -----------------------------------------------------------------------------
# Stage 2: Runtime
# -----------------------------------------------------------------------------
FROM node:24-slim

WORKDIR /app

# Bake the traineddata into the image so worker spawn needs no CDN egress at
# runtime (Olares/self-hosted networks may have restricted outbound access).
# Same source tesseract.js v7 defaults to (jsdelivr @tesseract.js-data).
ADD https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz /app/tessdata/eng.traineddata.gz
RUN chmod 644 /app/tessdata/eng.traineddata.gz

COPY --from=builder /build/dist/ ./dist/
COPY packages/ocr-service/package.json ./

# Install only production dependencies (tesseract.js + its worker files)
RUN npm install --omit=dev && npm cache clean --force

ENV OCR_LANG_PATH=/app/tessdata
ENV PORT=8891

EXPOSE 8891

# node:slim has no wget/curl — use node's global fetch for the healthcheck
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:8891/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

LABEL org.opencontainers.image.title="Lastest OCR Service"
LABEL org.opencontainers.image.description="Tesseract OCR microservice for the Lastest visual regression platform"
LABEL org.opencontainers.image.source="https://github.com/las-team/lastest"
LABEL com.docker.compose.project="lastest"

USER node

CMD ["node", "dist/index.js"]
