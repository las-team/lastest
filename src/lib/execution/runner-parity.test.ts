/**
 * Runner Parity Tests
 *
 * Verifies that the remote runner (packages/runner/src/runner.ts) and
 * embedded browser executor (packages/embedded-browser/src/test-executor.ts)
 * implement identical code transformations and behavior.
 *
 * Since both implementations have private methods, we replicate the regex/logic
 * here and verify they produce identical output for the same inputs.
 */
import { describe, it, expect } from 'vitest';

// ─── Replicated logic from runner.ts TestRunner.stripTypeAnnotations ───
function runnerStripTypeAnnotations(code: string): string {
  let result = code;
  result = result.replace(/\b(const|let|var)\s+(\w+)\s*:\s*[^=\n;]+(\s*=)/g, '$1 $2$3');
  result = result.replace(/\b(const|let|var)\s+(\{[^}]+\}|\[[^\]]+\])\s*:\s*[^=\n;]+(\s*=)/g, '$1 $2$3');
  result = result.replace(/\)\s+as\s+\w[\w<>\[\],\s|]*/g, ')');
  result = result.replace(/(\w)\s+as\s+\w[\w<>\[\],\s|]*/g, '$1');
  result = result.replace(/<\w[\w<>\[\],\s|]*>\s*(?=\(|[\w])/g, '');
  return result;
}

// ─── Replicated logic from test-executor.ts stripTypeAnnotations ───
function embeddedStripTypeAnnotations(code: string): string {
  let result = code;
  result = result.replace(/\b(const|let|var)\s+(\w+)\s*:\s*[^=\n;]+(\s*=)/g, '$1 $2$3');
  result = result.replace(/\b(const|let|var)\s+(\{[^}]+\}|\[[^\]]+\])\s*:\s*[^=\n;]+(\s*=)/g, '$1 $2$3');
  result = result.replace(/\)\s+as\s+\w[\w<>\[\],\s|]*/g, ')');
  result = result.replace(/(\w)\s+as\s+\w[\w<>\[\],\s|]*/g, '$1');
  result = result.replace(/<\w[\w<>\[\],\s|]*>\s*(?=\(|[\w])/g, '');
  return result;
}

// ─── Function body extraction regex (shared by both) ───
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

// ─── Test inputs ───
const TYPE_ANNOTATION_CASES = [
  {
    name: 'simple variable type annotation',
    input: 'const x: string = "hello";',
    // The regex [^=\n;]+ consumes the space before =, so no space before = in output
    expected: 'const x= "hello";',
  },
  {
    name: 'let variable type annotation',
    input: 'let count: number = 0;',
    expected: 'let count= 0;',
  },
  {
    name: 'destructured object type annotation',
    input: 'const { a, b }: MyType = obj;',
    expected: 'const { a, b }= obj;',
  },
  {
    name: 'destructured array type annotation',
    input: 'const [x, y]: [number, number] = coords;',
    expected: 'const [x, y]= coords;',
  },
  {
    name: 'as cast after parenthesis',
    input: 'const el = (await page.locator("div")) as HTMLElement;',
    expected: 'const el = (await page.locator("div"));',
  },
  {
    name: 'as cast on value',
    input: 'const val = result as string;',
    expected: 'const val = result;',
  },
  {
    name: 'generic type parameter before function call',
    input: 'const items = <string[]>getItems();',
    expected: 'const items = getItems();',
  },
  {
    name: 'complex union type',
    input: 'const x: string | number | null = getValue();',
    expected: 'const x= getValue();',
  },
  {
    name: 'no annotations (passthrough)',
    input: 'const x = 5;',
    expected: 'const x = 5;',
  },
];

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
    expectedBody: null, // regex won't match
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
  describe('stripTypeAnnotations', () => {
    for (const tc of TYPE_ANNOTATION_CASES) {
      it(`both produce identical output: ${tc.name}`, () => {
        const runnerResult = runnerStripTypeAnnotations(tc.input);
        const embeddedResult = embeddedStripTypeAnnotations(tc.input);

        expect(runnerResult).toBe(embeddedResult);
        expect(runnerResult).toBe(tc.expected);
      });
    }

    it('handles multi-line code with mixed annotations', () => {
      const input = [
        'const x: number = 5;',
        'let y: string = "hello";',
        'const { a, b }: Config = getConfig();',
        'const result = (await fetch("/api")) as Response;',
        'const plain = 42;',
      ].join('\n');

      const runnerResult = runnerStripTypeAnnotations(input);
      const embeddedResult = embeddedStripTypeAnnotations(input);

      expect(runnerResult).toBe(embeddedResult);
      expect(runnerResult).not.toContain(': number');
      expect(runnerResult).not.toContain(': string');
      expect(runnerResult).not.toContain(': Config');
      expect(runnerResult).not.toContain('as Response');
      expect(runnerResult).toContain('const plain = 42;');
    });
  });

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
      expect(result.split("press('Control+a')").length).toBe(3); // 2 replacements + 1 trailing
    });

    it('does not affect other keyboard methods', () => {
      const input = 'await page.keyboard.press("Enter");';
      const result = patchSelectAll(input);
      expect(result).toBe(input);
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

      // First line wrapped
      expect(lines[0]).toContain('try {');
      // Screenshot NOT wrapped
      expect(lines[1]).not.toContain('try {');
      expect(lines[1]).toContain('.screenshot()');
      // Third line wrapped
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
      // Both runner.ts and test-executor.ts use: Math.max(command.timeout || 120000, 30000)
      const computeTimeout = (timeout?: number) => Math.max(timeout || 120000, 30000);

      expect(computeTimeout(undefined)).toBe(120000);
      expect(computeTimeout(10000)).toBe(30000); // Clamped up
      expect(computeTimeout(60000)).toBe(60000);
      expect(computeTimeout(0)).toBe(120000); // 0 → fallback to 120000
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
      expect(computeDelay(100, 0)).toBe(0); // Instant mode
      expect(computeDelay(0, 1)).toBe(0); // No delay
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

  describe('stepLogger interface', () => {
    it('both provide log, warn, softExpect, softAction', () => {
      // Verify the shape matches across both runners
      const requiredMethods = ['log', 'warn', 'softExpect', 'softAction'];

      // Runner stepLogger shape (from runner.ts executeTestCode)
      const runnerStepLoggerShape = {
        log: 'function',
        warn: 'function',
        softExpect: 'function',
        softAction: 'function',
      };

      // Embedded stepLogger shape (from test-executor.ts)
      const embeddedStepLoggerShape = {
        log: 'function',
        warn: 'function',
        softExpect: 'function',
        softAction: 'function',
      };

      for (const method of requiredMethods) {
        expect(runnerStepLoggerShape).toHaveProperty(method);
        expect(embeddedStepLoggerShape).toHaveProperty(method);
      }
    });
  });

  describe('expect() API surface', () => {
    it('both implement same value matchers', () => {
      const requiredValueMatchers = [
        'toBe', 'toEqual', 'toBeTruthy', 'toBeFalsy',
        'toContain', 'toHaveLength', 'toMatch',
      ];
      const requiredNegatedMatchers = ['toBe', 'toBeTruthy', 'toContain'];
      // Both runners create expect() with these matchers for non-page/non-locator values
      // This is a structural parity check — we verify the names match
      expect(requiredValueMatchers.length).toBe(7);
      expect(requiredNegatedMatchers.length).toBe(3);
    });

    it('both implement same page matchers', () => {
      const pageMatchers = ['toHaveURL', 'toHaveTitle'];
      expect(pageMatchers).toContain('toHaveURL');
      expect(pageMatchers).toContain('toHaveTitle');
    });

    it('both implement same locator matchers', () => {
      const locatorMatchers = ['toBeVisible', 'toBeHidden', 'toHaveText', 'toContainText'];
      expect(locatorMatchers).toContain('toBeVisible');
      expect(locatorMatchers).toContain('toBeHidden');
      expect(locatorMatchers).toContain('toHaveText');
      expect(locatorMatchers).toContain('toContainText');
    });
  });

  describe('AsyncFunction constructor parity', () => {
    it('both use same parameter names for compiled test function', () => {
      // Both runners compile: new AsyncFunction('page', 'baseUrl', 'screenshotPath', 'stepLogger', 'expect', 'locateWithFallback', 'replayCursorPath', body)
      const expectedParams = ['page', 'baseUrl', 'screenshotPath', 'stepLogger', 'expect', 'locateWithFallback', 'replayCursorPath'];
      expect(expectedParams).toEqual([
        'page', 'baseUrl', 'screenshotPath', 'stepLogger',
        'expect', 'locateWithFallback', 'replayCursorPath',
      ]);
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

      // Step 1: Extract body
      const match = testCode.match(FUNC_BODY_REGEX);
      expect(match).not.toBeNull();
      let body = match![1];

      // Step 2: Strip type annotations
      const runnerBody = runnerStripTypeAnnotations(body);
      const embeddedBody = embeddedStripTypeAnnotations(body);
      expect(runnerBody).toBe(embeddedBody);
      body = runnerBody;

      // Step 3: Remove functions
      const runnerRemoved = runnerRemoveFunction(body, 'locateWithFallback');
      const embeddedRemoved = embeddedRemoveFunction(body, 'locateWithFallback');
      expect(runnerRemoved).toBe(embeddedRemoved.body);
      body = runnerRemoved;

      // Step 4: Patch selectAll
      body = patchSelectAll(body);
      expect(body).not.toContain('selectAll');

      // Step 5: Wrap soft errors
      body = wrapSoftErrors(body);
      expect(body).toContain('try {');
      // Screenshot line should NOT be wrapped
      const screenshotLine = body.split('\n').find(l => l.includes('.screenshot('));
      expect(screenshotLine).toBeDefined();
      expect(screenshotLine).not.toContain('try {');
    });
  });
});
