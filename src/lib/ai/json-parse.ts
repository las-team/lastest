/**
 * Strip code fences from an AI model's reply, JSON.parse the remainder,
 * and validate the shape with a caller-supplied predicate. Returns `null`
 * (rather than throwing) so callers can decide whether to retry the model,
 * fall back, or surface an error.
 *
 * Why: a prompt-injected page (test description, error message, recorded
 * console log) can shape model output to look like JSON with attacker-
 * chosen field names. Without shape validation the parsed object then
 * flows into DB writes or business logic with whatever keys the attacker
 * wants. This is one defensive layer against that — the system prompt and
 * model's own resistance to injection are others.
 */

export interface ParseAiJsonOptions {
  /** Optional descriptor used in diagnostic logs only. */
  source?: string;
}

const FENCE_RE = /```(?:json)?\s*([\s\S]*?)\s*```/i;

function stripFences(raw: string): string {
  const match = raw.match(FENCE_RE);
  if (match) return match[1]!.trim();
  return raw.trim();
}

export function parseAiJson<T>(
  raw: string,
  isValid: (value: unknown) => value is T,
  opts: ParseAiJsonOptions = {},
): T | null {
  const cleaned = stripFences(raw);
  if (!cleaned) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    if (opts.source) {
      console.warn(`[ai-json] ${opts.source}: JSON.parse failed —`, err);
    }
    return null;
  }
  if (!isValid(parsed)) {
    if (opts.source) {
      console.warn(`[ai-json] ${opts.source}: shape validation failed; got keys ${
        parsed && typeof parsed === 'object' ? Object.keys(parsed as object).join(',') : typeof parsed
      }`);
    }
    return null;
  }
  return parsed;
}
