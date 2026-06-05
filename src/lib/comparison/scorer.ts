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
} from "@/lib/db/schema";
import { computeNetworkDiff, summarizeNetworkDiff } from "./network-diff";
import { computeConsoleDiff, summarizeConsoleDiff } from "./console-diff";
import {
  computeUrlTrajectoryDiff,
  normalizeTrajectoryUrl,
  summarizeUrlTrajectoryDiff,
} from "./url-trajectory-diff";
import { computeA11yDiff, summarizeA11yDiff } from "./a11y-diff";
import { computeVariableDiff, summarizeVariableDiff } from "./variable-diff";
import { computePerfDiff, summarizePerfDiff } from "./perf-diff";

export interface MultiLayerVerdict {
  verdict: StepVerdict;
  evidence: EvidenceItem[];
  layers: StepComparisonEvidence;
}

interface ScoreInputs {
  baseline: Pick<
    TestResult,
    | "consoleErrors"
    | "networkRequests"
    | "a11yViolations"
    | "urlTrajectory"
    | "webVitals"
    | "extractedVariables"
  > | null;
  current: Pick<
    TestResult,
    | "consoleErrors"
    | "networkRequests"
    | "a11yViolations"
    | "urlTrajectory"
    | "webVitals"
    | "extractedVariables"
  >;
  /** Optional visual-diff record so we can fold visual signal into the verdict.
   *  When omitted we skip the visual layer entirely. */
  visualDiff?: Pick<
    VisualDiff,
    "pixelDifference" | "percentageDifference" | "id"
  > | null;
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
      layer: "visual",
      signal: "medium",
      summary: `${visualDiff.pixelDifference} px (${visualDiff.percentageDifference ?? "?"}%)`,
    });
  }

  // First-run silent baseline-establish. With no prior TestResult, every
  // non-visual diff below would falsely report all captured values as "new".
  // Skip them; the current TestResult becomes the implicit baseline for the
  // next build via getPreviousTestResultForTest. Visual already ran above —
  // its baseline lifecycle is independent (getBranchBaseline / auto-approve).
  if (baseline === null) {
    const verdict: StepVerdict = evidence.some((e) => e.signal === "medium")
      ? "yellow"
      : "green";
    return { verdict, evidence, layers };
  }

  // ── Console (HIGH SIGNAL) ────────────────────────────────────────────
  const consoleDiff = computeConsoleDiff(
    baseline?.consoleErrors ?? [],
    current.consoleErrors ?? [],
  );
  if (
    consoleDiff.newFingerprints.length > 0 ||
    consoleDiff.disappeared.length > 0 ||
    Object.keys(consoleDiff.countDelta).length > 0
  ) {
    layers.consoleDiff = consoleDiff;
    if (consoleDiff.newFingerprints.length > 0) {
      // Only NEW *app* (or CSP) fingerprints redden the verdict. Third-party
      // SDK noise (analytics, Cloudflare email-decoder, Hotjar) and transient
      // network 4xx/5xx surfacing as "Failed to load resource: …" are kept
      // visible at medium signal but do not gate. The `category` field on each
      // fingerprint is set by classifyConsoleFingerprint at fingerprint time.
      const hasOwnedNew = consoleDiff.newFingerprints.some(
        (f) =>
          f.category === "app" ||
          f.category === "csp" ||
          f.category === "unknown",
      );
      evidence.push({
        layer: "console",
        signal: hasOwnedNew ? "high" : "medium",
        summary: summarizeConsoleDiff(consoleDiff),
        details: { newFingerprints: consoleDiff.newFingerprints.slice(0, 5) },
      });
    } else {
      evidence.push({
        layer: "console",
        signal: "low",
        summary: summarizeConsoleDiff(consoleDiff),
      });
    }
  }

  // ── Network (HIGH SIGNAL on new 4xx/5xx; non-error churn is info-only) ─
  // `newErrorCount` already counts both new 4xx/5xx and error-class status
  // flips (see network-diff.ts). Endpoint-level counts (one bump per unique
  // (method, normalized URL) bucket) drive surface checks so cache warmup or
  // retry storms don't pad the report. Raw request counts stay in
  // `layers.network` for drill-down.
  const networkDiff = computeNetworkDiff(
    baseline?.networkRequests ?? [],
    current.networkRequests ?? [],
  );
  // computeNetworkDiff is fresh-compute → endpoint counts are always populated.
  if (
    networkDiff.newErrorCount > 0 ||
    (networkDiff.addedEndpoints ?? 0) > 0 ||
    (networkDiff.removedEndpoints ?? 0) > 0 ||
    (networkDiff.changedEndpoints ?? 0) > 0
  ) {
    layers.network = networkDiff;
    if (networkDiff.newErrorCount > 0) {
      evidence.push({
        layer: "network",
        signal: "high",
        summary: summarizeNetworkDiff(networkDiff),
      });
    } else {
      evidence.push({
        layer: "network",
        signal: "low",
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
    // A divergedStep is "real" only when the normalized finalUrl actually
    // changed. A redirect-chain-length-only change with identical normalized
    // finalUrl is CDN/A-B/auth-cache noise — keep it visible but don't fail.
    const hasRealUrlChange = urlDiff.divergedSteps.some(
      (s) =>
        normalizeTrajectoryUrl(s.baselineUrl) !==
        normalizeTrajectoryUrl(s.currentUrl),
    );
    evidence.push({
      layer: "url",
      signal: hasRealUrlChange ? "high" : "low",
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
    const isHigh =
      a11yDiff.newBySeverity.critical + a11yDiff.newBySeverity.serious > 0;
    evidence.push({
      layer: "a11y",
      signal: isHigh
        ? "high"
        : a11yDiff.newViolations.length > 0
          ? "medium"
          : "low",
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
    const hasStructural = varDiff.changes.some(
      (c) => c.tier === "structural-break",
    );
    evidence.push({
      layer: "variable",
      signal: hasStructural ? "high" : "medium",
      summary: summarizeVariableDiff(varDiff),
    });
  }

  // ── Perf (HIGH SIGNAL only on a NEWLY-introduced budget breach) ──────
  // Pre-existing breaches (current still over budget but baseline already was,
  // delta ≈ 0) are surfaced in `layers.perf` for visibility but stay 'low' —
  // otherwise every subsequent run inherits the same red verdict forever.
  // Relative drift within budget remains 'medium' (yellow gate).
  const perfDiff = computePerfDiff(
    baseline?.webVitals ?? [],
    current.webVitals ?? [],
  );
  if (perfDiff.deltas.length > 0) {
    layers.perf = perfDiff;
    const newBreach = perfDiff.deltas.some((d) => d.newlyBreached);
    const drifted = perfDiff.deltas.some((d) => d.drifted);
    evidence.push({
      layer: "perf",
      signal: newBreach ? "high" : drifted ? "medium" : "low",
      summary: summarizePerfDiff(perfDiff),
    });
  }

  // ── Verdict ──────────────────────────────────────────────────────────
  const hasHigh = evidence.some((e) => e.signal === "high");
  const hasMedium = evidence.some((e) => e.signal === "medium");
  const verdict: StepVerdict = hasHigh ? "red" : hasMedium ? "yellow" : "green";

  return { verdict, evidence, layers };
}
