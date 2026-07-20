export interface OcrRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type OcrGranularity = "word" | "line" | "block";

export interface OcrRecognition {
  text: string;
  confidence: number;
}
