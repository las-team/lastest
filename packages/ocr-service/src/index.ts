/**
 * Lastest OCR Service
 *
 * Standalone HTTP microservice that wraps Tesseract OCR (tesseract.js) so the
 * heavy WASM workers run outside the app process. The app talks to it via
 * `src/lib/ocr/remote.ts` when `OCR_SERVICE_URL` is set; when unset the app
 * falls back to running Tesseract in-process, so this container is optional.
 *
 * Wake/sleep model:
 *   - Cold by default: no Tesseract workers exist until the first request.
 *   - Any /recognize or /detect-regions request wakes the pool (lazy spawn,
 *     up to OCR_MAX_WORKERS).
 *   - POST /warmup?workers=N pre-spawns workers (called at recording start and
 *     before diff batches so the first real request doesn't pay init cost).
 *   - POST /sleep drains in-flight jobs then terminates all workers (called at
 *     recording stop). Idle auto-sleep also fires after OCR_IDLE_TIMEOUT_MS
 *     without activity, so a missed sleep hint never leaks memory.
 *
 * Endpoints:
 *   GET  /health                 → { status, state, workers, busy, queued, ... }
 *   POST /warmup[?workers=N]     → 202 { state, workers }
 *   POST /sleep                  → { state }
 *   POST /recognize              → body: PNG → { text, confidence }
 *   POST /detect-regions?granularity=word&minConfidence=50
 *                                → body: PNG → { regions: [{x,y,width,height}] }
 *
 * Env:
 *   PORT                 (default 8891)
 *   OCR_LANG             (default "eng")
 *   OCR_LANG_PATH        local dir with <lang>.traineddata.gz (baked into the
 *                        Docker image so no CDN egress is needed at runtime)
 *   OCR_MAX_WORKERS      (default 2 — one per image of a baseline/current pair)
 *   OCR_IDLE_TIMEOUT_MS  (default 120000)
 *   OCR_SERVICE_TOKEN    optional shared secret; when set, POST endpoints
 *                        require `Authorization: Bearer <token>`
 *   OCR_MAX_BODY_BYTES   (default 33554432 = 32 MiB)
 */

import http from "node:http";
import { createWorker, type Worker, type RecognizeResult } from "tesseract.js";

const PORT = parseInt(process.env.PORT || "8891", 10);
const LANG = process.env.OCR_LANG || "eng";
const LANG_PATH = process.env.OCR_LANG_PATH || "";
const MAX_WORKERS = clampInt(process.env.OCR_MAX_WORKERS, 2, 1, 8);
const IDLE_TIMEOUT_MS = clampInt(
  process.env.OCR_IDLE_TIMEOUT_MS,
  120_000,
  5_000,
  3_600_000,
);
const TOKEN = (process.env.OCR_SERVICE_TOKEN || "").trim();
const MAX_BODY_BYTES = clampInt(
  process.env.OCR_MAX_BODY_BYTES,
  32 * 1024 * 1024,
  1024,
  256 * 1024 * 1024,
);

function clampInt(
  raw: string | undefined,
  def: number,
  min: number,
  max: number,
): number {
  const n = parseInt(raw || "", 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

// ---------------------------------------------------------------------------
// Worker pool with wake/sleep lifecycle
// ---------------------------------------------------------------------------

interface PoolEntry {
  worker: Worker;
  busy: boolean;
}

const pool: PoolEntry[] = [];
let spawning = 0;
let inFlight = 0;
let lastActivity = Date.now();
let idleTimer: NodeJS.Timeout | null = null;
let shuttingDown = false;

type Job = (entry: PoolEntry) => Promise<void>;
const queue: Array<{ run: Job; reject: (err: Error) => void }> = [];

function touch(): void {
  lastActivity = Date.now();
  scheduleIdleCheck();
}

function scheduleIdleCheck(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    void maybeSleep();
  }, IDLE_TIMEOUT_MS + 250);
  idleTimer.unref();
}

async function maybeSleep(): Promise<void> {
  if (inFlight > 0 || queue.length > 0 || spawning > 0) {
    scheduleIdleCheck();
    return;
  }
  if (Date.now() - lastActivity < IDLE_TIMEOUT_MS) {
    scheduleIdleCheck();
    return;
  }
  if (pool.length > 0) {
    console.log(
      `[ocr-service] Idle for ${Math.round((Date.now() - lastActivity) / 1000)}s — sleeping (${pool.length} worker(s) terminated)`,
    );
    await terminateAll();
  }
}

async function terminateAll(): Promise<void> {
  const entries = pool.splice(0, pool.length);
  await Promise.all(
    entries.map((e) => e.worker.terminate().catch(() => undefined)),
  );
}

const SPAWN_TIMEOUT_MS = 60_000;
const JOB_TIMEOUT_MS = clampInt(
  process.env.OCR_JOB_TIMEOUT_MS,
  60_000,
  1_000,
  600_000,
);

async function spawnWorker(): Promise<PoolEntry | null> {
  spawning++;
  try {
    const worker = await Promise.race([
      createWorker(LANG, 1, {
        ...(LANG_PATH ? { langPath: LANG_PATH, cacheMethod: "none" } : {}),
      }),
      new Promise<never>((_, reject) => {
        const t = setTimeout(
          () => reject(new Error("worker spawn timeout")),
          SPAWN_TIMEOUT_MS,
        );
        t.unref();
      }),
    ]);
    const entry: PoolEntry = { worker, busy: false };
    pool.push(entry);
    console.log(`[ocr-service] Worker ready (pool=${pool.length})`);
    return entry;
  } catch (err) {
    console.error(
      `[ocr-service] Worker spawn failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  } finally {
    spawning--;
  }
}

function pump(): void {
  while (queue.length > 0) {
    const idle = pool.find((e) => !e.busy);
    if (idle) {
      const item = queue.shift()!;
      idle.busy = true;
      void item.run(idle).finally(() => {
        idle.busy = false;
        touch();
        pump();
      });
      continue;
    }
    if (pool.length + spawning < MAX_WORKERS) {
      void spawnWorker().then((entry) => {
        if (!entry && queue.length > 0 && pool.length + spawning === 0) {
          // Nothing can serve the queue — fail pending jobs instead of hanging.
          for (const item of queue.splice(0, queue.length)) {
            item.reject(new Error("OCR worker spawn failed"));
          }
        }
        pump();
      });
    }
    return;
  }
}

function withWorker<T>(fn: (worker: Worker) => Promise<T>): Promise<T> {
  touch();
  return new Promise<T>((resolve, reject) => {
    inFlight++;
    let settled = false;
    const settle = <R>(cb: (v: R) => void) => {
      return (v: R) => {
        if (settled) return;
        settled = true;
        inFlight--;
        touch();
        cb(v);
      };
    };
    queue.push({
      run: (entry) => {
        // Watchdog: a wedged WASM worker would otherwise hold its pool slot
        // forever. On timeout, fail the job and prune+terminate the worker so
        // the pool respawns a fresh one for subsequent jobs.
        let watchdogTimer: NodeJS.Timeout | undefined;
        const watchdog = new Promise<never>((_, rejectJob) => {
          watchdogTimer = setTimeout(() => {
            const i = pool.indexOf(entry);
            if (i >= 0) pool.splice(i, 1);
            void entry.worker.terminate().catch(() => undefined);
            console.error(
              `[ocr-service] Job exceeded ${JOB_TIMEOUT_MS}ms — worker terminated (pool=${pool.length})`,
            );
            rejectJob(new Error("OCR job timeout"));
          }, JOB_TIMEOUT_MS);
          watchdogTimer.unref();
        });
        return Promise.race([fn(entry.worker), watchdog])
          .finally(() => clearTimeout(watchdogTimer))
          .then(settle(resolve), settle(reject));
      },
      reject: settle(reject),
    });
    pump();
  });
}

async function warmup(workers: number): Promise<void> {
  touch();
  const want = Math.min(Math.max(1, workers), MAX_WORKERS);
  const deficit = want - pool.length - spawning;
  for (let i = 0; i < deficit; i++) {
    void spawnWorker().then(() => pump());
  }
}

// ---------------------------------------------------------------------------
// Region extraction (keep in sync with src/lib/ocr/regions.ts in the app —
// same walk over Tesseract's blocks → paragraphs → lines → words tree)
// ---------------------------------------------------------------------------

type Granularity = "word" | "line" | "block";

interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

function extractRegions(
  blocks: NonNullable<RecognizeResult["data"]["blocks"]>,
  granularity: Granularity,
  minConfidence: number,
): Region[] {
  const regions: Region[] = [];
  const push = (bbox: { x0: number; y0: number; x1: number; y1: number }) => {
    regions.push({
      x: bbox.x0,
      y: bbox.y0,
      width: bbox.x1 - bbox.x0,
      height: bbox.y1 - bbox.y0,
    });
  };

  for (const block of blocks) {
    if (granularity === "block") {
      if (block.confidence >= minConfidence) push(block.bbox);
      continue;
    }
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        if (granularity === "line") {
          if (line.confidence >= minConfidence) push(line.bbox);
          continue;
        }
        for (const word of line.words ?? []) {
          if (word.confidence >= minConfidence) push(word.bbox);
        }
      }
    }
  }
  return regions;
}

/** Flatten the blocks tree into word texts + confidences (keep in sync with
 *  extractWordsFromBlocks in src/lib/ocr/regions.ts). */
function extractWords(
  blocks: RecognizeResult["data"]["blocks"] | null,
): Array<{ text: string; confidence: number }> {
  const words: Array<{ text: string; confidence: number }> = [];
  for (const block of blocks ?? []) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        for (const word of line.words ?? []) {
          const text = (word.text ?? "").trim();
          if (text) words.push({ text, confidence: word.confidence ?? 0 });
        }
      }
    }
  }
  return words;
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function authorized(req: http.IncomingMessage): boolean {
  if (!TOKEN) return true;
  const header = req.headers.authorization || "";
  return header === `Bearer ${TOKEN}`;
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error("body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function poolState(): "cold" | "warming" | "warm" {
  if (pool.length > 0) return "warm";
  if (spawning > 0) return "warming";
  return "cold";
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  const route = `${req.method} ${url.pathname}`;

  try {
    if (route === "GET /health") {
      json(res, 200, {
        status: "ok",
        state: poolState(),
        workers: pool.length,
        busy: pool.filter((e) => e.busy).length,
        queued: queue.length,
        inFlight,
        idleTimeoutMs: IDLE_TIMEOUT_MS,
        lastActivityMsAgo: Date.now() - lastActivity,
        uptimeSec: Math.round(process.uptime()),
      });
      return;
    }

    if (req.method !== "POST") {
      json(res, 404, { error: "not found" });
      return;
    }
    if (!authorized(req)) {
      json(res, 401, { error: "unauthorized" });
      return;
    }

    if (url.pathname === "/warmup") {
      const workers = clampInt(
        url.searchParams.get("workers") ?? undefined,
        1,
        1,
        MAX_WORKERS,
      );
      void warmup(workers);
      json(res, 202, { state: poolState(), workers: pool.length });
      return;
    }

    if (url.pathname === "/sleep") {
      touch();
      if (inFlight > 0 || queue.length > 0) {
        // Busy — decline to hard-stop; the idle timer will sleep after drain.
        json(res, 200, { state: poolState(), deferred: true });
        return;
      }
      await terminateAll();
      json(res, 200, { state: poolState() });
      return;
    }

    if (url.pathname === "/recognize") {
      const image = await readBody(req);
      if (image.length === 0) {
        json(res, 400, { error: "empty body" });
        return;
      }
      // blocks:true so per-word confidences ride along — callers use them to
      // drop icon-glyph junk words instead of gating on the whole-image
      // average (which one bad glyph next to a clean label drags below any
      // sane threshold).
      const result = await withWorker((w) =>
        w.recognize(image, {}, { text: true, blocks: true }),
      );
      json(res, 200, {
        text: result.data.text ?? "",
        confidence: result.data.confidence ?? 0,
        words: extractWords(result.data.blocks ?? null),
      });
      return;
    }

    if (url.pathname === "/detect-regions") {
      const granularityRaw = url.searchParams.get("granularity") || "word";
      const granularity: Granularity =
        granularityRaw === "line" || granularityRaw === "block"
          ? granularityRaw
          : "word";
      const minConfidence = clampInt(
        url.searchParams.get("minConfidence") ?? undefined,
        50,
        0,
        100,
      );
      const image = await readBody(req);
      if (image.length === 0) {
        json(res, 400, { error: "empty body" });
        return;
      }
      const result = await withWorker((w) =>
        // tesseract.js v6+ only emits `text` by default — `blocks: true` is
        // required to get bbox data.
        w.recognize(image, {}, { text: false, blocks: true }),
      );
      const regions = result.data.blocks
        ? extractRegions(result.data.blocks, granularity, minConfidence)
        : [];
      json(res, 200, { regions, confidence: result.data.confidence ?? 0 });
      return;
    }

    json(res, 404, { error: "not found" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ocr-service] ${route} failed: ${msg}`);
    if (!res.headersSent) {
      json(res, msg === "body too large" ? 413 : 500, { error: msg });
    } else {
      res.end();
    }
  }
});

server.listen(PORT, () => {
  console.log(
    `[ocr-service] Listening on :${PORT} (lang=${LANG}, maxWorkers=${MAX_WORKERS}, idleTimeout=${IDLE_TIMEOUT_MS}ms, auth=${TOKEN ? "token" : "none"}, langPath=${LANG_PATH || "<cdn>"})`,
  );
});

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[ocr-service] ${signal} — shutting down`);
  server.close();
  const timeout = setTimeout(() => process.exit(0), 5000);
  timeout.unref();
  await terminateAll();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// tesseract.js worker threads surface some failures (e.g. traineddata fetch
// errors) as async throws outside any promise chain — as uncaughtException.
// This service is stateless, so log and keep serving instead of dying; a
// genuinely wedged process is caught by the k8s liveness probe. Workers that
// died this way are pruned lazily: their jobs reject and the pool respawns.
process.on("uncaughtException", (err) => {
  console.error(
    `[ocr-service] uncaughtException (suppressed): ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
  );
});
process.on("unhandledRejection", (reason) => {
  console.error(
    `[ocr-service] unhandledRejection (suppressed): ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`,
  );
});
