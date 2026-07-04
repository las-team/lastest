import type { VideoCaption } from "@/lib/db/schema";

// Build a WebVTT document from time-coded captions for the share-page <video>
// subtitle track. Pure + side-effect-free so it's unit-testable and can run in
// the route handler with no I/O.
//
// Cue timing comes straight off each caption's startMs/endMs. Those are an
// even-split approximation of the recording duration (we don't persist a real
// per-step video timestamp) — see src/lib/share/captions.ts. Good enough to
// keep the narration roughly aligned with the step it describes; not
// frame-accurate.

/** WebVTT timestamp: HH:MM:SS.mmm (hours are required by the spec when > 0 and
 *  harmless when zero, so we always emit them for a stable, simple format). */
export function msToVttTimestamp(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? Math.floor(ms) : 0;
  const h = Math.floor(safe / 3_600_000);
  const m = Math.floor((safe % 3_600_000) / 60_000);
  const s = Math.floor((safe % 60_000) / 1000);
  const millis = safe % 1000;
  const pad = (n: number, w = 2) => n.toString().padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(millis, 3)}`;
}

// Cue text can't contain the "-->" sequence (it's the timing delimiter) and
// must be single-logical-line per our renderer — collapse newlines to spaces
// and neutralize any stray arrow so a model-authored caption can never break
// the document structure.
function sanitizeCueText(text: string): string {
  return text
    .replace(/\r?\n/g, " ")
    .replace(/-->/g, "→")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Render captions to a WebVTT document. Captions are sorted by start time and
 * any with empty text or a non-positive duration are dropped so the track is
 * always valid. Returns an empty-cue VTT (`WEBVTT` header only) when there's
 * nothing to show — callers that want a 404 should check `captions.length`
 * first.
 */
export function captionsToVtt(captions: VideoCaption[]): string {
  const cues = [...captions]
    .filter((c) => c && typeof c.text === "string" && c.text.trim().length > 0)
    .map((c) => ({
      start: Math.max(0, Math.floor(c.startMs)),
      end: Math.max(0, Math.floor(c.endMs)),
      text: sanitizeCueText(c.text),
    }))
    .filter((c) => c.end > c.start && c.text.length > 0)
    .sort((a, b) => a.start - b.start);

  const body = cues
    .map(
      (c, i) =>
        `${i + 1}\n${msToVttTimestamp(c.start)} --> ${msToVttTimestamp(c.end)}\n${c.text}`,
    )
    .join("\n\n");

  return body ? `WEBVTT\n\n${body}\n` : "WEBVTT\n";
}
