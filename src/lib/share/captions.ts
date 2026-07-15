/**
 * Generate time-coded narration ("captions") for a share-page recording by
 * running a vision pass over the run's captured step screenshots. One cue per
 * readable screenshot, describing what the agent does and what's on screen.
 *
 * Mirrors the demo-notes generator (src/lib/quickstart/quickstart-notes.ts):
 * pull the repo's AI settings → getAIConfig → generateWithAI. The only new
 * wrinkle is passing the screenshots as `images` (vision input), which
 * generateWithAI now forwards to the provider.
 *
 * TIMING: cues anchor to each screenshot's recorded offset (`atMs`) when the
 * run captured it — the same clock the chapter rail seeks with, so narration
 * stays in lockstep with click-to-seek. Legacy rows without anchors fall back
 * to evenly splitting the recording's duration_ms across the steps.
 */

import { readFile } from "fs/promises";
import * as queries from "@/lib/db/queries";
import { generateWithAI } from "@/lib/ai";
import { getAIConfig } from "@/lib/playwright/agent-context";
import { parseAiJson } from "@/lib/ai/json-parse";
import { resolveStoragePathStrict } from "@/lib/storage/paths";
import type { VideoCaption } from "@/lib/db/schema";

export interface CaptionStepInput {
  /** Storage-relative screenshot path (e.g. `/screenshots/<repo>/<file>.png`). */
  path: string;
  label?: string | null;
  /** The screenshot's offset into the recording (CapturedScreenshot.atMs).
   *  When present, cues anchor to it instead of the even split — keeping
   *  narration in lockstep with the chapter rail's seek targets. */
  atMs?: number | null;
}

export interface GenerateVideoCaptionsInput {
  repositoryId: string;
  productName: string;
  targetDomain?: string | null;
  /** Optional run context to ground the narration (the demo-notes uxSummary). */
  uxSummary?: string | null;
  /** Recorded duration of the clip; drives cue timing. */
  durationMs: number | null;
  /** Captured steps in test_results.screenshots[] order. */
  steps: CaptionStepInput[];
}

const DEFAULT_STEP_MS = 3000;
const MAX_STEPS = 24; // cap the vision payload — long runs get sampled head-heavy

const SYSTEM_PROMPT = `You are narrating a screen recording of an automated browser agent testing a web app, for a viewer watching the replay. You are shown the captured screenshots in order, one per step.

For EACH screenshot, write one short present-tense caption (max ~12 words) that says what the agent is doing and what is visible on screen. Examples: "Opens the pricing page and scans the three plan tiers." / "Fills in the signup email and clicks Create account." / "Dashboard loads with an empty projects list."

Also return, when there is a clear primary element the step is about (a button, field, heading), a normalized focus box (x,y,w,h each between 0 and 1, origin top-left) and an annotation hint of "arrow", "underline", or "box". Omit focus/annotation when no single element dominates.

RULES:
- Describe only what is visible. Never invent features or text you cannot see.
- One caption per step, matched by stepIndex.
- Keep it plain and concrete; no marketing language.

OUTPUT STRICT JSON, no markdown, exactly:
{ "captions": [ { "stepIndex": 0, "text": "string", "focus": { "x": 0, "y": 0, "w": 0, "h": 0 }, "annotation": "arrow" } ] }`;

type RawCaption = {
  stepIndex: number;
  text: string;
  focus?: { x: number; y: number; w: number; h: number };
  annotation?: "arrow" | "underline" | "box";
};

function isRawCaptionPayload(v: unknown): v is { captions: RawCaption[] } {
  if (!v || typeof v !== "object") return false;
  const arr = (v as { captions?: unknown }).captions;
  if (!Array.isArray(arr)) return false;
  return arr.every(
    (c) =>
      c &&
      typeof c === "object" &&
      typeof (c as RawCaption).stepIndex === "number" &&
      typeof (c as RawCaption).text === "string",
  );
}

function mediaTypeFor(path: string): string {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
}

function normalizeFocus(
  f: RawCaption["focus"],
): VideoCaption["focus"] | undefined {
  if (!f || typeof f !== "object") return undefined;
  const { x, y, w, h } = f;
  if (![x, y, w, h].every((n) => typeof n === "number" && Number.isFinite(n)))
    return undefined;
  const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
  return { x: clamp01(x), y: clamp01(y), w: clamp01(w), h: clamp01(h) };
}

// Cue timing ladder: anchor to the screenshot's real recording offset
// (`atMs`, the same clock the chapter rail seeks with) when the run captured
// it — the cue runs from this step's anchor to the next anchored step's.
// Legacy rows without anchors fall back to the old even split (step i
// occupies [i/N, (i+1)/N] of the clip).
function timingFor(
  stepIndex: number,
  steps: CaptionStepInput[],
  durationMs: number | null,
): { startMs: number; endMs: number } {
  const totalSteps = steps.length;
  const total =
    durationMs && durationMs > 0 ? durationMs : totalSteps * DEFAULT_STEP_MS;

  const at = steps[stepIndex]?.atMs;
  if (typeof at === "number" && at >= 0) {
    let endMs: number | null = null;
    for (let i = stepIndex + 1; i < totalSteps; i++) {
      const next = steps[i]?.atMs;
      if (typeof next === "number" && next > at) {
        endMs = next;
        break;
      }
    }
    return {
      startMs: Math.round(at),
      endMs: Math.round(endMs ?? Math.max(at + 1000, total)),
    };
  }

  const per = total / Math.max(1, totalSteps);
  return {
    startMs: Math.round(stepIndex * per),
    endMs: Math.round((stepIndex + 1) * per),
  };
}

/**
 * Returns one VideoCaption per readable screenshot. Returns `[]` (never throws)
 * when there are no readable screenshots or the model output can't be parsed —
 * callers should treat empty as "no captions to persist".
 */
export async function generateVideoCaptions(
  input: GenerateVideoCaptionsInput,
  options?: { onLogCreated?: (logId: string) => void },
): Promise<VideoCaption[]> {
  const steps = input.steps.slice(0, MAX_STEPS);
  if (steps.length === 0) return [];

  // Load the screenshots from disk, preserving each step's original index so
  // the cue's stepIndex still aligns with test_results.screenshots[] even when
  // some files are missing.
  const loaded: Array<{
    index: number;
    label: string;
    base64: string;
    mediaType: string;
  }> = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!;
    const abs = await resolveStoragePathStrict(s.path);
    if (!abs) continue;
    try {
      const buf = await readFile(abs);
      loaded.push({
        index: i,
        label: (s.label ?? `Step ${i + 1}`).trim(),
        base64: buf.toString("base64"),
        mediaType: mediaTypeFor(s.path),
      });
    } catch {
      // Unreadable screenshot — skip; the rest still get captions.
    }
  }
  if (loaded.length === 0) return [];

  const settings = await queries.getAISettings(input.repositoryId);
  const config = getAIConfig(settings);

  const manifest = loaded
    .map(
      (l, ord) =>
        `image ${ord + 1} → stepIndex ${l.index}, label: ${JSON.stringify(l.label)}`,
    )
    .join("\n");

  const prompt = `Recording of ${input.productName}${
    input.targetDomain ? ` (${input.targetDomain})` : ""
  }.${input.uxSummary ? `\nContext: ${input.uxSummary}` : ""}

The ${loaded.length} attached screenshot(s) are the agent's steps in order:
${manifest}

Write one caption per step. Return the strict JSON described in the system prompt.`;

  let raw: string;
  try {
    raw = await generateWithAI(config, prompt, SYSTEM_PROMPT, {
      repositoryId: input.repositoryId,
      actionType: "agent_discover",
      onLogCreated: options?.onLogCreated,
      responseFormat: "json_object",
      images: loaded.map((l) => ({ base64: l.base64, mediaType: l.mediaType })),
    });
  } catch {
    return [];
  }

  const parsed = parseAiJson(raw, isRawCaptionPayload, { source: "captions" });
  if (!parsed) return [];

  const validIndexes = new Set(loaded.map((l) => l.index));
  const byStep = new Map<number, RawCaption>();
  for (const c of parsed.captions) {
    if (!validIndexes.has(c.stepIndex)) continue;
    if (typeof c.text !== "string" || c.text.trim().length === 0) continue;
    if (!byStep.has(c.stepIndex)) byStep.set(c.stepIndex, c);
  }

  const out: VideoCaption[] = [];
  for (const l of loaded) {
    const c = byStep.get(l.index);
    if (!c) continue;
    const { startMs, endMs } = timingFor(l.index, steps, input.durationMs);
    const annotation =
      c.annotation === "arrow" ||
      c.annotation === "underline" ||
      c.annotation === "box"
        ? c.annotation
        : undefined;
    out.push({
      stepIndex: l.index,
      startMs,
      endMs,
      text: c.text.trim(),
      focus: normalizeFocus(c.focus),
      annotation,
    });
  }
  out.sort((a, b) => a.startMs - b.startMs);
  return out;
}
