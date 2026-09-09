/**
 * `createSfdcClient(config)` — the production `SfdcClient` (§2.1) wired from
 * `MigrationConfig.source` / `.performance` / `.extract`: JWT-bearer or
 * client-credentials auth, REST transport with budget + retry + re-auth,
 * Bulk 2.0 jobs. Authenticates eagerly so `orgId` / `instanceUrl` are
 * available synchronously afterwards (§2.1.1: the org id is pinned in
 * `runs.source_org_id` and cross-checked with `SF_ORG_MISMATCH`).
 */
import { getLogger } from "../logger";
import type {
  SfdcGlobalDescribeEntry,
  SfdcObjectDescribe,
  SfdcRecordType,
  SourceRow,
} from "../types";
import {
  createSfdcAuthenticator,
  type FetchFn,
  type SfdcAuthConfig,
  type SfdcAuthenticator,
  type SfdcSession,
} from "./auth";
import { SfdcBulk, type SfdcBulkOptions } from "./bulk2";
import { ApiBudget } from "./limits";
import { SfdcRest, SfdcTransport, type SfdcRestOptions } from "./rest";
import type { RetryOptions } from "./retry";
import type {
  SfdcBulkQueryOptions,
  SfdcBulkResult,
  SfdcClient,
  SfdcDeletedResult,
  SfdcLimits,
  SfdcQueryOptions,
  SfdcQueryPlan,
  SfdcUpdatedResult,
} from "./types";

/** The slice of `MigrationConfig` the client needs (§7.2.1 `source`, `performance`, `extract`). */
export interface SfdcClientConfig {
  source: {
    loginUrl: string;
    apiVersion?: string;
    auth: SfdcAuthConfig;
  };
  performance?: {
    sfdcBulkConcurrency?: number;
    sfdcRestConcurrency?: number;
    sfdcApiFloorPct?: number;
  };
  extract?: {
    closureStrategy?: "soqlIn" | "composite";
  };
}

/** Injection points (tests stub `fetch`, `sleep`, `random`, `now`). */
export interface SfdcClientDeps {
  fetch?: FetchFn;
  sleep?: RetryOptions["sleep"];
  random?: RetryOptions["random"];
  now?: () => number;
  retryPolicy?: RetryOptions["policy"];
  /** Per-request timeout (default 10 min). */
  requestTimeoutMs?: number;
  /** Bulk polling/paging knobs. */
  bulk?: Pick<
    SfdcBulkOptions,
    "pollBaseMs" | "pollCapMs" | "pollTimeoutMs" | "maxRecords" | "pkChunkSize"
  >;
  /** Describe cache / feed guard knobs. */
  rest?: Pick<
    SfdcRestOptions,
    "describeTtlMs" | "feedWindowDays" | "inChunkSize" | "compositeChunkSize"
  >;
  /** JWT lifetime (s), ≤ 180. */
  jwtLifetimeSec?: number;
}

export const DEFAULT_SFDC_API_VERSION = "67.0";

/** `SfdcClient` plus the handles the run engine / preflight need. */
export interface SfdcClientHandle extends SfdcClient {
  readonly instanceUrl: string;
  readonly userId: string;
  readonly session: SfdcSession;
  readonly budget: ApiBudget;
  readonly transport: SfdcTransport;
  readonly rest: SfdcRest;
  readonly bulk: SfdcBulk;
  readonly auth: SfdcAuthenticator;
  /** Drop caches; the session itself has no server-side logout for JWT/client-credentials. */
  close(): Promise<void>;
}

class SfdcClientImpl implements SfdcClientHandle {
  readonly orgId: string;
  readonly userId: string;
  readonly instanceUrl: string;
  readonly apiVersion: string;

  constructor(
    readonly session: SfdcSession,
    readonly auth: SfdcAuthenticator,
    readonly transport: SfdcTransport,
    readonly rest: SfdcRest,
    readonly bulk: SfdcBulk,
  ) {
    this.orgId = session.orgId;
    this.userId = session.userId;
    this.instanceUrl = session.instanceUrl;
    this.apiVersion = transport.apiVersion;
  }

  get budget(): ApiBudget {
    return this.transport.budget;
  }

  describeGlobal(): Promise<SfdcGlobalDescribeEntry[]> {
    return this.rest.describeGlobal();
  }
  describe(objectName: string): Promise<SfdcObjectDescribe> {
    return this.rest.describe(objectName);
  }
  recordTypes(): Promise<SfdcRecordType[]> {
    return this.rest.recordTypes();
  }
  query(soql: string, opts?: SfdcQueryOptions): AsyncIterable<SourceRow> {
    return this.rest.query(soql, opts);
  }
  count(objectName: string, whereClause?: string): Promise<number> {
    return this.rest.count(objectName, whereClause);
  }
  queryIds(
    objectName: string,
    ids: readonly string[],
    columns: readonly string[],
  ): AsyncIterable<SourceRow> {
    return this.rest.queryIds(objectName, ids, columns);
  }
  explain(soql: string): Promise<SfdcQueryPlan[]> {
    return this.rest.explain(soql);
  }
  bulkQuery(soql: string, opts?: SfdcBulkQueryOptions): SfdcBulkResult {
    return this.bulk.query(soql, opts);
  }
  abortBulkJob(jobId: string): Promise<void> {
    return this.bulk.abortJob(jobId);
  }
  getDeleted(
    objectName: string,
    start: string,
    end: string,
  ): Promise<SfdcDeletedResult> {
    return this.rest.getDeleted(objectName, start, end);
  }
  getUpdated(
    objectName: string,
    start: string,
    end: string,
  ): Promise<SfdcUpdatedResult> {
    return this.rest.getUpdated(objectName, start, end);
  }
  limits(): Promise<SfdcLimits> {
    return this.rest.limits();
  }
  serverNow(): Promise<string> {
    return this.rest.serverNow();
  }
  availableVersions(): Promise<string[]> {
    return this.rest.availableVersions();
  }
  async close(): Promise<void> {
    this.rest.clearCaches();
    this.auth.invalidate();
  }
}

/**
 * Build and authenticate the client. Rejects with an `auth`-class
 * `SfdcApiError` when the flow is forbidden/misconfigured or the token
 * exchange fails.
 */
export async function createSfdcClient(
  config: SfdcClientConfig,
  deps: SfdcClientDeps = {},
): Promise<SfdcClientHandle> {
  const log = getLogger("Sfdc");
  const apiVersion = config.source.apiVersion ?? DEFAULT_SFDC_API_VERSION;
  const auth = createSfdcAuthenticator({
    loginUrl: config.source.loginUrl,
    auth: config.source.auth,
    fetch: deps.fetch,
    now: deps.now,
    jwtLifetimeSec: deps.jwtLifetimeSec,
  });
  const budget = new ApiBudget({
    reservePct: config.performance?.sfdcApiFloorPct ?? 20,
  });
  const transport = new SfdcTransport({
    auth,
    apiVersion,
    fetch: deps.fetch,
    budget,
    restConcurrency: config.performance?.sfdcRestConcurrency ?? 2,
    retry: { policy: deps.retryPolicy, sleep: deps.sleep, random: deps.random },
    requestTimeoutMs: deps.requestTimeoutMs,
    now: deps.now,
  });
  const rest = new SfdcRest(transport, {
    ...deps.rest,
    closureStrategy: config.extract?.closureStrategy ?? "soqlIn",
    now: deps.now,
  });
  const bulk = new SfdcBulk(transport, {
    ...deps.bulk,
    concurrency: config.performance?.sfdcBulkConcurrency ?? 4,
    sleep: deps.sleep,
    random: deps.random,
    now: deps.now,
  });
  const session = await auth.getSession();
  log.debug(
    {
      orgId: session.orgId,
      apiVersion,
      closureStrategy: config.extract?.closureStrategy ?? "soqlIn",
    },
    "SFDC client ready",
  );
  return new SfdcClientImpl(session, auth, transport, rest, bulk);
}
