import type { OcrGranularity, OcrRegion } from "@/lib/ocr/types";

/**
 * Walk Tesseract's blocks → paragraphs → lines → words tree and collect
 * bounding boxes at the requested granularity.
 *
 * Keep in sync with `extractRegions` in `packages/ocr-service/src/index.ts` —
 * the remote service applies the same walk server-side so only the (small)
 * region list crosses the wire instead of the full blocks tree.
 */

interface OcrBBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface OcrWordNode {
  confidence: number;
  bbox: OcrBBox;
}

interface OcrLineNode {
  confidence: number;
  bbox: OcrBBox;
  words?: OcrWordNode[] | null;
}

interface OcrParagraphNode {
  lines?: OcrLineNode[] | null;
}

export interface OcrBlockNode {
  confidence: number;
  bbox: OcrBBox;
  paragraphs?: OcrParagraphNode[] | null;
}

export function extractRegionsFromBlocks(
  blocks: OcrBlockNode[],
  granularity: OcrGranularity,
  minConfidence: number,
): OcrRegion[] {
  const regions: OcrRegion[] = [];
  const push = (bbox: OcrBBox) => {
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
