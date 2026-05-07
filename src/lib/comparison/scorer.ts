/**
 * Multi-layer verdict scorer (v1.13).
 *
 * Takes a baseline and current `TestResult` row plus optional visual-diff
 * stats, runs every layer-specific diff engine, and returns a verdict
 * (`green | yellow | red`) plus the evidence chain that produced it.
 *
 * Verdict rubric (from research digest, ranked by signal):
 *   RED if any high-signal layer fires alone:
 *     - new console fingerprint (Sentry-style)
 *     - new 4xx/5xx response
 *     - URL-trajectory divergence
 *     - new critical or serious a11y violation
 *     - structural-break in extracted variables
 *     - perf budget breach
 *   YELLOW if only medium-signal layers fire:
 *     - visual change > 0
 *     - DOM structural changes (interactive-only filtered)
 *     - new moderate/minor a11y violations
 *     - perf relative drift (within budget)
 *     - value-change in variables
 *   GREEN otherwise.
 */

import type {
  TestResult,
  VisualDiff,
  StepVerdict,
  EvidenceItem,
  StepComparisonEvidence,
} from '@/lib/db/schema';
import { computeNetworkDiff, summarizeNetworkDiff } from '@/lib/diff/network-diff';
import { computeConsoleDiff, summarizeConsoleDiff } from '@/lib/diff/console-diff';
import { computeUrlTrajectoryDiff, summarizeUrlTrajectoryDiff } from '@/lib/diff/url-trajectory-diff';
import { computeA11yDiff, summarizeA11yDiff } from '@/lib/diff/a11y-diff';
import { computeVariableDiff, summarizeVariableDiff } from '@/lib/diff/variable-diff';
import { computePerfDiff, summarizePerfDiff } from '@/lib/diff/perf-diff';

export interface MultiLayerVerdict {
  verdict: StepVerdict;
  evidence: EvidenceItem[];
  layers: StepComparisonEvidence;
}

interface ScoreInputs {
  baseline: Pick<
    TestResult,
    'consoleErrors' | 'networkRequests' | 'a11yViolations' | 'urlTrajectory' | 'webVitals' | 'extractedVariables'
  > | null;
  current: Pick<
    TestResult,
    'consoleErrors' | 'networkRequests' | 'a11yViolations' | 'urlTrajectory' | 'webVitals' | 'extractedVariables'
  >;
  /** Optional visual-diff record so we can fold visual signal into the verdict.
   *  When omitted we skip the visual layer entirely. */
  visualDiff?: Pick<VisualDiff, 'pixelDifference' | 'percentageDifference' | 'id'> | null;
  /** Variable-diff ignore patterns (per-test; defaults to none). */
  variableIgnorePaths?: string[];
}

export function scoreMultiLayer({
  baseline,
  current,
  visualDiff,
  variableIgnorePaths,
}: ScoreInputs): MultiLayerVerdict {
  const evidence: EvidenceItem[] = [];
  const layers: StepComparisonEvidence = {};

  // ── Visual ───────────────────────────────────────────────────────────
  if (visualDiff && (visualDiff.pixelDifference ?? 0) > 0) {
    layers.visual = {
      pixelDifference: visualDiff.pixelDifference ?? 0,
      percentageDifference: visualDiff.percentageDifference ?? null,
      diffId: visualDiff.id,
    };
    evidence.push({
      layer: 'visual',
      signal: 'medium',
      summary: `${visualDiff.pixelDifference} px (${visualDiff.percentageDifference ?? '?'}%)`,
    });
  }

  // ── Console (HIGH SIGNAL) ────────────────────────────────────────────
  const consoleDiff = computeConsoleDiff(
    baseline?.consoleErrors ?? [],
    current.consoleErrors ?? [],
  );
  if (consoleDiff.newFingerprints.length > 0 || consoleDiff.disappeared.length > 0
      || Object.keys(consoleDiff.countDelta).length > 0) {
    layers.consoleDiff = consoleDiff;
    if (consoleDiff.newFingerprints.length > 0) {
      evidence.push({
        layer: 'console',
        signal: 'high',
        summary: summarizeConsoleDiff(consoleDiff),
        details: { newFingerprints: consoleDiff.newFingerprints.slice(0, 5) },
      });
    } else {
      evidence.push({
        layer: 'console',
        signal: 'low',
        summary: summarizeConsoleDiff(consoleDiff),
      });
    }
  }

  // ── Network (HIGH SIGNAL on new 4xx/5xx) ─────────────────────────────
  const networkDiff = computeNetworkDiff(
    baseline?.networkRequests ?? [],
    current.networkRequests ?? [],
  );
  if (networkDiff.newErrorCount > 0 || networkDiff.added > 0 || networkDiff.removed > 0
      || networkDiff.changed > 0) {
    layers.network = networkDiff;
    if (networkDiff.newErrorCount > 0) {
      evidence.push({
        layer: 'network',
        signal: 'high',
        summary: summarizeNetworkDiff(networkDiff),
      });
    } else if (networkDiff.added > 0 || networkDiff.removed > 0) {
      evidence.push({
        layer: 'network',
        signal: 'medium',
        summary: summarizeNetworkDiff(networkDiff),
      });
    } else {
      evidence.push({
        layer: 'network',
        signal: 'low',
        summary: summarizeNetworkDiff(networkDiff),
      });
    }
  }

  // ── URL trajectory (HIGH SIGNAL) ─────────────────────────────────────
  const urlDiff = computeUrlTrajectoryDiff(
    baseline?.urlTrajectory ?? [],
    current.urlTrajectory ?? [],
  );
  if (urlDiff.divergedSteps.length > 0) {
    layers.url = urlDiff;
    evidence.push({
      layer: 'url',
      signal: 'high',
      summary: summarizeUrlTrajectoryDiff(urlDiff),
      details: { divergedSteps: urlDiff.divergedSteps.slice(0, 5) },
    });
  }

  // ── a11y (HIGH SIGNAL on critical/serious) ───────────────────────────
  const a11yDiff = computeA11yDiff(
    baseline?.a11yViolations ?? [],
    current.a11yViolations ?? [],
  );
  if (a11yDiff.newViolations.length > 0 || a11yDiff.disappeared.length > 0) {
    layers.a11y = a11yDiff;
    const isHigh = a11yDiff.newBySeverity.critical + a11yDiff.newBySeverity.serious > 0;
    evidence.push({
      layer: 'a11y',
      signal: isHigh ? 'high' : (a11yDiff.newViolations.length > 0 ? 'medium' : 'low'),
      summary: summarizeA11yDiff(a11yDiff),
    });
  }

  // ── Variables (HIGH SIGNAL on structural-break) ──────────────────────
  const varDiff = computeVariableDiff(
    baseline?.extractedVariables ?? null,
    current.extractedVariables ?? null,
    { ignorePaths: variableIgnorePaths },
  );
  if (varDiff.changes.length > 0) {
    layers.variable = varDiff;
    const hasStructural = varDiff.changes.some(c => c.tier === 'structural-break');
    evidence.push({
      layer: 'variable',
      signal: hasStructural ? 'high' : 'medium',
      summary: summarizeVariableDiff(varDiff),
    });
  }

  // ── Perf (HIGH SIGNAL on budget breach, MEDIUM on relative drift) ────
  const perfDiff = computePerfDiff(
    baseline?.webVitals ?? [],
    current.webVitals ?? [],
  );
  if (perfDiff.deltas.length > 0) {
    layers.perf = perfDiff;
    const breached = perfDiff.deltas.some(d => d.budgetBreached);
    const drifted = perfDiff.deltas.some(d => d.drifted);
    evidence.push({
      layer: 'perf',
      signal: breached ? 'high' : (drifted ? 'medium' : 'low'),
      summary: summarizePerfDiff(perfDiff),
    });
  }

  // ── Verdict ──────────────────────────────────────────────────────────
  const hasHigh = evidence.some(e => e.signal === 'high');
  const hasMedium = evidence.some(e => e.signal === 'medium');
  const verdict: StepVerdict = hasHigh ? 'red' : hasMedium ? 'yellow' : 'green';

  return { verdict, evidence, layers };
}
