/**
 * Client-side ordering (§2.2 step 9, §6.1). Bulk 2.0 cannot `ORDER BY`, so
 * every ordering the load needs is produced after extraction:
 *  - **partition by predicate**: `field = null` (parents) then `field != null`
 *    (children) — two sequential jobs per unit;
 *  - **depth ordering**: BFS from roots over `(Id, ParentId)` held in memory
 *    (small catalogs: product / territory / account with `depthOrder`);
 *    parents not in the extract count as roots; cycles left after `maxDepth`
 *    rounds → `MAP_DEPTH_UNRESOLVED` and the parent field is deferred;
 *  - **external sort**: streaming chunk sort + k-way merge over the extract
 *    pages (`multichannel_consent` by `(Capture_Datetime_vod__c, Id)`), never
 *    loading all pages at once.
 */
import path from "node:path";
import { to18 } from "../transform/ids";
import type { Finding, LoadOptions, ObjectKey, SourceRow } from "../types";
import type { ExtractFile } from "./types";
import { readCsvFile, writeCsvFile } from "./files";

// ---------------------------------------------------------------------------
// Partition by predicate
// ---------------------------------------------------------------------------

/** `['Parent_Call_vod__c = null', 'Parent_Call_vod__c != null']` in the declared order. */
export function partitionPredicates(
  partitionBy: LoadOptions["partitionBy"] | undefined,
): string[] {
  if (!partitionBy) return [];
  const order = partitionBy.order ?? ["null", "notNull"];
  return order.map((o) =>
    o === "null"
      ? `${partitionBy.field} = null`
      : `${partitionBy.field} != null`,
  );
}

// ---------------------------------------------------------------------------
// Depth ordering
// ---------------------------------------------------------------------------

export interface DepthResult {
  /** 18-char id → depth (roots = 0). */
  depth: Map<string, number>;
  /** Ids whose depth could not be resolved within `maxDepth` rounds (cycles). */
  unresolved: Set<string>;
  maxDepth: number;
}

const DEFAULT_MAX_DEPTH = 20;

/**
 * Iterative BFS: depth 0 = parent null or parent not in the extract; then
 * depth(child) = depth(parent) + 1 round by round. Rows still without a depth
 * after `maxDepth` rounds are cyclic (or hang off a cycle) and are returned
 * as `unresolved` — the caller loads them at depth `maxDepth + 1` with the
 * parent field deferred to pass 2.
 */
export function computeDepths(
  edges: Iterable<{ id: string; parentId: string | null | undefined }>,
  maxDepth = DEFAULT_MAX_DEPTH,
): DepthResult {
  const parent = new Map<string, string | null>();
  for (const e of edges) {
    const id = to18(e.id);
    const p = e.parentId ? to18(String(e.parentId)) : null;
    parent.set(id, p);
  }
  const depth = new Map<string, number>();
  for (const [id, p] of parent)
    if (p === null || !parent.has(p) || p === id) depth.set(id, 0);
  // level-synchronous rounds: round k assigns exactly depth k, so `maxDepth`
  // bounds the depth reached, not the iteration order of the map
  let round = 0;
  let changed = true;
  while (changed && round < maxDepth) {
    changed = false;
    round++;
    const assigned: string[] = [];
    for (const [id, p] of parent) {
      if (depth.has(id) || p === null) continue;
      if (depth.get(p) === round - 1) assigned.push(id);
    }
    for (const id of assigned) {
      depth.set(id, round);
      changed = true;
    }
  }
  const unresolved = new Set<string>();
  for (const id of parent.keys()) if (!depth.has(id)) unresolved.add(id);
  return { depth, unresolved, maxDepth };
}

export interface DepthPartitionResult {
  files: ExtractFile[];
  unresolved: Set<string>;
  findings: Finding[];
  maxDepthSeen: number;
}

/**
 * Re-write live extract pages into one file per depth
 * (`{outDir}/d{n}.csv`, partition = n). Unresolved rows land in the last
 * partition and are reported once (`MAP_DEPTH_UNRESOLVED`, warning).
 */
export async function depthPartitionFiles(
  files: readonly ExtractFile[],
  parentField: string,
  columns: readonly string[],
  outDir: string,
  opts: {
    objectKey: ObjectKey;
    country: string;
    maxDepth?: number;
    chunkRows?: number;
  } = {
    objectKey: "account",
    country: "GLOBAL",
  },
): Promise<DepthPartitionResult> {
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
  const edges: Array<{ id: string; parentId: string | null }> = [];
  for (const f of files)
    for await (const row of readCsvFile(f.path)) {
      const p = row[parentField];
      edges.push({ id: row.Id, parentId: p == null ? null : String(p) });
    }
  const { depth, unresolved } = computeDepths(edges, maxDepth);
  const overflow = maxDepth + 1;
  const buckets = new Map<number, SourceRow[]>();
  let maxDepthSeen = 0;
  const written: ExtractFile[] = [];
  const chunkRows = opts.chunkRows ?? 100_000;
  let seq = 0;
  const flush = async (d: number, rows: SourceRow[]) => {
    if (!rows.length) return;
    const file = path.join(outDir, `d${d}-${seq++}.csv`);
    await writeCsvFile(file, rows, columns);
    written.push({
      path: file,
      jobId: `depth-${d}`,
      pageNo: seq - 1,
      rows: rows.length,
      closure: false,
      partition: d,
    });
  };
  for (const f of files)
    for await (const row of readCsvFile(f.path)) {
      const id = to18(row.Id);
      const d = depth.get(id) ?? overflow;
      if (d > maxDepthSeen) maxDepthSeen = d;
      const b = buckets.get(d) ?? [];
      b.push(row);
      buckets.set(d, b);
      if (b.length >= chunkRows) {
        await flush(d, b);
        buckets.set(d, []);
      }
    }
  for (const d of [...buckets.keys()].sort((a, b) => a - b))
    await flush(d, buckets.get(d)!);
  written.sort((a, b) => a.partition! - b.partition! || a.pageNo - b.pageNo);
  const findings: Finding[] = [];
  if (unresolved.size)
    findings.push({
      severity: "warning",
      code: "MAP_DEPTH_UNRESOLVED",
      objectKey: opts.objectKey,
      country: opts.country,
      field: parentField,
      count: unresolved.size,
      detail: `${unresolved.size} row(s) form a cycle or hang off one after ${maxDepth} rounds; loaded last with ${parentField} deferred to pass 2`,
    });
  return { files: written, unresolved, findings, maxDepthSeen };
}

// ---------------------------------------------------------------------------
// External sort
// ---------------------------------------------------------------------------

function cmpValue(a: unknown, b: unknown): number {
  const x = a === undefined || a === null || a === "" ? null : String(a);
  const y = b === undefined || b === null || b === "" ? null : String(b);
  if (x === y) return 0;
  if (x === null) return 1; // nulls last
  if (y === null) return -1;
  return x < y ? -1 : 1;
}

/** Comparator over `keys` (ISO dates/datetimes and ids sort lexicographically); `Id` is the implicit tiebreak. */
export function rowComparator(
  keys: readonly string[],
): (a: SourceRow, b: SourceRow) => number {
  const ks = keys.includes("Id") ? keys : [...keys, "Id"];
  return (a, b) => {
    for (const k of ks) {
      const c = cmpValue(a[k], b[k]);
      if (c !== 0) return c;
    }
    return 0;
  };
}

export interface ExternalSortOptions {
  /** Rows per in-memory chunk (`performance.sortChunkRows`, default 500 000). */
  chunkRows?: number;
  /** Rows per output page. */
  pageRows?: number;
  jobId?: string;
}

/**
 * Streaming external merge-sort: read pages, sort chunks of `chunkRows` in
 * memory into `{outDir}/chunk-*.csv`, then k-way merge them into ordered
 * output pages `{outDir}/{jobId}-{n}.csv`. Memory is bounded by the chunk
 * size plus one row per chunk during the merge.
 */
export async function externalSort(
  files: readonly ExtractFile[],
  keys: readonly string[],
  columns: readonly string[],
  outDir: string,
  opts: ExternalSortOptions = {},
): Promise<ExtractFile[]> {
  const chunkRows = opts.chunkRows ?? 500_000;
  const pageRows = opts.pageRows ?? chunkRows;
  const jobId = opts.jobId ?? "sorted";
  const cmp = rowComparator(keys);

  // phase 1: sorted chunks
  const chunkFiles: string[] = [];
  let buf: SourceRow[] = [];
  const flushChunk = async () => {
    if (!buf.length) return;
    buf.sort(cmp);
    const file = path.join(outDir, `chunk-${chunkFiles.length}.csv`);
    await writeCsvFile(file, buf, columns);
    chunkFiles.push(file);
    buf = [];
  };
  for (const f of files)
    for await (const row of readCsvFile(f.path)) {
      buf.push(row);
      if (buf.length >= chunkRows) await flushChunk();
    }
  await flushChunk();

  // phase 2: k-way merge
  const iters = chunkFiles.map((f) => readCsvFile(f)[Symbol.asyncIterator]());
  const heads: Array<SourceRow | undefined> = [];
  for (const it of iters) {
    const n = await it.next();
    heads.push(n.done ? undefined : n.value);
  }
  const out: ExtractFile[] = [];
  let page: SourceRow[] = [];
  let pageNo = 0;
  const flushPage = async () => {
    if (!page.length) return;
    const file = path.join(outDir, `${jobId}-${pageNo}.csv`);
    await writeCsvFile(file, page, columns);
    out.push({
      path: file,
      jobId,
      pageNo,
      rows: page.length,
      closure: false,
    });
    pageNo++;
    page = [];
  };
  for (;;) {
    let best = -1;
    for (let i = 0; i < heads.length; i++) {
      const h = heads[i];
      if (!h) continue;
      if (best < 0 || cmp(h, heads[best]!) < 0) best = i;
    }
    if (best < 0) break;
    page.push(heads[best]!);
    const n = await iters[best].next();
    heads[best] = n.done ? undefined : n.value;
    if (page.length >= pageRows) await flushPage();
  }
  await flushPage();
  return out;
}
