/**
 * `createVaultClient(config)` — the `VaultClient` contract (§2.5) composed
 * from the transport (`http.ts`), the session (`auth.ts`) and the endpoint
 * modules. Everything is injectable (`fetch`, `sleep`, `random`, `now`) so
 * the client is testable without a network.
 */
import { getLogger, type Logger } from "../logger";
import type {
  VaultFieldMetadata,
  VaultLifecycle,
  VaultObjectMetadata,
  VaultObjectTypeConfig,
  VaultPicklistValue,
} from "../types";
import {
  VaultAuth,
  type VaultAuthConfig,
  type VersionFallbackInfo,
} from "./auth";
import { VaultHttp, type FetchLike, type VaultHttpHooks } from "./http";
import * as mdl from "./mdl";
import * as metadata from "./metadata";
import * as records from "./records";
import type { RandomFn, SleepFn, VaultRetryPolicy } from "./retry";
import type {
  VaultBulkResponse,
  VaultBurstInfo,
  VaultClient,
  VaultRow,
  VaultSession,
  VaultUser,
  VaultWriteOptions,
  VqlPage,
} from "./types";
import * as users from "./users";
import * as vql from "./vql";

export const DEFAULT_API_VERSION = "v26.2";
export const DEFAULT_CLIENT_ID = "veeva-migration-client";

export interface VaultClientConfig {
  vaultDns: string;
  /** Default `v26.2` (§2.5.1). */
  apiVersion?: string;
  auth: VaultAuthConfig;
  /** `X-VaultAPI-ClientID` (`{company}-{org}-veeva-migration-client-{program}`, ≤ 100 chars). */
  clientId?: string;
  /** Default `X-VaultAPI-MigrationMode` (config `target.migrationMode`, default true). */
  migrationMode?: boolean;
  /** Default `X-VaultAPI-UnchangedFieldBehavior` (default `AlwaysIgnore`). */
  unchangedFieldBehavior?: VaultWriteOptions["unchangedFieldBehavior"];
  /** `target.vaultId` when configured. */
  vaultId?: number;
  /** `performance.burstFloor` (default 200). */
  burstFloor?: number;
  burstWindowMs?: number;
  retry?: Partial<VaultRetryPolicy>;
  timeoutMs?: number;
  keepAliveIntervalMs?: number;
  authRateLimit?: { max: number; windowMs: number };
  versionFallback?: boolean;
  /** Default `X-VaultAPI-ReferenceId` (e.g. `{run_id}`); per-call values override it. */
  referenceId?: string;
  /** MDL request content type `[UNVERIFIED]` (default `application/json`). */
  mdlContentType?: string;
  hooks?: VaultHttpHooks;
  fetch?: FetchLike;
  sleep?: SleepFn;
  random?: RandomFn;
  now?: () => number;
  logger?: Logger;
}

/** Structural subset of `MigrationConfig` the client needs. */
export interface VaultClientConfigSource {
  target: {
    vaultDns: string;
    apiVersion?: string;
    auth: VaultAuthConfig;
    clientId?: string;
    migrationMode?: boolean;
    unchangedFieldBehavior?: VaultWriteOptions["unchangedFieldBehavior"];
    vaultId?: number;
  };
  performance?: { burstFloor?: number };
}

/** Derive a `VaultClientConfig` from a parsed `MigrationConfig` (structurally typed). */
export function vaultClientConfigFrom(
  config: VaultClientConfigSource,
  extra: Partial<VaultClientConfig> = {},
): VaultClientConfig {
  const t = config.target;
  return {
    vaultDns: t.vaultDns,
    apiVersion: t.apiVersion,
    auth: t.auth,
    clientId: t.clientId,
    migrationMode: t.migrationMode,
    unchangedFieldBehavior: t.unchangedFieldBehavior,
    vaultId: t.vaultId,
    burstFloor: config.performance?.burstFloor,
    ...extra,
  };
}

/** The concrete client: the contract plus the extras the loader/preflight use. */
export interface VaultClientImpl extends VaultClient {
  readonly http: VaultHttp;
  readonly auth: VaultAuth;
  /** Set when auth fell back to the previous release (§2.5.1 → `VT_API_VERSION_MISSING`). */
  readonly versionFallback: VersionFallbackInfo | undefined;
  /** Change the default `X-VaultAPI-ReferenceId` (`{run_id}` prefix). */
  setReferenceId(referenceId: string | undefined): void;
  /** `GET /objects/users` with paging/filter options (the contract's `users()` accepts a subset). */
  users(opts?: users.ListUsersOptions): AsyncIterable<VaultUser>;
  startKeepAlive(): void;
  stopKeepAlive(): void;
  vqlRows(
    q: string,
    opts?: vql.VqlOptions,
  ): AsyncIterable<Record<string, unknown>>;
  listPicklists(): Promise<metadata.VaultPicklistSummary[]>;
  usersMetadata(): Promise<Array<Record<string, unknown>>>;
  userPermissions(
    userId: number | string,
    filter?: string,
  ): Promise<Array<Record<string, unknown>>>;
  cascadeDelete(
    objectName: string,
    id: string,
  ): Promise<{ jobId?: string; url?: string }>;
  deletedRecords(
    objectName: string,
    opts?: { startDate?: string; endDate?: string; limit?: number },
  ): AsyncIterable<records.VaultDeletedRecord>;
  /** Cached per (object, action); `reprobe` bypasses the cache. */
  probeObjectAction(
    objectName: string,
    action: string,
    opts?: { reprobe?: boolean },
  ): Promise<records.ActionAvailability>;
  mergeRecords(
    objectName: string,
    sets: records.MergeSet[],
  ): Promise<{ ok: boolean; jobId?: string; message?: string }>;
  executeMdlAsync(mdlScript: string): Promise<mdl.MdlExecuteResult>;
  mdlResults(jobId: string): Promise<mdl.MdlJobResult>;
  waitForMdlJob(
    jobId: string,
    opts?: { pollMs?: number; timeoutMs?: number },
  ): Promise<mdl.MdlJobResult>;
  readObjectMdl(objectName: string): Promise<string>;
  updateUser(
    id: number | string,
    fields: VaultRow,
  ): Promise<VaultUser | undefined>;
  setVaultMembership(
    userId: number | string,
    vaultId: number | string,
    membership: users.VaultMembership,
  ): Promise<void>;
  /** Cached object metadata (used by action probes); `objectMetadata()` always fetches. */
  cachedObjectMetadata(objectName: string): Promise<VaultObjectMetadata>;
}

export function createVaultClient(config: VaultClientConfig): VaultClientImpl {
  const apiVersion = config.apiVersion ?? DEFAULT_API_VERSION;
  const log =
    config.logger ?? getLogger("Vault", { vault_dns: config.vaultDns });
  const writeDefaults: records.WriteDefaults = {
    migrationMode: config.migrationMode ?? true,
    unchangedFieldBehavior: config.unchangedFieldBehavior ?? "AlwaysIgnore",
  };

  // `auth` is declared right after `http`; the callbacks only dereference it
  // at call time, so the closure never observes the temporal dead zone.
  const http: VaultHttp = new VaultHttp({
    vaultDns: config.vaultDns,
    apiVersion,
    clientId: config.clientId ?? DEFAULT_CLIENT_ID,
    authorization: (): string | undefined => auth.authorization(),
    reauthenticate: async (): Promise<void> => {
      await auth.reauthenticate();
    },
    fetch: config.fetch,
    sleep: config.sleep,
    random: config.random,
    now: config.now,
    burstFloor: config.burstFloor,
    burstWindowMs: config.burstWindowMs,
    retry: config.retry,
    timeoutMs: config.timeoutMs,
    hooks: config.hooks,
    logger: log,
  });
  http.defaultReferenceId = config.referenceId;
  const auth: VaultAuth = new VaultAuth({
    http,
    vaultDns: config.vaultDns,
    auth: config.auth,
    configuredVaultId: config.vaultId,
    authRateLimit: config.authRateLimit,
    keepAliveIntervalMs: config.keepAliveIntervalMs,
    versionFallback: config.versionFallback,
    now: config.now,
    sleep: config.sleep,
    logger: log,
  });

  const metaCache = new Map<string, Promise<VaultObjectMetadata>>();
  const actionCache = new Map<string, records.ActionAvailability>();
  const mdlOpts = { contentType: config.mdlContentType };

  const cachedObjectMetadata = (objectName: string) => {
    let p = metaCache.get(objectName);
    if (!p) {
      p = metadata.objectMetadata(http, objectName).catch((e) => {
        metaCache.delete(objectName);
        throw e;
      });
      metaCache.set(objectName, p);
    }
    return p;
  };

  const client: VaultClientImpl = {
    http,
    get auth() {
      return auth;
    },
    vaultDns: config.vaultDns,
    get apiVersion() {
      return http.apiVersion;
    },
    get session(): VaultSession | undefined {
      return auth.session;
    },
    get burst(): VaultBurstInfo {
      return http.burst;
    },
    get versionFallback() {
      return auth.versionFallback;
    },
    setReferenceId(referenceId) {
      http.defaultReferenceId = referenceId;
    },

    // --- session (§2.5.1)
    authenticate: () => auth.authenticate(),
    keepAlive: () => auth.keepAlive(),
    endSession: () => auth.endSession(),
    availableVersions: () => auth.availableVersions(),
    me: () => auth.me(),
    startKeepAlive: () => auth.startKeepAlive(),
    stopKeepAlive: () => auth.stopKeepAlive(),

    // --- VQL (§2.5.5)
    vql: (q: string): AsyncIterable<VqlPage> => vql.vqlPages(http, q),
    vqlRows: (q, opts) => vql.vqlRows(http, q, opts),
    vqlCount: (q: string) => vql.vqlCount(http, q),

    // --- metadata (§2.5.6)
    listObjects: () => metadata.listObjects(http),
    objectMetadata: (objectName: string) =>
      metadata.objectMetadata(http, objectName),
    cachedObjectMetadata,
    fieldMetadata: (
      objectName: string,
      fieldName: string,
    ): Promise<VaultFieldMetadata> =>
      metadata.fieldMetadata(http, objectName, fieldName),
    picklistValues: (name: string): Promise<VaultPicklistValue[]> =>
      metadata.picklistValues(http, name),
    listPicklists: () => metadata.listPicklists(http),
    createPicklistValues: (name: string, labels: string[]) =>
      metadata.createPicklistValues(http, name, labels),
    setPicklistValueStatus: (name, value, status) =>
      metadata.setPicklistValueStatus(http, name, value, status),
    objectTypes: async (
      objectName: string,
    ): Promise<VaultObjectTypeConfig[]> => {
      let meta: VaultObjectMetadata | undefined;
      try {
        meta = await cachedObjectMetadata(objectName);
      } catch {
        meta = undefined;
      }
      return metadata.objectTypes(http, objectName, meta);
    },
    lifecycleStates: (name: string): Promise<VaultLifecycle> =>
      metadata.lifecycleStates(http, name),
    usersMetadata: () => metadata.usersMetadata(http),
    userPermissions: (userId, filter) =>
      metadata.userPermissions(http, userId, filter),
    limits: () => metadata.limits(http),

    // --- writes (§2.5.4)
    upsert: (objectName, rows, opts): Promise<VaultBulkResponse> =>
      records.upsert(http, objectName, rows, opts, writeDefaults),
    update: (objectName, rows, opts = {}) =>
      records.update(http, objectName, rows, opts, writeDefaults),
    deleteRecords: (objectName, ids, opts = {}) =>
      records.deleteRecords(http, objectName, ids, opts, writeDefaults),
    changeType: (objectName, rows) =>
      records.changeType(http, objectName, rows, {}, writeDefaults),
    addAttachment: (objectName, id, file) =>
      records.addAttachment(http, objectName, id, file),
    cascadeDelete: (objectName, id) =>
      records.cascadeDelete(http, objectName, id),
    deletedRecords: (objectName, opts) =>
      records.deletedRecords(http, objectName, opts),
    async probeObjectAction(objectName, action, opts = {}) {
      const key = `${objectName}:${action}`;
      const cached = actionCache.get(key);
      if (cached && !opts.reprobe) return cached;
      const r = await records.probeObjectAction(http, objectName, action, () =>
        cachedObjectMetadata(objectName),
      );
      log.info(
        {
          code: "PROBE_RESULT",
          object: objectName,
          action,
          availability: r.availability,
          via: r.via,
        },
        "object action probe",
      );
      actionCache.set(key, r.availability);
      return r.availability;
    },
    async objectAction(objectName, action, body) {
      const availability = await client.probeObjectAction(objectName, action);
      return records.objectAction(http, objectName, action, body, availability);
    },
    mergeRecords: (objectName, sets) =>
      records.mergeRecords(http, objectName, sets),

    // --- MDL (§2.5.6)
    executeMdl: async (mdlScript, opts = {}) =>
      opts.async
        ? mdl.executeMdlAsync(http, mdlScript, mdlOpts)
        : mdl.executeMdl(http, mdlScript, mdlOpts),
    executeMdlAsync: (mdlScript) =>
      mdl.executeMdlAsync(http, mdlScript, mdlOpts),
    mdlResults: (jobId) => mdl.mdlResults(http, jobId),
    waitForMdlJob: (jobId, opts = {}) =>
      mdl.waitForMdlJob(http, jobId, {
        ...opts,
        sleep: config.sleep,
        now: config.now,
      }),
    readObjectMdl: (objectName) => mdl.readObjectMdl(http, objectName),

    // --- users (§2.5.6)
    users: (opts = {}) => users.listUsers(http, opts),
    createUsers: (rows, opts) => users.createUsers(http, rows, opts),
    updateUser: (id, fields) => users.updateUser(http, id, fields),
    setVaultMembership: (userId, vaultId, membership) =>
      users.setVaultMembership(http, userId, vaultId, membership),
  };
  return client;
}
