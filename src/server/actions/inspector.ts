'use server';

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import * as queries from '@/lib/db/queries';
import { requireRepoAccess } from '@/lib/auth';
import { generateDiff } from '@/lib/diff/generator';
import { computeDomDiff } from '@/lib/diff/dom-diff';
import {
  computeNetworkDiff,
  type NetworkRequestLike,
} from '@/lib/diff/network-diff';
import { diffVariables } from '@/lib/diff/variables-diff';
import { diffVisibleText } from '@/lib/diff/text-content-diff';
import { STORAGE_ROOT, STORAGE_DIRS, toRelativePath } from '@/lib/storage/paths';
import type {
  DiffEngineType,
  InspectionResult,
  InspectorClassification,
  InspectorDimension,
  InspectorOptions,
  InspectorSeverity,
  RegionDetectionMode,
  VisualInspectionPayload,
  DomInspectionPayload,
  TextInspectionPayload,
  NetworkInspectionPayload,
  VariableInspectionPayload,
} from '@/lib/db/schema';

export interface InspectTargetsInput {
  testId: string;
  currentResultId: string;
  baselineResultId: string;
  engine?: DiffEngineType;
  dimensions?: InspectorDimension[];
  options?: InspectorOptions;
}

const ALL_DIMENSIONS: InspectorDimension[] = ['visual', 'dom', 'text', 'network', 'variables'];

// Per-dimension timeout. Real bottlenecks are the visual diff on huge
// screenshots and the LCS in text-content-diff on huge DOM snapshots; without
// this cap a single bad payload silently locks the whole inspection request.
const DIMENSION_TIMEOUT_MS = 30_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function buildCacheKey(input: InspectTargetsInput, engine: DiffEngineType): string {
  const payload = JSON.stringify({
    t: input.testId,
    c: input.currentResultId,
    b: input.baselineResultId,
    e: engine,
    d: (input.dimensions ?? ALL_DIMENSIONS).slice().sort(),
    o: input.options ?? {},
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

async function authorizeForTest(testId: string) {
  const repoId = await queries.getRepoIdForTest(testId);
  if (!repoId) throw new Error('Test has no repository');
  return requireRepoAccess(repoId);
}

function hostFromDomSnapshotUrl(url: string | undefined | null): string {
  if (!url) return '';
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

function classifyVisual(p: VisualInspectionPayload | undefined): InspectorSeverity {
  if (!p) return 'unavailable';
  if (p.error) return 'unavailable';
  if (p.classification === 'unchanged') return 'unchanged';
  if (p.classification === 'flaky') return 'minor';
  return 'changed';
}

function classifyDom(p: DomInspectionPayload | undefined): InspectorSeverity {
  if (!p || p.error) return 'unavailable';
  const total = p.diff.added.length + p.diff.removed.length + p.diff.changed.length;
  if (total === 0) return 'unchanged';
  if (total < 5) return 'minor';
  return 'changed';
}

function classifyText(p: TextInspectionPayload | undefined): InspectorSeverity {
  if (!p || p.error) return 'unavailable';
  const total = p.added + p.removed;
  if (total === 0) return 'unchanged';
  if (total < 3) return 'minor';
  return 'changed';
}

function classifyNetwork(p: NetworkInspectionPayload | undefined): InspectorSeverity {
  if (!p || p.error) return 'unavailable';
  const failedDelta = p.summary.failedCountB - p.summary.failedCountA;
  if (failedDelta > 0) return 'changed';
  const total =
    p.added.length + p.removed.length + p.changedStatus.length + p.changedSize.length + p.slowdowns.length;
  if (total === 0) return 'unchanged';
  if (total < 4) return 'minor';
  return 'changed';
}

function classifyVariables(p: VariableInspectionPayload | undefined): InspectorSeverity {
  if (!p || p.error) return 'unavailable';
  const ext = p.extracted.filter((e) => e.kind !== 'unchanged').length;
  const asg = p.assigned.filter((e) => e.kind !== 'unchanged').length;
  const consoleNew = p.consoleErrors.added.length;
  const total = ext + asg + consoleNew;
  if (consoleNew > 0) return 'changed';
  if (total === 0) return 'unchanged';
  if (total < 3) return 'minor';
  return 'changed';
}

async function runVisual(
  baselinePath: string | null | undefined,
  currentPath: string | null | undefined,
  engine: DiffEngineType,
  repoId: string,
): Promise<VisualInspectionPayload> {
  if (!baselinePath || !currentPath) {
    return {
      classification: 'changed',
      pixelDifference: 0,
      percentageDifference: 0,
      baselineImagePath: baselinePath ?? null,
      currentImagePath: currentPath ?? null,
      diffImagePath: null,
      engine,
      error: 'Missing screenshot on one side',
    };
  }
  const absBaseline = path.join(STORAGE_ROOT, baselinePath);
  const absCurrent = path.join(STORAGE_ROOT, currentPath);
  if (!fs.existsSync(absBaseline) || !fs.existsSync(absCurrent)) {
    return {
      classification: 'changed',
      pixelDifference: 0,
      percentageDifference: 0,
      baselineImagePath: baselinePath,
      currentImagePath: currentPath,
      diffImagePath: null,
      engine,
      error: 'Screenshot file missing on disk',
    };
  }

  const settings = await queries.getDiffSensitivitySettings(repoId);
  const includeAntiAliasing = settings.includeAntiAliasing ?? false;
  const ignorePageShift = settings.ignorePageShift ?? false;
  const regionDetectionMode = (settings.regionDetectionMode as RegionDetectionMode) ?? 'grid';
  const unchangedThreshold = settings.unchangedThreshold ?? 1;
  const flakyThreshold = settings.flakyThreshold ?? 10;

  const result = await generateDiff(
    absBaseline,
    absCurrent,
    STORAGE_DIRS.diffs,
    0.1,
    includeAntiAliasing,
    undefined,
    ignorePageShift,
    engine,
    regionDetectionMode,
    undefined,
  );

  let classification: 'unchanged' | 'flaky' | 'changed';
  if (result.percentageDifference < unchangedThreshold) classification = 'unchanged';
  else if (result.percentageDifference < flakyThreshold) classification = 'flaky';
  else classification = 'changed';

  return {
    classification,
    pixelDifference: result.pixelDifference,
    percentageDifference: result.percentageDifference,
    baselineImagePath: baselinePath,
    currentImagePath: currentPath,
    diffImagePath: toRelativePath(result.diffImagePath),
    engine,
    metadata: result.metadata,
  };
}

/**
 * Compare two prior runs of the same test across visual, DOM, text, network,
 * and variables. Pure recompute over already-persisted artifacts — no
 * Playwright re-execution and no build creation.
 */
export async function runInspection(input: InspectTargetsInput): Promise<InspectionResult> {
  const { team, repo } = await authorizeForTest(input.testId);
  void team;

  const test = await queries.getTest(input.testId);
  if (!test) throw new Error('Test not found');

  const engine: DiffEngineType =
    input.engine ?? (test.diffOverrides?.diffEngine as DiffEngineType | undefined) ?? 'pixelmatch';
  const dimensions = input.dimensions ?? ALL_DIMENSIONS;
  const cacheKey = buildCacheKey(input, engine);

  const cached = await queries.getInspectorCacheEntry(cacheKey);
  if (cached) {
    return cached.payload;
  }

  const [current, baseline] = await Promise.all([
    queries.getTestResultById(input.currentResultId),
    queries.getTestResultById(input.baselineResultId),
  ]);
  if (!current || current.testId !== input.testId) {
    throw new Error('Current run not found for this test');
  }
  if (!baseline || baseline.testId !== input.testId) {
    throw new Error('Baseline run not found for this test');
  }

  const wantVisual = dimensions.includes('visual');
  const wantDom = dimensions.includes('dom');
  const wantText = dimensions.includes('text');
  const wantNetwork = dimensions.includes('network');
  const wantVars = dimensions.includes('variables');

  const visualP: Promise<VisualInspectionPayload | undefined> = wantVisual
    ? withTimeout(
        runVisual(baseline.screenshotPath, current.screenshotPath, engine, repo.id),
        DIMENSION_TIMEOUT_MS,
        'visual',
      ).catch(
        (err): VisualInspectionPayload => ({
          classification: 'changed',
          pixelDifference: 0,
          percentageDifference: 0,
          baselineImagePath: baseline.screenshotPath ?? null,
          currentImagePath: current.screenshotPath ?? null,
          diffImagePath: null,
          engine,
          error: err instanceof Error ? err.message : String(err),
        }),
      )
    : Promise.resolve(undefined);

  const domP: Promise<DomInspectionPayload | undefined> = wantDom
    ? withTimeout(
        (async (): Promise<DomInspectionPayload> => {
          if (!baseline.domSnapshot || !current.domSnapshot) {
            return {
              diff: { added: [], removed: [], changed: [], unchangedCount: 0 },
              baselineUrl: baseline.domSnapshot?.url,
              currentUrl: current.domSnapshot?.url,
              error: 'DOM snapshot missing on one side',
            };
          }
          const diff = computeDomDiff(baseline.domSnapshot, current.domSnapshot);
          return {
            diff,
            baselineUrl: baseline.domSnapshot.url,
            currentUrl: current.domSnapshot.url,
          };
        })(),
        DIMENSION_TIMEOUT_MS,
        'dom',
      ).catch(
        (err): DomInspectionPayload => ({
          diff: { added: [], removed: [], changed: [], unchangedCount: 0 },
          error: err instanceof Error ? err.message : String(err),
        }),
      )
    : Promise.resolve(undefined);

  const textP: Promise<TextInspectionPayload | undefined> = wantText
    ? withTimeout(
        Promise.resolve().then(() =>
          diffVisibleText(baseline.domSnapshot, current.domSnapshot, {
            ignorePatterns: input.options?.textIgnorePatterns,
          }),
        ),
        DIMENSION_TIMEOUT_MS,
        'text',
      ).catch(
        (err): TextInspectionPayload => ({
          lines: [],
          added: 0,
          removed: 0,
          baselineLength: 0,
          currentLength: 0,
          error: err instanceof Error ? err.message : String(err),
        }),
      )
    : Promise.resolve(undefined);

  const networkP: Promise<NetworkInspectionPayload | undefined> = wantNetwork
    ? withTimeout(
        Promise.resolve().then(() => {
          const reqsA = (baseline.networkRequests ?? []) as NetworkRequestLike[];
          const reqsB = (current.networkRequests ?? []) as NetworkRequestLike[];
          const primaryHostA = hostFromDomSnapshotUrl(baseline.domSnapshot?.url);
          const primaryHostB = hostFromDomSnapshotUrl(current.domSnapshot?.url);
          return computeNetworkDiff(reqsA, reqsB, primaryHostA, primaryHostB);
        }),
        DIMENSION_TIMEOUT_MS,
        'network',
      ).catch(
        (err): NetworkInspectionPayload => ({
          added: [],
          removed: [],
          changedStatus: [],
          changedSize: [],
          slowdowns: [],
          failedA: [],
          failedB: [],
          summary: {
            countA: 0,
            countB: 0,
            bytesA: 0,
            bytesB: 0,
            byTypeA: {},
            byTypeB: {},
            thirdPartyDomainsA: [],
            thirdPartyDomainsB: [],
            failedCountA: 0,
            failedCountB: 0,
          },
          error: err instanceof Error ? err.message : String(err),
        }),
      )
    : Promise.resolve(undefined);

  const variablesP: Promise<VariableInspectionPayload | undefined> = wantVars
    ? withTimeout(
        Promise.resolve().then(() =>
          diffVariables({
            baseline: {
              extracted: baseline.extractedVariables,
              assigned: baseline.assignedVariables,
              consoleErrors: baseline.consoleErrors,
              logs: baseline.logs,
            },
            current: {
              extracted: current.extractedVariables,
              assigned: current.assignedVariables,
              consoleErrors: current.consoleErrors,
              logs: current.logs,
            },
            options: { ignoreKeys: input.options?.ignoreVariableKeys },
          }),
        ),
        DIMENSION_TIMEOUT_MS,
        'variables',
      ).catch(
        (err): VariableInspectionPayload => ({
          extracted: [],
          assigned: [],
          consoleErrors: { added: [], removed: [], common: 0 },
          logs: { addedCount: 0, removedCount: 0, sample: [] },
          error: err instanceof Error ? err.message : String(err),
        }),
      )
    : Promise.resolve(undefined);

  const [visual, dom, text, network, variables] = await Promise.all([
    visualP,
    domP,
    textP,
    networkP,
    variablesP,
  ]);

  const classification: InspectorClassification = {
    visual: classifyVisual(visual),
    dom: classifyDom(dom),
    text: classifyText(text),
    network: classifyNetwork(network),
    variables: classifyVariables(variables),
  };

  const result: InspectionResult = {
    cacheKey,
    computedAtMs: Date.now(),
    testId: input.testId,
    currentResultId: input.currentResultId,
    baselineResultId: input.baselineResultId,
    engine,
    visual,
    dom,
    text,
    network,
    variables,
    classification,
  };

  await queries.putInspectorCacheEntry(
    cacheKey,
    input.testId,
    input.currentResultId,
    input.baselineResultId,
    engine,
    result,
  );

  return result;
}

/**
 * List candidate runs for the inspector target picker. Limited to recent runs
 * with at least a screenshot or DOM snapshot, sorted newest first.
 */
export async function listInspectableRuns(testId: string, limit = 50) {
  await authorizeForTest(testId);
  const rows = await queries.getTestResultsByTest(testId);
  return rows.slice(0, limit).map((r) => ({
    id: r.id,
    testRunId: r.testRunId,
    status: r.status,
    startedAt: r.startedAt,
    durationMs: r.durationMs,
    viewport: r.viewport,
    browser: r.browser,
    gitBranch: r.gitBranch ?? null,
    gitCommit: r.gitCommit ?? null,
    hasScreenshot: !!r.screenshotPath,
    hasDom: !!r.domSnapshot,
    hasNetwork: Array.isArray(r.networkRequests) && r.networkRequests.length > 0,
    hasVariables:
      (r.extractedVariables && Object.keys(r.extractedVariables).length > 0) ||
      (r.assignedVariables && Object.keys(r.assignedVariables).length > 0),
  }));
}
