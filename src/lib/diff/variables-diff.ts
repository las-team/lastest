/**
 * Pairwise diff for the per-test "variables" surface — extracted vars,
 * assigned vars, console errors, and runner logs. Cheap, pure, sync.
 */

import type {
  VariableInspectionPayload,
  VariableMapDiffEntry,
} from '../db/schema';

export interface VariableDiffOptions {
  ignoreKeys?: string[];
}

export function diffStringMap(
  baseline: Record<string, string> | null | undefined,
  current: Record<string, string> | null | undefined,
  ignoreKeys: Set<string>,
): VariableMapDiffEntry[] {
  const out: VariableMapDiffEntry[] = [];
  const keys = new Set<string>([
    ...Object.keys(baseline ?? {}),
    ...Object.keys(current ?? {}),
  ]);
  for (const key of keys) {
    if (ignoreKeys.has(key)) continue;
    const b = baseline?.[key] ?? null;
    const c = current?.[key] ?? null;
    let kind: VariableMapDiffEntry['kind'];
    if (b === null && c !== null) kind = 'added';
    else if (b !== null && c === null) kind = 'removed';
    else if (b !== c) kind = 'changed';
    else kind = 'unchanged';
    out.push({ key, baseline: b, current: c, kind });
  }
  // Stable sort: changed first, then added, removed, unchanged; alpha within.
  const order = { changed: 0, added: 1, removed: 2, unchanged: 3 };
  out.sort((a, b) => {
    const d = order[a.kind] - order[b.kind];
    return d !== 0 ? d : a.key.localeCompare(b.key);
  });
  return out;
}

function diffStringArrays(
  baseline: string[] | null | undefined,
  current: string[] | null | undefined,
): { added: string[]; removed: string[]; common: number } {
  const baseCounts = new Map<string, number>();
  for (const s of baseline ?? []) baseCounts.set(s, (baseCounts.get(s) ?? 0) + 1);
  const added: string[] = [];
  let common = 0;
  for (const s of current ?? []) {
    const c = baseCounts.get(s) ?? 0;
    if (c > 0) {
      common++;
      baseCounts.set(s, c - 1);
    } else {
      added.push(s);
    }
  }
  const removed: string[] = [];
  for (const [s, c] of baseCounts) {
    for (let i = 0; i < c; i++) removed.push(s);
  }
  return { added, removed, common };
}

export interface RunnerLog {
  timestamp: number;
  level: string;
  message: string;
}

function diffLogs(
  baseline: RunnerLog[] | null | undefined,
  current: RunnerLog[] | null | undefined,
): { addedCount: number; removedCount: number; sample: string[] } {
  // Compare on level+message to ignore timestamp drift.
  const baseKeys = new Map<string, number>();
  for (const l of baseline ?? []) {
    const k = `${l.level}|${l.message}`;
    baseKeys.set(k, (baseKeys.get(k) ?? 0) + 1);
  }
  let addedCount = 0;
  const addedSamples: string[] = [];
  for (const l of current ?? []) {
    const k = `${l.level}|${l.message}`;
    const c = baseKeys.get(k) ?? 0;
    if (c > 0) {
      baseKeys.set(k, c - 1);
    } else {
      addedCount++;
      if (addedSamples.length < 20) addedSamples.push(`[${l.level}] ${l.message}`);
    }
  }
  let removedCount = 0;
  for (const c of baseKeys.values()) removedCount += c;
  return { addedCount, removedCount, sample: addedSamples };
}

export interface VariableDiffInput {
  baseline: {
    extracted?: Record<string, string> | null;
    assigned?: Record<string, string> | null;
    consoleErrors?: string[] | null;
    logs?: RunnerLog[] | null;
  };
  current: {
    extracted?: Record<string, string> | null;
    assigned?: Record<string, string> | null;
    consoleErrors?: string[] | null;
    logs?: RunnerLog[] | null;
  };
  options?: VariableDiffOptions;
}

export function diffVariables(input: VariableDiffInput): VariableInspectionPayload {
  const ignore = new Set(input.options?.ignoreKeys ?? []);
  return {
    extracted: diffStringMap(input.baseline.extracted, input.current.extracted, ignore),
    assigned: diffStringMap(input.baseline.assigned, input.current.assigned, ignore),
    consoleErrors: diffStringArrays(input.baseline.consoleErrors, input.current.consoleErrors),
    logs: diffLogs(input.baseline.logs, input.current.logs),
  };
}
