/**
 * Delta strategy (§4): watermark windows, delete sources and routing.
 *
 *  - Window (§4.1): `wm_lo = watermark.modstamp − overlap`,
 *    `wm_hi = min(sfdc_now − safetyLag, freezeAt)`; predicate
 *    `SystemModstamp >= {wm_lo} AND SystemModstamp < {wm_hi}` with unquoted
 *    `YYYY-MM-DDThh:mm:ssZ` literals. `wm_hi` is fixed for the whole run.
 *  - A cutoff change against the stored watermark raises
 *    `SCOPE_CUTOFF_CHANGED`; a *wider* cutoff forces a full re-extract.
 *  - Deletes (§4.4): `queryAll` rows with `IsDeleted = true` (collected by
 *    the extractor), `getDeleted` feed (replicateable objects, ≤ 30 days —
 *    `DELETE_WINDOW_EXCEEDED` beyond), key-set reconciliation for
 *    non-replicateable objects (`SF_NOT_REPLICATEABLE`), and master-detail
 *    cascades which arrive through the children's own feeds.
 *  - Routing (§4.3 step 5): last-wins against the row's `SystemModstamp`
 *    seen in the window; the action follows `deletePolicy`.
 *  - Parent changes (§4.2): children are found through `fk_index` and
 *    re-issued by the loader.
 */
import type { SfdcClient } from "../sfdc/types";
import { soqlDateTime, andPredicates, buildSelect } from "../sfdc/soql";
import type { StateStore } from "../store/types";
import { to18 } from "../transform/ids";
import type {
  DeletePolicy,
  Finding,
  FkIndexRow,
  ObjectKey,
  Unit,
  Watermark,
} from "../types";

export const DELETE_FEED_WINDOW_DAYS = 30;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

export interface DeltaWindowInput {
  mode: "init" | "delta" | "final-delta";
  /** Stored `modstamp` watermark of the unit (absent on the first delta). */
  watermark?: Pick<Watermark, "value" | "cutoffDate">;
  /** `sfdc_now` — from Salesforce, never the host (§4.1). */
  sfdcNow: string;
  /** `delta.overlapMinutes` (5–15, default 10). */
  overlapMinutes?: number;
  /** `delta.safetyLagMinutes` (default 5). */
  safetyLagMinutes?: number;
  /** `runs.freeze_at` for `final-delta` (§4.5). */
  freezeAt?: string;
  /** Cutoff literal in force for the unit (to detect a retention change). */
  cutoffDate?: string;
  objectKey?: ObjectKey;
  country?: string;
}

export interface DeltaWindow {
  /** Absent on `init`, on the first delta of a unit, and when a wider cutoff forces a re-extract. */
  wmLo?: string;
  wmHi: string;
  /** `SystemModstamp` term; absent when the whole scope must be (re-)extracted. */
  predicate?: string;
  reextract: boolean;
  findings: Finding[];
}

function ms(iso: string): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) throw new TypeError(`Invalid datetime: ${iso}`);
  return t;
}

/** §4.1 window math; literals are rendered with `soqlDateTime`. */
export function planDeltaWindow(input: DeltaWindowInput): DeltaWindow {
  const overlap = input.overlapMinutes ?? 10;
  if (overlap < 5 || overlap > 15)
    throw new RangeError(`delta.overlapMinutes must be 5–15, got ${overlap}`);
  const lag = input.safetyLagMinutes ?? 5;
  let hi = ms(input.sfdcNow) - lag * MINUTE;
  if (input.mode === "final-delta" && input.freezeAt)
    hi = Math.min(hi, ms(input.freezeAt));
  const wmHi = soqlDateTime(hi);
  const findings: Finding[] = [];
  if (input.mode === "init") return { wmHi, reextract: false, findings };

  let reextract = false;
  const wm = input.watermark;
  if (
    wm?.cutoffDate &&
    input.cutoffDate &&
    wm.cutoffDate !== input.cutoffDate
  ) {
    const wider = input.cutoffDate < wm.cutoffDate;
    reextract = wider;
    findings.push({
      severity: "warning",
      code: "SCOPE_CUTOFF_CHANGED",
      objectKey: input.objectKey,
      country: input.country,
      detail: `cutoff changed ${wm.cutoffDate} → ${input.cutoffDate}${wider ? " (wider: full re-extract of the scope)" : " (narrower: rows that aged out are left in place)"}`,
    });
  }
  if (!wm || reextract)
    return { wmHi, predicate: `SystemModstamp < ${wmHi}`, reextract, findings };
  const lo = ms(wm.value) - overlap * MINUTE;
  const wmLo = soqlDateTime(lo);
  return {
    wmLo,
    wmHi,
    predicate: `SystemModstamp >= ${wmLo} AND SystemModstamp < ${wmHi}`,
    reextract: false,
    findings,
  };
}

/** `SystemModstamp >= lo AND SystemModstamp < hi` for an explicit plan window. */
export function windowPredicate(window: {
  wmLo?: string;
  wmHi: string;
}): string {
  const hi = soqlDateTime(window.wmHi);
  return window.wmLo
    ? `SystemModstamp >= ${soqlDateTime(window.wmLo)} AND SystemModstamp < ${hi}`
    : `SystemModstamp < ${hi}`;
}

// ---------------------------------------------------------------------------
// Delete sources
// ---------------------------------------------------------------------------

export type DeleteSource = "queryAll" | "feed" | "keySet" | "cascade";

export interface DeletedRow {
  id: string;
  deletedDate: string;
  source: DeleteSource;
  /** Account merges: the surviving record (§3.4 a). */
  masterRecordId?: string;
  /** Extract partition the `queryAll` row came from (internal bookkeeping). */
  partition?: number;
}

/** §4.4 source 2 guard: the feed reaches back 30 days; older starts need a `verify` full reconciliation. */
export function checkDeleteWindow(
  deletedSince: string | undefined,
  wmHi: string,
  mode: "delta" | "final-delta" | string,
  unit?: Unit,
): Finding[] {
  if (!deletedSince) return [];
  const gap = ms(wmHi) - ms(deletedSince);
  if (gap <= DELETE_FEED_WINDOW_DAYS * DAY) return [];
  return [
    {
      severity:
        mode === "delta" || mode === "final-delta" ? "blocking" : "warning",
      code: "DELETE_WINDOW_EXCEEDED",
      objectKey: unit?.objectKey,
      country: unit?.country,
      detail: `last delete watermark ${deletedSince} is ${Math.floor(gap / DAY)} days before ${wmHi}; the /deleted/ feed covers ${DELETE_FEED_WINDOW_DAYS} days — run 'verify --keys' first`,
    },
  ];
}

export async function fetchDeletedFeed(
  sfdc: Pick<SfdcClient, "getDeleted">,
  objectName: string,
  start: string,
  end: string,
): Promise<{ rows: DeletedRow[]; latestDateCovered: string }> {
  const r = await sfdc.getDeleted(objectName, start, end);
  return {
    rows: r.deletedRecords.map((d) => ({
      id: to18(d.id),
      deletedDate: d.deletedDate,
      source: "feed",
    })),
    latestDateCovered: r.latestDateCovered,
  };
}

/**
 * Key-set reconciliation for non-replicateable objects (§2.1.6): full
 * `SELECT Id` (country-filtered when a predicate exists) diffed against the
 * live id-map rows of the unit; ids gone from the source are deleted with
 * `deletedDate = wm_hi`.
 */
export async function keySetReconcile(
  sfdc: Pick<SfdcClient, "query">,
  store: Pick<StateStore, "idMap">,
  unit: Unit,
  objectName: string,
  wmHi: string,
  countryPredicate?: string,
): Promise<DeletedRow[]> {
  const present = new Set<string>();
  const soql = buildSelect({
    object: objectName,
    columns: ["Id"],
    where: andPredicates(countryPredicate),
  });
  for await (const row of sfdc.query(soql)) present.add(to18(row.Id));
  const out: DeletedRow[] = [];
  for await (const m of store.idMap.iterate(unit.objectKey, unit.country)) {
    if (m.deletedAt || m.mergedInto) continue;
    if (!present.has(m.sfdcId))
      out.push({ id: m.sfdcId, deletedDate: wmHi, source: "keySet" });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

export type DeleteAction = "delete" | "inactivate" | "ignore";

export interface RoutedDeletes {
  action: DeleteAction;
  /** To apply (`delete`/`inactivate`) — empty for `ignore`. */
  apply: DeletedRow[];
  /** Policy `ignore`: listed in the run report only. */
  ignored: DeletedRow[];
  /** A later update/undelete in the window wins (§4.3 step 5). */
  superseded: DeletedRow[];
}

/**
 * Deduplicate by id (latest `deletedDate` wins), drop deletes superseded by
 * a live row with a later `SystemModstamp` in the same window, then route
 * by `deletePolicy`.
 */
export function routeDeletes(
  deleted: readonly DeletedRow[],
  policy: DeletePolicy,
  liveModstamps: ReadonlyMap<string, string> = new Map(),
): RoutedDeletes {
  const byId = new Map<string, DeletedRow>();
  for (const d of deleted) {
    const id = to18(d.id);
    const prev = byId.get(id);
    if (!prev || prev.deletedDate < d.deletedDate)
      byId.set(id, {
        ...d,
        id,
        masterRecordId: d.masterRecordId ?? prev?.masterRecordId,
      });
    else if (d.masterRecordId && !prev.masterRecordId)
      prev.masterRecordId = d.masterRecordId;
  }
  const apply: DeletedRow[] = [];
  const ignored: DeletedRow[] = [];
  const superseded: DeletedRow[] = [];
  for (const d of byId.values()) {
    const live = liveModstamps.get(d.id);
    if (live !== undefined && live > d.deletedDate) {
      superseded.push(d);
      continue;
    }
    if (policy === "ignore") ignored.push(d);
    else apply.push(d);
  }
  const sortById = (a: DeletedRow, b: DeletedRow) => (a.id < b.id ? -1 : 1);
  return {
    action: policy,
    apply: apply.sort(sortById),
    ignored: ignored.sort(sortById),
    superseded: superseded.sort(sortById),
  };
}

/** Live rows re-appearing after a recorded delete (`UNDELETE`, §4.4): id-map rows with `deletedAt` set. */
export async function detectUndeletes(
  store: Pick<StateStore, "idMap">,
  objectKey: ObjectKey,
  liveIds: Iterable<string>,
): Promise<string[]> {
  const ids = [...new Set([...liveIds].map(to18))];
  const out: string[] = [];
  for (let i = 0; i < ids.length; i += 1000) {
    const rows = await store.idMap.bulkGet(objectKey, ids.slice(i, i + 1000));
    for (const [id, row] of rows) if (row.deletedAt) out.push(id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// getUpdated cross-check (§4.1)
// ---------------------------------------------------------------------------

export interface UpdatedCrossCheck {
  /** Ids the feed reports as updated in the window that the extract did not stream. */
  missing: string[];
  feedCount: number;
  findings: Finding[];
}

/**
 * `|ids|` from `/updated/` vs the ids streamed. A shortfall is a
 * `DELTA_COUNT_MISMATCH` warning only when the unit is full-scope and global
 * (the only case where equality is expected); scoped/country units get an
 * `info` (`DELTA_UPDATED_UNSEEN`) because the feed ignores scope and country.
 */
export async function crossCheckUpdated(
  sfdc: Pick<SfdcClient, "getUpdated">,
  objectName: string,
  window: { wmLo?: string; wmHi: string },
  seenIds: ReadonlySet<string>,
  unit: Unit,
  exact: boolean,
): Promise<UpdatedCrossCheck> {
  if (!window.wmLo) return { missing: [], feedCount: 0, findings: [] };
  const r = await sfdc.getUpdated(objectName, window.wmLo, window.wmHi);
  const missing = r.ids.map(to18).filter((id) => !seenIds.has(id));
  const findings: Finding[] = [];
  if (missing.length)
    findings.push({
      severity: exact ? "warning" : "info",
      code: exact ? "DELTA_COUNT_MISMATCH" : "DELTA_UPDATED_UNSEEN",
      objectKey: unit.objectKey,
      country: unit.country,
      count: missing.length,
      detail: exact
        ? `${missing.length} id(s) reported by /updated/ were not streamed in the window; re-queried by id`
        : `${missing.length} id(s) reported by /updated/ fall outside the unit's scope/country predicate`,
    });
  return { missing, feedCount: r.ids.length, findings };
}

// ---------------------------------------------------------------------------
// Parent changes (§4.2)
// ---------------------------------------------------------------------------

/**
 * Children whose stored FK pointed at a parent that was merged/re-keyed/
 * deleted in this delta — the loader re-issues their updates.
 */
export async function collectParentChangeFanOut(
  store: Pick<StateStore, "fkIndex">,
  parentKey: ObjectKey | "user",
  changedParentIds: Iterable<string>,
): Promise<FkIndexRow[]> {
  const out: FkIndexRow[] = [];
  const seen = new Set<string>();
  for (const raw of changedParentIds) {
    const id = to18(raw);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(...(await store.fkIndex.childrenOf(parentKey, id)));
  }
  return out;
}
