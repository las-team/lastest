/**
 * Three-tier test-body extractor used by both runners.
 *
 * The remote runner and EB executor used to share a single regex that only
 * recognised `export async function test(page, ...) { ... }`. AI-authored
 * code, copy-pastes from Playwright's docs, and the
 * `@playwright/test`-framework style all use a different shape:
 *
 *     import { test, expect } from '@playwright/test';
 *     test('does the thing', async ({ page }) => {
 *       await page.goto('/');
 *     });
 *
 * This extractor first tries the legacy shape (so tests already in the prod
 * DB extract byte-identically — no regression). If that fails it tries the
 * framework shape, emitting a small destructuring preamble so the runner can
 * still inject the named args the body expects. If both fail, the caller
 * uses the entire code as the body (current behaviour).
 *
 * The destructuring preamble for the framework shape:
 *
 *     // The runner injects `page` (and our helpers) as named args of the
 *     // AsyncFunction wrapper. The framework body was written for a `{
 *     // page, expect, request, context }` destructure of a single
 *     // fixtures argument. We synthesise that object from the named args
 *     // the runner already provides; missing names fall back to undefined.
 *     const __pwFixtures = { page, expect, context: page.context(), request: undefined };
 *     <body>
 *
 * The framework body itself stays unchanged — `await page.goto(...)` works
 * because `page` is *also* available as a named injected arg, so the
 * destructure is only needed when the user wrote `{ page }` explicitly. The
 * preamble exists so destructured names like `request` / `context` don't
 * cause `ReferenceError` at runtime; they'll be `undefined` instead, and
 * the soft-error wrapper will surface that as a warning rather than killing
 * the run.
 */

export type ExtractShape = 'legacy-export' | 'framework-test' | 'whole-code';

export interface ExtractedTestBody {
  body: string;
  shape: ExtractShape;
}

const LEGACY_RE = /export\s+async\s+function\s+test\s*\(\s*page[^)]*\)\s*\{([\s\S]*)\}\s*$/;
const LEGACY_SETUP_RE = /export\s+async\s+function\s+setup\s*\(\s*page[^)]*\)\s*\{([\s\S]*)\}\s*$/;

/**
 * Match the `@playwright/test` framework signature. Accepts:
 *
 *   test('name', async ({page}) => { ... })
 *   test('name', async ({ page, expect }) => { ... })
 *   test('name', { tag: '@x' }, async ({ page }) => { ... })
 *
 * and the `.only` / `.skip` / `.fixme` variants. We use a non-greedy match
 * up to `=>` then a balanced-brace walk for the body so we don't trip on
 * `{}` literals inside the test.
 */
const FRAMEWORK_HEAD_RE =
  /\btest(?:\.(?:only|skip|fixme|serial|describe\.serial))?\s*\(\s*(['"`])[^'"`]*\1\s*,(?:\s*\{[^}]*\}\s*,)?\s*async\s*\(\s*\{([^}]*)\}\s*\)\s*=>\s*\{/;

function extractBalancedBody(source: string, openBraceIdx: number): { body: string; endIdx: number } | null {
  if (source[openBraceIdx] !== '{') return null;
  let depth = 1;
  let i = openBraceIdx + 1;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    const next = source[i + 1];
    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      i++;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (inSingle) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === "'") inSingle = false;
      i++;
      continue;
    }
    if (inDouble) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '"') inDouble = false;
      i++;
      continue;
    }
    if (inTemplate) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '`') inTemplate = false;
      i++;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 2;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 2;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      i++;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      i++;
      continue;
    }
    if (ch === '`') {
      inTemplate = true;
      i++;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  if (depth !== 0) return null;
  return { body: source.slice(openBraceIdx + 1, i - 1), endIdx: i };
}

/**
 * Pull the test body out of `code`. Always returns *something* — the
 * `whole-code` tier is the final fallback and matches today's pre-extractor
 * behaviour ("treat entire code as the function body").
 *
 * `allowSetup` makes the legacy tier also accept
 * `export async function setup(page, ...)` so setup scripts share this
 * helper.
 */
export function extractTestBody(code: string, opts: { allowSetup?: boolean } = {}): ExtractedTestBody {
  if (opts.allowSetup) {
    const setupMatch = code.match(LEGACY_SETUP_RE);
    if (setupMatch) return { body: setupMatch[1], shape: 'legacy-export' };
  }
  const legacyMatch = code.match(LEGACY_RE);
  if (legacyMatch) return { body: legacyMatch[1], shape: 'legacy-export' };

  const fwHead = code.match(FRAMEWORK_HEAD_RE);
  if (fwHead && fwHead.index !== undefined) {
    const openIdx = code.indexOf('{', fwHead.index + fwHead[0].length - 1);
    if (openIdx >= 0) {
      const balanced = extractBalancedBody(code, openIdx);
      if (balanced) {
        const destructured = fwHead[2]
          .split(',')
          .map((s) => s.trim().split(/[:=]/)[0].trim())
          .filter(Boolean);
        const knownInjected = new Set(['page', 'expect']);
        const synth = destructured
          .filter((n) => !knownInjected.has(n))
          .map((n) => {
            if (n === 'context') return 'const context = page.context();';
            if (n === 'browser') return 'const browser = page.context().browser();';
            if (n === 'request') return 'const request = undefined; /* APIRequestContext not provided */';
            return `const ${n} = undefined; /* not injected by Lastest runner */`;
          })
          .join('\n');
        const preamble = synth ? `${synth}\n` : '';
        return { body: `${preamble}${balanced.body}`, shape: 'framework-test' };
      }
    }
  }

  return { body: code, shape: 'whole-code' };
}
