import Tesseract from 'tesseract.js';

let worker: Tesseract.Worker | null = null;
let workerPromise: Promise<Tesseract.Worker> | null = null;

async function getWorker(): Promise<Tesseract.Worker> {
  if (worker) return worker;

  // Deduplicate concurrent worker creation requests
  if (!workerPromise) {
    console.log('[OCR] Creating Tesseract worker...');
    workerPromise = Tesseract.createWorker('eng').then((w) => {
      worker = w;
      workerPromise = null;
      console.log('[OCR] Tesseract worker ready');
      return w;
    });
  }
  return workerPromise;
}

/**
 * Eagerly initialize the Tesseract worker so it's ready when first OCR request arrives.
 * Call this at recording start when OCR is enabled.
 */
export function warmupWorker(): void {
  getWorker().catch(() => {});
}

/**
 * Extract text from an image buffer using Tesseract OCR.
 * Returns null if confidence is below 60% or timeout (8s) is exceeded.
 * The timeout covers both worker init (if not warmed up) and recognition.
 */
export async function extractText(imageBuffer: Buffer): Promise<string | null> {
  const timeoutMs = 8000;

  try {
    const result = await Promise.race([
      (async () => {
        const w = await getWorker();
        return w.recognize(imageBuffer);
      })(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('OCR timeout')), timeoutMs)
      ),
    ]);

    const { data } = result as Tesseract.RecognizeResult;
    const text = data.text.trim();
    console.log(`[OCR] Recognition result: confidence=${data.confidence.toFixed(1)}%, text="${text.slice(0, 50)}"`);

    if (data.confidence < 60) {
      console.warn(`[OCR] Rejected: confidence ${data.confidence.toFixed(1)}% < 60% threshold`);
      return null;
    }

    return text.length > 0 ? text : null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'OCR timeout') {
      console.warn(`[OCR] Timed out after ${timeoutMs}ms`);
    } else {
      console.warn(`[OCR] Error: ${msg}`);
    }
    return null;
  }
}

/**
 * Terminate the Tesseract worker (call on recording stop).
 * Has a 3s safety timeout to prevent hanging.
 */
export async function terminateWorker(): Promise<void> {
  const cleanup = async () => {
    if (workerPromise) {
      try {
        const w = await workerPromise;
        await w.terminate();
      } catch { /* ignore */ }
      workerPromise = null;
    }
    if (worker) {
      await worker.terminate();
      worker = null;
    }
  };

  try {
    await Promise.race([
      cleanup(),
      new Promise<void>((resolve) => setTimeout(() => {
        console.warn('[OCR] terminateWorker timed out after 3s, forcing cleanup');
        worker = null;
        workerPromise = null;
        resolve();
      }, 3000)),
    ]);
  } catch {
    worker = null;
    workerPromise = null;
  }
}
