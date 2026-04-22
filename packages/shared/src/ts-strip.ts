/**
 * Strip TypeScript-only syntax from a code string so it can execute as plain JS
 * via `new Function` / `new AsyncFunction`.
 *
 * Primary path: sucrase `transform` with `disableESTransforms: true`. This
 * tokenizes the source, so it is safe inside strings, template literals, and
 * comments — unlike the regex approach it replaces. Output preserves line
 * numbers, which matters for stepLogger stack traces in the runners.
 *
 * Fallback path: the original regex stripper, kept so rare sucrase failures
 * (parse errors on hand-authored code) degrade to previous behaviour rather
 * than killing the test run.
 */

import { transform } from 'sucrase';

export function stripTypeAnnotations(code: string): string {
  try {
    const { code: js } = transform(code, {
      transforms: ['typescript'],
      disableESTransforms: true,
      preserveDynamicImport: true,
      production: true,
    });
    return js;
  } catch {
    return legacyStripTypeAnnotations(code);
  }
}

/**
 * Original regex-based stripper. Exported for tests and as the documented
 * fallback. Do not call directly from production code paths — use
 * `stripTypeAnnotations` so sucrase is preferred when available.
 */
export function legacyStripTypeAnnotations(code: string): string {
  let result = code;
  result = result.replace(/\b(const|let|var)\s+(\w+)\s*:\s*[^=\n;]+(\s*=)/g, '$1 $2$3');
  result = result.replace(/\b(const|let|var)\s+(\{[^}]+\}|\[[^\]]+\])\s*:\s*[^=\n;]+(\s*=)/g, '$1 $2$3');
  result = result.replace(/\)\s+as\s+\w[\w<>\[\],\s|]*/g, ')');
  result = result.replace(/(\w)\s+as\s+\w[\w<>\[\],\s|]*/g, '$1');
  result = result.replace(/<\w[\w<>\[\],\s|]*>\s*(?=\(|[\w])/g, '');
  return result;
}
