/**
 * Shared `expect` shim used by both the remote runner
 * (`packages/runner/src/runner.ts`) and the embedded-browser executor
 * (`packages/embedded-browser/src/test-executor.ts`).
 *
 * The behavioural contract is a strict superset of the prior hand-rolled
 * shims:
 *
 *   - Every matcher that the remote runner's `createExpect()` already
 *     implemented produces the same polling-loop / timeout / error message
 *     shape it produced before. (Snapshot tests in
 *     `playwright-expect.test.ts` lock this in.)
 *   - The matchers the EB-only shim implemented (`toBeGreaterThanOrEqual`)
 *     are also retained.
 *   - The remaining locator/page matchers our own recorder + assertion
 *     parser already emit (`toBeAttached`, `toBeEnabled`, `toBeDisabled`,
 *     `toBeChecked`, `toBeFocused`, `toBeEditable`, `toBeEmpty`,
 *     `toBeInViewport`, `toHaveValue`, `toHaveAttribute`, `toHaveCount`,
 *     `toHaveClass`, `toHaveCSS`, `toHaveJSProperty`, `toHaveRole`) are
 *     added with the same polling-loop shape.
 *   - `.not.X` is supported for every matcher above (the prior shims only
 *     supported a partial set).
 *
 * Targets are duck-typed (Page = anything with `goto`, Locator = anything
 * with both `click` and `fill`) so this module does not need to import
 * Playwright types — keeping `@lastest/shared` free of a Playwright dep.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface CreateExpectOptions {
  /** Default timeout in ms for polling matchers (toHaveURL/text/visible…). */
  timeout?: number;
}

type Matcher = (...args: any[]) => unknown;
type MatcherMap = Record<string, Matcher>;

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Build `.not.X` for an *async* matcher map (Page/Locator). The wrapper
 * `await`s the positive matcher and inverts the outcome. Matches the
 * previous shims' behaviour for the few async `.not` entries they shipped
 * (e.g. EB's `.not.toBeVisible`), and extends `.not` to every async matcher.
 */
function buildAsyncNot(positive: MatcherMap, msgPrefix: string): MatcherMap {
  const not: MatcherMap = {};
  for (const [name, fn] of Object.entries(positive)) {
    not[name] = async (...args: any[]) => {
      let threw = false;
      try {
        await fn(...args);
      } catch {
        threw = true;
      }
      if (!threw) {
        throw new Error(`${msgPrefix}Expected NOT to match ${name}(${args.map((a) => safeStringify(a)).join(', ')})`);
      }
    };
  }
  return not;
}

/**
 * Build `.not.X` for *synchronous* value matchers (toBe, toEqual, …). The
 * previous shims returned sync throws here, so callers that wrote
 * `expect(x).not.toBe(y);` without `await` still got a synchronous failure.
 * Keeping `.not` sync for generic matchers preserves that contract — if we
 * returned a Promise here, an unawaited `expect(x).not.toBe(y)` would
 * silently swallow its rejection.
 */
function buildSyncNot(positive: MatcherMap, msgPrefix: string): MatcherMap {
  const not: MatcherMap = {};
  for (const [name, fn] of Object.entries(positive)) {
    not[name] = (...args: any[]) => {
      let threw = false;
      try {
        fn(...args);
      } catch {
        threw = true;
      }
      if (!threw) {
        throw new Error(`${msgPrefix}Expected NOT to match ${name}(${args.map((a) => safeStringify(a)).join(', ')})`);
      }
    };
  }
  return not;
}

function safeStringify(v: unknown): string {
  try {
    return typeof v === 'string' ? `"${v}"` : JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * Poll a predicate until it returns truthy or `timeout` elapses. The
 * predicate receives no arguments; it is expected to capture whatever state
 * the matcher cares about in its closure.
 */
async function pollUntil(predicate: () => Promise<boolean>, timeout: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

export function createExpect(options: CreateExpectOptions = {}): (target: any, message?: string) => any {
  const defaultTimeout = options.timeout ?? DEFAULT_TIMEOUT_MS;

  return function expect(target: any, message?: string) {
    const msgPrefix = message ? `${message}: ` : '';
    const isPage = typeof target?.goto === 'function';
    const isLocator = typeof target?.click === 'function' && typeof target?.fill === 'function';

    if (isPage) {
      const page: MatcherMap = {
        async toHaveURL(expected: string | RegExp, opts?: { timeout?: number }) {
          const t = opts?.timeout ?? defaultTimeout;
          const ok = await pollUntil(async () => {
            const url = target.url();
            if (typeof expected === 'string') return url === expected;
            return expected.test(url);
          }, t);
          if (!ok) throw new Error(`${msgPrefix}Expected URL "${expected}" but got "${target.url()}"`);
        },
        async toHaveTitle(expected: string | RegExp, opts?: { timeout?: number }) {
          const t = opts?.timeout ?? defaultTimeout;
          const ok = await pollUntil(async () => {
            const title = await target.title();
            if (typeof expected === 'string') return title === expected;
            return expected.test(title);
          }, t);
          if (!ok) throw new Error(`${msgPrefix}Expected title "${expected}" but got "${await target.title()}"`);
        },
        async toHaveScreenshot(_name?: string, _opts?: unknown) {
          // Lastest does visual diffing through a separate pipeline (see
          // src/lib/diff/* and the embedded-browser multi-layer-capture).
          // Treating `toHaveScreenshot` as a soft no-op preserves test
          // execution; the visual layer still asserts on its own.
          return;
        },
      };
      return { ...page, not: buildAsyncNot(page, msgPrefix) };
    }

    if (isLocator) {
      const locator: MatcherMap = {
        async toBeVisible(opts?: { timeout?: number }) {
          await target.waitFor({ state: 'visible', timeout: opts?.timeout ?? defaultTimeout });
        },
        async toBeHidden(opts?: { timeout?: number }) {
          await target.waitFor({ state: 'hidden', timeout: opts?.timeout ?? defaultTimeout });
        },
        async toBeAttached(opts?: { timeout?: number }) {
          await target.waitFor({ state: 'attached', timeout: opts?.timeout ?? defaultTimeout });
        },
        async toBeEnabled(opts?: { timeout?: number }) {
          const t = opts?.timeout ?? defaultTimeout;
          const ok = await pollUntil(async () => await target.isEnabled(), t);
          if (!ok) throw new Error(`${msgPrefix}Expected locator to be enabled`);
        },
        async toBeDisabled(opts?: { timeout?: number }) {
          const t = opts?.timeout ?? defaultTimeout;
          const ok = await pollUntil(async () => await target.isDisabled(), t);
          if (!ok) throw new Error(`${msgPrefix}Expected locator to be disabled`);
        },
        async toBeChecked(opts?: { timeout?: number; checked?: boolean }) {
          const t = opts?.timeout ?? defaultTimeout;
          const desired = opts?.checked ?? true;
          const ok = await pollUntil(async () => (await target.isChecked()) === desired, t);
          if (!ok) throw new Error(`${msgPrefix}Expected locator to be ${desired ? 'checked' : 'unchecked'}`);
        },
        async toBeFocused(opts?: { timeout?: number }) {
          const t = opts?.timeout ?? defaultTimeout;
          const ok = await pollUntil(
            async () => await target.evaluate((el: Element) => el === document.activeElement),
            t,
          );
          if (!ok) throw new Error(`${msgPrefix}Expected locator to be focused`);
        },
        async toBeEditable(opts?: { timeout?: number }) {
          const t = opts?.timeout ?? defaultTimeout;
          const ok = await pollUntil(async () => await target.isEditable(), t);
          if (!ok) throw new Error(`${msgPrefix}Expected locator to be editable`);
        },
        async toBeEmpty(opts?: { timeout?: number }) {
          const t = opts?.timeout ?? defaultTimeout;
          const ok = await pollUntil(async () => {
            const text = (await target.textContent()) ?? '';
            return text.trim().length === 0;
          }, t);
          if (!ok) throw new Error(`${msgPrefix}Expected locator to be empty`);
        },
        async toBeInViewport(opts?: { timeout?: number; ratio?: number }) {
          const t = opts?.timeout ?? defaultTimeout;
          const ratio = opts?.ratio ?? 0;
          const ok = await pollUntil(async () => {
            return await target.evaluate((el: Element, r: number) => {
              const rect = (el as HTMLElement).getBoundingClientRect();
              const vh = window.innerHeight || document.documentElement.clientHeight;
              const vw = window.innerWidth || document.documentElement.clientWidth;
              const visibleH = Math.max(0, Math.min(rect.bottom, vh) - Math.max(rect.top, 0));
              const visibleW = Math.max(0, Math.min(rect.right, vw) - Math.max(rect.left, 0));
              const area = (rect.height * rect.width) || 1;
              return ((visibleH * visibleW) / area) >= r;
            }, ratio);
          }, t);
          if (!ok) throw new Error(`${msgPrefix}Expected locator to be in viewport`);
        },
        async toHaveText(expected: string | RegExp, opts?: { timeout?: number }) {
          const t = opts?.timeout ?? defaultTimeout;
          const ok = await pollUntil(async () => {
            const text = await target.textContent();
            if (typeof expected === 'string') return text === expected;
            return text != null && expected.test(text);
          }, t);
          if (!ok) throw new Error(`${msgPrefix}Expected text "${expected}" but got "${await target.textContent()}"`);
        },
        async toContainText(expected: string | RegExp, opts?: { timeout?: number }) {
          const t = opts?.timeout ?? defaultTimeout;
          const ok = await pollUntil(async () => {
            const text = await target.textContent();
            if (text == null) return false;
            return typeof expected === 'string' ? text.includes(expected) : expected.test(text);
          }, t);
          if (!ok) throw new Error(`${msgPrefix}Expected text to contain "${expected}"`);
        },
        async toHaveValue(expected: string | RegExp, opts?: { timeout?: number }) {
          const t = opts?.timeout ?? defaultTimeout;
          const ok = await pollUntil(async () => {
            const v = await target.inputValue();
            if (typeof expected === 'string') return v === expected;
            return expected.test(v);
          }, t);
          if (!ok) throw new Error(`${msgPrefix}Expected value "${expected}" but got "${await target.inputValue()}"`);
        },
        async toHaveAttribute(name: string, expected: string | RegExp, opts?: { timeout?: number }) {
          const t = opts?.timeout ?? defaultTimeout;
          const ok = await pollUntil(async () => {
            const v = await target.getAttribute(name);
            if (v == null) return false;
            if (typeof expected === 'string') return v === expected;
            return expected.test(v);
          }, t);
          if (!ok) {
            throw new Error(
              `${msgPrefix}Expected attribute ${name}="${expected}" but got "${await target.getAttribute(name)}"`,
            );
          }
        },
        async toHaveCount(expected: number, opts?: { timeout?: number }) {
          const t = opts?.timeout ?? defaultTimeout;
          const ok = await pollUntil(async () => (await target.count()) === expected, t);
          if (!ok) throw new Error(`${msgPrefix}Expected count ${expected} but got ${await target.count()}`);
        },
        async toHaveClass(expected: string | RegExp | (string | RegExp)[], opts?: { timeout?: number }) {
          const t = opts?.timeout ?? defaultTimeout;
          const ok = await pollUntil(async () => {
            const cls = ((await target.getAttribute('class')) ?? '').trim().split(/\s+/);
            if (Array.isArray(expected)) {
              if (cls.length !== expected.length) return false;
              return expected.every((e, i) => (typeof e === 'string' ? cls[i] === e : e.test(cls[i] ?? '')));
            }
            const joined = cls.join(' ');
            return typeof expected === 'string' ? joined.split(/\s+/).includes(expected) : expected.test(joined);
          }, t);
          if (!ok) throw new Error(`${msgPrefix}Expected class to match ${expected}`);
        },
        async toHaveCSS(name: string, expected: string | RegExp, opts?: { timeout?: number }) {
          const t = opts?.timeout ?? defaultTimeout;
          const ok = await pollUntil(async () => {
            const v = await target.evaluate(
              (el: Element, p: string) => getComputedStyle(el as HTMLElement).getPropertyValue(p),
              name,
            );
            const s = String(v ?? '').trim();
            return typeof expected === 'string' ? s === expected : expected.test(s);
          }, t);
          if (!ok) throw new Error(`${msgPrefix}Expected CSS ${name} to match ${expected}`);
        },
        async toHaveJSProperty(name: string, expected: unknown, opts?: { timeout?: number }) {
          const t = opts?.timeout ?? defaultTimeout;
          const ok = await pollUntil(async () => {
            const v = await target.evaluate((el: Element, p: string) => (el as any)[p], name);
            return JSON.stringify(v) === JSON.stringify(expected);
          }, t);
          if (!ok) throw new Error(`${msgPrefix}Expected JS property ${name} to equal ${safeStringify(expected)}`);
        },
        async toHaveRole(expected: string, opts?: { timeout?: number }) {
          const t = opts?.timeout ?? defaultTimeout;
          const ok = await pollUntil(async () => {
            const role = await target.evaluate((el: Element) => {
              return (el as HTMLElement).getAttribute('role') ?? (el as HTMLElement).tagName.toLowerCase();
            });
            return role === expected;
          }, t);
          if (!ok) throw new Error(`${msgPrefix}Expected role ${expected}`);
        },
      };
      return { ...locator, not: buildAsyncNot(locator, msgPrefix) };
    }

    // ────────────────────────────────────────────────────────────────────
    // Generic value matchers (arrays, primitives, objects).
    // ────────────────────────────────────────────────────────────────────
    const generic: MatcherMap = {
      toBe(expected: unknown) {
        if (target !== expected) {
          throw new Error(`${msgPrefix}Expected ${safeStringify(expected)} but got ${safeStringify(target)}`);
        }
      },
      toEqual(expected: unknown) {
        if (JSON.stringify(target) !== JSON.stringify(expected)) {
          throw new Error(`${msgPrefix}Expected ${safeStringify(expected)} but got ${safeStringify(target)}`);
        }
      },
      toStrictEqual(expected: unknown) {
        if (JSON.stringify(target) !== JSON.stringify(expected)) {
          throw new Error(`${msgPrefix}Expected (strict) ${safeStringify(expected)} but got ${safeStringify(target)}`);
        }
      },
      toBeTruthy() {
        if (!target) throw new Error(`${msgPrefix}Expected value to be truthy but got ${safeStringify(target)}`);
      },
      toBeFalsy() {
        if (target) throw new Error(`${msgPrefix}Expected value to be falsy but got ${safeStringify(target)}`);
      },
      toBeNull() {
        if (target !== null) throw new Error(`${msgPrefix}Expected null but got ${safeStringify(target)}`);
      },
      toBeUndefined() {
        if (target !== undefined) throw new Error(`${msgPrefix}Expected undefined but got ${safeStringify(target)}`);
      },
      toBeNaN() {
        if (!(typeof target === 'number' && Number.isNaN(target))) {
          throw new Error(`${msgPrefix}Expected NaN but got ${safeStringify(target)}`);
        }
      },
      toBeInstanceOf(ctor: any) {
        if (!(target instanceof ctor)) {
          throw new Error(`${msgPrefix}Expected instance of ${ctor?.name ?? ctor}`);
        }
      },
      toBeCloseTo(expected: number, digits = 2) {
        if (typeof target !== 'number') {
          throw new Error(`${msgPrefix}toBeCloseTo requires a number, got ${typeof target}`);
        }
        const tolerance = Math.pow(10, -digits) / 2;
        if (Math.abs(target - expected) > tolerance) {
          throw new Error(`${msgPrefix}Expected ${target} to be close to ${expected} (${digits} digits)`);
        }
      },
      toContain(expected: unknown) {
        if (Array.isArray(target)) {
          if (!target.includes(expected)) {
            throw new Error(`${msgPrefix}Expected array to contain ${safeStringify(expected)}`);
          }
        } else if (typeof target === 'string') {
          if (!target.includes(expected as string)) {
            throw new Error(`${msgPrefix}Expected string to contain ${safeStringify(expected)}`);
          }
        } else {
          throw new Error(`${msgPrefix}toContain only works on arrays and strings`);
        }
      },
      toHaveLength(expected: number) {
        const actual = (target as any)?.length;
        if (actual !== expected) {
          const details = Array.isArray(target) ? `\nReceived: ${safeStringify(target.slice(0, 10))}` : '';
          throw new Error(`${msgPrefix}Expected length ${expected} but got ${actual}${details}`);
        }
      },
      toBeGreaterThan(expected: number) {
        if (typeof target !== 'number' || target <= expected) {
          throw new Error(`${msgPrefix}Expected ${target} to be greater than ${expected}`);
        }
      },
      toBeGreaterThanOrEqual(expected: number) {
        if (typeof target !== 'number' || target < expected) {
          throw new Error(`${msgPrefix}Expected ${target} to be greater than or equal to ${expected}`);
        }
      },
      toBeLessThan(expected: number) {
        if (typeof target !== 'number' || target >= expected) {
          throw new Error(`${msgPrefix}Expected ${target} to be less than ${expected}`);
        }
      },
      toBeLessThanOrEqual(expected: number) {
        if (typeof target !== 'number' || target > expected) {
          throw new Error(`${msgPrefix}Expected ${target} to be less than or equal to ${expected}`);
        }
      },
      toMatch(expected: string | RegExp) {
        const str = typeof target === 'string' ? target : String(target);
        const regex = typeof expected === 'string' ? new RegExp(expected) : expected;
        if (!regex.test(str)) {
          throw new Error(`${msgPrefix}Expected "${str}" to match ${regex}`);
        }
      },
    };

    return { ...generic, not: buildSyncNot(generic, msgPrefix) };
  };
}
