export interface OcrRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type OcrGranularity = "word" | "line" | "block";

export interface OcrWord {
  text: string;
  confidence: number;
}

export interface OcrRecognition {
  text: string;
  confidence: number;
  /** Per-word breakdown when the backend provides it — lets callers drop
   *  low-confidence junk words (icon glyphs) instead of rejecting the whole
   *  result on the dragged-down average. */
  words?: OcrWord[] | null;
}
