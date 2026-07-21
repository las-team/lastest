/**
 * Unified OCR facade.
 *
 * Backend is picked per-call from env: remote container when OCR_SERVICE_URL
 * is set (see `config.ts`), in-process Tesseract otherwise. Both backends
 * share the same wake/sleep model — warm up when recording starts or a
 * text-aware diff batch begins, sleep on recording stop or after idle.
 *
 * All results are best-effort: failures surface as `null` / empty regions and
 * callers degrade gracefully (standard diff, no ocr-text selector).
 */

import { isRemoteOCR } from "@/lib/ocr/config";
import {
  recognizeLocal,
  terminateLocalWorker,
  warmupLocalWorker,
} from "@/lib/ocr/local";
import {
  extractRegionsFromBlocks,
  extractWordsFromBlocks,
} from "@/lib/ocr/regions";
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
} from "@/lib/ocr/types";

export type { OcrGranularity, OcrRecognition, OcrRegion };
export { isRemoteOCR };

/**
 * Full-image text extraction (recording-time `ocr-text` selectors).
 * Returns null when OCR fails or is unavailable.
 */
export async function ocrRecognize(
  image: Buffer,
): Promise<OcrRecognition | null> {
  if (isRemoteOCR()) {
    return remoteRecognize(image);
  }
  // blocks:true so per-word confidences ride along (same contract as the
  // remote /recognize) — callers use them to drop icon-glyph junk words.
  const result = await recognizeLocal(image, { blocks: true });
  return result
    ? {
        text: result.text,
        confidence: result.confidence,
        words: result.blocks ? extractWordsFromBlocks(result.blocks) : null,
      }
    : null;
}

/**
 * Detect text bounding boxes for text-region-aware diffing.
 * Returns null when OCR fails or is unavailable (caller falls back to a
 * standard single-pass diff), otherwise the raw (unmerged) region list.
 */
export async function ocrDetectRegions(
  image: Buffer,
  granularity: OcrGranularity,
  minConfidence: number,
): Promise<OcrRegion[] | null> {
  if (isRemoteOCR()) {
    return remoteDetectRegions(image, granularity, minConfidence);
  }
  const result = await recognizeLocal(image, { blocks: true });
  if (!result) return null;
  return result.blocks
    ? extractRegionsFromBlocks(result.blocks, granularity, minConfidence)
    : [];
}

/**
 * Wake the OCR backend so the first real request doesn't pay worker-init
 * latency. Fire-and-forget and idempotent — safe to call on every recording
 * start / diff batch.
 */
export function ocrWarmup(workers = 1): void {
  if (isRemoteOCR()) {
    void remoteWarmup(workers);
    return;
  }
  warmupLocalWorker();
}

/**
 * Put the OCR backend to sleep (recording stop). Best-effort — both backends
 * also auto-sleep after their idle timeout, so a missed call never leaks.
 */
export async function ocrSleep(): Promise<void> {
  if (isRemoteOCR()) {
    await remoteSleep();
    return;
  }
  await terminateLocalWorker();
}
