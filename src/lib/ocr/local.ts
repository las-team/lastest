/**
 * In-process Tesseract backend (default when OCR_SERVICE_URL is unset).
 *
 * A single shared worker serves both recording-time text extraction and
 * text-region detection for diffs. Same wake/sleep semantics as the remote
 * container: the worker is spawned lazily on first use ("wake"), kept warm
 * across calls, and auto-terminated after `OCR_IDLE_TIMEOUT_MS` (default 60s)
 * of inactivity ("sleep") so the ~150–300 MB WASM heap isn't held forever by
 * the app process. Explicit warmup/terminate hooks are still available for
 * recording start/stop.
 */

import { ocrIdleTimeoutMs } from "@/lib/ocr/config";
import type { OcrBlockNode } from "@/lib/ocr/regions";

type TesseractModule = typeof import("tesseract.js");
type TesseractWorker = import("tesseract.js").Worker;

export interface LocalRecognizeResult {
  text: string;
  confidence: number;
  blocks: OcrBlockNode[] | null;
}

let worker: TesseractWorker | null = null;
let workerPromise: Promise<TesseractWorker> | null = null;
let inFlight = 0;
let lastActivity = 0;
let idleTimer: NodeJS.Timeout | null = null;

// ---------------------------------------------------------------------------
// Crash suppression
//
// tesseract.js worker threads can fail with broken module resolution in Docker
// standalone builds; the failure propagates as an uncaughtException that would
// kill the app's event loop. While any OCR call is active we install a
// refcounted listener that swallows tesseract-originated crashes (the call
// itself then fails via the crashed flag / recognize rejection).
// ---------------------------------------------------------------------------

let suppressionRefs = 0;
let workerCrashed = false;

function suppressTesseractCrash(err: Error): void {
  const stack = err.stack || "";
  const isTesseract =
    stack.includes("tesseract") ||
    stack.includes("worker-script") ||
    stack.includes("createWorker");
  if (isTesseract) {
    workerCrashed = true;
    return; // swallow — surfaced by the active call
  }
  throw err; // re-throw non-tesseract errors
}

function pushSuppression(): void {
  if (suppressionRefs++ === 0) {
    process.on("uncaughtException", suppressTesseractCrash);
  }
}

function popSuppression(): void {
  if (--suppressionRefs === 0) {
    process.removeListener("uncaughtException", suppressTesseractCrash);
  }
}

// ---------------------------------------------------------------------------
// Worker lifecycle
// ---------------------------------------------------------------------------

async function importTesseract(): Promise<TesseractModule> {
  return Promise.race([
    import("tesseract.js"),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("Tesseract.js import timeout")),
        10_000,
      ),
    ),
  ]);
}

function touch(): void {
  lastActivity = Date.now();
  scheduleIdleSleep();
}

function scheduleIdleSleep(): void {
  if (idleTimer) clearTimeout(idleTimer);
  const timeoutMs = ocrIdleTimeoutMs();
  idleTimer = setTimeout(() => {
    if (inFlight > 0 || (!worker && !workerPromise)) return;
    if (Date.now() - lastActivity < timeoutMs) {
      scheduleIdleSleep();
      return;
    }
    console.log("[OCR] Idle — terminating in-process Tesseract worker");
    void terminateLocalWorker();
  }, timeoutMs + 250);
  // Never keep the process alive just for the sleep timer
  idleTimer.unref();
}

async function getWorker(): Promise<TesseractWorker> {
  touch();
  if (worker) return worker;
  if (!workerPromise) {
    console.log("[OCR] Creating Tesseract worker...");
    workerCrashed = false;
    workerPromise = (async () => {
      pushSuppression();
      try {
        const Tesseract = await importTesseract();
        // Optional local traineddata dir (mirrors the OCR container's env) so
        // restricted-egress self-hosts can avoid the CDN download.
        const langPath = (process.env.OCR_LANG_PATH || "").trim();
        const w = await Tesseract.createWorker(
          "eng",
          1,
          langPath ? { langPath, cacheMethod: "none" } : {},
        );
        if (workerCrashed) {
          await w.terminate().catch(() => {});
          throw new Error("Tesseract worker crashed during init");
        }
        worker = w;
        console.log("[OCR] Tesseract worker ready");
        return w;
      } finally {
        popSuppression();
        workerPromise = null;
      }
    })();
    workerPromise.catch(() => {});
  }
  return workerPromise;
}

/** Eagerly initialize the shared worker (recording start / diff batch). */
export function warmupLocalWorker(): void {
  getWorker().catch(() => {});
}

/**
 * Run recognition on the shared worker. Returns null on any failure — OCR is
 * always best-effort (callers fall back to "no text detected").
 */
export async function recognizeLocal(
  image: Buffer,
  options: { blocks?: boolean } = {},
): Promise<LocalRecognizeResult | null> {
  inFlight++;
  pushSuppression();
  try {
    const w = await getWorker();
    const result = await w.recognize(
      image,
      {},
      // tesseract.js v6+ only emits `text` by default — `blocks: true` must be
      // requested explicitly to get bbox data.
      { text: true, blocks: options.blocks === true },
    );
    if (workerCrashed) throw new Error("Tesseract worker crashed");
    return {
      text: result.data.text ?? "",
      confidence: result.data.confidence ?? 0,
      blocks: (result.data.blocks as OcrBlockNode[] | null | undefined) ?? null,
    };
  } catch (err) {
    console.warn(
      `[OCR] Local recognition failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    if (workerCrashed) {
      // Drop the crashed worker so the next call respawns cleanly
      worker = null;
    }
    return null;
  } finally {
    popSuppression();
    inFlight--;
    touch();
  }
}

/**
 * Terminate the shared worker (recording stop / idle sleep).
 * Has a 3s safety timeout to prevent hanging.
 */
export async function terminateLocalWorker(): Promise<void> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  const cleanup = async () => {
    if (workerPromise) {
      try {
        const w = await workerPromise;
        await w.terminate();
      } catch {
        /* ignore */
      }
    }
    if (worker) {
      const w = worker;
      worker = null;
      await w.terminate();
    }
  };

  try {
    await Promise.race([
      cleanup(),
      new Promise<void>((resolve) =>
        setTimeout(() => {
          console.warn(
            "[OCR] terminateLocalWorker timed out after 3s, forcing cleanup",
          );
          resolve();
        }, 3000),
      ),
    ]);
  } catch {
    /* ignore */
  } finally {
    worker = null;
    workerPromise = null;
  }
}
