/**
 * `Extractor` implementation (§2.2 steps 1–4, 8, 9; §4).
 *
 * Per unit:
 *  1. scope predicate (§6.2) ∧ country predicate (§6.0.5) ∧ delta window
 *     (§4.1) — **no `IsDeleted` term**: the main pass runs as `queryAll` and
 *     rows are routed on `IsDeleted` (`false` → extract files, `true` →
 *     delete queue);
 *  2. column list (§2.2 step 2);
 *  3. `COUNT()` first (REST, `query` semantics), then REST for ≤ 2 000
 *     expected rows (or `--limit`), Bulk 2.0 `queryAll` otherwise
 *     (PK chunking when the plan asks, when the scoped count exceeds
 *     `pkChunkRowThreshold`, always on `init` for the §2.1.5 large objects,
 *     and after a count mismatch);
 *  4. pages streamed to `{runDir}/{country}/{objectKey}/extract/*.csv`, one
 *     checkpoint per page (`extract_checkpoints`), FK id-sets collected per
 *     reference column keyed by target object key (`OwnerId` keeps `005`,
 *     records `00G` as queue owners);
 *  5. count reconciliation vs `COUNT()` (also for pages reused from a
 *     resumed job): mismatch → warning + automatic re-run with PK chunking;
 *     second mismatch → blocking;
 *  6. delete sources for delta modes (`getDeleted` feed when replicateable,
 *     key-set reconciliation otherwise) and the `getUpdated` cross-check —
 *     rows re-queried by id join the page set *before* ordering;
 *  7. partitions (`load.partitionBy`, two sequential jobs), external sort
 *     (`load.orderBy`), depth ordering (`load.depthOrderBy`).
 *
 * Memory: FK id-sets are held per unit as the spec requires; the per-id
 * `SystemModstamp` map and the de-duplication set are kept only for delta
 * modes (small windows) — an `init` extract of a multi-million-row object
 * streams pages to disk without a per-row in-memory index.
 */
import path from "node:path";
import { getLogger } from "../logger";
import { getModule } from "../objects/registry";
import { andPredicates, buildSelect, inClauses } from "../sfdc/soql";
import { isQueueId, to18 } from "../transform/ids";
import type {
  CountryOfSpec,
  Finding,
  ObjectKey,
  SourceRow,
  Unit,
} from "../types";
import { unitId } from "../types";
import { buildColumnList, type FkColumn } from "./columns";
import { runClosure, collectRowFks, type ClosureOptions } from "./closure";
import {
  attributeCountry,
  buildCountryStrategy,
  countryColumns,
  parentFieldFromMapping,
  type CountryStrategy,
  type CountryStrategyOptions,
} from "./country";
import {
  checkDeleteWindow,
  crossCheckUpdated,
  fetchDeletedFeed,
  keySetReconcile,
  windowPredicate,
  type DeletedRow,
} from "./delta";
import {
  deletedDir,
  depthDir,
  extractDir,
  fileExists,
  pageFileName,
  readCsvFile,
  removeDir,
  sortedDir,
  writeCsvFile,
} from "./files";
import {
  depthPartitionFiles,
  externalSort,
  partitionPredicates,
} from "./order";
import { buildScopePredicate, type ScopeBuild } from "./scope";
import type {
  ClosureRequest,
  ClosureResult,
  ExtractFile,
  ExtractManifest,
  ExtractPlan,
  Extractor,
  ExtractorDeps,
  FkIdSets,
} from "./types";

/** §2.1.5 selection rule: Bulk 2.0 above this many expected rows. */
export const REST_THRESHOLD = 2000;

/** §2.1.5: PK chunking whenever the object exceeds ~1M rows. */
export const PK_CHUNK_ROW_THRESHOLD = 1_000_000;

/**
 * §2.1.5: source objects always PK-chunked on `init` (`Call2_vod__c` and its
 * children, samples, emails, multichannel activity, accounts, addresses) —
 * the documented missing-rows behaviour on large unchunked jobs.
 */
export const PK_CHUNK_INIT_SOURCES: ReadonlySet<string> = new Set([
  "Call2_vod__c",
  "Call2_Detail_vod__c",
  "Call2_Discussion_vod__c",
  "Call2_Key_Message_vod__c",
  "Call2_Sample_vod__c",
  "Sample_Transaction_vod__c",
  "Sent_Email_vod__c",
  "Multichannel_Activity_vod__c",
  "Account",
  "Address_vod__c",
]);

export interface ExtractorOptions extends CountryStrategyOptions {
  /** Expected rows at/below which REST is used (default 2 000). */
  restThreshold?: number;
  /** Rows per REST page file (default 2 000). */
  restPageRows?: number;
  /** Bulk `maxRecords` per results page (default: server default). */
  bulkMaxRecords?: number;
  /** Parent id-set size at/below which `field IN (…)` REST chunks are used instead of a client filter (default 2 000). */
  idSetRestMax?: number;
  /** Scoped `COUNT()` above which a Bulk job is PK-chunked on the first pass (default 1 000 000, §2.1.5). */
  pkChunkRowThreshold?: number;
  /** Source objects always PK-chunked on `init` (default `PK_CHUNK_INIT_SOURCES`). */
  pkChunkInitSources?: Iterable<string>;
  /** `performance.sortChunkRows` (default 500 000). */
  sortChunkRows?: number;
  /** Depth-ordering round cap (default 20). */
  maxDepth?: number;
  /** Open-item term of a parent object (default: the registry module's `scope.openPredicate`); `null` disables. */
  parentOpenPredicate?: (key: ObjectKey) => string | undefined;
  /** Include the parent's open-item term in `via-parent` scopes (default true, §1.1 #4). */
  includeParentOpenPredicate?: boolean;
  /** Ids of parent rows extracted in this run for the id-set country strategy (unioned with the id map). */
  parentIds?: (
    parentKey: ObjectKey,
    country: string,
  ) => Promise<Iterable<string>>;
  closure?: ClosureOptions;
  /** Clock for `deletedDate` defaults when a `queryAll` row has no `SystemModstamp`. */
  now?: () => Date;
}

/** Manifest with the extra facts the run engine and reconciler consume. */
export interface SfdcExtractManifest extends ExtractManifest {
  deletedIds: DeletedRow[];
  findings: Finding[];
  strategy: "rest" | "bulk" | "empty";
  countryStrategy: CountryStrategy["kind"];
  /** Rows dropped by the client-side country filter (id-set strategy). */
  filteredOut: number;
  /**
   * `SystemModstamp` per live id streamed (last-wins delete routing, §4.3
   * step 5). Populated for delta modes only (`delta`, `final-delta`, or a
   * plan with `deletedSince`) — on `init` there is no delete to supersede
   * and the map would hold one entry per row of the whole object.
   */
  liveModstamps: Map<string, string>;
  /** Rows in a depth cycle: their parent field must be deferred to pass 2. */
  deferredParentIds: Set<string>;
  cutoffDate?: string;
  partitions: number;
  scopePredicate?: string;
  countryPredicate?: string;
}

interface PartitionCounters {
  /** Live rows delivered by the source (before the client filter) — compared with `COUNT()`. */
  streamedLive: number;
  /** Rows (live + deleted) dropped by the client-side country filter. */
  filteredOut: number;
  /** Live rows dropped by the client-side country filter (netted from `sfdcScopeCount`). */
  filteredOutLive: number;
}

function newCounters(): PartitionCounters {
  return { streamedLive: 0, filteredOut: 0, filteredOutLive: 0 };
}

function isDeletedRow(row: SourceRow): boolean {
  return row.IsDeleted === true || row.IsDeleted === "true";
}

function registryOpenPredicate(key: ObjectKey): string | undefined {
  try {
    const s = getModule(key).scope;
    return s.kind === "dated" ? s.openPredicate : undefined;
  } catch {
    return undefined;
  }
}

export class SfdcExtractor implements Extractor {
  private readonly opts: ExtractorOptions;
  constructor(
    private readonly deps: ExtractorDeps,
    opts: ExtractorOptions = {},
  ) {
    this.opts = opts;
  }

  async extractUnit(
    unit: Unit,
    plan: ExtractPlan,
  ): Promise<SfdcExtractManifest> {
    const log = getLogger("Extract", {
      run_id: plan.runId,
      object_key: unit.objectKey,
      country: unit.country,
    });
    const { mapping, target } = plan;
    const source = mapping.sourceObject;
    const now = () => this.opts.now?.() ?? new Date();
    const findings: Finding[] = [];

    // 1. predicates
    const parentOpen =
      this.opts.includeParentOpenPredicate === false
        ? undefined
        : mapping.scope.spec.kind === "via-parent"
          ? (this.opts.parentOpenPredicate ?? registryOpenPredicate)(
              mapping.scope.spec.parentKey,
            )
          : undefined;
    const scope: ScopeBuild = buildScopePredicate(mapping.scope, {
      cutoffDate: plan.cutoffDate,
      now: now(),
      parentOpenPredicate: parentOpen,
    });
    const countryOpts: CountryStrategyOptions = {
      ...this.opts,
      parentFieldFor:
        this.opts.parentFieldFor ?? parentFieldFromMapping(mapping),
    };
    const strategy = buildCountryStrategy(
      mapping.countryOf,
      unit.country,
      countryOpts,
    );
    const window = plan.window ? windowPredicate(plan.window) : undefined;
    const columnList = buildColumnList(mapping, target, {
      countryPaths: countryColumns(strategy),
    });
    const { columns, fkColumns } = columnList;

    const manifest: SfdcExtractManifest = {
      unit,
      files: [],
      fkSets: new Map(),
      extractedLive: 0,
      extractedDeleted: 0,
      closureRows: 0,
      sfdcScopeCount: undefined,
      deletedIds: [],
      deletedLatestCovered: undefined,
      predicate: "",
      columns,
      queueOwners: new Set(),
      findings,
      strategy: "empty",
      countryStrategy: strategy.kind,
      filteredOut: 0,
      liveModstamps: new Map(),
      deferredParentIds: new Set(),
      cutoffDate: scope.cutoffDate,
      partitions: 0,
      scopePredicate: scope.predicate,
      countryPredicate: undefined,
    };

    if (strategy.kind === "none") {
      findings.push({
        severity: "info",
        code: "EXTRACT_COUNTRY_EMPTY",
        objectKey: unit.objectKey,
        country: unit.country,
        detail: `countryOf assigns every row to another country; unit ${unitId(unit)} has no rows`,
      });
      return manifest;
    }

    // country: predicate, or parent id-set (REST IN chunks / client filter)
    let countryPredicate: string | undefined;
    let clientFilter: ((row: SourceRow) => boolean) | undefined;
    let idSetChunks: string[] | undefined;
    if (strategy.kind === "predicate" || strategy.kind === "all")
      countryPredicate = strategy.predicate;
    else if (strategy.kind === "idSet") {
      const parentSet = new Set<string>();
      for await (const m of this.deps.store.idMap.iterate(
        strategy.parentKey,
        unit.country,
      ))
        if (!m.deletedAt) parentSet.add(m.sfdcId);
      if (this.opts.parentIds)
        for (const id of await this.opts.parentIds(
          strategy.parentKey,
          unit.country,
        ))
          parentSet.add(to18(id));
      if (!parentSet.size) {
        findings.push({
          severity: "info",
          code: "EXTRACT_COUNTRY_EMPTY",
          objectKey: unit.objectKey,
          country: unit.country,
          detail: `no ${strategy.parentKey} rows attributed to ${unit.country} (id map + this run); ${unitId(unit)} has no rows`,
        });
        return manifest;
      }
      const idSetRestMax = this.opts.idSetRestMax ?? 2000;
      if (!strategy.partialPredicate && parentSet.size <= idSetRestMax) {
        idSetChunks = inClauses(strategy.field, [...parentSet]);
      } else {
        const specs: readonly CountryOfSpec[] = mapping.countryOf;
        const parentCountry = (k: ObjectKey, id: string) =>
          k === strategy.parentKey && parentSet.has(id)
            ? unit.country
            : undefined;
        clientFilter = (row) =>
          attributeCountry(row, specs, { ...countryOpts, parentCountry }) ===
          unit.country;
      }
      log.info(
        {
          parent: strategy.parentKey,
          ids: parentSet.size,
          mode: idSetChunks ? "in" : "filter",
        },
        "country by parent id-set",
      );
    }
    manifest.countryPredicate = countryPredicate ?? idSetChunks?.join(" OR ");

    const basePredicate = andPredicates(
      scope.predicate,
      countryPredicate,
      window,
    );
    const partitions = partitionPredicates(mapping.load.partitionBy);
    manifest.partitions = partitions.length || 1;
    manifest.predicate = basePredicate ?? "";

    // 2. streaming state
    const deltaMode = plan.mode === "delta" || plan.mode === "final-delta";
    // per-id bookkeeping (de-duplication set + modstamp map) is bounded by
    // the delta window; on `init` it would index the whole object in memory
    const trackLive = deltaMode || Boolean(plan.deletedSince);
    const liveSeen = new Set<string>();
    const counters = new Map<number, PartitionCounters>();
    let limitReached = false;
    let usedBulk = false;
    let usedRest = false;
    let restOrdered = false;
    let recheckRows = 0;

    const routeRows = async (
      rows: SourceRow[],
      partition: number | undefined,
      jobId: string,
      pageNo: number,
      nextLocator: string | null,
      persist: boolean,
    ) => {
      const pc = counters.get(partition ?? 0) ?? newCounters();
      counters.set(partition ?? 0, pc);
      const live: SourceRow[] = [];
      const deleted: SourceRow[] = [];
      for (const row of rows) {
        if (plan.limit !== undefined && manifest.extractedLive >= plan.limit) {
          limitReached = true;
          break;
        }
        const id = to18(row.Id);
        row.Id = id;
        const isDel = isDeletedRow(row);
        if (!isDel) pc.streamedLive++;
        if (clientFilter && !clientFilter(row)) {
          manifest.filteredOut++;
          pc.filteredOut++;
          if (!isDel) pc.filteredOutLive++;
          continue;
        }
        if (isDel) {
          manifest.extractedDeleted++;
          const master = row.MasterRecordId;
          manifest.deletedIds.push({
            id,
            deletedDate:
              typeof row.SystemModstamp === "string" && row.SystemModstamp
                ? row.SystemModstamp
                : (plan.window?.wmHi ??
                  plan.deletedUntil ??
                  now().toISOString()),
            source: "queryAll",
            partition: partition ?? 0,
            ...(master ? { masterRecordId: to18(String(master)) } : {}),
          });
          deleted.push(row);
          continue;
        }
        if (trackLive) {
          if (liveSeen.has(id)) continue; // re-delivered in the window
          liveSeen.add(id);
          if (typeof row.SystemModstamp === "string")
            manifest.liveModstamps.set(id, row.SystemModstamp);
        }
        collectRowFks(row, fkColumns, manifest.fkSets, manifest.queueOwners);
        manifest.extractedLive++;
        live.push(row);
      }
      if (!persist) return;
      const dir = extractDir(
        plan.runDir,
        unit.country,
        unit.objectKey,
        partition,
      );
      const file = path.join(dir, pageFileName(jobId, pageNo));
      if (live.length) {
        await writeCsvFile(file, live, columns);
        manifest.files.push({
          path: file,
          jobId,
          pageNo,
          rows: live.length,
          closure: false,
          ...(partition !== undefined ? { partition } : {}),
        });
      }
      if (deleted.length)
        await writeCsvFile(
          path.join(
            deletedDir(plan.runDir, unit.country, unit.objectKey),
            pageFileName(jobId, pageNo),
          ),
          deleted,
          columns,
        );
      await this.deps.store.checkpoints.add({
        runId: plan.runId,
        objectKey: unit.objectKey,
        country: unit.country,
        jobId,
        locator: nextLocator,
        pageNo,
        rows: live.length,
        file,
      });
    };

    /** Replay pages already on disk (resume, §8.2) without re-writing them. */
    const replay = async (
      pages: Array<{
        file: string;
        jobId: string;
        pageNo: number;
        partition?: number;
      }>,
    ) => {
      for (const p of pages) {
        const dir = extractDir(
          plan.runDir,
          unit.country,
          unit.objectKey,
          p.partition,
        );
        const live: SourceRow[] = [];
        if (await fileExists(p.file))
          for await (const row of readCsvFile(p.file)) live.push(row);
        const delFile = path.join(
          deletedDir(plan.runDir, unit.country, unit.objectKey),
          pageFileName(p.jobId, p.pageNo),
        );
        const deleted: SourceRow[] = [];
        if (await fileExists(delFile))
          for await (const row of readCsvFile(delFile)) deleted.push(row);
        await routeRows(
          [...live, ...deleted],
          p.partition,
          p.jobId,
          p.pageNo,
          null,
          false,
        );
        if (live.length)
          manifest.files.push({
            path: path.join(dir, pageFileName(p.jobId, p.pageNo)),
            jobId: p.jobId,
            pageNo: p.pageNo,
            rows: live.length,
            closure: false,
            ...(p.partition !== undefined ? { partition: p.partition } : {}),
          });
      }
    };

    const extractPartition = async (
      predicates: Array<string | undefined>,
      partition: number | undefined,
      attempt: number,
    ): Promise<void> => {
      const dir = extractDir(
        plan.runDir,
        unit.country,
        unit.objectKey,
        partition,
      );
      let count = 0;
      for (const p of predicates)
        count += await this.deps.sfdc.count(source, p);
      manifest.sfdcScopeCount = (manifest.sfdcScopeCount ?? 0) + count;
      const expected = plan.expectedRows ?? count;
      const useRest =
        plan.limit !== undefined ||
        idSetChunks !== undefined ||
        expected <= (this.opts.restThreshold ?? REST_THRESHOLD);
      const pkChunking =
        attempt > 0 ||
        plan.pkChunking === true ||
        count > (this.opts.pkChunkRowThreshold ?? PK_CHUNK_ROW_THRESHOLD) ||
        (plan.mode === "init" &&
          new Set(this.opts.pkChunkInitSources ?? PK_CHUNK_INIT_SOURCES).has(
            source,
          ));
      let pageNo = 0;

      if (useRest) {
        usedRest = true;
        // SOQL ORDER BY only yields a globally ordered stream for a single
        // query; id-set IN chunks are each ordered on their own, so the
        // external sort must still run over the concatenated pages
        const orderBy =
          mapping.load.orderBy &&
          partitions.length === 0 &&
          predicates.length === 1
            ? mapping.load.orderBy
            : undefined;
        if (orderBy) restOrdered = true;
        const jobId = `rest-${unit.objectKey}-${unit.country}-p${partition ?? 0}-a${attempt}`;
        const pageRows = this.opts.restPageRows ?? REST_THRESHOLD;
        for (const p of predicates) {
          const soql = buildSelect({
            object: source,
            columns,
            where: p,
            orderBy,
            limit: plan.limit,
          });
          log.info({ soql, partition, attempt }, "REST extract");
          let buf: SourceRow[] = [];
          for await (const row of this.deps.sfdc.query(soql, {
            all: true,
            batchSize: 2000,
          })) {
            buf.push(row);
            if (buf.length >= pageRows) {
              await routeRows(buf, partition, jobId, pageNo++, null, true);
              buf = [];
              if (limitReached) break;
            }
          }
          if (buf.length || pageNo === 0)
            await routeRows(buf, partition, jobId, pageNo++, null, true);
          if (limitReached) break;
        }
      } else {
        usedBulk = true;
        // resume from checkpoints of a previous attempt of this run (§8.2):
        // only a job whose page files are still on disk qualifies (a
        // count-mismatch re-run deletes the discarded attempt's pages)
        const cps = (
          await this.deps.store.checkpoints.list(
            plan.runId,
            unit.objectKey,
            unit.country,
          )
        ).filter(
          (c) => path.dirname(c.file) === dir && !c.jobId.startsWith("rest-"),
        );
        let resume:
          | { jobId: string; locator: string | null; pageNo: number }
          | undefined;
        let reused = false;
        if (cps.length && attempt === 0) {
          const byJob = new Map<string, typeof cps>();
          for (const c of cps) {
            if (!(await fileExists(c.file)) && c.rows > 0) continue;
            const list = byJob.get(c.jobId) ?? [];
            list.push(c);
            byJob.set(c.jobId, list);
          }
          const best = [...byJob.values()].sort(
            (a, b) => b.length - a.length,
          )[0];
          if (best?.length) {
            const last = best[best.length - 1];
            const complete =
              last.locator === null || last.locator === undefined;
            await replay(
              best.map((c) => ({
                file: c.file,
                jobId: c.jobId,
                pageNo: c.pageNo,
                partition,
              })),
            );
            pageNo = last.pageNo + 1;
            if (complete) {
              // the pages are reused, but the §2.2 step 8 count check below
              // still runs: a crashed-and-resumed run is exactly the one
              // most likely to have lost a page
              reused = true;
              log.info(
                { jobId: last.jobId, pages: best.length },
                "extract already complete on disk; reusing pages",
              );
            } else {
              resume = {
                jobId: last.jobId,
                locator: last.locator ?? null,
                pageNo,
              };
              log.info(resume, "resuming Bulk job from checkpoint");
            }
          }
        }
        if (!reused) {
          const soql = buildSelect({
            object: source,
            columns,
            where: predicates[0],
          });
          log.info(
            { soql, partition, attempt, pkChunking },
            "Bulk queryAll extract",
          );
          const result = this.deps.sfdc.bulkQuery(soql, {
            all: true,
            pkChunking,
            resume,
            maxRecords: this.opts.bulkMaxRecords,
          });
          for await (const page of result) {
            await routeRows(
              page.records,
              partition,
              page.jobId,
              page.pageNo,
              page.nextLocator,
              true,
            );
            if (limitReached) break;
          }
          await result.job;
        }
      }

      // 5. count reconciliation (§2.2 step 8, §2.8): the raw COUNT() is
      // compared with the rows the source delivered (before the client
      // filter); the reported scope count is then netted of the rows the
      // client-side country filter dropped so that it counts the same
      // population as `extractedLive` (§2.8 gate, tolerance 0)
      if (plan.limit !== undefined) return;
      const pc = counters.get(partition ?? 0) ?? newCounters();
      const streamed = pc.streamedLive;
      if (streamed === count) {
        manifest.sfdcScopeCount =
          (manifest.sfdcScopeCount ?? 0) - pc.filteredOutLive;
        return;
      }
      if (attempt === 0) {
        findings.push({
          severity: "warning",
          code: "EXTRACT_COUNT_MISMATCH",
          objectKey: unit.objectKey,
          country: unit.country,
          count: Math.abs(count - streamed),
          detail: `COUNT() = ${count} but ${streamed} live rows streamed${partition !== undefined ? ` (partition ${partition})` : ""}; re-running with PK chunking`,
        });
        // reset this partition and retry
        manifest.sfdcScopeCount = (manifest.sfdcScopeCount ?? 0) - count;
        manifest.filteredOut -= pc.filteredOut;
        await this.resetPartition(
          manifest,
          partition,
          dir,
          liveSeen,
          fkColumns,
          trackLive,
        );
        counters.set(partition ?? 0, newCounters());
        await removeDir(dir);
        await extractPartition(predicates, partition, 1);
        return;
      }
      manifest.sfdcScopeCount =
        (manifest.sfdcScopeCount ?? 0) - pc.filteredOutLive;
      findings.push({
        severity: "blocking",
        code: "EXTRACT_COUNT_MISMATCH",
        objectKey: unit.objectKey,
        country: unit.country,
        count: Math.abs(count - streamed),
        detail: `COUNT() = ${count} but ${streamed} live rows streamed after the PK-chunked re-run`,
      });
    };

    // 3./4. stream each partition sequentially (§2.2 step 9)
    const predicateSets: Array<Array<string | undefined>> = (
      partitions.length ? partitions : [undefined]
    ).map((pp) =>
      idSetChunks
        ? idSetChunks.map((chunk) => andPredicates(basePredicate, pp, chunk))
        : [andPredicates(basePredicate, pp)],
    );
    for (let i = 0; i < predicateSets.length; i++) {
      await extractPartition(
        predicateSets[i],
        partitions.length ? i : undefined,
        0,
      );
      if (limitReached) break;
    }
    manifest.strategy = usedBulk ? "bulk" : usedRest ? "rest" : "empty";

    // 6. delete sources (§4.4) + update feed cross-check (§4.1) — before the
    // ordering step so rows re-queried by id take part in the sort / depth
    // partitioning instead of being appended after it
    if (trackLive) {
      const wmHi =
        plan.window?.wmHi ?? plan.deletedUntil ?? now().toISOString();
      if (target.replicateable) {
        const start = plan.deletedSince ?? plan.window?.wmLo;
        findings.push(...checkDeleteWindow(start, wmHi, plan.mode, unit));
        if (
          start &&
          !findings.some(
            (f) =>
              f.code === "DELETE_WINDOW_EXCEEDED" && f.severity === "blocking",
          )
        ) {
          const feed = await fetchDeletedFeed(
            this.deps.sfdc,
            source,
            start,
            wmHi,
          );
          manifest.deletedIds.push(...feed.rows);
          manifest.deletedLatestCovered = feed.latestDateCovered;
        }
        if (plan.window) {
          const exact =
            mapping.scope.spec.kind === "full" && strategy.kind === "global";
          const seen = new Set<string>([
            ...liveSeen,
            ...manifest.deletedIds.map((d) => d.id),
          ]);
          const check = await crossCheckUpdated(
            this.deps.sfdc,
            source,
            plan.window,
            seen,
            unit,
            exact,
          );
          findings.push(...check.findings);
          if (exact && check.missing.length) {
            const rows: SourceRow[] = [];
            for await (const row of this.deps.sfdc.queryIds(
              source,
              check.missing,
              columns,
            ))
              rows.push(row);
            const before = manifest.extractedLive;
            await routeRows(rows, undefined, "updated-recheck", 0, null, true);
            recheckRows += manifest.extractedLive - before;
          }
        }
      } else {
        findings.push({
          severity: "info",
          code: "SF_NOT_REPLICATEABLE",
          objectKey: unit.objectKey,
          country: unit.country,
          detail: `${source} is not replicateable: /deleted/ and /updated/ skipped; key-set reconciliation used instead`,
        });
        const gone = await keySetReconcile(
          this.deps.sfdc,
          this.deps.store,
          unit,
          source,
          wmHi,
          countryPredicate,
        );
        manifest.deletedIds.push(...gone);
      }
    }

    // 7. client-side ordering (§2.2 step 9); an ordered REST stream stays
    // as-is unless re-checked rows were added out of order
    const sortedAtSource = restOrdered && !usedBulk && recheckRows === 0;
    if (mapping.load.orderBy?.length && !sortedAtSource) {
      const out = sortedDir(plan.runDir, unit.country, unit.objectKey);
      await removeDir(out);
      manifest.files = await externalSort(
        manifest.files,
        mapping.load.orderBy,
        columns,
        out,
        {
          chunkRows: this.opts.sortChunkRows,
          jobId: "sorted",
        },
      );
    }
    const depthField = mapping.load.depthOrderBy;
    const depthEnabled =
      depthField &&
      (unit.objectKey !== "account" || mapping.options.depthOrder === true);
    if (depthEnabled && manifest.files.length) {
      const out = depthDir(plan.runDir, unit.country, unit.objectKey);
      await removeDir(out);
      const r = await depthPartitionFiles(
        manifest.files,
        depthField,
        columns,
        out,
        {
          objectKey: unit.objectKey,
          country: unit.country,
          maxDepth: this.opts.maxDepth,
        },
      );
      manifest.files = r.files;
      manifest.deferredParentIds = r.unresolved;
      findings.push(...r.findings);
    }

    log.info(
      {
        strategy: manifest.strategy,
        live: manifest.extractedLive,
        deleted: manifest.extractedDeleted,
        scope_count: manifest.sfdcScopeCount,
        files: manifest.files.length,
        fk_objects: manifest.fkSets.size,
        queue_owners: manifest.queueOwners.size,
      },
      "unit extracted",
    );
    return manifest;
  }

  private async resetPartition(
    manifest: SfdcExtractManifest,
    partition: number | undefined,
    dir: string,
    liveSeen: Set<string>,
    fkColumns: readonly FkColumn[],
    trackLive: boolean,
  ): Promise<void> {
    // drop this partition's files, deleted rows and FK contributions, then
    // rebuild the live bookkeeping from the pages of the other partitions
    manifest.files = manifest.files.filter((f) => path.dirname(f.path) !== dir);
    manifest.deletedIds = manifest.deletedIds.filter(
      (d) => !(d.source === "queryAll" && d.partition === (partition ?? 0)),
    );
    manifest.extractedDeleted = manifest.deletedIds.filter(
      (d) => d.source === "queryAll",
    ).length;
    manifest.extractedLive = 0;
    manifest.fkSets = new Map();
    manifest.queueOwners = new Set();
    manifest.liveModstamps = new Map();
    liveSeen.clear();
    for (const f of manifest.files)
      for await (const row of readCsvFile(f.path)) {
        manifest.extractedLive++;
        collectRowFks(row, fkColumns, manifest.fkSets, manifest.queueOwners);
        if (!trackLive) continue;
        const id = to18(row.Id);
        liveSeen.add(id);
        if (typeof row.SystemModstamp === "string")
          manifest.liveModstamps.set(id, row.SystemModstamp);
      }
  }

  async closure(req: ClosureRequest): Promise<ClosureResult> {
    return runClosure(this.deps, req, this.opts.closure);
  }

  async *readRows(
    files: readonly ExtractFile[],
  ): AsyncIterable<{ row: SourceRow; file: ExtractFile }> {
    for (const file of files)
      for await (const row of readCsvFile(file.path)) yield { row, file };
  }
}

export function createExtractor(
  deps: ExtractorDeps,
  opts?: ExtractorOptions,
): SfdcExtractor {
  return new SfdcExtractor(deps, opts);
}

/** Queue owners across manifests (report helper). */
export function mergeQueueOwners(
  manifests: Iterable<Pick<ExtractManifest, "queueOwners">>,
): Set<string> {
  const out = new Set<string>();
  for (const m of manifests)
    for (const q of m.queueOwners) if (isQueueId(q)) out.add(q);
  return out;
}

/** Union of FK sets (closure input across the units of a country). */
export function mergeFkSets(sets: Iterable<FkIdSets>): FkIdSets {
  const out: FkIdSets = new Map();
  for (const s of sets)
    for (const [k, ids] of s) {
      let t = out.get(k);
      if (!t) {
        t = new Set();
        out.set(k, t);
      }
      for (const id of ids) t.add(id);
    }
  return out;
}
