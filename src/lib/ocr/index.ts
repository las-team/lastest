/**
 * Unified OCR facade — remote-only.
 *
 * All OCR work (recording-time `ocr-text` selectors + text-region-aware
 * diffing) runs in the standalone OCR container (`packages/ocr-service`).
 * `OCR_SERVICE_URL` is required for OCR features — for local dev the
 * container ships in ./docker-compose.yml, so `docker compose up -d` plus
 * `OCR_SERVICE_URL=http://localhost:8891` in `.env.local` is all it takes.
 *
 * When the env var is unset the app still boots, but OCR features are
 * disabled: calls return null / no regions (standard diff, no ocr-text
 * selector) and a one-time warning is logged. There is deliberately no
 * in-process Tesseract fallback — that would silently reintroduce the WASM
 * memory/CPU load in the app process that the container exists to isolate.
 *
 * Wake/sleep: the service wakes lazily on any request; `ocrWarmup()` is
 * called at recording start and before diff pairs so the first real request
 * doesn't pay worker-init latency, `ocrSleep()` on recording stop; the
 * service also auto-sleeps after idle so a missed hint never leaks memory.
 */

import { isRemoteOCR } from "@/lib/ocr/config";
import {
  remoteDetectRegions,
  remoteRecognize,
  remoteSleep,
  remoteWarmup,
} from "@/lib/ocr/remote";
import type {
  OcrGranularity,
  OcrRecognition,
  OcrRegion,
  OcrWord,
} from "@/lib/ocr/types";

export type { OcrGranularity, OcrRecognition, OcrRegion, OcrWord };
export { isRemoteOCR };

let warnedUnconfigured = false;

function serviceConfigured(): boolean {
  if (isRemoteOCR()) return true;
  if (!warnedUnconfigured) {
    warnedUnconfigured = true;
    console.warn(
      "[OCR] OCR_SERVICE_URL is not set — OCR features (ocr-text selectors, " +
        "text-region-aware diffing) are disabled. Start the OCR container " +
        "(`docker compose up -d`) and set OCR_SERVICE_URL=http://localhost:8891.",
    );
  }
  return false;
}

/**
 * Full-image text extraction (recording-time `ocr-text` selectors).
 * Returns null when OCR fails or is not configured.
 */
export async function ocrRecognize(
  image: Buffer,
): Promise<OcrRecognition | null> {
  if (!serviceConfigured()) return null;
  return remoteRecognize(image);
}

/**
 * Detect text bounding boxes for text-region-aware diffing.
 * Returns null when OCR fails or is not configured (caller falls back to a
 * standard single-pass diff), otherwise the raw (unmerged) region list.
 */
export async function ocrDetectRegions(
  image: Buffer,
  granularity: OcrGranularity,
  minConfidence: number,
): Promise<OcrRegion[] | null> {
  if (!serviceConfigured()) return null;
  return remoteDetectRegions(image, granularity, minConfidence);
}

/**
 * Wake the OCR service so the first real request doesn't pay worker-init
 * latency. Fire-and-forget and idempotent — safe to call on every recording
 * start / diff batch.
 */
export function ocrWarmup(workers = 1): void {
  if (!serviceConfigured()) return;
  void remoteWarmup(workers);
}

/**
 * Put the OCR service to sleep (recording stop). Best-effort — the service
 * also auto-sleeps after its idle timeout, so a missed call never leaks.
 */
export async function ocrSleep(): Promise<void> {
  if (!isRemoteOCR()) return;
  await remoteSleep();
}
