/**
 * Assertion tracking instrumentation for test execution.
 *
 * Wraps each `expect(...)` (and `await page.waitForLoadState(...)`) line in
 * the test body with an `await __assertion(id, async () => { <stmt> })` call.
 * The runner's `__assertion` helper records pass/fail per id so the criteria
 * evaluator can promote a soft assertion failure to a hard test failure.
 *
 * The assertion ids come from the host's `parseAssertions(code)` and are
 * paired to runtime calls by source order — the parser walks the same source
 * top-to-bottom looking for the same matcher patterns, so the Nth match in
 * the body is the Nth parsed assertion.
 */

export interface ParsedAssertionRef {
  id: string;
}

/**
 * Match `expect(`, `await expect(`, or `await page.waitForLoadState(` lines.
 *
 * Mirrors what `parseAssertions` (src/lib/playwright/assertion-parser.ts)
 * counts. Both walks must agree on which lines are assertions, in the same
 * order, or ids drift.
 */
const ASSERTION_LINE_RE = /(?:^|\W)(?:expect\(|page\.waitForLoadState\()/;

/**
 * Instrument a test body so each assertion line is wrapped with
 * `await __assertion(<id>, async () => { <original stmt> });`.
 *
 * `assertions` must be in source order (as produced by `parseAssertions`).
 * Returns the new body and the number of lines actually wrapped — callers
 * can compare against `assertions.length` to log a warning when the runner
 * and parser disagree.
 */
export function instrumentAssertionTracking(
  body: string,
  assertions: ReadonlyArray<ParsedAssertionRef>,
): { instrumentedBody: string; wrappedCount: number } {
  if (!assertions || assertions.length === 0) {
    return { instrumentedBody: body, wrappedCount: 0 };
  }

  const lines = body.split('\n');
  let assertionIdx = 0;

  for (let i = 0; i < lines.length && assertionIdx < assertions.length; i++) {
    const line = lines[i];
    if (!ASSERTION_LINE_RE.test(line)) continue;

    // Statement must end on this line (semicolon at line end). Multi-line
    // expects fall through and stay un-instrumented — same limitation the
    // soft-wrapper has had, acceptable for now.
    const m = line.match(/^(\s*)(await\s+)?(.+;)\s*$/);
    if (!m) {
      // Skip without consuming an assertion id — keeps parser↔runner in sync
      // even if the regex misses a multi-line statement.
      continue;
    }

    const [, indent, awaitKw, stmt] = m;
    const id = assertions[assertionIdx].id;
    const inner = awaitKw ? `${awaitKw}${stmt}` : stmt;

    lines[i] = `${indent}await __assertion(${JSON.stringify(id)}, async () => { ${inner} });`;
    assertionIdx++;
  }

  return { instrumentedBody: lines.join('\n'), wrappedCount: assertionIdx };
}
