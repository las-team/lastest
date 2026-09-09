/**
 * FK closure (§1.1 #5, §2.2 steps 5–6): fetch every referenced parent that is
 * neither in the id map nor in this run's extract, recursively over the
 * fetched rows' own FKs until no new ids appear.
 *
 *  - `Id IN (…)` via REST `queryAll` semantics, ≤ 400 ids per call
 *    (`SfdcClient.queryIds`), selecting the referenced object's own column
 *    list; `extract.closureStrategy = composite` is honoured by the client.
 *  - Remainders > 50 000 ids run one Bulk `queryAll` of the whole parent
 *    object and filter client-side.
 *  - Self-referencing chains converge because every id is fetched once;
 *    the round cap (`extract.closureMaxRounds`, default 20) raises a
 *    `blocking` finding.
 *  - Closure rows are tagged `closure = true` (they bypass the scope
 *    filter) and are written under the *referencing* row's country. Page
 *    files carry a per-invocation tag (`closure-{tag}-r{round}-{page}.csv`)
 *    so concurrent units closing over the same parent never overwrite each
 *    other's pages.
 *  - Objects with `load.partitionBy` (`call2`, `em_event`) keep one buffer
 *    per partition: parent rows (`field = null`) land in `p0`, child rows in
 *    `p1`, and the returned file list is ordered parents-first, so the
 *    loader can commit parents before the children that reference them
 *    (§2.2 step 9, §6.1 step 16) — a child fetched in round N routinely has
 *    its parent fetched only in round N+1.
 *  - Deleted parents (`IsDeleted = true`) and ids the source no longer has
 *    are `dangling` — the child's FK stays unresolved (§3.5).
 *  - Users are never closure-fetched (matched in wave 0, §3.4); `user` ids
 *    in `needed` are ignored.
 */
import { randomUUID } from "node:crypto";
import path from "node:path";
import { getLogger } from "../logger";
import type { SfdcClient } from "../sfdc/types";
import { buildSelect, SOQL_IN_MAX_IDS } from "../sfdc/soql";
import type { StateStore } from "../store/types";
import { isQueueId, isUserId, to18 } from "../transform/ids";
import type { Finding, ObjectKey, SourceRow } from "../types";
import { buildColumnList, type FkColumn } from "./columns";
import {
  buildCountryStrategy,
  countryColumns,
  parentFieldFromMapping,
} from "./country";
import { extractDir, writeCsvFile } from "./files";
import type {
  ClosureRequest,
  ClosureResult,
  ExtractFile,
  FkIdSets,
} from "./types";

export const CLOSURE_BULK_THRESHOLD = 50_000;

export interface ClosureOptions {
  /** Remainder size above which the whole parent object is bulk-extracted and filtered (default 50 000). */
  bulkThreshold?: number;
  /** Ids per REST call (default 400, §2.1.4). */
  restChunk?: number;
  /** Rows per closure page file (default 2 000). */
  pageRows?: number;
}

export interface ClosureRunRequest extends ClosureRequest {
  /** Ids already extracted in this run per object (subtracted in every round). */
  have?: FkIdSets;
}

/** File-name safe form of a caller-supplied tag (unit ids contain `:`). */
function fileTag(tag: string | undefined): string {
  const t = (tag ?? "")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return t || randomUUID().slice(0, 8);
}

/** Partition index of a row for `load.partitionBy` (0 = parents by default order). */
export function partitionIndex(
  row: SourceRow,
  partitionBy: { field: string; order?: readonly ("null" | "notNull")[] },
): number {
  const order = partitionBy.order ?? ["null", "notNull"];
  const want = nonEmpty(row[partitionBy.field]) ? "notNull" : "null";
  const i = order.indexOf(want);
  return i < 0 ? 0 : i;
}

export interface ClosureRunResult extends ClosureResult {
  findings: Finding[];
  /** Parents that came back `IsDeleted = true` (subset of `dangling`). */
  deletedParents: Map<ObjectKey, number>;
  /** Queue owners (`00G`) seen on closure rows. */
  queueOwners: Set<string>;
  /** User ids referenced by closure rows (resolved by the user map, never fetched). */
  userIds: Set<string>;
}

function isDeletedRow(row: SourceRow): boolean {
  return row.IsDeleted === true || row.IsDeleted === "true";
}

function nonEmpty(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s ? s : undefined;
}

/** Collect FK values of one row into `sets` (§2.2 step 4 rules). */
export function collectRowFks(
  row: SourceRow,
  fkColumns: readonly FkColumn[],
  sets: FkIdSets,
  queueOwners?: Set<string>,
): void {
  for (const fk of fkColumns) {
    const raw = nonEmpty(row[fk.column]);
    if (!raw) continue;
    if (fk.polymorphic) {
      if (isQueueId(raw)) {
        queueOwners?.add(to18(raw));
        continue;
      }
      if (!isUserId(raw)) continue;
    }
    if (fk.targetObjectKey === "user" && !isUserId(raw)) continue;
    let set = sets.get(fk.targetObjectKey);
    if (!set) {
      set = new Set();
      sets.set(fk.targetObjectKey, set);
    }
    set.add(to18(raw));
  }
}

async function subtractIdMap(
  store: Pick<StateStore, "idMap">,
  objectKey: ObjectKey,
  ids: Set<string>,
): Promise<void> {
  const list = [...ids];
  for (let i = 0; i < list.length; i += 1000) {
    const found = await store.idMap.bulkGet(objectKey, list.slice(i, i + 1000));
    for (const id of found.keys()) ids.delete(id);
  }
}

/**
 * Run the closure to a fixpoint. `req.needed` is the remainder after the id
 * map and the current extract; both are subtracted again per round so a
 * caller may pass raw FK sets.
 */
export async function runClosure(
  deps: { sfdc: SfdcClient; store: StateStore },
  req: ClosureRunRequest,
  opts: ClosureOptions = {},
): Promise<ClosureRunResult> {
  const log = getLogger("Closure", { run_id: req.runId, country: req.country });
  const bulkThreshold = opts.bulkThreshold ?? CLOSURE_BULK_THRESHOLD;
  const restChunk = Math.min(
    opts.restChunk ?? SOQL_IN_MAX_IDS,
    SOQL_IN_MAX_IDS,
  );
  const pageRows = opts.pageRows ?? 2000;
  const maxRounds = req.maxRounds > 0 ? req.maxRounds : 20;
  const tag = fileTag(req.tag);

  const files = new Map<ObjectKey, ExtractFile[]>();
  const fetched = new Map<ObjectKey, number>();
  const dangling: FkIdSets = new Map();
  const deletedParents = new Map<ObjectKey, number>();
  const findings: Finding[] = [];
  const queueOwners = new Set<string>();
  const userIds = new Set<string>();
  /** Every id already fetched, found dangling, or known to be in the id map. */
  const seen = new Map<ObjectKey, Set<string>>();
  const seenSet = (key: ObjectKey) => {
    let s = seen.get(key);
    if (!s) {
      s = new Set();
      seen.set(key, s);
    }
    return s;
  };
  const addDangling = (key: ObjectKey, ids: Iterable<string>) => {
    let s = dangling.get(key);
    if (!s) {
      s = new Set();
      dangling.set(key, s);
    }
    for (const id of ids) s.add(id);
  };

  // round 0 input: needed − have − id map; users are never fetched
  let pending = new Map<ObjectKey, Set<string>>();
  for (const [key, ids] of req.needed) {
    if (key === "user") {
      for (const id of ids) userIds.add(id);
      continue;
    }
    const have = req.have?.get(key);
    const set = new Set<string>();
    for (const id of ids) {
      const id18 = to18(id);
      if (have?.has(id18)) continue;
      set.add(id18);
    }
    if (set.size) pending.set(key, set);
  }
  for (const [key, ids] of pending) {
    await subtractIdMap(deps.store, key, ids);
    if (!ids.size) pending.delete(key);
  }

  let rounds = 0;
  while (pending.size) {
    if (rounds >= maxRounds) {
      const remaining = [...pending.values()].reduce((n, s) => n + s.size, 0);
      findings.push({
        severity: "blocking",
        code: "EXTRACT_CLOSURE_ROUNDS_EXCEEDED",
        country: req.country,
        count: remaining,
        detail: `FK closure did not converge after ${maxRounds} rounds; ${remaining} id(s) across ${[...pending.keys()].join(", ")} left unfetched`,
      });
      for (const [key, ids] of pending) addDangling(key, ids);
      break;
    }
    rounds++;
    const next = new Map<ObjectKey, Set<string>>();
    for (const [key, ids] of pending) {
      const mapping = req.mappings.get(key);
      const target = req.targets.get(key);
      for (const id of ids) seenSet(key).add(id);
      if (!mapping) {
        findings.push({
          severity: "warning",
          code: "EXTRACT_CLOSURE_NO_MAPPING",
          objectKey: key,
          country: req.country,
          count: ids.size,
          detail: `${ids.size} referenced ${key} id(s) cannot be closed over: the object is not part of this run`,
        });
        addDangling(key, ids);
        continue;
      }
      const strategy = buildCountryStrategy(mapping.countryOf, req.country, {
        parentFieldFor: parentFieldFromMapping(mapping),
      });
      const { columns, fkColumns } = buildColumnList(mapping, target, {
        countryPaths: countryColumns(strategy),
      });
      const source = mapping.sourceObject;
      const partitionBy = mapping.load.partitionBy;
      const want = new Set(ids);
      const got = new Set<string>();
      const liveIds = new Set<string>();
      let deletedCount = 0;
      const outFiles = files.get(key) ?? [];
      files.set(key, outFiles);
      const jobId = `closure-${tag}-r${rounds}`;
      // one buffer per partition (a single unpartitioned one otherwise)
      const buffers = new Map<
        number | undefined,
        { rows: SourceRow[]; pageNo: number }
      >();
      const bufferFor = (partition: number | undefined) => {
        let b = buffers.get(partition);
        if (!b) {
          b = { rows: [], pageNo: 0 };
          buffers.set(partition, b);
        }
        return b;
      };
      const flush = async (partition: number | undefined) => {
        const b = buffers.get(partition);
        if (!b?.rows.length) return;
        const dir = extractDir(req.runDir, req.country, key, partition);
        const file = path.join(dir, `${jobId}-${b.pageNo}.csv`);
        await writeCsvFile(file, b.rows, columns);
        outFiles.push({
          path: file,
          jobId,
          pageNo: b.pageNo,
          rows: b.rows.length,
          closure: true,
          ...(partition !== undefined ? { partition } : {}),
        });
        b.pageNo++;
        b.rows = [];
      };
      const flushAll = async () => {
        for (const partition of [...buffers.keys()]) await flush(partition);
      };
      const handle = async (row: SourceRow) => {
        const id = to18(row.Id);
        if (!want.has(id) || got.has(id)) return;
        got.add(id);
        if (isDeletedRow(row)) {
          deletedCount++;
          return;
        }
        row.Id = id;
        liveIds.add(id);
        const sets: FkIdSets = new Map();
        collectRowFks(row, fkColumns, sets, queueOwners);
        for (const [tk, tids] of sets) {
          if (tk === "user") {
            for (const u of tids) userIds.add(u);
            continue;
          }
          const s = seenSet(tk);
          const have = req.have?.get(tk);
          let bucket = next.get(tk);
          for (const t of tids) {
            if (s.has(t) || have?.has(t) || pending.get(tk)?.has(t)) continue;
            if (!bucket) {
              bucket = new Set();
              next.set(tk, bucket);
            }
            bucket.add(t);
          }
        }
        const partition = partitionBy
          ? partitionIndex(row, partitionBy)
          : undefined;
        const b = bufferFor(partition);
        b.rows.push(row);
        if (b.rows.length >= pageRows) await flush(partition);
      };

      if (want.size > bulkThreshold) {
        log.info(
          { object_key: key, ids: want.size, round: rounds },
          "closure remainder above threshold: bulk queryAll + client filter",
        );
        const result = deps.sfdc.bulkQuery(
          buildSelect({ object: source, columns }),
          { all: true },
        );
        for await (const page of result)
          for (const row of page.records) await handle(row);
        await result.job;
      } else {
        const list = [...want];
        for (let i = 0; i < list.length; i += restChunk) {
          for await (const row of deps.sfdc.queryIds(
            source,
            list.slice(i, i + restChunk),
            columns,
          ))
            await handle(row);
        }
      }
      await flushAll();
      const live = got.size - deletedCount;
      fetched.set(key, (fetched.get(key) ?? 0) + live);
      const missing = [...want].filter((id) => !got.has(id));
      if (deletedCount)
        deletedParents.set(key, (deletedParents.get(key) ?? 0) + deletedCount);
      // dangling = wanted − live rows written (missing ∪ deleted parents)
      addDangling(
        key,
        [...want].filter((id) => !liveIds.has(id)),
      );
      log.info(
        {
          object_key: key,
          round: rounds,
          requested: want.size,
          live,
          deleted: deletedCount,
          missing: missing.length,
        },
        "closure round",
      );
    }
    for (const [key, ids] of next) {
      await subtractIdMap(deps.store, key, ids);
      if (!ids.size) next.delete(key);
    }
    pending = next;
  }

  for (const [key, set] of dangling) if (!set.size) dangling.delete(key);
  // parents-first across rounds for partitioned objects (stable: round/page
  // order is kept within a partition)
  for (const list of files.values())
    list.sort((a, b) => (a.partition ?? 0) - (b.partition ?? 0));

  const totalDangling = [...dangling.values()].reduce((n, s) => n + s.size, 0);
  if (totalDangling)
    findings.push({
      severity: "info",
      code: "EXTRACT_CLOSURE_DANGLING",
      country: req.country,
      count: totalDangling,
      detail: `${totalDangling} referenced parent id(s) are deleted or missing in the source; the referencing FKs stay unresolved (§3.5)`,
    });
  return {
    files,
    rounds,
    dangling,
    fetched,
    findings,
    deletedParents,
    queueOwners,
    userIds,
  };
}
