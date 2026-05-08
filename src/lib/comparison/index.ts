/**
 * Multi-layer comparison subsystem (v1.13).
 *
 * Sibling to `src/lib/diff/` (visual + url-diff). These engines compare the
 * same logical test across runs (baseline vs current) rather than two URLs
 * side-by-side. Each is a pure function returning a structured diff plus a
 * one-line summary; the `scorer` rolls them up into a green/yellow/red
 * verdict per test step.
 */
export { computeNetworkDiff, normalizeRequestUrl, summarizeNetworkDiff } from './network-diff';
export { computeConsoleDiff, fingerprintConsoleMessage, summarizeConsoleDiff } from './console-diff';
export { computeUrlTrajectoryDiff, normalizeTrajectoryUrl, summarizeUrlTrajectoryDiff } from './url-trajectory-diff';
export { computeA11yDiff, summarizeA11yDiff } from './a11y-diff';
export { computeVariableDiff, summarizeVariableDiff } from './variable-diff';
export { computePerfDiff, summarizePerfDiff } from './perf-diff';
export { scoreMultiLayer, type MultiLayerVerdict } from './scorer';
