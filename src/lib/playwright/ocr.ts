/**
 * Recording-time OCR helpers.
 *
 * Thin wrapper around the unified OCR facade (`src/lib/ocr`): work runs in the
 * standalone OCR container when `OCR_SERVICE_URL` is set, in-process Tesseract
 * otherwise. The historical API (warmup / extract / terminate) is preserved
 * for recording start / capture / stop.
 */

import { ocrRecognize, ocrSleep, ocrWarmup } from "@/lib/ocr";

/**
 * Eagerly wake the OCR backend so it's ready when the first OCR request
 * arrives. Call this at recording start when OCR is enabled.
 */
export function warmupWorker(): void {
  ocrWarmup();
}

/**
 * Extract text from an image buffer using Tesseract OCR.
 * Returns null if confidence is below 60% or timeout (8s) is exceeded.
 * The timeout covers backend wake-up (if not warmed up) and recognition.
 */
export async function extractText(imageBuffer: Buffer): Promise<string | null> {
  const timeoutMs = 8000;

  try {
    const result = await Promise.race([
      ocrRecognize(imageBuffer),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("OCR timeout")), timeoutMs),
      ),
    ]);

    if (!result) return null;

    const text = result.text.trim();
    console.log(
      `[OCR] Recognition result: confidence=${result.confidence.toFixed(1)}%, text="${text.slice(0, 50)}"`,
    );

    if (result.confidence < 60) {
      console.warn(
        `[OCR] Rejected: confidence ${result.confidence.toFixed(1)}% < 60% threshold`,
      );
      return null;
    }

    return text.length > 0 ? text : null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "OCR timeout") {
      console.warn(`[OCR] Timed out after ${timeoutMs}ms`);
    } else {
      console.warn(`[OCR] Error: ${msg}`);
    }
    return null;
  }
}

/**
 * Put the OCR backend to sleep (call on recording stop). Terminates the
 * in-process worker or sends a sleep hint to the OCR container; both backends
 * also auto-sleep after idle, so this is best-effort.
 */
export async function terminateWorker(): Promise<void> {
  await ocrSleep();
}
