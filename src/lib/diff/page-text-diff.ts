import fs from 'fs/promises';
import path from 'path';
import { STORAGE_ROOT } from '@/lib/storage/paths';
import { diffLines, diffStats, type DiffLine } from './text-diff';
import type { TextDiffStatus } from '@/lib/db/schema';

/** Normalize captured page text before disk write or diff. Collapse runs of
 *  blank lines to at most one, and trim trailing whitespace per line. Keeps
 *  the diff output focused on real content changes rather than whitespace
 *  churn from `innerText` quirks. */
export function normalizePageText(raw: string): string {
  const lines = raw.split('\n').map(l => l.replace(/[ \t]+$/g, ''));
  const out: string[] = [];
  let blankRun = 0;
  for (const line of lines) {
    if (line === '') {
      blankRun++;
      if (blankRun <= 1) out.push(line);
    } else {
      blankRun = 0;
      out.push(line);
    }
  }
  return out.join('\n').replace(/^\n+|\n+$/g, '');
}

async function readTextFile(relPath: string | null | undefined): Promise<string | null> {
  if (!relPath) return null;
  try {
    return await fs.readFile(path.join(STORAGE_ROOT, relPath), 'utf8');
  } catch {
    return null;
  }
}

export interface PageTextDiff {
  status: TextDiffStatus;
  summary: { added: number; removed: number; sameAsBaseline: boolean };
  lines: DiffLine[];
  baselineText: string | null;
  currentText: string | null;
}

/** Read both text blobs and produce a status + summary + line-level diff.
 *  When either side is missing, status reflects which side existed; lines is
 *  empty in those cases (no diff to render). */
export async function computePageTextDiff(
  baselineTextPath: string | null | undefined,
  currentTextPath: string | null | undefined,
): Promise<PageTextDiff> {
  const [baselineText, currentText] = await Promise.all([
    readTextFile(baselineTextPath),
    readTextFile(currentTextPath),
  ]);

  if (!baselineText && !currentText) {
    return {
      status: 'skipped',
      summary: { added: 0, removed: 0, sameAsBaseline: true },
      lines: [],
      baselineText,
      currentText,
    };
  }
  if (!baselineText) {
    return {
      status: 'current_only',
      summary: { added: currentText!.split('\n').length, removed: 0, sameAsBaseline: false },
      lines: [],
      baselineText,
      currentText,
    };
  }
  if (!currentText) {
    return {
      status: 'baseline_only',
      summary: { added: 0, removed: baselineText.split('\n').length, sameAsBaseline: false },
      lines: [],
      baselineText,
      currentText,
    };
  }

  if (baselineText === currentText) {
    return {
      status: 'unchanged',
      summary: { added: 0, removed: 0, sameAsBaseline: true },
      lines: [],
      baselineText,
      currentText,
    };
  }

  const lines = diffLines(baselineText, currentText);
  const stats = diffStats(lines);
  return {
    status: stats.added === 0 && stats.removed === 0 ? 'unchanged' : 'changed',
    summary: { ...stats, sameAsBaseline: stats.added === 0 && stats.removed === 0 },
    lines,
    baselineText,
    currentText,
  };
}

/** Cheaper variant used inside the build hot-path: skips the full LCS walk
 *  when the two blobs are byte-equal (the common case), and returns just the
 *  status + summary without retaining the diff lines. */
export async function computePageTextDiffSummary(
  baselineTextPath: string | null | undefined,
  currentTextPath: string | null | undefined,
): Promise<{ status: TextDiffStatus; summary: { added: number; removed: number; sameAsBaseline: boolean } }> {
  const result = await computePageTextDiff(baselineTextPath, currentTextPath);
  return { status: result.status, summary: result.summary };
}
