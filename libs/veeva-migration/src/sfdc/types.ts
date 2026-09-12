/**
 * SFDC client contract (§2.1). Implemented in `src/sfdc/client.ts` (REST +
 * Bulk 2.0 over the agent-supplied auth) and faked by
 * `src/testkit/fake-sfdc.ts`. Every method states the spec section it
 * implements. All paths are relative to `{instance_url}/services/data/v{apiVersion}`.
 */
import type {
  SfdcGlobalDescribeEntry,
  SfdcObjectDescribe,
  SfdcRecordType,
  SourceRow,
} from "../types";

/** `GET /limits` subset used by preflight (§2.1.7). */
export interface SfdcLimits {
  DailyApiRequests: { Max: number; Remaining: number };
  DailyBulkV2QueryJobs?: { Max: number; Remaining: number };
  DailyBulkV2QueryFileStorageMB?: { Max: number; Remaining: number };
  DailyBulkApiBatches?: { Max: number; Remaining: number };
  [name: string]: { Max: number; Remaining: number } | undefined;
}

export interface SfdcQueryOptions {
  /** Use `queryAll` (includes `IsDeleted = true` rows in the Recycle Bin, §2.1.4). */
  all?: boolean;
  /** `Sforce-Query-Options: batchSize=` (200–2000). */
  batchSize?: number;
}

/** Bulk 2.0 job info (§2.1.5 create/poll response). */
export interface SfdcBulkJobInfo {
  id: string;
  operation: "query" | "queryAll";
  object: string;
  state: "UploadComplete" | "InProgress" | "JobComplete" | "Failed" | "Aborted";
  createdDate?: string;
  systemModstamp?: string;
  numberRecordsProcessed?: number;
  errorMessage?: string;
}

/** One results page of a Bulk 2.0 query job (§2.1.5 results). */
export interface SfdcBulkPage {
  jobId: string;
  /** `Sforce-Locator` of the request that produced this page (null for the first page). */
  locator: string | null;
  /** `Sforce-Locator` to pass for the next page; `null` when done (the literal "null" header is normalised). */
  nextLocator: string | null;
  pageNo: number;
  /** `Sforce-NumberOfRecords`. */
  rows: number;
  /** Full CSV text with header row (RFC-4180, UTF-8, LF). */
  csv: string;
  /** Parsed rows (empty = null; values are strings). Implementations may parse lazily. */
  records: SourceRow[];
}

export interface SfdcBulkQueryOptions {
  all?: boolean;
  /** `Sforce-Enable-PKChunking: chunkSize=` (1,000–250,000; default 100,000). */
  pkChunking?:
    | boolean
    | { chunkSize?: number; startRow?: string; parent?: string };
  /** Resume from a persisted checkpoint (§2.2 step 3, §8.2). */
  resume?: { jobId: string; locator: string | null; pageNo: number };
  /** Max records per results page (`maxRecords`). */
  maxRecords?: number;
  /** Job state poll interval cap in ms (default 30 000). */
  pollCapMs?: number;
}

export interface SfdcBulkResult extends AsyncIterable<SfdcBulkPage> {
  /** Resolves once the job reaches `JobComplete` (or rejects on Failed/Aborted). */
  job: Promise<SfdcBulkJobInfo>;
}

/** `GET /sobjects/{Object}/deleted/` (§2.1.6). */
export interface SfdcDeletedResult {
  deletedRecords: Array<{ id: string; deletedDate: string }>;
  earliestDateAvailable: string;
  latestDateCovered: string;
}

/** `GET /sobjects/{Object}/updated/` (§2.1.6). */
export interface SfdcUpdatedResult {
  ids: string[];
  latestDateCovered: string;
}

/** `GET /query/?explain=` (§2.1.4). */
export interface SfdcQueryPlan {
  cost: number;
  leadingOperationType: string;
  sobjectCardinality: number;
  fields?: string[];
  notes?: Array<{ description: string; fields?: string[] }>;
}

export interface SfdcClient {
  /** 18-char org id parsed from the identity URL (§2.1.1). */
  readonly orgId: string;
  /** Pinned `source.apiVersion` (§2.1.2). */
  readonly apiVersion: string;
  /** `instance_url` from the token response. */
  readonly instanceUrl?: string;

  /** §2.1.3 `GET /sobjects` — objects absent here have no Read permission. */
  describeGlobal(): Promise<SfdcGlobalDescribeEntry[]>;
  /** §2.1.3 `GET /sobjects/{Object}/describe` (cached per run with `If-Modified-Since`). */
  describe(objectName: string): Promise<SfdcObjectDescribe>;
  /** §2.1.3 `SELECT … FROM RecordType`, cached once per run. */
  recordTypes(): Promise<SfdcRecordType[]>;
  /**
   * §2.1.4 REST SOQL (`/query` or `/queryAll` with `all`), following
   * `nextRecordsUrl` until `done`. Streams rows; never buffers the result.
   * Relationship values are flattened into dotted keys (`Account_vod__r.Name`).
   */
  query(soql: string, opts?: SfdcQueryOptions): AsyncIterable<SourceRow>;
  /** §2.1.4 `SELECT COUNT() FROM … WHERE …` via `query` (never `queryAll`). */
  count(objectName: string, whereClause?: string): Promise<number>;
  /**
   * §2.1.4 / §2.2 step 5 closure lookup: `Id IN (…)` in chunks of ≤ 400 ids
   * (`queryAll` semantics — deleted parents come back with `IsDeleted = true`);
   * `extract.closureStrategy = composite` may use `/composite/sobjects`.
   */
  queryIds(
    objectName: string,
    ids: readonly string[],
    columns: readonly string[],
  ): AsyncIterable<SourceRow>;
  /** §2.1.4 `GET /query/?explain=`. */
  explain(soql: string): Promise<SfdcQueryPlan[]>;
  /**
   * §2.1.5 Bulk API 2.0 query job: create → poll → page results with
   * `Sforce-Locator`. Yields pages in order; each page is checkpointable.
   */
  bulkQuery(soql: string, opts?: SfdcBulkQueryOptions): SfdcBulkResult;
  /** §2.1.5 `PATCH /jobs/query/{id}` Aborted + `DELETE`. */
  abortBulkJob(jobId: string): Promise<void>;
  /** §2.1.6 delete feed (caller guards `describe.replicateable`). ISO datetimes, ≤ 30 days back. */
  getDeleted(
    objectName: string,
    start: string,
    end: string,
  ): Promise<SfdcDeletedResult>;
  /** §2.1.6 update feed cross-check. */
  getUpdated(
    objectName: string,
    start: string,
    end: string,
  ): Promise<SfdcUpdatedResult>;
  /** §2.1.7 `GET /limits`. */
  limits(): Promise<SfdcLimits>;
  /** §4.1 `sfdc_now`: `Date` header of the first REST call or `MAX(SystemModstamp)`. ISO string. */
  serverNow(): Promise<string>;
  /** §2.1.2 `GET /services/data/` version list. */
  availableVersions(): Promise<string[]>;
}
