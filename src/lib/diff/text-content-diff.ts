/**
 * Visible-text diff between two `DomSnapshotData` captures.
 *
 * Builds a normalized line stream from each snapshot's `textContent` (in DOM
 * order, whitespace-collapsed, empties dropped, optional regex masking) and
 * runs the existing line-level LCS in `text-diff.ts`. Cheap to compute even
 * on large pages because we work over already-extracted text strings.
 */

import type {
  DomSnapshotData,
  TextDiffLine,
  TextInspectionPayload,
} from '../db/schema';
import { diffLines, diffStats } from './text-diff';

export interface TextDiffOptions {
  ignorePatterns?: string[];
}

function normalize(raw: string, masks: RegExp[]): string {
  let s = raw.replace(/\s+/g, ' ').trim();
  for (const m of masks) s = s.replace(m, '⟨masked⟩');
  return s;
}

function compileMasks(patterns: string[] | undefined): RegExp[] {
  if (!patterns || patterns.length === 0) return [];
  const out: RegExp[] = [];
  for (const p of patterns) {
    try {
      out.push(new RegExp(p, 'g'));
    } catch {
      // Invalid regex from user settings — silently skip rather than crash.
    }
  }
  return out;
}

function extractVisibleLines(snapshot: DomSnapshotData, masks: RegExp[]): string[] {
  const out: string[] = [];
  for (const el of snapshot.elements) {
    const raw = el.textContent;
    if (!raw) continue;
    const norm = normalize(raw, masks);
    if (!norm) continue;
    out.push(norm);
  }
  return out;
}

export function diffVisibleText(
  baseline: DomSnapshotData | null | undefined,
  current: DomSnapshotData | null | undefined,
  options: TextDiffOptions = {},
): TextInspectionPayload {
  const masks = compileMasks(options.ignorePatterns);
  const baseLines = baseline ? extractVisibleLines(baseline, masks) : [];
  const currLines = current ? extractVisibleLines(current, masks) : [];

  // diffLines uses "".split("\n") = [""], which would treat an empty side as a
  // single blank line and produce a spurious add+del pair. Short-circuit when
  // either side has no extracted text.
  let lines: TextDiffLine[];
  if (baseLines.length === 0 && currLines.length === 0) {
    lines = [];
  } else if (baseLines.length === 0) {
    lines = currLines.map((line, i) => ({ op: 'add' as const, line, newLineNo: i + 1 }));
  } else if (currLines.length === 0) {
    lines = baseLines.map((line, i) => ({ op: 'del' as const, line, oldLineNo: i + 1 }));
  } else {
    lines = diffLines(baseLines.join('\n'), currLines.join('\n'));
  }

  const { added, removed } = diffStats(lines);
  return {
    lines,
    added,
    removed,
    baselineLength: baseLines.length,
    currentLength: currLines.length,
  };
}
