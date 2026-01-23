import Tesseract from 'tesseract.js';

let worker: Tesseract.Worker | null = null;

async function getWorker(): Promise<Tesseract.Worker> {
  if (!worker) {
    worker = await Tesseract.createWorker('eng');
  }
  return worker;
}

/**
 * Extract text from an image buffer using Tesseract OCR.
 * Returns null if confidence is below 60% or timeout (3s) is exceeded.
 */
export async function extractText(imageBuffer: Buffer): Promise<string | null> {
  const timeoutMs = 3000;

  try {
    const result = await Promise.race([
      (async () => {
        const w = await getWorker();
        return w.recognize(imageBuffer);
      })(),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error('OCR timeout')), timeoutMs)
      ),
    ]);

    if (!result) return null;

    const { data } = result as Tesseract.RecognizeResult;
    if (data.confidence < 60) return null;

    const text = data.text.trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

/**
 * Terminate the Tesseract worker (call on recording stop).
 */
export async function terminateWorker(): Promise<void> {
  if (worker) {
    await worker.terminate();
    worker = null;
  }
}
