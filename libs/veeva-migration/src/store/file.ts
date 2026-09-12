/**
 * File-backed `StateStore` (§2.4) for dry runs and small migrations. Keeps
 * the working set in memory with exactly the semantics of the reference
 * `MemoryStateStore` and persists it under `{dir}/`:
 *
 *   meta.json                 { format, vaultDns }
 *   <table>.snapshot.json     compacted rows `[[key, row], …]`, replaced atomically
 *   <table>.log.ndjson        append-only journal: {"k":key,"v":row} | {"k":key,"d":1}
 *
 * Every mutation is applied in memory and appended to the journal before the
 * call resolves; writes are serialised through one queue so lines never
 * interleave. Snapshots are written to a temp file and renamed (crash-safe);
 * a torn trailing journal line is ignored on load. Replay is idempotent
 * (set/delete by key), so a crash between snapshot rename and journal reset
 * cannot duplicate rows.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { getLogger } from "../logger";
import { to18 } from "../transform/ids";
import type {
  AuditLogEntry,
  CountryCode,
  ExtractCheckpoint,
  Finding,
  FkIndexRow,
  IdMapRow,
  MappingSnapshot,
  ObjectKey,
  PendingFk,
  ProbeResult,
  ReconciliationRow,
  RowResult,
  RowState,
  RunRecord,
  StoredFinding,
  Watermark,
} from "../types";
import type {
  AuditLogRepo,
  CheckpointsRepo,
  CountryStatusRepo,
  FindingsRepo,
  FkIndexRepo,
  IdMapRepo,
  MappingSnapshotsRepo,
  PendingFkRepo,
  ProbeResultsRepo,
  ReconciliationRepo,
  RowResultsRepo,
  RunsRepo,
  StateStore,
  WatermarksRepo,
} from "./types";

export const FILE_STORE_FORMAT = 1;

const clone = <T>(v: T): T =>
  v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
const nowIso = () => new Date().toISOString();

/** A row that occupies its (vaultObject, vaultId) slot per `id_map_vault_uidx`. */
const isLive = (r: IdMapRow): boolean => !r.mergedInto && !r.deletedAt;
const vaultKey = (r: Pick<IdMapRow, "vaultObject" | "vaultId">): string =>
  `${r.vaultObject}|${r.vaultId}`;

type JournalEntry = { k: string; v: unknown } | { k: string; d: 1 };

type TableFile =
  | "runs"
  | "watermarks"
  | "id_map"
  | "row_results"
  | "pending_fk"
  | "fk_index"
  | "extract_checkpoints"
  | "preflight_findings"
  | "reconciliation"
  | "mapping_snapshots"
  | "audit_log"
  | "probe_results"
  | "country_status";

export interface FileStateStoreOptions {
  /** Directory holding the state files (created if missing). */
  dir: string;
  vaultDns: string;
  /** Journal entries per table before an automatic compaction (default 5000). */
  compactEvery?: number;
}

/** Atomic file replace: write `<file>.tmp-<rand>` then rename. */
async function writeAtomic(file: string, data: string): Promise<void> {
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  const handle = await fs.open(tmp, "w");
  try {
    await handle.writeFile(data, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(tmp, file);
}

/**
 * One persisted table: an insertion-ordered map plus its journal. All rows
 * stored here are already deep-copied by the caller.
 */
class Table<T> {
  readonly rows = new Map<string, T>();
  private pending = 0;

  constructor(
    private readonly store: FileStateStore,
    readonly name: TableFile,
  ) {}

  get(key: string): T | undefined {
    return this.rows.get(key);
  }

  values(): T[] {
    return [...this.rows.values()];
  }

  /** In-memory set + journal append (returns the write promise). */
  set(key: string, row: T): Promise<void> {
    this.rows.set(key, row);
    return this.journal({ k: key, v: row });
  }

  delete(key: string): Promise<void> {
    if (!this.rows.delete(key)) return Promise.resolve();
    return this.journal({ k: key, d: 1 });
  }

  deleteMany(keys: string[]): Promise<void> {
    const gone = keys.filter((k) => this.rows.delete(k));
    return this.journal(...gone.map((k) => ({ k, d: 1 as const })));
  }

  /** Batch variant: one append for many entries. */
  setMany(entries: Array<[string, T]>): Promise<void> {
    for (const [k, v] of entries) this.rows.set(k, v);
    return this.journal(...entries.map(([k, v]) => ({ k, v })));
  }

  private journal(...entries: JournalEntry[]): Promise<void> {
    if (entries.length === 0) return Promise.resolve();
    this.pending += entries.length;
    const lines = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
    return this.store.enqueue(async () => {
      await fs.appendFile(
        this.store.file(`${this.name}.log.ndjson`),
        lines,
        "utf8",
      );
      if (this.pending >= this.store.compactEvery) await this.compactNow();
    });
  }

  /** Called inside the write queue. */
  async compactNow(): Promise<void> {
    const snapshot = this.store.file(`${this.name}.snapshot.json`);
    const log = this.store.file(`${this.name}.log.ndjson`);
    await writeAtomic(snapshot, JSON.stringify([...this.rows.entries()]));
    await writeAtomic(log, "");
    this.pending = 0;
  }

  async load(): Promise<void> {
    this.rows.clear();
    const snapshot = this.store.file(`${this.name}.snapshot.json`);
    const log = this.store.file(`${this.name}.log.ndjson`);
    const snap = await readIfExists(snapshot);
    if (snap !== undefined) {
      const entries = JSON.parse(snap) as Array<[string, T]>;
      for (const [k, v] of entries) this.rows.set(k, v);
    }
    const text = await readIfExists(log);
    if (text === undefined) return;
    const lines = text.split("\n");
    const complete = text.endsWith("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === "") continue;
      let entry: JournalEntry;
      try {
        entry = JSON.parse(line) as JournalEntry;
      } catch (err) {
        const last = i === lines.length - 1 && !complete;
        if (last) {
          this.store.log.warn(
            { table: this.name },
            "ignoring torn trailing journal line (previous crash)",
          );
          break;
        }
        throw new Error(
          `corrupt journal ${log} at line ${i + 1}: ${(err as Error).message}`,
        );
      }
      if ("d" in entry) this.rows.delete(entry.k);
      else this.rows.set(entry.k, entry.v as T);
      this.pending++;
    }
  }
}

async function readIfExists(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

export class FileStateStore implements StateStore {
  readonly vaultDns: string;
  readonly dir: string;
  readonly compactEvery: number;
  readonly log = getLogger("Store", { driver: "file" });
  private opened: Promise<void> | undefined;
  private queue: Promise<void> = Promise.resolve();
  private closed = false;

  private runsT = new Table<RunRecord>(this, "runs");
  private wmT = new Table<Watermark>(this, "watermarks");
  private idMapT = new Table<IdMapRow>(this, "id_map");
  private rowResultsT = new Table<RowResult>(this, "row_results");
  private pendingT = new Table<PendingFk>(this, "pending_fk");
  private fkT = new Table<FkIndexRow>(this, "fk_index");
  private cpT = new Table<ExtractCheckpoint>(this, "extract_checkpoints");
  private findingsT = new Table<StoredFinding>(this, "preflight_findings");
  private reconT = new Table<ReconciliationRow>(this, "reconciliation");
  private snapT = new Table<MappingSnapshot>(this, "mapping_snapshots");
  private auditT = new Table<AuditLogEntry>(this, "audit_log");
  private probesT = new Table<ProbeResult>(this, "probe_results");
  private frozenT = new Table<{ country: CountryCode; frozenAt: string }>(
    this,
    "country_status",
  );
  /**
   * Secondary index for `id_map_vault_uidx`: `vaultObject|vaultId` → id-map
   * key, live rows only. Keeps `put`/`putMany`/`byVaultId` O(1) per row
   * instead of a scan of the whole map (the loader puts once per loaded row
   * and the matcher looks up once per hit). Maintained by the `idMap*`
   * mutators below and rebuilt on `load()`.
   */
  private liveByVault = new Map<string, string>();
  private auditSeq = 0;
  private findingSeq = 0;

  constructor(opts: FileStateStoreOptions) {
    this.vaultDns = opts.vaultDns;
    this.dir = path.resolve(opts.dir);
    this.compactEvery = opts.compactEvery ?? 5000;
  }

  /** Open (create the directory, load snapshots + journals). Idempotent. */
  static async open(opts: FileStateStoreOptions): Promise<FileStateStore> {
    const store = new FileStateStore(opts);
    await store.ready();
    return store;
  }

  file(name: string): string {
    return path.join(this.dir, name);
  }

  /** Serialise a write behind every earlier one. */
  enqueue(task: () => Promise<void>): Promise<void> {
    const next = this.queue.then(task, task);
    // keep the chain alive even when a task fails; the failure is surfaced to the awaiting caller
    this.queue = next.catch(() => undefined);
    return next;
  }

  private tables(): Table<unknown>[] {
    return [
      this.runsT,
      this.wmT,
      this.idMapT,
      this.rowResultsT,
      this.pendingT,
      this.fkT,
      this.cpT,
      this.findingsT,
      this.reconT,
      this.snapT,
      this.auditT,
      this.probesT,
      this.frozenT,
    ] as Table<unknown>[];
  }

  private ready(): Promise<void> {
    if (!this.opened) this.opened = this.load();
    return this.opened;
  }

  private async load(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const metaFile = this.file("meta.json");
    const metaText = await readIfExists(metaFile);
    if (metaText === undefined) {
      await writeAtomic(
        metaFile,
        JSON.stringify({ format: FILE_STORE_FORMAT, vaultDns: this.vaultDns }),
      );
    } else {
      const meta = JSON.parse(metaText) as {
        format?: number;
        vaultDns?: string;
      };
      if (meta.format !== FILE_STORE_FORMAT)
        throw new Error(
          `file state store ${this.dir}: unsupported format ${String(meta.format)} (expected ${FILE_STORE_FORMAT})`,
        );
      if (meta.vaultDns !== this.vaultDns)
        throw new Error(
          `file state store ${this.dir} belongs to vault ${String(meta.vaultDns)}, not ${this.vaultDns} (one id map per target vault, §2.4)`,
        );
    }
    for (const t of this.tables()) await t.load();
    this.liveByVault.clear();
    for (const [k, r] of this.idMapT.rows)
      if (isLive(r)) this.liveByVault.set(vaultKey(r), k);
    for (const e of this.auditT.values())
      this.auditSeq = Math.max(this.auditSeq, e.id ?? 0);
    for (const k of this.findingsT.rows.keys())
      this.findingSeq = Math.max(this.findingSeq, Number(k) || 0);
    this.log.debug(
      { dir: this.dir, id_map_rows: this.idMapT.rows.size },
      "file state store opened",
    );
  }

  /** Write snapshots for every table and reset the journals. */
  async compact(): Promise<void> {
    await this.ready();
    await this.enqueue(async () => {
      for (const t of this.tables()) await t.compactNow();
    });
  }

  async migrate(): Promise<void> {
    await this.ready();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    if (this.opened) await this.compact();
    this.closed = true;
  }

  private idKey(objectKey: ObjectKey, sfdcId: string): string {
    return `${objectKey}|${to18(sfdcId)}`;
  }

  /** Every id_map mutation goes through these so `liveByVault` stays exact. */
  private reindexIdMap(key: string, next: IdMapRow | undefined): void {
    const prev = this.idMapT.get(key);
    if (prev && isLive(prev)) {
      const vk = vaultKey(prev);
      if (this.liveByVault.get(vk) === key) this.liveByVault.delete(vk);
    }
    if (next && isLive(next)) this.liveByVault.set(vaultKey(next), key);
  }
  private idMapSet(key: string, row: IdMapRow): Promise<void> {
    this.reindexIdMap(key, row);
    return this.idMapT.set(key, row);
  }
  private idMapSetMany(entries: Array<[string, IdMapRow]>): Promise<void> {
    for (const [k, v] of entries) this.reindexIdMap(k, v);
    return this.idMapT.setMany(entries);
  }
  private idMapDeleteMany(keys: string[]): Promise<void> {
    for (const k of keys) this.reindexIdMap(k, undefined);
    return this.idMapT.deleteMany(keys);
  }

  // -------------------------------------------------------------------------

  runs: RunsRepo = {
    create: async (run) => {
      await this.ready();
      if (this.runsT.get(run.runId))
        throw new Error(`run ${run.runId} already exists`);
      await this.runsT.set(run.runId, clone(run));
    },
    get: async (runId) => {
      await this.ready();
      return clone(this.runsT.get(runId));
    },
    update: async (runId, patch) => {
      await this.ready();
      const cur = this.runsT.get(runId);
      if (!cur) throw new Error(`run ${runId} not found`);
      await this.runsT.set(runId, { ...cur, ...clone(patch) });
    },
    list: async (filter = {}) => {
      await this.ready();
      let out = this.runsT
        .values()
        .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
      if (filter.mode) out = out.filter((r) => r.mode === filter.mode);
      if (filter.status) out = out.filter((r) => r.status === filter.status);
      if (filter.limit !== undefined) out = out.slice(0, filter.limit);
      return clone(out);
    },
    latestSucceeded: async () => {
      await this.ready();
      return clone(
        this.runsT
          .values()
          .filter((r) => r.status === "succeeded")
          .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))[0],
      );
    },
  };

  watermarks: WatermarksRepo = {
    get: async (objectKey, country, kind) => {
      await this.ready();
      return clone(this.wmT.get(`${objectKey}|${country}|${kind}`));
    },
    set: async (w) => {
      await this.ready();
      await this.wmT.set(`${w.objectKey}|${w.country}|${w.kind}`, clone(w));
    },
    list: async (filter = {}) => {
      await this.ready();
      return clone(
        this.wmT
          .values()
          .filter(
            (w) =>
              (!filter.objectKey || w.objectKey === filter.objectKey) &&
              (!filter.country || w.country === filter.country),
          ),
      );
    },
  };

  /**
   * Shared by put/putMany: validates + returns the normalised row (no I/O).
   * `staged` holds this batch's rows by id-map key and `stagedByVault` the
   * batch-local counterpart of `liveByVault`; both take precedence over the
   * committed tables so a batch that re-maps a row is checked against its
   * own final state.
   */
  private prepareIdMapRow(
    row: IdMapRow,
    staged: Map<string, IdMapRow>,
    stagedByVault: Map<string, string>,
  ): [string, IdMapRow] {
    const key = this.idKey(row.objectKey, row.sfdcId);
    const prevStaged = staged.get(key);
    const existing = prevStaged ?? this.idMapT.get(key);
    const next: IdMapRow = {
      ...clone(row),
      sfdcId: to18(row.sfdcId),
      vaultDns: this.vaultDns,
      firstSeenRun: existing?.firstSeenRun ?? row.firstSeenRun,
    };
    if (prevStaged && isLive(prevStaged)) {
      const vk = vaultKey(prevStaged);
      if (stagedByVault.get(vk) === key) stagedByVault.delete(vk);
    }
    if (isLive(next)) {
      const vk = vaultKey(next);
      let otherKey = stagedByVault.get(vk);
      if (otherKey === undefined) {
        const committed = this.liveByVault.get(vk);
        // a committed holder that this batch re-stages is judged by its staged state
        if (committed !== undefined && !staged.has(committed))
          otherKey = committed;
      }
      if (otherKey !== undefined && otherKey !== key) {
        const other = staged.get(otherKey) ?? this.idMapT.get(otherKey);
        throw new Error(
          `id_map_vault_uidx violation: ${next.vaultObject}/${next.vaultId} already mapped to ${other?.sfdcId ?? otherKey}`,
        );
      }
      stagedByVault.set(vk, key);
    }
    staged.set(key, next);
    return [key, next];
  }

  idMap: IdMapRepo = {
    get: async (objectKey, sfdcId) => {
      await this.ready();
      return clone(this.idMapT.get(this.idKey(objectKey, sfdcId)));
    },
    put: async (row) => {
      await this.ready();
      const [key, next] = this.prepareIdMapRow(row, new Map(), new Map());
      await this.idMapSet(key, next);
    },
    putMany: async (rows) => {
      await this.ready();
      const staged = new Map<string, IdMapRow>();
      const stagedByVault = new Map<string, string>();
      for (const r of rows) this.prepareIdMapRow(r, staged, stagedByVault);
      await this.idMapSetMany([...staged.entries()]);
    },
    bulkGet: async (objectKey, sfdcIds) => {
      await this.ready();
      const out = new Map<string, IdMapRow>();
      for (const id of sfdcIds) {
        const row = this.idMapT.get(this.idKey(objectKey, id));
        if (row) out.set(row.sfdcId, clone(row));
      }
      return out;
    },
    byVaultId: async (vaultObject, vaultId) => {
      await this.ready();
      const key = this.liveByVault.get(vaultKey({ vaultObject, vaultId }));
      return key === undefined ? undefined : clone(this.idMapT.get(key));
    },
    markDeleted: async (objectKey, sfdcId, deletedAt) => {
      await this.ready();
      const key = this.idKey(objectKey, sfdcId);
      const row = this.idMapT.get(key);
      if (row) await this.idMapSet(key, { ...row, deletedAt });
    },
    merge: async (objectKey, loser, survivor, runId) => {
      await this.ready();
      const lKey = this.idKey(objectKey, loser);
      const l = this.idMapT.get(lKey);
      const s = this.idMapT.get(this.idKey(objectKey, survivor));
      if (!s) throw new Error(`merge survivor ${survivor} not in id map`);
      const survivorId = to18(survivor);
      if (l) {
        await this.idMapSet(lKey, {
          ...l,
          mergedInto: survivorId,
          vaultId: s.vaultId,
          matchMethod: "merged",
          lastSeenRun: runId,
        });
      } else {
        await this.idMapSet(lKey, {
          ...clone(s),
          sfdcId: to18(loser),
          mergedInto: survivorId,
          matchMethod: "merged",
          firstSeenRun: runId,
          lastSeenRun: runId,
          sourceHash: null,
          verifiedHash: null,
          verifiedAt: null,
        });
      }
    },
    setSourceHash: async (objectKey, sfdcId, sourceHash, runId) => {
      await this.ready();
      const key = this.idKey(objectKey, sfdcId);
      const row = this.idMapT.get(key);
      if (row)
        await this.idMapSet(key, { ...row, sourceHash, lastSeenRun: runId });
    },
    setVerified: async (objectKey, sfdcId, verifiedHash, verifiedAt) => {
      await this.ready();
      const key = this.idKey(objectKey, sfdcId);
      const row = this.idMapT.get(key);
      if (row) await this.idMapSet(key, { ...row, verifiedHash, verifiedAt });
    },
    count: async (objectKey, country) => {
      await this.ready();
      return this.idMapT
        .values()
        .filter(
          (r) =>
            r.objectKey === objectKey &&
            (!country || r.country === country) &&
            !r.deletedAt &&
            !r.mergedInto,
        ).length;
    },
    iterate: (objectKey, country) => this.iterateIdMap(objectKey, country),
    purgeDryRun: async () => {
      await this.ready();
      const keys = [...this.idMapT.rows]
        .filter(([, r]) => r.dryRun)
        .map(([k]) => k);
      await this.idMapDeleteMany(keys);
      return keys.length;
    },
  };

  private async *iterateIdMap(
    objectKey: ObjectKey,
    country?: CountryCode,
  ): AsyncGenerator<IdMapRow> {
    await this.ready();
    const rows = this.idMapT
      .values()
      .filter(
        (r) => r.objectKey === objectKey && (!country || r.country === country),
      );
    for (const r of rows) yield clone(r);
  }

  rowResults: RowResultsRepo = {
    upsert: async (rows) => {
      await this.ready();
      await this.rowResultsT.setMany(
        rows.map((r) => {
          const sfdcId = to18(r.sfdcId);
          return [
            `${r.runId}|${r.objectKey}|${sfdcId}`,
            { ...clone(r), sfdcId },
          ];
        }),
      );
    },
    get: async (runId, objectKey, sfdcId) => {
      await this.ready();
      return clone(
        this.rowResultsT.get(`${runId}|${objectKey}|${to18(sfdcId)}`),
      );
    },
    query: async (filter) => {
      await this.ready();
      const states =
        filter.state === undefined
          ? undefined
          : Array.isArray(filter.state)
            ? filter.state
            : [filter.state];
      let out = this.rowResultsT
        .values()
        .filter(
          (r) =>
            r.runId === filter.runId &&
            (!filter.objectKey || r.objectKey === filter.objectKey) &&
            (!filter.country || r.country === filter.country) &&
            (!states || states.includes(r.state)) &&
            (!filter.errorType || r.errorType === filter.errorType) &&
            (filter.batchNo === undefined || r.batchNo === filter.batchNo),
        );
      if (filter.offset) out = out.slice(filter.offset);
      if (filter.limit !== undefined) out = out.slice(0, filter.limit);
      return clone(out);
    },
    countByState: async (runId, objectKey, country) => {
      await this.ready();
      const out: Partial<Record<RowState, number>> = {};
      for (const r of this.rowResultsT.values())
        if (
          r.runId === runId &&
          r.objectKey === objectKey &&
          r.country === country
        )
          out[r.state] = (out[r.state] ?? 0) + 1;
      return out;
    },
    countFailedByType: async (runId, objectKey, country) => {
      await this.ready();
      const out: Record<string, number> = {};
      for (const r of this.rowResultsT.values())
        if (
          r.runId === runId &&
          r.objectKey === objectKey &&
          r.country === country &&
          r.state === "failed"
        ) {
          const t = r.errorType ?? "UNKNOWN";
          out[t] = (out[t] ?? 0) + 1;
        }
      return out;
    },
  };

  private pendingKey(
    runId: string,
    objectKey: ObjectKey,
    sfdcId: string,
    field: string,
  ) {
    return `${runId}|${objectKey}|${to18(sfdcId)}|${field}`;
  }

  pendingFk: PendingFkRepo = {
    add: async (rows) => {
      await this.ready();
      const entries: Array<[string, PendingFk]> = [];
      const staged = new Map<string, PendingFk>();
      for (const r of rows) {
        const key = this.pendingKey(r.runId, r.objectKey, r.sfdcId, r.field);
        const existing = staged.get(key) ?? this.pendingT.get(key);
        const next: PendingFk = {
          ...clone(r),
          sfdcId: to18(r.sfdcId),
          targetSfdcId: to18(r.targetSfdcId),
          attempts: existing?.attempts ?? r.attempts,
        };
        staged.set(key, next);
      }
      for (const e of staged) entries.push(e);
      await this.pendingT.setMany(entries);
    },
    list: async (runId, filter = {}) => {
      await this.ready();
      return clone(
        this.pendingT
          .values()
          .filter(
            (r) =>
              r.runId === runId &&
              (!filter.objectKey || r.objectKey === filter.objectKey) &&
              (!filter.country || r.country === filter.country) &&
              (!filter.unresolvedOnly || !r.resolvedAt),
          ),
      );
    },
    resolve: async (runId, objectKey, sfdcId, field, resolvedAt) => {
      await this.ready();
      const key = this.pendingKey(runId, objectKey, sfdcId, field);
      const r = this.pendingT.get(key);
      if (r) await this.pendingT.set(key, { ...r, resolvedAt });
    },
    bumpAttempts: async (runId, objectKey, sfdcId, field) => {
      await this.ready();
      const key = this.pendingKey(runId, objectKey, sfdcId, field);
      const r = this.pendingT.get(key);
      if (r) await this.pendingT.set(key, { ...r, attempts: r.attempts + 1 });
    },
    countUnresolved: async (runId, objectKey, country) => {
      await this.ready();
      return this.pendingT
        .values()
        .filter(
          (r) =>
            r.runId === runId &&
            r.objectKey === objectKey &&
            r.country === country &&
            !r.resolvedAt,
        ).length;
    },
  };

  fkIndex: FkIndexRepo = {
    put: async (rows) => {
      await this.ready();
      const staged = new Map<string, FkIndexRow>();
      for (const r of rows) {
        const sfdcId = to18(r.sfdcId);
        staged.set(`${r.objectKey}|${sfdcId}|${r.field}`, {
          ...clone(r),
          sfdcId,
          targetSfdcId: to18(r.targetSfdcId),
        });
      }
      await this.fkT.setMany([...staged.entries()]);
    },
    childrenOf: async (targetObjectKey, targetSfdcId) => {
      await this.ready();
      const id = to18(targetSfdcId);
      return clone(
        this.fkT
          .values()
          .filter(
            (r) =>
              r.targetObjectKey === targetObjectKey && r.targetSfdcId === id,
          ),
      );
    },
    get: async (objectKey, sfdcId) => {
      await this.ready();
      const id = to18(sfdcId);
      return clone(
        this.fkT
          .values()
          .filter((r) => r.objectKey === objectKey && r.sfdcId === id),
      );
    },
  };

  checkpoints: CheckpointsRepo = {
    add: async (cp) => {
      await this.ready();
      await this.cpT.set(`${cp.runId}|${cp.jobId}|${cp.pageNo}`, clone(cp));
    },
    list: async (runId, objectKey, country) => {
      await this.ready();
      return clone(
        this.cpT
          .values()
          .filter(
            (c) =>
              c.runId === runId &&
              c.objectKey === objectKey &&
              c.country === country,
          )
          .sort((a, b) => a.pageNo - b.pageNo),
      );
    },
    complete: async (runId, jobId, pageNo, completedAt) => {
      await this.ready();
      const key = `${runId}|${jobId}|${pageNo}`;
      const c = this.cpT.get(key);
      if (c) await this.cpT.set(key, { ...c, completedAt });
    },
  };

  findings: FindingsRepo = {
    add: async (runId, findings: Finding[]) => {
      await this.ready();
      const createdAt = nowIso();
      await this.findingsT.setMany(
        findings.map((f) => [
          String(++this.findingSeq),
          { ...clone(f), runId, createdAt },
        ]),
      );
    },
    list: async (runId, filter = {}) => {
      await this.ready();
      return clone(
        this.findingsT
          .values()
          .filter(
            (f) =>
              f.runId === runId &&
              (!filter.severity || f.severity === filter.severity) &&
              (!filter.objectKey || f.objectKey === filter.objectKey) &&
              (!filter.country || f.country === filter.country) &&
              (!filter.code || f.code === filter.code),
          ),
      );
    },
    previous: async (currentRunId) => {
      await this.ready();
      const order = [...this.runsT.rows.keys()];
      const idx = order.indexOf(currentRunId);
      const prev = idx > 0 ? order[idx - 1] : undefined;
      return prev
        ? clone(this.findingsT.values().filter((f) => f.runId === prev))
        : [];
    },
  };

  reconciliation: ReconciliationRepo = {
    upsert: async (row) => {
      await this.ready();
      await this.reconT.set(
        `${row.runId}|${row.objectKey}|${row.country}`,
        clone(row),
      );
    },
    get: async (runId, objectKey, country) => {
      await this.ready();
      return clone(this.reconT.get(`${runId}|${objectKey}|${country}`));
    },
    list: async (runId) => {
      await this.ready();
      return clone(this.reconT.values().filter((r) => r.runId === runId));
    },
  };

  mappingSnapshots: MappingSnapshotsRepo = {
    put: async (s) => {
      await this.ready();
      await this.snapT.set(
        `${s.mappingHash}|${s.objectKey}|${s.country}`,
        clone(s),
      );
    },
    get: async (mappingHash, objectKey, country) => {
      await this.ready();
      return clone(this.snapT.get(`${mappingHash}|${objectKey}|${country}`));
    },
    latestFor: async (objectKey, country) => {
      await this.ready();
      return clone(
        this.snapT
          .values()
          .filter((s) => s.objectKey === objectKey && s.country === country)
          .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0],
      );
    },
  };

  auditLog: AuditLogRepo = {
    append: async (entry) => {
      await this.ready();
      const id = ++this.auditSeq;
      await this.auditT.set(String(id), { ...clone(entry), id });
    },
    list: async (filter = {}) => {
      await this.ready();
      let out = this.auditT
        .values()
        .filter(
          (e) =>
            (!filter.runId || e.runId === filter.runId) &&
            (!filter.event || e.event === filter.event),
        );
      if (filter.limit !== undefined) out = out.slice(-filter.limit);
      return clone(out);
    },
  };

  probeResults: ProbeResultsRepo = {
    get: async (probe) => {
      await this.ready();
      return clone(this.probesT.get(probe));
    },
    set: async (r) => {
      await this.ready();
      await this.probesT.set(r.probe, clone({ ...r, vaultDns: this.vaultDns }));
    },
    list: async () => {
      await this.ready();
      return clone(this.probesT.values());
    },
  };

  countryStatus: CountryStatusRepo = {
    setFrozen: async (country, frozenAt) => {
      await this.ready();
      if (frozenAt === null) await this.frozenT.delete(country);
      else await this.frozenT.set(country, { country, frozenAt });
    },
    isFrozen: async (country) => {
      await this.ready();
      return this.frozenT.get(country) !== undefined;
    },
    list: async () => {
      await this.ready();
      return clone(this.frozenT.values());
    },
  };
}
