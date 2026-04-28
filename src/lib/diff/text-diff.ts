// Tiny line-level text diff for the test Versions tab. Computes a
// longest-common-subsequence on lines (O(n*m), fine for ~thousands of lines)
// and walks back to produce a unified `+`/`-`/` ` sequence.
//
// Kept here rather than adding a `diff` npm dep — typical test files are
// small and this avoids pulling another package into the bundle.

export type LineOp = 'add' | 'del' | 'eq';

export interface DiffLine {
  op: LineOp;
  line: string;
  // 1-based line numbers in the respective source. Undefined when the line
  // doesn't exist on that side (`add` has no oldLineNo, `del` has no newLineNo).
  oldLineNo?: number;
  newLineNo?: number;
}

export function diffLines(oldStr: string, newStr: string): DiffLine[] {
  const oldLines = oldStr.split('\n');
  const newLines = newStr.split('\n');
  const n = oldLines.length;
  const m = newLines.length;

  // dp[i][j] = LCS length of oldLines[i..] vs newLines[j..]
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = oldLines[i] === newLines[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      out.push({ op: 'eq', line: oldLines[i], oldLineNo: i + 1, newLineNo: j + 1 });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ op: 'del', line: oldLines[i], oldLineNo: i + 1 });
      i++;
    } else {
      out.push({ op: 'add', line: newLines[j], newLineNo: j + 1 });
      j++;
    }
  }
  while (i < n) out.push({ op: 'del', line: oldLines[i], oldLineNo: ++i });
  while (j < m) out.push({ op: 'add', line: newLines[j], newLineNo: ++j });
  return out;
}

// Cheap summary for badges: { added: x, removed: y } counts.
export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.op === 'add') added++;
    else if (l.op === 'del') removed++;
  }
  return { added, removed };
}
