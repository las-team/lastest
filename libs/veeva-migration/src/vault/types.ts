/**
 * Vault client contract (§2.5). Implemented in `src/vault/client.ts`; faked
 * by `src/testkit/fake-vault.ts`. HTTP is 200 even on FAILURE — every method
 * branches on `responseStatus` and throws `VaultApiError` with the error
 * `type` for non-row-level failures (§2.5.3).
 */
import type {
  PayloadValue,
  VaultFieldMetadata,
  VaultLifecycle,
  VaultObjectMetadata,
  VaultObjectTypeConfig,
  VaultPicklistValue,
} from "../types";

export type VaultResponseStatus =
  | "SUCCESS"
  | "FAILURE"
  | "WARNING"
  | "EXCEPTION";

export interface VaultError {
  type: string;
  message: string;
}

/** §2.5.1 auth response subset. */
export interface VaultSession {
  sessionId: string;
  userId: number;
  vaultId: number;
  vaultDns: string;
  vaultIds: Array<{ id: number; name: string; url: string }>;
  apiVersion: string;
}

/** Burst headers of the last response (§2.5.2). */
export interface VaultBurstInfo {
  burstLimit?: number;
  burstLimitRemaining?: number;
  responseDelayMs?: number;
  executionId?: string;
  /** `X-VaultAPI-DowntimeExpectedDurationMinutes` when announced (§2.5.1). */
  downtimeExpectedMinutes?: number;
  observedAt?: string;
}

/** One page of `POST /query` (§2.5.5). Picklist values are normalised to arrays by the client. */
export interface VqlPage {
  responseDetails: {
    pagesize: number;
    pageoffset: number;
    size: number;
    total: number;
    next_page?: string;
    previous_page?: string;
  };
  data: Array<Record<string, unknown>>;
}

/** Request row for upsert/update: Vault API names → JSON scalars (deferred refs already resolved by the loader). */
export type VaultRow = Record<
  string,
  Exclude<PayloadValue, object> | string | number | boolean | null
>;

/** One `data[]` entry of a bulk write (§2.5.4). Order == input order. */
export interface VaultRowResult {
  responseStatus: VaultResponseStatus;
  data?: {
    id?: string;
    url?: string;
    id_param_value?: string;
    /** `create` | `update` on upsert. */
    event?: string;
  };
  errors?: VaultError[];
  warnings?: VaultError[];
}

export interface VaultBulkResponse {
  responseStatus: VaultResponseStatus;
  responseMessage?: string;
  errors?: VaultError[];
  data: VaultRowResult[];
  burst: VaultBurstInfo;
}

export interface VaultWriteOptions {
  /** `?idParam={legacyIdField}` — must be a `unique: true` field (§2.5.4). */
  idParam?: string;
  /** `X-VaultAPI-MigrationMode` (default from config `target.migrationMode`). */
  migrationMode?: boolean;
  /** `X-VaultAPI-NoTriggers` (only effective with MigrationMode). */
  noTriggers?: boolean;
  /** `X-VaultAPI-UnchangedFieldBehavior` (default `AlwaysIgnore`). */
  unchangedFieldBehavior?:
    | "AlwaysIgnore"
    | "IgnoreSetOnCreateOnly"
    | "NeverIgnore";
  /** `X-VaultAPI-ReferenceId: {run_id}:{object}:{batch}`. */
  referenceId?: string;
}

export interface VaultUser {
  id: number;
  user_name__v: string;
  user_first_name__v?: string;
  user_last_name__v?: string;
  user_email__v?: string;
  active__v?: boolean;
  federated_id__v?: string;
  [field: string]: unknown;
}

export class VaultApiError extends Error {
  constructor(
    public readonly type: string,
    message: string,
    public readonly status?: VaultResponseStatus,
    public readonly errors: VaultError[] = [],
  ) {
    super(`${type}: ${message}`);
  }
}

export interface VaultClient {
  readonly vaultDns: string;
  readonly apiVersion: string;
  /** Session after `authenticate()`; undefined before. */
  readonly session?: VaultSession;
  /** Burst counters from the most recent response (§2.5.2). */
  readonly burst: VaultBurstInfo;

  /** §2.5.1 `POST /api/{version}/auth` (+ vault check, `users/me` validation). Cached; ≤ 20/min. */
  authenticate(): Promise<VaultSession>;
  /** §2.5.1 `POST /api/{version}/keep-alive`. */
  keepAlive(): Promise<void>;
  /** §2.5.1 `DELETE /api/{version}/session`. */
  endSession(): Promise<void>;
  /** §2.5.1 `GET /api` versions (needs a session). */
  availableVersions(): Promise<string[]>;
  /** §2.5.1 `GET /objects/users/me` — session/user validation and cheap health check. */
  me(): Promise<VaultUser>;

  /** §2.5.5 `POST /query` following `next_page` (POST). Yields pages, not rows. */
  vql(q: string): AsyncIterable<VqlPage>;
  /** §2.5.5 `PAGESIZE 0` → `responseDetails.total`. */
  vqlCount(q: string): Promise<number>;

  /** §2.5.6 `GET /metadata/vobjects`. */
  listObjects(): Promise<
    Array<{ name: string; label?: string; status?: string[] }>
  >;
  /** §2.5.6 `GET /metadata/vobjects/{object}`. */
  objectMetadata(objectName: string): Promise<VaultObjectMetadata>;
  /** §2.5.6 `GET /metadata/vobjects/{object}/fields/{field}`. */
  fieldMetadata(
    objectName: string,
    fieldName: string,
  ): Promise<VaultFieldMetadata>;
  /** §2.5.6 `GET /objects/picklists/{name}` — active values only. */
  picklistValues(picklistName: string): Promise<VaultPicklistValue[]>;
  /** §2.5.6 `POST /objects/picklists/{name}` (only with `--allow-picklist-create`). */
  createPicklistValues?(
    picklistName: string,
    labels: string[],
  ): Promise<VaultPicklistValue[]>;
  /** §2.5.6 `PUT /objects/picklists/{name}/{value}` status flip (`--allow-picklist-reactivate`). */
  setPicklistValueStatus?(
    picklistName: string,
    valueName: string,
    status: "active" | "inactive",
  ): Promise<void>;
  /** §2.5.6 `GET /configuration/Objecttype.{object}.{type}` per type — required-ness is per type. */
  objectTypes(objectName: string): Promise<VaultObjectTypeConfig[]>;
  /** §2.5.6 `GET /configuration/Objectlifecycle.{lifecycle}`. */
  lifecycleStates(lifecycleName: string): Promise<VaultLifecycle>;

  /** §2.5.4 `POST /vobjects/{object}?idParam=` — ≤ 500 rows; per-row results in input order. */
  upsert(
    objectName: string,
    rows: VaultRow[],
    opts: VaultWriteOptions,
  ): Promise<VaultBulkResponse>;
  /** §2.5.4 `PUT /vobjects/{object}` by `id` (second-pass patches, inactivation, blobs). */
  update(
    objectName: string,
    rows: VaultRow[],
    opts?: VaultWriteOptions,
  ): Promise<VaultBulkResponse>;
  /** §2.5.4 `DELETE /vobjects/{object}` by Vault ids (≤ 500). */
  deleteRecords(
    objectName: string,
    ids: string[],
    opts?: Pick<VaultWriteOptions, "referenceId" | "migrationMode">,
  ): Promise<VaultBulkResponse>;
  /** §2.5.6 `POST /vobjects/{object}/actions/changetype` (CSV) — resets lifecycle state. */
  changeType?(
    objectName: string,
    rows: Array<{ id: string; objectType: string } & Record<string, unknown>>,
  ): Promise<VaultBulkResponse>;
  /** §8.6 `POST /vobjects/{object}/{id}/attachments` (multipart). */
  addAttachment?(
    objectName: string,
    id: string,
    file: { name: string; content: Uint8Array; contentType?: string },
  ): Promise<void>;
  /** §2.5.6 `POST /api/mdl/execute` (`--allow-mdl` only). */
  executeMdl(
    mdl: string,
    opts?: { async?: boolean },
  ): Promise<{ jobId?: string; ok: boolean; message?: string }>;
  /** §2.5.6 `GET /objects/users`. */
  users(opts?: { activeOnly?: boolean }): AsyncIterable<VaultUser>;
  /** §2.5.6 Users API upsert (`objects.user.mode = create`). */
  createUsers?(
    rows: VaultRow[],
    opts: { idParam: string },
  ): Promise<VaultBulkResponse>;
  /** §2.5.6 `POST /vobjects/{object}/actions/{action}` generic action (roll-up recalc, corporate currency). */
  objectAction?(
    objectName: string,
    action: string,
    body?: Record<string, unknown>,
  ): Promise<{ ok: boolean; jobId?: string; message?: string }>;
  /** §2.5.6 `GET /limits`. */
  limits?(): Promise<Record<string, unknown>>;
  /**
   * §2.5.6 / §5.2 `GET /objects/users/{id}/permissions?filter=…` — permission
   * probe (`filter` e.g. `object.account__v.actions`). Entries are returned
   * as-is (`{ name, permissions{read,create,edit,delete} }` per the Users API
   * `[UNV]`); callers parse defensively.
   */
  userPermissions?(
    userId: number | string,
    filter?: string,
  ): Promise<Array<Record<string, unknown>>>;
}
