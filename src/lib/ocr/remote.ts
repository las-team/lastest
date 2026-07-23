/**
 * HTTP client for the standalone OCR container (`packages/ocr-service`).
 *
 * Every function is best-effort and never throws: a `null` return means "OCR
 * unavailable / failed" and callers degrade exactly like they do today when
 * in-process Tesseract fails (no text found → standard diff / no ocr-text
 * selector). No local fallback on remote failure — falling back to in-process
 * WASM would silently reintroduce the memory/CPU load the container exists to
 * isolate (and could OOM small deployments like Olares).
 */

import {
  ocrRequestTimeoutMs,
  ocrServiceToken,
  ocrServiceUrl,
} from "@/lib/ocr/config";
import type {
  OcrGranularity,
  OcrRecognition,
  OcrRegion,
} from "@/lib/ocr/types";

function authHeaders(): Record<string, string> {
  const token = ocrServiceToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function post(
  path: string,
  body: Buffer | null,
  timeoutMs: number,
): Promise<Response | null> {
  const base = ocrServiceUrl();
  if (!base) return null;
  try {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        ...(body ? { "Content-Type": "image/png" } : {}),
        ...authHeaders(),
      },
      // Uint8Array view keeps fetch happy about BodyInit typing
      body: body ? new Uint8Array(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      console.warn(`[OCR] Remote ${path} returned ${res.status}`);
      return null;
    }
    return res;
  } catch (err) {
    console.warn(
      `[OCR] Remote ${path} failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

export async function remoteRecognize(
  image: Buffer,
  timeoutMs: number = ocrRequestTimeoutMs(),
): Promise<OcrRecognition | null> {
  const res = await post("/recognize", image, timeoutMs);
  if (!res) return null;
  try {
    const data = (await res.json()) as {
      text?: string;
      confidence?: number;
      words?: Array<{ text?: string; confidence?: number }> | null;
    };
    const words = Array.isArray(data.words)
      ? data.words
          .filter((w) => typeof w?.text === "string" && w.text.trim())
          .map((w) => ({ text: w.text!.trim(), confidence: w.confidence ?? 0 }))
      : null;
    return {
      text: data.text ?? "",
      confidence: data.confidence ?? 0,
      // Omitted (not null) when the service predates the words field — keeps
      // older callers' deep-equality expectations intact.
      ...(words ? { words } : {}),
    };
  } catch {
    return null;
  }
}

export async function remoteDetectRegions(
  image: Buffer,
  granularity: OcrGranularity,
  minConfidence: number,
  timeoutMs: number = ocrRequestTimeoutMs(),
): Promise<OcrRegion[] | null> {
  const params = new URLSearchParams({
    granularity,
    minConfidence: String(minConfidence),
  });
  const res = await post(`/detect-regions?${params}`, image, timeoutMs);
  if (!res) return null;
  try {
    const data = (await res.json()) as { regions?: OcrRegion[] };
    return Array.isArray(data.regions) ? data.regions : [];
  } catch {
    return null;
  }
}

/** Fire-and-forget pre-spawn of remote workers (wake). */
export async function remoteWarmup(workers = 1): Promise<void> {
  await post(`/warmup?workers=${workers}`, null, 5_000);
}

/** Fire-and-forget sleep hint — the service still auto-sleeps on idle. */
export async function remoteSleep(): Promise<void> {
  await post("/sleep", null, 5_000);
}
