/**
 * Variable diff — Pact-style structural comparison of two record-of-string
 * maps (extracted variables) or arbitrary JSON-shaped values.
 *
 * Tier ranking, highest signal first:
 *   1. structural-break — key added/removed (both sides have at least one)
 *   2. type-change — same path, different runtime type (object vs string)
 *   3. value-change-numeric — number value changed
 *   4. value-change-string — string/other primitive value changed
 *
 * Ignore-paths use simple glob-like patterns: "user.id", "session.*", "**.timestamp".
 */

import type { VariableDiffSummary } from '@/lib/db/schema';

type DiffTier = VariableDiffSummary['changes'][number]['tier'];

interface VariableDiffOptions {
  /** Glob-like patterns; matched against dot-paths. `*` = single segment, `**` = any depth. */
  ignorePaths?: string[];
}

function matchPath(path: string, pattern: string): boolean {
  // Escape regex meta-chars EXCEPT `*` so we can convert globs ourselves.
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    '^' + escaped
      .replace(/\*\*/g, '__DOUBLESTAR__')
      .replace(/\*/g, '[^.]+')
      .replace(/__DOUBLESTAR__/g, '.+')
      + '$',
  );
  return re.test(path);
}

function shouldIgnore(path: string, ignorePaths: string[] | undefined): boolean {
  if (!ignorePaths || ignorePaths.length === 0) return false;
  return ignorePaths.some(p => matchPath(path, p));
}

function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function classifyChange(baseline: unknown, current: unknown): DiffTier | null {
  // Object/array key sets differ => structural-break (handled by recursion below)
  const bt = typeOf(baseline);
  const ct = typeOf(current);
  if (bt !== ct) return 'type-change';
  if (bt === 'object' || bt === 'array') return null; // recurse
  if (baseline === current) return null;
  if (bt === 'number') return 'value-change-numeric';
  return 'value-change-string';
}

function diffRecursive(
  baseline: unknown,
  current: unknown,
  path: string,
  changes: VariableDiffSummary['changes'],
  ignorePaths: string[] | undefined,
): void {
  if (shouldIgnore(path, ignorePaths)) return;

  // Both objects (non-array) — diff key by key
  if (
    baseline && current &&
    typeOf(baseline) === 'object' && typeOf(current) === 'object'
  ) {
    const baseObj = baseline as Record<string, unknown>;
    const currObj = current as Record<string, unknown>;
    const keys = new Set([...Object.keys(baseObj), ...Object.keys(currObj)]);
    for (const k of keys) {
      const subPath = path ? `${path}.${k}` : k;
      const bHas = k in baseObj;
      const cHas = k in currObj;
      if (bHas && !cHas) {
        if (!shouldIgnore(subPath, ignorePaths)) {
          changes.push({ path: subPath, tier: 'structural-break', baseline: baseObj[k] });
        }
      } else if (!bHas && cHas) {
        if (!shouldIgnore(subPath, ignorePaths)) {
          changes.push({ path: subPath, tier: 'structural-break', current: currObj[k] });
        }
      } else {
        diffRecursive(baseObj[k], currObj[k], subPath, changes, ignorePaths);
      }
    }
    return;
  }

  // Both arrays — diff by index
  if (Array.isArray(baseline) && Array.isArray(current)) {
    const len = Math.max(baseline.length, current.length);
    for (let i = 0; i < len; i++) {
      const subPath = `${path}[${i}]`;
      if (i >= baseline.length) {
        if (!shouldIgnore(subPath, ignorePaths)) {
          changes.push({ path: subPath, tier: 'structural-break', current: current[i] });
        }
      } else if (i >= current.length) {
        if (!shouldIgnore(subPath, ignorePaths)) {
          changes.push({ path: subPath, tier: 'structural-break', baseline: baseline[i] });
        }
      } else {
        diffRecursive(baseline[i], current[i], subPath, changes, ignorePaths);
      }
    }
    return;
  }

  // Primitives or mismatched type
  const tier = classifyChange(baseline, current);
  if (tier) changes.push({ path: path || '$', tier, baseline, current });
}

export function computeVariableDiff(
  baseline: Record<string, unknown> | null | undefined,
  current: Record<string, unknown> | null | undefined,
  options: VariableDiffOptions = {},
): VariableDiffSummary {
  const changes: VariableDiffSummary['changes'] = [];
  diffRecursive(baseline ?? {}, current ?? {}, '', changes, options.ignorePaths);
  // Sort by tier severity: structural-break > type-change > numeric > string
  const tierRank: Record<DiffTier, number> = {
    'structural-break': 0,
    'type-change': 1,
    'value-change-numeric': 2,
    'value-change-string': 3,
  };
  changes.sort((a, b) => tierRank[a.tier] - tierRank[b.tier]);
  return { changes };
}

export function summarizeVariableDiff(d: VariableDiffSummary): string {
  if (d.changes.length === 0) return 'No variable changes';
  const counts: Record<DiffTier, number> = {
    'structural-break': 0, 'type-change': 0, 'value-change-numeric': 0, 'value-change-string': 0,
  };
  for (const c of d.changes) counts[c.tier]++;
  const parts: string[] = [];
  if (counts['structural-break']) parts.push(`${counts['structural-break']} structural`);
  if (counts['type-change']) parts.push(`${counts['type-change']} type`);
  if (counts['value-change-numeric']) parts.push(`${counts['value-change-numeric']} numeric`);
  if (counts['value-change-string']) parts.push(`${counts['value-change-string']} string`);
  return parts.join(', ');
}
