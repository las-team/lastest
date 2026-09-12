/**
 * Bulk API 2.0 query jobs (§2.1.5): create (`query` | `queryAll`, CSV,
 * COMMA, LF, optional `Sforce-Enable-PKChunking`), poll with backoff
 * (1 s → 30 s cap, no timeout below 6 h), page results with
 * `Sforce-Locator` / `maxRecords`, abort + delete, list for cleanup.
 *
 * `maxRecords` is **always** sent (default `DEFAULT_BULK_MAX_RECORDS`,
 * 100 000 — the PK chunk size) so a results page is bounded regardless of
 * what the server would otherwise choose: an unbounded page of a
 * multi-million-row `queryAll` would be buffered whole, and a download that
 * outlives the 10-min request timeout would be retried from scratch up to
 * 8 times against the 150M/day allocation (§2.1.5, §2.1.7).
 *
 * Every page is a full CSV with a header row and is parsed with the
 * RFC-4180 parser (`csv.ts`) **lazily** — `page.records` parses `page.csv`
 * on first access and memoises, so a consumer that only streams the CSV to
 * disk (§2.1.4 / §2.2 step 3) never pays for the object array;
 * `(jobId, locator, pageNo)` is the resumable checkpoint (§2.2 step 3, §8.2). Concurrent jobs are capped by
 * `performance.sfdcBulkConcurrency` — the semaphore slot is held from job
 * creation until the last page has been yielded (or the iterator is closed).
 */
import { getLogger } from "../logger";
import { to18 } from "../transform/ids";
import type { SourceRow } from "../types";
import { parseCsvRows } from "./csv";
import { SfdcApiError, toSfdcError } from "./errors";
import { Semaphore } from "./limits";
import type { SfdcTransport } from "./rest";
import { defaultSleep, type RandomFn, type SleepFn } from "./retry";
import { objectOfSoql } from "./soql";
import type {
  SfdcBulkJobInfo,
  SfdcBulkPage,
  SfdcBulkQueryOptions,
  SfdcBulkResult,
} from "./types";

export interface SfdcBulkOptions {
  /** `performance.sfdcBulkConcurrency` (default 4, max 25). */
  concurrency?: number;
  /** Poll interval start / cap (ms), defaults 1 000 / 30 000. */
  pollBaseMs?: number;
  pollCapMs?: number;
  /** Give up polling after this long (ms), default 6 h (§2.1.5). */
  pollTimeoutMs?: number;
  /** Default `maxRecords` per results page (default `DEFAULT_BULK_MAX_RECORDS`; must be a positive integer). */
  maxRecords?: number;
  /** Default PK chunk size when `pkChunking: true` (1 000–250 000; default 100 000). */
  pkChunkSize?: number;
  sleep?: SleepFn;
  random?: RandomFn;
  now?: () => number;
}

export interface BulkJobListEntry {
  id: string;
  operation: string;
  object: string;
  state: string;
  createdDate?: string;
  systemModstamp?: string;
}

const TERMINAL = new Set(["JobComplete", "Failed", "Aborted"]);

/**
 * `maxRecords` sent with every results request when neither the query
 * options nor `SfdcBulkOptions.maxRecords` override it (§2.1.5). Matches
 * the default PK chunk size so one page ≈ one internal chunk.
 */
export const DEFAULT_BULK_MAX_RECORDS = 100_000;

function assertMaxRecords(n: number, where: string): number {
  if (!Number.isInteger(n) || n < 1)
    throw new RangeError(
      `${where} must be a positive integer (records per results page), got ${n}`,
    );
  return n;
}

/** Render the `Sforce-Enable-PKChunking` header value (§2.1.5). */
export function pkChunkingHeader(
  pk: SfdcBulkQueryOptions["pkChunking"],
  defaultChunkSize = 100_000,
): string | undefined {
  if (!pk) return undefined;
  const o = pk === true ? {} : pk;
  const size = o.chunkSize ?? defaultChunkSize;
  if (!Number.isInteger(size) || size < 1_000 || size > 250_000)
    throw new RangeError(
      `PK chunk size must be an integer in 1000..250000, got ${size}`,
    );
  const parts = [`chunkSize=${size}`];
  if (o.startRow) parts.push(`startRow=${o.startRow}`);
  if (o.parent) parts.push(`parent=${o.parent}`);
  return parts.join("; ");
}

/** Normalise the literal `"null"` locator header to `null`. */
export function parseLocator(header: string | null | undefined): string | null {
  if (header === null || header === undefined) return null;
  const v = header.trim();
  return v === "" || v.toLowerCase() === "null" ? null : v;
}

function jobInfo(body: Record<string, unknown>): SfdcBulkJobInfo {
  return {
    id: String(body.id),
    operation: body.operation === "queryAll" ? "queryAll" : "query",
    object: typeof body.object === "string" ? body.object : "",
    state: String(body.state) as SfdcBulkJobInfo["state"],
    createdDate:
      typeof body.createdDate === "string" ? body.createdDate : undefined,
    systemModstamp:
      typeof body.systemModstamp === "string" ? body.systemModstamp : undefined,
    numberRecordsProcessed:
      typeof body.numberRecordsProcessed === "number"
        ? body.numberRecordsProcessed
        : undefined,
    errorMessage:
      typeof body.errorMessage === "string" ? body.errorMessage : undefined,
  };
}

export class SfdcBulk {
  private readonly log = getLogger("Sfdc");
  private readonly sem: Semaphore;
  private readonly pollBaseMs: number;
  private readonly pollCapMs: number;
  private readonly pollTimeoutMs: number;
  private readonly defaultMaxRecords: number;
  private readonly pkChunkSize: number;
  private readonly sleep: SleepFn;
  private readonly random: RandomFn;
  private readonly now: () => number;

  constructor(
    readonly transport: SfdcTransport,
    opts: SfdcBulkOptions = {},
  ) {
    this.sem = new Semaphore(Math.min(25, opts.concurrency ?? 4));
    this.pollBaseMs = opts.pollBaseMs ?? 1_000;
    this.pollCapMs = opts.pollCapMs ?? 30_000;
    this.pollTimeoutMs = opts.pollTimeoutMs ?? 6 * 3_600_000;
    this.defaultMaxRecords = assertMaxRecords(
      opts.maxRecords ?? DEFAULT_BULK_MAX_RECORDS,
      "SfdcBulkOptions.maxRecords",
    );
    this.pkChunkSize = opts.pkChunkSize ?? 100_000;
    this.sleep = opts.sleep ?? defaultSleep;
    this.random = opts.random ?? Math.random;
    this.now = opts.now ?? (() => Date.now());
  }

  /** Jobs currently holding a concurrency slot. */
  get activeJobs(): number {
    return this.sem.inUse;
  }

  async createJob(
    soql: string,
    opts: SfdcBulkQueryOptions = {},
  ): Promise<SfdcBulkJobInfo> {
    const headers: Record<string, string> = {};
    const pk = pkChunkingHeader(opts.pkChunking, this.pkChunkSize);
    if (pk) headers["Sforce-Enable-PKChunking"] = pk;
    const res = await this.transport.request<Record<string, unknown>>({
      method: "POST",
      path: "/jobs/query",
      lane: "bulk",
      headers,
      body: {
        operation: opts.all ? "queryAll" : "query",
        query: soql,
        contentType: "CSV",
        columnDelimiter: "COMMA",
        lineEnding: "LF",
      },
    });
    const info = jobInfo(res.body);
    this.log.info(
      {
        jobId: info.id,
        object: info.object || objectOfSoql(soql),
        operation: info.operation,
        pkChunking: pk ?? false,
      },
      "Bulk query job created",
    );
    return info;
  }

  async getJob(jobId: string): Promise<SfdcBulkJobInfo> {
    const res = await this.transport.request<Record<string, unknown>>({
      method: "GET",
      path: `/jobs/query/${encodeURIComponent(jobId)}`,
      lane: "bulk",
    });
    return jobInfo(res.body);
  }

  /** Poll until terminal; rejects with a structural error on Failed/Aborted. */
  async waitForJob(
    jobId: string,
    signal?: AbortSignal,
  ): Promise<SfdcBulkJobInfo> {
    const started = this.now();
    let polls = 0;
    for (;;) {
      const info = await this.getJob(jobId);
      if (TERMINAL.has(info.state)) {
        if (info.state === "JobComplete") return info;
        throw new SfdcApiError(
          `Bulk query job ${jobId} ended in state ${info.state}${info.errorMessage ? `: ${info.errorMessage}` : " (Salesforce reports no error message for failed query jobs)"}`,
          {
            errorCode:
              info.state === "Aborted" ? "BULK_JOB_ABORTED" : "BULK_JOB_FAILED",
            errorClass: "structural",
          },
        );
      }
      if (signal?.aborted)
        throw new SfdcApiError(`Polling of job ${jobId} aborted`, {
          errorCode: "ABORTED",
          errorClass: "fatal",
        });
      if (this.now() - started > this.pollTimeoutMs)
        throw new SfdcApiError(
          `Bulk query job ${jobId} still ${info.state} after ${Math.round(this.pollTimeoutMs / 60000)} min`,
          {
            errorCode: "BULK_JOB_TIMEOUT",
            errorClass: "retryable",
          },
        );
      polls++;
      // 1 s → 30 s cap, exponential ceiling, jittered within [ceiling/2, ceiling].
      const ceiling = Math.min(
        this.pollCapMs,
        this.pollBaseMs * 2 ** (polls - 1),
      );
      const delay = Math.floor(ceiling / 2 + (this.random() * ceiling) / 2);
      this.log.debug(
        { jobId, state: info.state, polls, delayMs: delay },
        "Bulk job not ready",
      );
      await this.sleep(delay);
    }
  }

  /**
   * Fetch one results page. `maxRecords` is always sent (caller override →
   * `SfdcBulkOptions.maxRecords` → `DEFAULT_BULK_MAX_RECORDS`). The CSV
   * text is kept on the page; `records` is parsed on first access.
   */
  async fetchPage(
    jobId: string,
    locator: string | null,
    pageNo: number,
    maxRecords?: number,
  ): Promise<SfdcBulkPage> {
    const res = await this.transport.request<string>({
      method: "GET",
      path: `/jobs/query/${encodeURIComponent(jobId)}/results`,
      lane: "bulk",
      accept: "text",
      query: {
        maxRecords:
          maxRecords === undefined
            ? this.defaultMaxRecords
            : assertMaxRecords(maxRecords, "maxRecords"),
        locator: locator ?? undefined,
      },
    });
    const csv = res.body ?? "";
    const nHeader = res.headers.get("sforce-numberofrecords");
    const headerRows =
      nHeader !== null && nHeader !== "" ? Number(nHeader) : Number.NaN;
    let records: SourceRow[] | undefined;
    const parse = (): SourceRow[] => {
      records ??= parseCsvRows(csv).map((r) => {
        if (typeof r.Id === "string") r.Id = to18(r.Id);
        return r as SourceRow;
      });
      return records;
    };
    return {
      jobId,
      locator,
      nextLocator: parseLocator(res.headers.get("sforce-locator")),
      pageNo,
      // `Sforce-NumberOfRecords` when present; otherwise count by parsing.
      rows: Number.isFinite(headerRows) ? headerRows : parse().length,
      csv,
      get records(): SourceRow[] {
        return parse();
      },
    };
  }

  /** §2.1.5 create → poll → page; or resume paging an existing job. */
  query(soql: string, opts: SfdcBulkQueryOptions = {}): SfdcBulkResult {
    let resolveJob!: (j: SfdcBulkJobInfo) => void;
    let rejectJob!: (e: unknown) => void;
    const job = new Promise<SfdcBulkJobInfo>((res, rej) => {
      resolveJob = res;
      rejectJob = rej;
    });
    // A consumer that never awaits `job` must not get an unhandled rejection.
    job.catch(() => {});
    return {
      job,
      [Symbol.asyncIterator]: () =>
        this.pages(soql, opts, { resolve: resolveJob, reject: rejectJob }),
    };
  }

  private async *pages(
    soql: string,
    opts: SfdcBulkQueryOptions,
    settle: {
      resolve: (j: SfdcBulkJobInfo) => void;
      reject: (e: unknown) => void;
    },
  ): AsyncGenerator<SfdcBulkPage> {
    const release = await this.sem.acquire();
    let jobId: string | undefined;
    let settled = false;
    try {
      let info: SfdcBulkJobInfo;
      if (opts.resume) {
        jobId = opts.resume.jobId;
        info = await this.getJob(jobId);
        if (info.state !== "JobComplete") info = await this.waitForJob(jobId);
      } else {
        info = await this.createJob(soql, opts);
        jobId = info.id;
        info = await this.waitForJob(jobId);
      }
      settle.resolve(info);
      settled = true;
      let locator: string | null = opts.resume?.locator ?? null;
      let pageNo = opts.resume?.pageNo ?? 0;
      for (;;) {
        const page = await this.fetchPage(
          jobId,
          locator,
          pageNo,
          opts.maxRecords,
        );
        yield page;
        if (page.nextLocator === null) break;
        locator = page.nextLocator;
        pageNo++;
      }
      this.log.info(
        { jobId, pages: pageNo + 1, records: info.numberRecordsProcessed },
        "Bulk query results consumed",
      );
    } catch (e) {
      const err = toSfdcError(e);
      if (!settled) settle.reject(err);
      throw err;
    } finally {
      release();
    }
  }

  /** `PATCH {state: Aborted}` (ignored when already terminal) then `DELETE`. */
  async abortJob(jobId: string): Promise<void> {
    const path = `/jobs/query/${encodeURIComponent(jobId)}`;
    try {
      await this.transport.request({
        method: "PATCH",
        path,
        lane: "bulk",
        body: { state: "Aborted" },
      });
    } catch (e) {
      const err = toSfdcError(e);
      // Already complete/failed/aborted or gone: fine, proceed to delete.
      if (
        err.errorClass !== "structural" &&
        err.status !== 404 &&
        err.status !== 400
      )
        throw err;
      this.log.debug(
        { jobId, errorCode: err.errorCode },
        "Bulk job abort skipped (already terminal)",
      );
    }
    try {
      await this.transport.request({ method: "DELETE", path, lane: "bulk" });
    } catch (e) {
      const err = toSfdcError(e);
      if (err.status === 404) return;
      throw err;
    }
    this.log.info({ jobId }, "Bulk query job aborted and deleted");
  }

  /** `GET /jobs/query?jobType=V2Query` (follows `nextRecordsUrl`). */
  async listJobs(): Promise<BulkJobListEntry[]> {
    const out: BulkJobListEntry[] = [];
    let path: string | undefined = "/jobs/query";
    let query: Record<string, string> | undefined = { jobType: "V2Query" };
    while (path) {
      const res: {
        body: {
          records?: BulkJobListEntry[];
          done?: boolean;
          nextRecordsUrl?: string;
        };
      } = await this.transport.request({
        method: "GET",
        path,
        lane: "bulk",
        query,
      });
      out.push(...(res.body.records ?? []));
      path =
        res.body.done === false && res.body.nextRecordsUrl
          ? res.body.nextRecordsUrl
          : undefined;
      query = undefined;
    }
    return out;
  }

  /** Delete every finished query job (results are otherwise kept 7 days). */
  async cleanupFinishedJobs(): Promise<number> {
    let n = 0;
    for (const j of await this.listJobs()) {
      if (!TERMINAL.has(j.state)) continue;
      try {
        await this.transport.request({
          method: "DELETE",
          path: `/jobs/query/${encodeURIComponent(j.id)}`,
          lane: "bulk",
        });
        n++;
      } catch (e) {
        this.log.warn(
          { jobId: j.id, err: e },
          "could not delete finished bulk job",
        );
      }
    }
    return n;
  }
}
