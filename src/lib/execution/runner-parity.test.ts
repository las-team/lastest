/**
 * Runner Parity Tests
 *
 * Verifies that the remote runner (packages/runner/src/runner.ts) and
 * embedded browser executor (packages/embedded-browser/src/test-executor.ts)
 * apply the same code transformations and behavior contracts.
 *
 * TS-stripping is now a shared utility (`@lastest/shared` → `ts-strip.ts`),
 * so both runners import the *same* function rather than each carrying a
 * private copy kept in sync by hand. This test file therefore:
 *   1. Unit-tests the shared `stripTypeAnnotations` (sucrase path) on the
 *      TS-torture fixtures the hand-rolled regex couldn't handle.
 *   2. Unit-tests the `legacyStripTypeAnnotations` regex fallback for the
 *      original byte-exact outputs (rare parse failures degrade to this).
 *   3. Keeps the existing behavioural-parity checks (selectAll, soft errors,
 *      function-body extraction, function removal, timeout/cancel).
 */
import { describe, it, expect } from 'vitest';
import { instrumentAssertionTracking, stripTypeAnnotations, legacyStripTypeAnnotations } from '@lastest/shared';

// ─── Function body extraction regex (shared by both runners) ───
const FUNC_BODY_REGEX = /export\s+async\s+function\s+test\s*\(\s*page[^)]*\)\s*\{([\s\S]*)\}\s*$/;

// ─── Function removal (runner uses inline, embedded uses removeFunctionDefinition) ───
function runnerRemoveFunction(body: string, funcName: string): string {
  const pattern = `async function ${funcName}(`;
  if (!body.includes(pattern)) return body;

  const regex = new RegExp(`async function ${funcName}\\s*\\([^)]*\\)\\s*\\{`);
  const startMatch = body.match(regex);
  if (!startMatch || startMatch.index === undefined) return body;

  const startIdx = startMatch.index;
  const braceStart = body.indexOf('{', startIdx);
  let depth = 1;
  let endIdx = braceStart + 1;
  while (depth > 0 && endIdx < body.length) {
    if (body[endIdx] === '{') depth++;
    else if (body[endIdx] === '}') depth--;
    endIdx++;
  }
  return body.slice(0, startIdx) + `/* ${funcName} provided by runner */` + body.slice(endIdx);
}

function embeddedRemoveFunction(body: string, funcName: string): { body: string; removed: boolean } {
  const pattern = `async function ${funcName}`;
  if (!body.includes(pattern)) return { body, removed: false };

  const regex = new RegExp(`async function ${funcName}\\s*\\([^)]*\\)\\s*\\{`);
  const startMatch = body.match(regex);
  if (!startMatch || startMatch.index === undefined) return { body, removed: false };

  const startIdx = startMatch.index;
  const braceStart = body.indexOf('{', startIdx);
  let depth = 1;
  let endIdx = braceStart + 1;
  while (depth > 0 && endIdx < body.length) {
    if (body[endIdx] === '{') depth++;
    else if (body[endIdx] === '}') depth--;
    endIdx++;
  }
  return {
    body: body.slice(0, startIdx) + `/* ${funcName} provided by runner */` + body.slice(endIdx),
    removed: true,
  };
}

// ─── selectAll patching (identical in both) ───
function patchSelectAll(body: string): string {
  return body.replace(/page\.keyboard\.selectAll\(\)/g, "page.keyboard.press('Control+a')");
}

// ─── Soft error wrapping (identical in both) ───
function wrapSoftErrors(body: string): string {
  return body.replace(/^(\s*)(await\s+.+;)\s*$/gm, (_match: string, indent: string, stmt: string) => {
    if (stmt.includes('.screenshot(')) return `${indent}${stmt}`;
    return `${indent}try { ${stmt} } catch(__softErr) { stepLogger.warn(typeof __softErr === 'object' && __softErr !== null && 'message' in __softErr ? __softErr.message : String(__softErr)); }`;
  });
}

/**
 * Helper: asserts that a stripped body parses as a valid async-function body.
 * This is the real contract we care about — `new AsyncFunction(..., body)`
 * must not throw with "Unexpected token" or similar syntax errors.
 */
function assertParsesAsAsyncBody(body: string): void {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  expect(() => new AsyncFunction('page', 'expect', body)).not.toThrow();
}

// ────────────────────────────────────────────────────────────────────────
// Shared stripTypeAnnotations (sucrase path) — semantic correctness tests.
// Sucrase preserves formatting differently from the legacy regex, so these
// assert "no TS remnants + parses as valid JS" rather than byte-exact output.
// ────────────────────────────────────────────────────────────────────────

const TS_TORTURE_FIXTURES: Array<{ name: string; input: string; mustNotContain?: string[]; mustContain?: string[] }> = [
  {
    name: 'simple variable type annotation',
    input: 'const x: string = "hello";',
    mustNotContain: [': string'],
    mustContain: ['"hello"'],
  },
  {
    name: 'destructured object type annotation',
    input: 'const { a, b }: MyType = obj;',
    mustNotContain: [': MyType'],
    mustContain: ['{ a, b }', 'obj'],
  },
  {
    name: 'as cast after parenthesis inside page.evaluate — mwhospital regression',
    input: 'await page.evaluate(() => { const i = document.querySelector("div"); (i as HTMLElement).click(); });',
    mustNotContain: ['as HTMLElement'],
    mustContain: ['.click()'],
  },
  {
    name: 'non-null assertion — previously unhandled',
    input: 'const x = obj!.foo();',
    mustNotContain: ['!.'],
    mustContain: ['obj', '.foo()'],
  },
  {
    name: 'parameter type annotation in arrow inside page.evaluate',
    input: 'await page.evaluate(() => { document.querySelectorAll("a").forEach((el: HTMLElement) => el.click()); });',
    mustNotContain: [': HTMLElement'],
    mustContain: ['.click()'],
  },
  {
    name: 'generic type cast prefix',
    input: 'const items = <string[]>getItems();',
    mustNotContain: ['<string[]>'],
    mustContain: ['getItems()'],
  },
  {
    name: 'type-only import is stripped entirely',
    input: 'import type { Page } from "playwright";\nawait page.goto("/");',
    mustNotContain: ['import type'],
    mustContain: ['page.goto'],
  },
  {
    name: 'return-type annotation on arrow',
    input: 'const f = (): Promise<void> => { return Promise.resolve(); };',
    mustNotContain: [': Promise<void>'],
    mustContain: ['Promise.resolve()'],
  },
  {
    name: 'double cast x as unknown as HTMLElement',
    input: 'const el = (x as unknown as HTMLElement).click();',
    mustNotContain: ['as unknown', 'as HTMLElement'],
    mustContain: ['.click()'],
  },
  {
    name: 'satisfies operator',
    input: 'const cfg = { a: 1 } satisfies Foo;',
    mustNotContain: ['satisfies'],
    mustContain: ['{ a: 1 }'],
  },
  {
    name: 'comment containing "as HTMLElement" is left intact',
    input: '// cast x as HTMLElement for foo\nconst y = 1;',
    mustContain: ['cast x as HTMLElement for foo'],
  },
  {
    name: 'string literal containing "as HTMLElement" is left intact',
    input: 'const s = "x as HTMLElement";',
    mustContain: ['"x as HTMLElement"'],
  },
];

describe('stripTypeAnnotations (shared, sucrase path)', () => {
  for (const fx of TS_TORTURE_FIXTURES) {
    it(fx.name, () => {
      const out = stripTypeAnnotations(fx.input);
      for (const needle of fx.mustNotContain ?? []) {
        expect(out).not.toContain(needle);
      }
      for (const needle of fx.mustContain ?? []) {
        expect(out).toContain(needle);
      }
      assertParsesAsAsyncBody(out);
    });
  }

  it('preserves line count (1:1 line mapping for stack traces)', () => {
    const input = 'const a: number = 1;\nconst b: string = "x";\nconst c = a + b.length;';
    const out = stripTypeAnnotations(input);
    expect(out.split('\n').length).toBe(input.split('\n').length);
  });

  it('is idempotent — stripping already-stripped JS is a no-op in content', () => {
    const input = 'const x = 5;\nawait page.goto("/");';
    const once = stripTypeAnnotations(input);
    const twice = stripTypeAnnotations(once);
    expect(twice).toBe(once);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Legacy regex fallback — byte-exact outputs preserved for backwards compat.
// These are the contracts that the hand-rolled regex honoured; the fallback
// must continue to honour them so that if sucrase parse-fails on some odd
// input, behaviour degrades to "same as before".
// ────────────────────────────────────────────────────────────────────────

const LEGACY_BYTE_EXACT_CASES = [
  { name: 'simple variable type annotation', input: 'const x: string = "hello";', expected: 'const x= "hello";' },
  { name: 'let variable type annotation', input: 'let count: number = 0;', expected: 'let count= 0;' },
  { name: 'destructured object type annotation', input: 'const { a, b }: MyType = obj;', expected: 'const { a, b }= obj;' },
  { name: 'destructured array type annotation', input: 'const [x, y]: [number, number] = coords;', expected: 'const [x, y]= coords;' },
  { name: 'as cast after parenthesis', input: 'const el = (await page.locator("div")) as HTMLElement;', expected: 'const el = (await page.locator("div"));' },
  { name: 'as cast on value', input: 'const val = result as string;', expected: 'const val = result;' },
  { name: 'generic type parameter before function call', input: 'const items = <string[]>getItems();', expected: 'const items = getItems();' },
  { name: 'complex union type', input: 'const x: string | number | null = getValue();', expected: 'const x= getValue();' },
  { name: 'no annotations (passthrough)', input: 'const x = 5;', expected: 'const x = 5;' },
];

describe('legacyStripTypeAnnotations (regex fallback)', () => {
  for (const tc of LEGACY_BYTE_EXACT_CASES) {
    it(`byte-exact: ${tc.name}`, () => {
      expect(legacyStripTypeAnnotations(tc.input)).toBe(tc.expected);
    });
  }
});

// ────────────────────────────────────────────────────────────────────────
// Remaining behavioural parity checks — unchanged.
// ────────────────────────────────────────────────────────────────────────

const FUNC_BODY_CASES = [
  {
    name: 'standard test function',
    input: `export async function test(page, baseUrl, screenshotPath, stepLogger) {
  await page.goto(baseUrl);
  await page.screenshot();
}`,
    expectedBody: '\n  await page.goto(baseUrl);\n  await page.screenshot();\n',
  },
  {
    name: 'test function with type annotations',
    input: `export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: StepLogger) {
  const title: string = await page.title();
}`,
    expectedBody: '\n  const title: string = await page.title();\n',
  },
  {
    name: 'no wrapper (fallback to full code)',
    input: 'await page.goto("/");\nawait page.screenshot();',
    expectedBody: null,
  },
];

const FUNCTION_REMOVAL_CASES = [
  {
    name: 'simple locateWithFallback',
    input: `  doSomething();
  async function locateWithFallback(page, selectors) {
    for (const s of selectors) {
      try { return page.locator(s); } catch { continue; }
    }
  }
  await locateWithFallback(page, [".btn"]);`,
    funcName: 'locateWithFallback',
    shouldRemove: true,
  },
  {
    name: 'nested braces in function',
    input: `  async function locateWithFallback(page, selectors) {
    for (const s of selectors) {
      if (s.type === 'css') {
        const el = page.locator(s.value);
        if (el) { return el; }
      }
    }
  }
  doStuff();`,
    funcName: 'locateWithFallback',
    shouldRemove: true,
  },
  {
    name: 'replayCursorPath removal',
    input: `  async function replayCursorPath(page, moves) {
    for (const [x, y, delay] of moves) {
      await page.mouse.move(x, y);
    }
  }
  await replayCursorPath(page, [[0,0,0]]);`,
    funcName: 'replayCursorPath',
    shouldRemove: true,
  },
  {
    name: 'no function to remove',
    input: '  await page.goto("/");',
    funcName: 'locateWithFallback',
    shouldRemove: false,
  },
];

describe('Runner Parity — Code Transformations', () => {
  describe('function body extraction', () => {
    for (const tc of FUNC_BODY_CASES) {
      it(`both use identical regex: ${tc.name}`, () => {
        const match = tc.input.match(FUNC_BODY_REGEX);
        if (tc.expectedBody === null) {
          expect(match).toBeNull();
        } else {
          expect(match).not.toBeNull();
          expect(match![1]).toBe(tc.expectedBody);
        }
      });
    }
  });

  describe('function removal (locateWithFallback, replayCursorPath)', () => {
    for (const tc of FUNCTION_REMOVAL_CASES) {
      it(`both produce identical output: ${tc.name}`, () => {
        const runnerResult = runnerRemoveFunction(tc.input, tc.funcName);
        const embeddedResult = embeddedRemoveFunction(tc.input, tc.funcName);

        expect(runnerResult).toBe(embeddedResult.body);
        expect(embeddedResult.removed).toBe(tc.shouldRemove);

        if (tc.shouldRemove) {
          expect(runnerResult).toContain(`/* ${tc.funcName} provided by runner */`);
          expect(runnerResult).not.toContain(`async function ${tc.funcName}`);
        }
      });
    }
  });

  describe('selectAll patching', () => {
    it('patches page.keyboard.selectAll() to press Control+a', () => {
      const input = '  await page.keyboard.selectAll();';
      const result = patchSelectAll(input);
      expect(result).toBe("  await page.keyboard.press('Control+a');");
    });

    it('patches multiple occurrences', () => {
      const input = 'await page.keyboard.selectAll();\nawait page.keyboard.selectAll();';
      const result = patchSelectAll(input);
      expect(result).not.toContain('selectAll');
      expect(result.split("press('Control+a')").length).toBe(3);
    });

    it('does not affect other keyboard methods', () => {
      const input = 'await page.keyboard.press("Enter");';
      const result = patchSelectAll(input);
      expect(result).toBe(input);
    });
  });

  describe('assertion instrumentation (shared helper used by both runners)', () => {
    it('wraps await expect(page).toHaveURL with __assertion(id, async () => { ... })', () => {
      const body = `await expect(page).toHaveURL('/home');`;
      const { instrumentedBody, wrappedCount } = instrumentAssertionTracking(body, [{ id: 'aaa111' }]);
      expect(wrappedCount).toBe(1);
      expect(instrumentedBody).toContain('await __assertion("aaa111"');
      expect(instrumentedBody).toContain(`await expect(page).toHaveURL('/home');`);
    });

    it('pairs multiple assertions in source order', () => {
      const body = [
        `await page.waitForLoadState('networkidle');`,
        `await expect(page).toHaveURL(/foo/);`,
        `await expect(button).toBeVisible();`,
      ].join('\n');
      const { instrumentedBody, wrappedCount } = instrumentAssertionTracking(body, [
        { id: 'id-load' }, { id: 'id-url' }, { id: 'id-vis' },
      ]);
      expect(wrappedCount).toBe(3);
      const lines = instrumentedBody.split('\n');
      expect(lines[0]).toContain('"id-load"');
      expect(lines[1]).toContain('"id-url"');
      expect(lines[2]).toContain('"id-vis"');
    });

    it('is a no-op when no assertions are provided', () => {
      const body = `await expect(page).toHaveURL('/home');`;
      const { instrumentedBody, wrappedCount } = instrumentAssertionTracking(body, []);
      expect(wrappedCount).toBe(0);
      expect(instrumentedBody).toBe(body);
    });

    it('preserves indentation', () => {
      const body = `    await expect(page).toHaveURL('/');`;
      const { instrumentedBody } = instrumentAssertionTracking(body, [{ id: 'i1' }]);
      expect(instrumentedBody).toMatch(/^ {4}await __assertion\(/);
    });
  });

  describe('soft error wrapping', () => {
    it('wraps standalone await statements', () => {
      const input = '  await page.click(".btn");';
      const result = wrapSoftErrors(input);
      expect(result).toContain('try {');
      expect(result).toContain('catch(__softErr)');
      expect(result).toContain('stepLogger.warn');
    });

    it('does NOT wrap screenshot calls', () => {
      const input = '  await page.screenshot();';
      const result = wrapSoftErrors(input);
      expect(result).not.toContain('try {');
      expect(result).toBe(input);
    });

    it('wraps multiple lines independently', () => {
      const input = [
        '  await page.click(".a");',
        '  await page.screenshot();',
        '  await page.fill(".b", "value");',
      ].join('\n');

      const result = wrapSoftErrors(input);
      const lines = result.split('\n');

      expect(lines[0]).toContain('try {');
      expect(lines[1]).not.toContain('try {');
      expect(lines[1]).toContain('.screenshot()');
      expect(lines[2]).toContain('try {');
    });

    it('preserves indentation', () => {
      const input = '    await page.goto("/");';
      const result = wrapSoftErrors(input);
      expect(result).toMatch(/^    try \{/);
    });
  });
});

describe('Runner Parity — Behavioral Contracts', () => {
  describe('timeout handling', () => {
    it('both enforce Math.max(timeout, 30000)', () => {
      const computeTimeout = (timeout?: number) => Math.max(timeout || 120000, 30000);

      expect(computeTimeout(undefined)).toBe(120000);
      expect(computeTimeout(10000)).toBe(30000);
      expect(computeTimeout(60000)).toBe(60000);
      expect(computeTimeout(0)).toBe(120000);
    });
  });

  describe('replayCursorPath speed calculation', () => {
    it('both use Math.round(delay / speed) for delay computation', () => {
      const computeDelay = (delay: number, speed: number) => {
        if (delay > 0 && speed > 0) return Math.round(delay / speed);
        return 0;
      };

      expect(computeDelay(100, 1)).toBe(100);
      expect(computeDelay(100, 2)).toBe(50);
      expect(computeDelay(100, 0.5)).toBe(200);
      expect(computeDelay(100, 0)).toBe(0);
      expect(computeDelay(0, 1)).toBe(0);
    });
  });

  describe('context options parity', () => {
    it('both apply deviceScaleFactor:1 when crossOsConsistency or freezeAnimations enabled', () => {
      const getContextOptions = (stabilization?: { crossOsConsistency?: boolean; freezeAnimations?: boolean }) => {
        const needsStabilized = stabilization?.crossOsConsistency || stabilization?.freezeAnimations;
        return {
          ...(needsStabilized ? { deviceScaleFactor: 1 } : {}),
          ...(needsStabilized ? { locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light' } : {}),
          ...(stabilization?.freezeAnimations ? { reducedMotion: 'reduce' } : {}),
        };
      };

      const noStab = getContextOptions();
      expect(noStab).not.toHaveProperty('deviceScaleFactor');

      const crossOs = getContextOptions({ crossOsConsistency: true });
      expect(crossOs.deviceScaleFactor).toBe(1);
      expect(crossOs.locale).toBe('en-US');
      expect(crossOs.timezoneId).toBe('UTC');
      expect(crossOs.colorScheme).toBe('light');

      const freezeAnim = getContextOptions({ freezeAnimations: true });
      expect(freezeAnim.deviceScaleFactor).toBe(1);
      expect(freezeAnim.reducedMotion).toBe('reduce');

      const both = getContextOptions({ crossOsConsistency: true, freezeAnimations: true });
      expect(both.deviceScaleFactor).toBe(1);
      expect(both.reducedMotion).toBe('reduce');
    });
  });

  describe('cancellation detection', () => {
    it('both detect cancellation via error message containing "cancelled"', () => {
      const isCancelled = (errorMessage: string, aborted: boolean) =>
        errorMessage.includes('cancelled') || aborted;

      expect(isCancelled('Test cancelled', false)).toBe(true);
      expect(isCancelled('Test cancelled before starting', false)).toBe(true);
      expect(isCancelled('Some other error', true)).toBe(true);
      expect(isCancelled('Some other error', false)).toBe(false);
    });
  });

  describe('timeout detection', () => {
    it('both detect timeout via error message containing "timed out"', () => {
      const isTimeout = (msg: string) => msg.includes('timed out');

      expect(isTimeout('Test execution timed out after 30000ms')).toBe(true);
      expect(isTimeout('Navigation timed out')).toBe(true);
      expect(isTimeout('Test failed: element not found')).toBe(false);
    });
  });

  describe('full pipeline parity', () => {
    it('both apply transforms in same order: extract → strip types → remove functions → patch selectAll → wrap errors', () => {
      const testCode = `export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: StepLogger) {
  const title: string = await page.title();
  async function locateWithFallback(pg: Page, sels: Selector[]) {
    for (const s of sels) {
      try { return pg.locator(s.value); } catch { continue; }
    }
  }
  await page.keyboard.selectAll();
  await page.click(".btn");
  await page.screenshot();
}`;

      const match = testCode.match(FUNC_BODY_REGEX);
      expect(match).not.toBeNull();
      let body = match![1];

      body = stripTypeAnnotations(body);
      expect(body).not.toContain(': string');
      expect(body).not.toContain(': Selector[]');

      const removed = embeddedRemoveFunction(body, 'locateWithFallback');
      expect(removed.removed).toBe(true);
      body = removed.body;

      body = patchSelectAll(body);
      expect(body).not.toContain('selectAll');

      body = wrapSoftErrors(body);
      expect(body).toContain('try {');
      const screenshotLine = body.split('\n').find(l => l.includes('.screenshot('));
      expect(screenshotLine).toBeDefined();
      expect(screenshotLine).not.toContain('try {');
    });
  });
});
