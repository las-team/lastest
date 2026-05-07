/**
 * URL-Diff engine orchestrator. Runs the four diff engines (visual, DOM,
 * network, a11y) over two captures and returns a single result blob.
 */

import path from 'node:path';
import { promises as fs } from 'node:fs';

import { STORAGE_DIRS, toRelativePath } from '@/lib/storage/paths';
import { generateDiff, type DiffResult } from '@/lib/diff/generator';
import { computeDomDiff, summarizeDomDiff } from '@/lib/diff/dom-diff';
import type { DomDiffResult, DomSnapshotData } from '@/lib/db/schema';
import { computeNetworkDiff, type NetworkDiffResult } from '@/lib/diff/network-diff';
import { computeA11yDiff, type A11yDiffResult } from '@/lib/diff/a11y-diff';
import { computePageTextDiff, type PageTextDiff } from '@/lib/diff/page-text-diff';
import type { UrlCapture } from './capture';

export type VisualEngineKey = 'pixelmatch' | 'pixelmatch-shift' | 'ssim' | 'butteraugli';

export interface VisualVariant {
  key: VisualEngineKey;
  label: string;
  diffRelPath: string;
  pixelDifference: number;
  percentageDifference: number;
}

export interface UrlDiffResult {
  visual: {
    baselineRelPath: string;
    currentRelPath: string;
    /** Default variant rendered first ('pixelmatch'). */
    defaultKey: VisualEngineKey;
    variants: VisualVariant[];
    /** Back-compat with v1 result shape: mirrors the default variant so older
     *  callers (and the snapshot-stitch path) keep working unchanged. */
    diffRelPath: string;
    pixelDifference: number;
    percentageDifference: number;
    metadata: DiffResult['metadata'];
  };
  dom: DomDiffResult & { summary: string };
  network: NetworkDiffResult;
  a11y: A11yDiffResult;
  text: PageTextDiff;
  capturedAtA: number;
  capturedAtB: number;
  primaryHostA: string;
  primaryHostB: string;
}

const EMPTY_DOM: DomSnapshotData = {
  elements: [],
  url: '',
  timestamp: 0,
};

export async function buildUrlDiff(
  captureA: UrlCapture,
  captureB: UrlCapture,
  jobId: string,
): Promise<UrlDiffResult> {
  const diffOutDir = path.join(STORAGE_DIRS['url-diffs'], jobId, 'diff');
  await fs.mkdir(diffOutDir, { recursive: true });

  // Run all 4 visual engines so the UI can let users compare diffs side-by-side.
  // ignorePageShift gates the LCS row-alignment pre-pass — useful when comparing
  // two layouts of the same content. Run sequentially: pixelmatch is fast,
  // butteraugli is slow; serial keeps memory bounded at ~one PNG pair at a time.
  const visualConfigs: Array<{
    key: VisualEngineKey;
    label: string;
    engine: 'pixelmatch' | 'ssim' | 'butteraugli';
    ignorePageShift: boolean;
  }> = [
    { key: 'pixelmatch', label: 'Pixelmatch', engine: 'pixelmatch', ignorePageShift: false },
    { key: 'pixelmatch-shift', label: 'Pixelmatch · page-shift aware', engine: 'pixelmatch', ignorePageShift: true },
    { key: 'ssim', label: 'SSIM', engine: 'ssim', ignorePageShift: false },
    { key: 'butteraugli', label: 'Butteraugli', engine: 'butteraugli', ignorePageShift: false },
  ];
  const visualRuns: Array<{ cfg: typeof visualConfigs[number]; result: DiffResult }> = [];
  for (const cfg of visualConfigs) {
    const subDir = path.join(diffOutDir, cfg.key);
    await fs.mkdir(subDir, { recursive: true });
    try {
      const result = await generateDiff(
        captureA.screenshotAbsPath,
        captureB.screenshotAbsPath,
        subDir,
        0.1,
        false,
        undefined,
        cfg.ignorePageShift,
        cfg.engine,
      );
      visualRuns.push({ cfg, result });
    } catch (err) {
      console.warn(`[url-diff] visual engine '${cfg.key}' failed:`, err);
    }
  }
  if (visualRuns.length === 0) {
    throw new Error('All visual diff engines failed');
  }
  const primary = visualRuns[0]!;
  const variants: VisualVariant[] = visualRuns.map(({ cfg, result }) => ({
    key: cfg.key,
    label: cfg.label,
    diffRelPath: toRelativePath(result.diffImagePath),
    pixelDifference: result.pixelDifference,
    percentageDifference: result.percentageDifference,
  }));

  const domA = captureA.domSnapshot ?? EMPTY_DOM;
  const domB = captureB.domSnapshot ?? EMPTY_DOM;
  const domDiff = computeDomDiff(domA, domB);
  const domWithSummary = { ...domDiff, summary: summarizeDomDiff(domDiff) };

  const networkDiff = computeNetworkDiff(
    captureA.networkRequests,
    captureB.networkRequests,
    captureA.primaryHost,
    captureB.primaryHost,
  );

  const a11yDiff = computeA11yDiff(
    captureA.a11yViolations,
    captureB.a11yViolations,
    captureA.a11yPassesCount,
    captureB.a11yPassesCount,
  );

  const textDiff = await computePageTextDiff(
    captureA.pageTextRelPath,
    captureB.pageTextRelPath,
  );

  return {
    visual: {
      baselineRelPath: captureA.screenshotRelPath,
      currentRelPath: captureB.screenshotRelPath,
      defaultKey: primary.cfg.key,
      variants,
      diffRelPath: variants[0]!.diffRelPath,
      pixelDifference: variants[0]!.pixelDifference,
      percentageDifference: variants[0]!.percentageDifference,
      metadata: primary.result.metadata,
    },
    dom: domWithSummary,
    network: networkDiff,
    a11y: a11yDiff,
    text: textDiff,
    capturedAtA: captureA.capturedAt,
    capturedAtB: captureB.capturedAt,
    primaryHostA: captureA.primaryHost,
    primaryHostB: captureB.primaryHost,
  };
}
