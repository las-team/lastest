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
import type { UrlCapture } from './capture';

export interface UrlDiffResult {
  visual: {
    baselineRelPath: string;
    currentRelPath: string;
    diffRelPath: string;
    pixelDifference: number;
    percentageDifference: number;
    metadata: DiffResult['metadata'];
  };
  dom: DomDiffResult & { summary: string };
  network: NetworkDiffResult;
  a11y: A11yDiffResult;
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

  const visualResult = await generateDiff(
    captureA.screenshotAbsPath,
    captureB.screenshotAbsPath,
    diffOutDir,
    0.1,
    false,
    undefined,
    true, // ignorePageShift — different sites have different layouts; LCS gives saner output
    'pixelmatch',
  );

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

  return {
    visual: {
      baselineRelPath: captureA.screenshotRelPath,
      currentRelPath: captureB.screenshotRelPath,
      diffRelPath: toRelativePath(visualResult.diffImagePath),
      pixelDifference: visualResult.pixelDifference,
      percentageDifference: visualResult.percentageDifference,
      metadata: visualResult.metadata,
    },
    dom: domWithSummary,
    network: networkDiff,
    a11y: a11yDiff,
    capturedAtA: captureA.capturedAt,
    capturedAtB: captureB.capturedAt,
    primaryHostA: captureA.primaryHost,
    primaryHostB: captureB.primaryHost,
  };
}
