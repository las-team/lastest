/**
 * `SimpleExtractor` — a REST-only `Extractor` (§2.2) used when the Bulk 2.0
 * extractor of `src/extract` is not wired (small orgs, dry runs, tests).
 * It implements the same contract: scope + country + delta predicate,
 * `queryAll` streaming with `IsDeleted` routing, JSON page files under
 * `{runDir}/{country}/{objectKey}/extract/`, checkpoints, FK id-set
 * collection, the REST `COUNT()` cross-check, the delete feed, partitions
 * (`load.partitionBy`) and `ORDER BY` for `load.orderBy`, plus the FK
 * closure by `Id IN (…)` (≤ 400 ids per call) to a fixpoint.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { buildCountryPredicate, countryOfSoqlPath } from "../country-of";
import { getLogger } from "../logger";
import { isQueueId, isSfdcId, isUserId, to18 } from "../transform/ids";
import { readSource } from "../transform/apply";
import type { MaterialisedMapping, ObjectKey, SourceRow, Unit } from "../types";
import type { ResolvedTarget } from "../preflight/types";
import type {
  ClosureRequest,
  ClosureResult,
  ExtractFile,
  ExtractManifest,
  ExtractPlan,
  Extractor,
  ExtractorDeps,
  FkIdSets,
} from "../extract/types";
import { referenceColumns } from "./context";

export const SYSTEM_COLUMNS = ["Id", "IsDeleted", "SystemModstamp"] as const;

function soqlDate(iso: string): string {
  return iso.replace(/\.\d{3}Z$/, "Z");
}

/** Country path of a parent mapping (for `parent:` rules of children). */
export function parentCountryPath(
  mapping: MaterialisedMapping | undefined,
): string | undefined {
  if (!mapping) return undefined;
  for (const s of mapping.countryOf) {
    const p = countryOfSoqlPath(s);
    if (p) return p;
  }
  return undefined;
}

export interface PredicateInput {
  mapping: MaterialisedMapping;
  unit: Unit;
  cutoffDate?: string;
  window?: { wmLo: string; wmHi: string };
  parentPaths?: Record<string, string>;
  partition?: "null" | "notNull";
}

/** §2.2 step 1 / §4.1 predicate (no `IsDeleted` term). */
export function buildPredicate(input: PredicateInput): string {
  const { mapping, unit } = input;
  const terms: string[] = [];
  const scope = mapping.scope.spec;
  const cutoff = mapping.scope.cutoffDate ?? input.cutoffDate;
  if (cutoff && scope.kind === "dated") {
    const parts = scope.predicates.map(
      (p) =>
        `${p.field} >= ${p.type === "datetime" ? `${cutoff}T00:00:00Z` : cutoff}`,
    );
    if (scope.openPredicate) parts.push(`(${scope.openPredicate})`);
    terms.push(parts.length > 1 ? `(${parts.join(" OR ")})` : parts[0]);
  } else if (cutoff && scope.kind === "via-parent") {
    terms.push(
      `${scope.parentField} >= ${scope.type === "datetime" ? `${cutoff}T00:00:00Z` : cutoff}`,
    );
  }
  if (unit.country !== "GLOBAL") {
    const c = buildCountryPredicate(
      mapping.countryOf,
      unit.country,
      {},
      input.parentPaths ?? {},
    );
    if (c) terms.push(`(${c})`);
  }
  if (input.window)
    terms.push(
      `SystemModstamp >= ${soqlDate(input.window.wmLo)} AND SystemModstamp < ${soqlDate(input.window.wmHi)}`,
    );
  const part = mapping.load.partitionBy;
  if (part && input.partition)
    terms.push(
      `${part.field} ${input.partition === "null" ? "= null" : "!= null"}`,
    );
  return terms.join(" AND ");
}

export function columnsFor(
  target: ResolvedTarget,
  mapping: MaterialisedMapping,
): string[] {
  const set = new Set<string>(SYSTEM_COLUMNS);
  for (const c of target.columns) set.add(c);
  if (!target.columns.length)
    for (const f of mapping.fields)
      if (f.source && f.transform.kind !== "skip") set.add(f.source);
  return [...set];
}

export interface SimpleExtractorOptions {
  /** Rows per page file (default 2000). */
  pageRows?: number;
  /** Mappings/targets of other objects, for parent country paths. */
  mappings?: Map<ObjectKey, MaterialisedMapping>;
}

export class SimpleExtractor implements Extractor {
  private jobCounter = 0;
  constructor(
    private readonly deps: ExtractorDeps,
    private readonly opts: SimpleExtractorOptions = {},
  ) {}

  private extractDir(runDir: string, unit: Unit): string {
    return path.join(runDir, unit.country, unit.objectKey, "extract");
  }

  private collectFks(
    row: SourceRow,
    mapping: MaterialisedMapping,
    fkSets: FkIdSets,
    queueOwners: Set<string>,
  ): void {
    for (const c of referenceColumns(mapping)) {
      const v = readSource(row, c.source);
      if (!isSfdcId(v)) continue;
      if (c.key === "user") {
        if (isQueueId(v)) queueOwners.add(to18(v));
        else if (isUserId(v))
          (
            fkSets.get("user") ?? fkSets.set("user", new Set()).get("user")!
          ).add(to18(v));
        continue;
      }
      (fkSets.get(c.key) ?? fkSets.set(c.key, new Set()).get(c.key)!).add(
        to18(v),
      );
    }
  }

  async extractUnit(unit: Unit, plan: ExtractPlan): Promise<ExtractManifest> {
    const log = getLogger("Extract", {
      run_id: plan.runId,
      object_key: unit.objectKey,
      country: unit.country,
    });
    const { mapping, target } = plan;
    const dir = this.extractDir(plan.runDir, unit);
    await fs.mkdir(dir, { recursive: true });
    const columns = columnsFor(target, mapping);
    const parentPaths: Record<string, string> = {};
    for (const s of mapping.countryOf)
      if (s.kind === "parent") {
        const p = parentCountryPath(this.opts.mappings?.get(s.key));
        if (p) parentPaths[s.key] = p;
      }
    const partitions: Array<"null" | "notNull" | undefined> = mapping.load
      .partitionBy
      ? (mapping.load.partitionBy.order ?? ["null", "notNull"])
      : [undefined];
    const manifest: ExtractManifest = {
      unit,
      files: [],
      fkSets: new Map(),
      extractedLive: 0,
      extractedDeleted: 0,
      closureRows: 0,
      deletedIds: [],
      predicate: "",
      columns,
      queueOwners: new Set(),
    };
    const pageRows = this.opts.pageRows ?? 2000;
    const jobId = `rest-${++this.jobCounter}`;
    let pageNo = 0;
    for (let pi = 0; pi < partitions.length; pi++) {
      const predicate = buildPredicate({
        mapping,
        unit,
        cutoffDate: plan.cutoffDate,
        window: plan.window,
        parentPaths,
        partition: partitions[pi],
      });
      if (pi === 0) manifest.predicate = predicate;
      const order = mapping.load.orderBy?.length
        ? ` ORDER BY ${mapping.load.orderBy.join(", ")}`
        : "";
      const limit = plan.limit ? ` LIMIT ${plan.limit}` : "";
      const soql = `SELECT ${columns.join(", ")} FROM ${mapping.sourceObject}${predicate ? ` WHERE ${predicate}` : ""}${order}${limit}`;
      log.info({ soql, partition: partitions[pi] }, "extracting (REST)");
      let buf: SourceRow[] = [];
      const flush = async () => {
        if (!buf.length) return;
        const file = path.join(
          dir,
          `${jobId}-page${pageNo}${pi ? `-p${pi}` : ""}.json`,
        );
        await fs.writeFile(file, JSON.stringify(buf), "utf8");
        const ef: ExtractFile = {
          path: file,
          jobId,
          pageNo,
          rows: buf.length,
          closure: false,
          partition: mapping.load.partitionBy ? pi : undefined,
        };
        manifest.files.push(ef);
        await this.deps.store.checkpoints.add({
          runId: plan.runId,
          objectKey: unit.objectKey,
          country: unit.country,
          jobId,
          locator: null,
          pageNo,
          rows: buf.length,
          file,
        });
        pageNo++;
        buf = [];
      };
      for await (const raw of this.deps.sfdc.query(soql, { all: true })) {
        const row: SourceRow = { ...raw, Id: to18(raw.Id) };
        const deleted = row.IsDeleted === true || row.IsDeleted === "true";
        if (deleted) {
          manifest.extractedDeleted++;
          manifest.deletedIds.push({
            id: row.Id,
            deletedDate:
              typeof row.SystemModstamp === "string"
                ? row.SystemModstamp
                : (plan.window?.wmHi ?? new Date().toISOString()),
          });
          continue;
        }
        manifest.extractedLive++;
        this.collectFks(row, mapping, manifest.fkSets, manifest.queueOwners);
        buf.push(row);
        if (buf.length >= pageRows) await flush();
      }
      await flush();
      if (!plan.limit) {
        try {
          const n = await this.deps.sfdc.count(
            mapping.sourceObject,
            predicate || undefined,
          );
          manifest.sfdcScopeCount = (manifest.sfdcScopeCount ?? 0) + n;
        } catch (e) {
          log.warn({ err: e }, "COUNT() cross-check failed");
        }
      }
    }
    if (plan.deletedSince && target.replicateable && plan.window) {
      try {
        const feed = await this.deps.sfdc.getDeleted(
          mapping.sourceObject,
          plan.deletedSince,
          plan.window.wmHi,
        );
        for (const d of feed.deletedRecords)
          manifest.deletedIds.push({
            id: to18(d.id),
            deletedDate: d.deletedDate,
          });
        manifest.deletedLatestCovered = feed.latestDateCovered;
      } catch (e) {
        log.warn({ err: e }, "delete feed unavailable");
      }
    }
    log.info(
      {
        live: manifest.extractedLive,
        deleted: manifest.extractedDeleted,
        files: manifest.files.length,
        scope_count: manifest.sfdcScopeCount,
      },
      "extract done",
    );
    return manifest;
  }

  async closure(req: ClosureRequest): Promise<ClosureResult> {
    const log = getLogger("Closure", {
      run_id: req.runId,
      country: req.country,
    });
    const result: ClosureResult = {
      files: new Map(),
      rounds: 0,
      dangling: new Map(),
      fetched: new Map(),
    };
    let needed: FkIdSets = new Map(
      [...req.needed].map(([k, v]) => [k, new Set(v)]),
    );
    const known = new Map<ObjectKey | "user", Set<string>>();
    for (
      let round = 0;
      round < req.maxRounds && [...needed.values()].some((s) => s.size);
      round++
    ) {
      result.rounds = round + 1;
      const next: FkIdSets = new Map();
      for (const [key, ids] of needed) {
        if (key === "user" || !ids.size) continue;
        const mapping = req.mappings.get(key);
        const target = req.targets.get(key);
        if (!mapping || !target) {
          for (const id of ids)
            (
              result.dangling.get(key) ??
              result.dangling.set(key, new Set()).get(key)!
            ).add(id);
          continue;
        }
        const seen = known.get(key) ?? known.set(key, new Set()).get(key)!;
        const list = [...ids].filter((id) => !seen.has(id));
        for (const id of list) seen.add(id);
        if (!list.length) continue;
        // subtract the id map (§2.2 step 5)
        const remaining: string[] = [];
        for (let i = 0; i < list.length; i += 500) {
          const chunk = list.slice(i, i + 500);
          const got = await this.deps.store.idMap.bulkGet(key, chunk);
          for (const id of chunk)
            if (!got.has(id) || got.get(id)!.dryRun) remaining.push(id);
        }
        if (!remaining.length) continue;
        const unit: Unit = { objectKey: key, country: req.country };
        const dir = this.extractDir(req.runDir, unit);
        await fs.mkdir(dir, { recursive: true });
        const columns = columnsFor(target, mapping);
        const rows: SourceRow[] = [];
        const returned = new Set<string>();
        for (let i = 0; i < remaining.length; i += 400) {
          for await (const raw of this.deps.sfdc.queryIds(
            mapping.sourceObject,
            remaining.slice(i, i + 400),
            columns,
          )) {
            const row: SourceRow = { ...raw, Id: to18(raw.Id) };
            returned.add(row.Id);
            if (row.IsDeleted === true || row.IsDeleted === "true") continue;
            rows.push(row);
            this.collectFks(row, mapping, next, new Set());
          }
        }
        for (const id of remaining)
          if (!returned.has(id))
            (
              result.dangling.get(key) ??
              result.dangling.set(key, new Set()).get(key)!
            ).add(id);
        if (rows.length) {
          const file = path.join(
            dir,
            `closure-r${round}-${Date.now().toString(36)}.json`,
          );
          await fs.writeFile(file, JSON.stringify(rows), "utf8");
          const ef: ExtractFile = {
            path: file,
            jobId: `closure-${round}`,
            pageNo: round,
            rows: rows.length,
            closure: true,
          };
          (result.files.get(key) ?? result.files.set(key, []).get(key)!).push(
            ef,
          );
          result.fetched.set(key, (result.fetched.get(key) ?? 0) + rows.length);
        }
      }
      needed = next;
    }
    if ([...needed.values()].some((s) => s.size))
      log.warn(
        { rounds: result.rounds },
        "closure did not converge within maxRounds",
      );
    return result;
  }

  async *readRows(
    files: readonly ExtractFile[],
  ): AsyncIterable<{ row: SourceRow; file: ExtractFile }> {
    for (const file of files) {
      const rows = JSON.parse(
        await fs.readFile(file.path, "utf8"),
      ) as SourceRow[];
      for (const row of rows) yield { row, file };
    }
  }
}
