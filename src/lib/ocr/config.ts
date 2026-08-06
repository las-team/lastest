/**
 * OCR service configuration.
 *
 * All OCR work (recording-time text extraction and text-region-aware
 * diffing) runs in the standalone OCR container (`packages/ocr-service`);
 * `OCR_SERVICE_URL` is REQUIRED for OCR features. There is no in-process
 * Tesseract backend — when the env var is unset, OCR features are disabled
 * (graceful degradation with a one-time warning; see `src/lib/ocr/index.ts`).
 *
 * Env:
 *   OCR_SERVICE_URL        e.g. http://lastest-ocr:8891 (in-cluster) or
 *                          http://localhost:8891 (host dev; the container is
 *                          part of ./docker-compose.yml)
 *   OCR_SERVICE_TOKEN      optional bearer token, must match the service's
 *   OCR_REQUEST_TIMEOUT_MS per-request timeout for remote calls (default 15000)
 */

export function ocrServiceUrl(): string | null {
  const raw = (process.env.OCR_SERVICE_URL || "").trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

export function isRemoteOCR(): boolean {
  return ocrServiceUrl() !== null;
}

export function ocrServiceToken(): string | null {
  const raw = (process.env.OCR_SERVICE_TOKEN || "").trim();
  return raw || null;
}

export function ocrRequestTimeoutMs(): number {
  const n = parseInt(process.env.OCR_REQUEST_TIMEOUT_MS || "", 10);
  return Number.isFinite(n) && n > 0 ? n : 15_000;
}
