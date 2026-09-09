/**
 * Record writes and actions (§2.5.4, §2.5.6, §8.6):
 *
 *  - `POST /vobjects/{object}?idParam=` upsert, `PUT /vobjects/{object}`
 *    update by id, `DELETE /vobjects/{object}` — JSON bodies, ≤ 500 rows per
 *    call, `X-VaultAPI-MigrationMode` / `NoTriggers` /
 *    `UnchangedFieldBehavior` headers, per-row results in input order,
 *    structural failure detection, client-side duplicate-`idParam` guard;
 *  - `POST /vobjects/{object}/actions/changetype` (CSV);
 *  - `POST /vobjects/{object}/{id}/attachments` (multipart) for blobs;
 *  - `POST /vobjects/{object}/{id}/actions/cascadedelete` (async job);
 *  - `GET /objects/deletions/vobjects/{object}` deletions feed (30 days);
 *  - generic actions (`merge`, `updatecorporatecurrency`,
 *    `recalculaterollups`, …) behind an availability probe — the roll-up path
 *    is `[UNVERIFIED]` (§2.5.6) and must never be assumed.
 */
import { VaultRequestError } from "./errors";
import type { VaultHttp } from "./http";
import { objectMetadata } from "./metadata";
import type {
  VaultBulkResponse,
  VaultBurstInfo,
  VaultResponseStatus,
  VaultRow,
  VaultRowResult,
  VaultWriteOptions,
} from "./types";

/** Vault bulk limit (§2.5.4). */
export const VAULT_BATCH_MAX = 500;
/** `actions/merge` accepts at most this many sets per call (§2.5.6). */
export const MERGE_SETS_MAX = 10;

export interface WriteDefaults {
  migrationMode: boolean;
  unchangedFieldBehavior: NonNullable<
    VaultWriteOptions["unchangedFieldBehavior"]
  >;
  noTriggers?: boolean;
}

export const DEFAULT_WRITE_DEFAULTS: WriteDefaults = {
  migrationMode: true,
  unchangedFieldBehavior: "AlwaysIgnore",
};

/** Build the §2.5.4 write headers; `NoTriggers` is only sent with MigrationMode. */
export function writeHeaders(
  opts: VaultWriteOptions,
  defaults: WriteDefaults = DEFAULT_WRITE_DEFAULTS,
): Record<string, string> {
  const migrationMode = opts.migrationMode ?? defaults.migrationMode;
  const noTriggers = opts.noTriggers ?? defaults.noTriggers ?? false;
  const headers: Record<string, string> = {
    "X-VaultAPI-UnchangedFieldBehavior":
      opts.unchangedFieldBehavior ?? defaults.unchangedFieldBehavior,
  };
  if (migrationMode) headers["X-VaultAPI-MigrationMode"] = "true";
  if (migrationMode && noTriggers) headers["X-VaultAPI-NoTriggers"] = "true";
  return headers;
}

/** Throw the §8.1 structural errors the server would raise, before spending a call. */
export function assertBatch(rows: readonly VaultRow[], idParam?: string): void {
  if (rows.length > VAULT_BATCH_MAX)
    throw new VaultRequestError(
      "INVALID_DATA",
      `Batch has ${rows.length} rows (max ${VAULT_BATCH_MAX} per call)`,
      { errorClass: "structural" },
    );
  if (!idParam) return;
  const seen = new Set<string>();
  for (const row of rows) {
    const v = row[idParam];
    if (v === undefined || v === null || v === "")
      throw new VaultRequestError(
        "PARAMETER_REQUIRED",
        `Row is missing the idParam value [${idParam}]`,
        { errorClass: "structural" },
      );
    const key = String(v);
    if (seen.has(key))
      throw new VaultRequestError(
        "INVALID_DATA",
        `Duplicate idParam value [${key}] in batch — dedupe client-side (last-wins by SystemModstamp, §8.2)`,
        { errorClass: "structural" },
      );
    seen.add(key);
  }
}

function asStatus(v: unknown): VaultResponseStatus {
  const s = String(v ?? "").toUpperCase();
  return s === "SUCCESS" ||
    s === "FAILURE" ||
    s === "WARNING" ||
    s === "EXCEPTION"
    ? s
    : "FAILURE";
}

function errorsOf(v: unknown): Array<{ type: string; message: string }> {
  if (!Array.isArray(v)) return [];
  return v.map((e) => {
    const o = (e ?? {}) as Record<string, unknown>;
    return {
      type: String(o.type ?? "UNKNOWN"),
      message: String(o.message ?? ""),
    };
  });
}

/** One `data[]` entry → `VaultRowResult`. */
export function normaliseRowResult(raw: unknown): VaultRowResult {
  const r = (raw ?? {}) as Record<string, unknown>;
  const out: VaultRowResult = { responseStatus: asStatus(r.responseStatus) };
  const d = r.data;
  if (d && typeof d === "object") {
    const data: NonNullable<VaultRowResult["data"]> = {};
    const o = d as Record<string, unknown>;
    if (o.id !== undefined && o.id !== null) data.id = String(o.id);
    if (typeof o.url === "string") data.url = o.url;
    if (o.id_param_value !== undefined && o.id_param_value !== null)
      data.id_param_value = String(o.id_param_value);
    if (typeof o.event === "string") data.event = o.event;
    out.data = data;
  } else if (r.id !== undefined && r.id !== null) {
    // some endpoints put `id` at the row root
    out.data = { id: String(r.id) };
  }
  const errors = errorsOf(r.errors);
  if (errors.length) out.errors = errors;
  const warnings = errorsOf(r.warnings);
  if (warnings.length) out.warnings = warnings;
  return out;
}

/**
 * Map a bulk envelope onto `VaultBulkResponse`. The outer status is SUCCESS
 * or WARNING here (FAILURE/EXCEPTION already threw in the transport). A
 * `data[]` whose length differs from the request is a structural failure —
 * the results could not be aligned with the input rows.
 */
export function mapBulkResponse(
  body: unknown,
  expectedRows: number,
  burst: VaultBurstInfo,
  ctx: { url?: string; method?: string } = {},
): VaultBulkResponse {
  const o = (body ?? {}) as Record<string, unknown>;
  const rawData = Array.isArray(o.data) ? o.data : [];
  if (rawData.length !== expectedRows)
    throw new VaultRequestError(
      "UNEXPECTED_ERROR",
      `Vault returned ${rawData.length} row results for ${expectedRows} rows — cannot align results with input`,
      { errorClass: "structural", status: asStatus(o.responseStatus), ...ctx },
    );
  const out: VaultBulkResponse = {
    responseStatus: asStatus(o.responseStatus),
    data: rawData.map(normaliseRowResult),
    burst,
  };
  if (typeof o.responseMessage === "string")
    out.responseMessage = o.responseMessage;
  const errors = errorsOf(o.errors);
  if (errors.length) out.errors = errors;
  return out;
}

/** `POST /vobjects/{object}?idParam=` — ≤ 500 rows; per-row results in input order. */
export async function upsert(
  http: VaultHttp,
  objectName: string,
  rows: VaultRow[],
  opts: VaultWriteOptions,
  defaults: WriteDefaults = DEFAULT_WRITE_DEFAULTS,
): Promise<VaultBulkResponse> {
  if (!opts.idParam)
    throw new VaultRequestError(
      "PARAMETER_REQUIRED",
      "idParam is required for upsert (creates never happen without it, §8.2)",
      { errorClass: "structural" },
    );
  assertBatch(rows, opts.idParam);
  if (rows.length === 0)
    return { responseStatus: "SUCCESS", data: [], burst: { ...http.burst } };
  const res = await http.request({
    method: "POST",
    path: `/vobjects/${encodeURIComponent(objectName)}`,
    query: { idParam: opts.idParam },
    body: rows,
    headers: writeHeaders(opts, defaults),
    referenceId: opts.referenceId,
  });
  return mapBulkResponse(res.body, rows.length, res.burst, {
    url: res.url,
    method: "POST",
  });
}

/** `PUT /vobjects/{object}` by `id` (or `?idParam=`); `WARNING` = no change. */
export async function update(
  http: VaultHttp,
  objectName: string,
  rows: VaultRow[],
  opts: VaultWriteOptions = {},
  defaults: WriteDefaults = DEFAULT_WRITE_DEFAULTS,
): Promise<VaultBulkResponse> {
  assertBatch(rows, opts.idParam ?? "id");
  if (rows.length === 0)
    return { responseStatus: "SUCCESS", data: [], burst: { ...http.burst } };
  const res = await http.request({
    method: "PUT",
    path: `/vobjects/${encodeURIComponent(objectName)}`,
    query: opts.idParam ? { idParam: opts.idParam } : undefined,
    body: rows,
    headers: writeHeaders(opts, defaults),
    referenceId: opts.referenceId,
  });
  return mapBulkResponse(res.body, rows.length, res.burst, {
    url: res.url,
    method: "PUT",
  });
}

/** `DELETE /vobjects/{object}` body `[{id}]` (≤ 500). `?idParam=` on DELETE is `[UNVERIFIED]` — ids only. */
export async function deleteRecords(
  http: VaultHttp,
  objectName: string,
  ids: string[],
  opts: Pick<VaultWriteOptions, "referenceId" | "migrationMode"> = {},
  defaults: WriteDefaults = DEFAULT_WRITE_DEFAULTS,
): Promise<VaultBulkResponse> {
  if (ids.length > VAULT_BATCH_MAX)
    throw new VaultRequestError(
      "INVALID_DATA",
      `Delete batch has ${ids.length} ids (max ${VAULT_BATCH_MAX} per call)`,
      { errorClass: "structural" },
    );
  const unique = [...new Set(ids)];
  if (unique.length !== ids.length)
    throw new VaultRequestError(
      "INVALID_DATA",
      "Duplicate ids in delete batch",
      { errorClass: "structural" },
    );
  if (ids.length === 0)
    return { responseStatus: "SUCCESS", data: [], burst: { ...http.burst } };
  const headers: Record<string, string> = {};
  if (opts.migrationMode ?? defaults.migrationMode)
    headers["X-VaultAPI-MigrationMode"] = "true";
  const res = await http.request({
    method: "DELETE",
    path: `/vobjects/${encodeURIComponent(objectName)}`,
    body: ids.map((id) => ({ id })),
    headers,
    referenceId: opts.referenceId,
  });
  return mapBulkResponse(res.body, ids.length, res.burst, {
    url: res.url,
    method: "DELETE",
  });
}

/** RFC 4180 quoting for one CSV cell. */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Build a CSV document from rows (union of keys, in first-seen order). */
export function toCsv(rows: ReadonlyArray<Record<string, unknown>>): string {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const r of rows)
    for (const k of Object.keys(r))
      if (!seen.has(k)) {
        seen.add(k);
        columns.push(k);
      }
  const lines = [columns.map(csvCell).join(",")];
  for (const r of rows) lines.push(columns.map((c) => csvCell(r[c])).join(","));
  return lines.join("\n") + "\n";
}

/**
 * `POST /vobjects/{object}/actions/changetype` (CSV: `id`,
 * `object_type__v.api_name__v`, optional new-type field values). Side effects
 * (§2.5.6): fields absent on the new type are dropped; lifecycle state resets.
 */
export async function changeType(
  http: VaultHttp,
  objectName: string,
  rows: Array<{ id: string; objectType: string } & Record<string, unknown>>,
  opts: Pick<VaultWriteOptions, "referenceId" | "migrationMode"> = {},
  defaults: WriteDefaults = DEFAULT_WRITE_DEFAULTS,
): Promise<VaultBulkResponse> {
  if (rows.length > VAULT_BATCH_MAX)
    throw new VaultRequestError(
      "INVALID_DATA",
      `changetype batch has ${rows.length} rows (max ${VAULT_BATCH_MAX})`,
      { errorClass: "structural" },
    );
  if (rows.length === 0)
    return { responseStatus: "SUCCESS", data: [], burst: { ...http.burst } };
  const csvRows = rows.map(({ id, objectType, ...rest }) => ({
    id,
    "object_type__v.api_name__v": objectType,
    ...rest,
  }));
  const headers: Record<string, string> = {};
  if (opts.migrationMode ?? defaults.migrationMode)
    headers["X-VaultAPI-MigrationMode"] = "true";
  const res = await http.request({
    method: "POST",
    path: `/vobjects/${encodeURIComponent(objectName)}/actions/changetype`,
    body: toCsv(csvRows),
    contentType: "text/csv",
    headers,
    referenceId: opts.referenceId,
  });
  return mapBulkResponse(res.body, rows.length, res.burst, {
    url: res.url,
    method: "POST",
  });
}

/** `POST /vobjects/{object}/{id}/attachments` (multipart `file`) — needs `allow_attachments` (§8.6). */
export async function addAttachment(
  http: VaultHttp,
  objectName: string,
  id: string,
  file: { name: string; content: Uint8Array; contentType?: string },
  opts: Pick<VaultWriteOptions, "referenceId"> = {},
): Promise<void> {
  const form = new FormData();
  const bytes = new Uint8Array(file.content);
  form.set(
    "file",
    new Blob([bytes], { type: file.contentType ?? "application/octet-stream" }),
    file.name,
  );
  await http.request({
    method: "POST",
    path: `/vobjects/${encodeURIComponent(objectName)}/${encodeURIComponent(id)}/attachments`,
    body: form,
    referenceId: opts.referenceId,
  });
}

/** `POST /vobjects/{object}/{id}/actions/cascadedelete` (async) → job id. */
export async function cascadeDelete(
  http: VaultHttp,
  objectName: string,
  id: string,
  opts: Pick<VaultWriteOptions, "referenceId"> = {},
): Promise<{ jobId?: string; url?: string }> {
  const body = await http.json<Record<string, unknown>>({
    method: "POST",
    path: `/vobjects/${encodeURIComponent(objectName)}/${encodeURIComponent(id)}/actions/cascadedelete`,
    referenceId: opts.referenceId,
  });
  const out: { jobId?: string; url?: string } = {};
  if (body.job_id !== undefined) out.jobId = String(body.job_id);
  if (typeof body.url === "string") out.url = body.url;
  return out;
}

export interface VaultDeletedRecord {
  id: string;
  date_deleted?: string;
  [k: string]: unknown;
}

/**
 * `GET /objects/deletions/vobjects/{object}?start_date&end_date&limit&offset`
 * — Vault-side deleted ids for the last 30 days; paginated by offset.
 */
export async function* deletedRecords(
  http: VaultHttp,
  objectName: string,
  opts: {
    startDate?: string;
    endDate?: string;
    limit?: number;
    referenceId?: string;
  } = {},
): AsyncIterable<VaultDeletedRecord> {
  const limit = opts.limit ?? 1000;
  let offset = 0;
  for (;;) {
    const body = await http.json<Record<string, unknown>>({
      method: "GET",
      path: `/objects/deletions/vobjects/${encodeURIComponent(objectName)}`,
      query: {
        start_date: opts.startDate,
        end_date: opts.endDate,
        limit,
        offset,
      },
      referenceId: opts.referenceId,
    });
    const data = Array.isArray(body.data) ? body.data : [];
    for (const raw of data) {
      const r = (raw ?? {}) as Record<string, unknown>;
      const rec: VaultDeletedRecord = { ...r, id: String(r.id ?? "") };
      if (r.date_deleted !== undefined)
        rec.date_deleted = String(r.date_deleted);
      yield rec;
    }
    const details = (body.responseDetails ?? {}) as Record<string, unknown>;
    const total = Number(details.total);
    offset += data.length;
    if (
      data.length === 0 ||
      data.length < limit ||
      (Number.isFinite(total) && offset >= total)
    )
      return;
  }
}

export type ActionAvailability = "available" | "absent";

/** Actions the tool may invoke through `objectAction` (§2.5.6). */
export const KNOWN_OBJECT_ACTIONS = [
  "merge",
  "changetype",
  "updatecorporatecurrency",
  "recalculaterollups",
  "cascadedelete",
] as const;

/**
 * Probe whether `/vobjects/{object}/actions/{action}` exists (§2.5.6
 * `postLoad.recalculateRollups = auto`): scan the object's `urls{}` for an
 * action whose key or path contains the action name, then `OPTIONS` (falling
 * back to `GET`) on the candidate path. `MALFORMED_URL` / `METHOD_NOT_SUPPORTED`
 * / HTTP 404–405 mean absent; a permission error means the path exists.
 */
export async function probeObjectAction(
  http: VaultHttp,
  objectName: string,
  action: string,
  metadata?: () => Promise<{ urls?: Record<string, string> }>,
): Promise<{ availability: ActionAvailability; path?: string; via: string }> {
  const needle = action.toLowerCase().replace(/[^a-z]/g, "");
  try {
    const meta = metadata
      ? await metadata()
      : await objectMetadata(http, objectName);
    for (const [key, url] of Object.entries(meta.urls ?? {})) {
      const k = key.toLowerCase().replace(/[^a-z]/g, "");
      const u = url.toLowerCase();
      if (k.includes(needle) || u.includes(`/actions/${action.toLowerCase()}`))
        return { availability: "available", path: url, via: "metadata.urls" };
    }
  } catch {
    // metadata unavailable → fall through to the path probe
  }
  const path = `/vobjects/${encodeURIComponent(objectName)}/actions/${encodeURIComponent(action)}`;
  for (const method of ["OPTIONS", "GET"] as const) {
    try {
      const res = await http.request({
        method,
        path,
        retry: false,
        allowFailure: true,
      });
      const status = res.responseStatus;
      const errType =
        (res.body as { errors?: Array<{ type?: string }> })?.errors?.[0]
          ?.type ?? "";
      if (res.httpStatus === 404 || res.httpStatus === 405) continue;
      if (
        status === "FAILURE" &&
        (errType.startsWith("MALFORMED_URL") ||
          errType.startsWith("METHOD_NOT_SUPPORTED"))
      )
        continue;
      return { availability: "available", path, via: method };
    } catch (e) {
      const err = e as VaultRequestError;
      if (err instanceof VaultRequestError && err.errorClass === "permission")
        return { availability: "available", path, via: method };
      // MALFORMED_URL / 404 / anything else: keep probing
    }
  }
  return { availability: "absent", via: "probe" };
}

/**
 * `POST /vobjects/{object}/actions/{action}` behind `probeObjectAction`
 * (cached per client by the caller). Returns `ok: false` with a message when
 * the action is absent instead of throwing — the caller turns it into
 * `VT_ROLLUP_RECALC_UNAVAILABLE` / `VT_CORP_CURRENCY_UNAVAILABLE`.
 */
export async function objectAction(
  http: VaultHttp,
  objectName: string,
  action: string,
  body: Record<string, unknown> | undefined,
  availability: ActionAvailability,
  opts: Pick<VaultWriteOptions, "referenceId"> = {},
): Promise<{ ok: boolean; jobId?: string; message?: string }> {
  if (availability === "absent")
    return {
      ok: false,
      message: `Action [${action}] is not available on [${objectName}]`,
    };
  const res = await http.request<Record<string, unknown>>({
    method: "POST",
    path: `/vobjects/${encodeURIComponent(objectName)}/actions/${encodeURIComponent(action)}`,
    body: body && Object.keys(body).length ? body : undefined,
    referenceId: opts.referenceId,
  });
  const out: { ok: boolean; jobId?: string; message?: string } = { ok: true };
  if (res.body.job_id !== undefined) out.jobId = String(res.body.job_id);
  if (typeof res.body.responseMessage === "string")
    out.message = res.body.responseMessage;
  return out;
}

export interface MergeSet {
  main_record_id: string;
  duplicate_record_id: string;
}

/** `POST /vobjects/account__v/actions/merge` — ≤ 10 sets per call (§2.5.6; body shape `[API]`). */
export async function mergeRecords(
  http: VaultHttp,
  objectName: string,
  sets: MergeSet[],
  opts: Pick<VaultWriteOptions, "referenceId"> = {},
): Promise<{ ok: boolean; jobId?: string; message?: string; data?: unknown }> {
  if (sets.length === 0) return { ok: true };
  if (sets.length > MERGE_SETS_MAX)
    throw new VaultRequestError(
      "INVALID_DATA",
      `merge accepts at most ${MERGE_SETS_MAX} sets per call (got ${sets.length})`,
      { errorClass: "structural" },
    );
  const res = await http.request<Record<string, unknown>>({
    method: "POST",
    path: `/vobjects/${encodeURIComponent(objectName)}/actions/merge`,
    body: sets,
    referenceId: opts.referenceId,
  });
  const out: { ok: boolean; jobId?: string; message?: string; data?: unknown } =
    { ok: true };
  if (res.body.job_id !== undefined) out.jobId = String(res.body.job_id);
  if (typeof res.body.responseMessage === "string")
    out.message = res.body.responseMessage;
  if (res.body.data !== undefined) out.data = res.body.data;
  return out;
}
