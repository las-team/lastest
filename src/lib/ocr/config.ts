/**
 * OCR backend selection.
 *
 * When `OCR_SERVICE_URL` is set, all OCR work (recording-time text extraction
 * and text-region-aware diffing) is sent to the standalone OCR container
 * (`packages/ocr-service`). When unset, Tesseract runs in-process — the
 * container is fully optional so existing deployments (ZimaOS compose, Olares)
 * keep working unchanged until the operator opts in.
 *
 * Env:
 *   OCR_SERVICE_URL        e.g. http://lastest-ocr:8891 (in-cluster) or
 *                          http://localhost:8891 (host dev + compose profile)
 *   OCR_SERVICE_TOKEN      optional bearer token, must match the service's
 *   OCR_REQUEST_TIMEOUT_MS per-request timeout for remote calls (default 15000)
 *   OCR_IDLE_TIMEOUT_MS    in-process worker idle auto-sleep (default 60000)
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

export function ocrIdleTimeoutMs(): number {
  const n = parseInt(process.env.OCR_IDLE_TIMEOUT_MS || "", 10);
  return Number.isFinite(n) && n > 0 ? n : 60_000;
}
