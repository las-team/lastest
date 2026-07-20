# Lastest OCR Service — standalone Tesseract OCR container.
# Build context is the repo root (like the EB image):
#   pnpm --filter @lastest/ocr-service build
#   docker build -f packages/ocr-service/Dockerfile -t lastest-ocr-service:latest .
FROM node:24-slim

WORKDIR /app

# Bake the traineddata into the image so worker spawn needs no CDN egress at
# runtime (Olares/self-hosted networks may have restricted outbound access).
# Same source tesseract.js v7 defaults to (jsdelivr @tesseract.js-data).
ADD https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz /app/tessdata/eng.traineddata.gz
RUN chmod 644 /app/tessdata/eng.traineddata.gz

# Copy pre-built dist (built locally via pnpm build) and production package.json
COPY packages/ocr-service/dist/ ./dist/
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
