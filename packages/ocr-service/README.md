# @lastest/ocr-service

Standalone HTTP microservice that runs Tesseract OCR (tesseract.js WASM
workers) outside the Lastest app process.

## Why a separate container

OCR is the heaviest CPU/memory burst in the app process today:

- **Text-region-aware diffing** (`src/lib/diff/text-regions.ts`) spawns WASM
  workers per diff and competes with the Next.js event loop for CPU.
- Each warm Tesseract worker holds **~150–300 MB** of WASM heap.
- In Docker standalone builds, tesseract.js worker-thread module resolution is
  fragile (see the `uncaughtException` guard the app had to carry).

Moving it into a dedicated container isolates the memory/CPU, removes the
fragile in-process worker threads from the app image, and lets OCR sleep to
near-zero footprint when unused.

## Wake / sleep lifecycle

- **Cold start:** no workers exist until the first request.
- **Wake:** any `/recognize` or `/detect-regions` call lazily spawns workers
  (up to `OCR_MAX_WORKERS`). `/warmup` pre-spawns so recording / diff batches
  don't pay init latency on the first real request.
- **Sleep:** `/sleep` drains in-flight jobs and terminates all workers.
  A missed sleep hint is harmless — the idle timer auto-sleeps after
  `OCR_IDLE_TIMEOUT_MS` (default 2 min) of inactivity.

The app calls `/warmup` when a recording with OCR selectors starts and before
text-aware diff batches, and `/sleep` when recording stops.

## API

| Endpoint | Body | Response |
| --- | --- | --- |
| `GET /health` | — | `{ status, state: cold\|warming\|warm, workers, busy, queued, ... }` |
| `POST /warmup?workers=N` | — | `202 { state, workers }` |
| `POST /sleep` | — | `{ state, deferred? }` |
| `POST /recognize` | PNG bytes | `{ text, confidence }` |
| `POST /detect-regions?granularity=word\|line\|block&minConfidence=50` | PNG bytes | `{ regions: [{x,y,width,height}], confidence }` |

When `OCR_SERVICE_TOKEN` is set, POST endpoints require
`Authorization: Bearer <token>`.

## Env

| Var | Default | Notes |
| --- | --- | --- |
| `PORT` | `8891` | |
| `OCR_LANG` | `eng` | |
| `OCR_LANG_PATH` | — | local dir with `<lang>.traineddata.gz`; baked to `/app/tessdata` in the image so no CDN egress is needed |
| `OCR_MAX_WORKERS` | `2` | one per image of a baseline/current diff pair |
| `OCR_IDLE_TIMEOUT_MS` | `120000` | idle auto-sleep |
| `OCR_SERVICE_TOKEN` | — | optional bearer auth |
| `OCR_MAX_BODY_BYTES` | 32 MiB | request body cap |

## Build & run

```bash
pnpm --filter @lastest/ocr-service build
docker build -f packages/ocr-service/Dockerfile -t lastest-ocr-service:latest .
docker run --rm -p 8891:8891 lastest-ocr-service:latest
```

Dev (host, no container): `pnpm --filter @lastest/ocr-service dev`

App side: set `OCR_SERVICE_URL=http://localhost:8891` (and optionally
`OCR_SERVICE_TOKEN`). When `OCR_SERVICE_URL` is unset the app runs Tesseract
in-process exactly as before — the container is fully optional (ZimaOS /
Olares deployments keep working unchanged until the operator opts in).
