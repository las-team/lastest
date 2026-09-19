/**
 * MDL (§2.5.6, `--allow-mdl` only): `POST /api/mdl/execute` (no version
 * segment) with the raw script, `POST /api/mdl/execute_async` +
 * `GET /api/mdl/execute_async/{job_id}/results` (mandatory for objects with
 * ≥ 10,000 records when adding fields), and the `ALTER Object … ADD Field`
 * builder for the legacy-id field with `unique(true)`.
 *
 * The request `Content-Type` for the raw script is `[UNVERIFIED]`
 * (`application/json` in the public examples) — configurable.
 */
import { VaultRequestError } from "./errors";
import type { VaultHttp } from "./http";
import { defaultSleep, type SleepFn } from "./retry";

export const MDL_STATEMENT_START = /^\s*(CREATE|RECREATE|RENAME|ALTER|DROP)\b/i;

/** Every MDL script the tool sends must start with one of the verbs the API accepts. */
export function assertMdlStatement(mdl: string): void {
  if (!MDL_STATEMENT_START.test(mdl))
    throw new VaultRequestError(
      "INVALID_DATA",
      "MDL script must start with CREATE|RECREATE|RENAME|ALTER|DROP",
      { errorClass: "structural" },
    );
}

/** Escape a string for an MDL `'…'` literal (backslash escaping, mirrors VQL). */
export function mdlString(value: string): string {
  if (/[\r\n]/.test(value))
    throw new VaultRequestError(
      "INVALID_DATA",
      "MDL string literals cannot contain line breaks",
      { errorClass: "structural" },
    );
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

const COMPONENT_NAME = /^[a-z][a-z0-9_]*__(v|c|sys)$/;

/** Component (object/field) API names accepted in generated MDL. */
export function assertMdlName(name: string, what: string): void {
  if (!COMPONENT_NAME.test(name))
    throw new VaultRequestError(
      "INVALID_DATA",
      `Invalid ${what} API name for MDL: [${name}]`,
      { errorClass: "structural" },
    );
}

export interface AddFieldMdlOptions {
  object: string;
  field: string;
  label: string;
  /** Vault field type (default `String`). */
  type?: "String" | "Number" | "Boolean" | "Date" | "DateTime" | "LongText";
  maxLength?: number;
  active?: boolean;
  required?: boolean;
  listColumn?: boolean;
  unique?: boolean;
  order?: number;
  /** Extra `name(value)` attributes appended verbatim after `order(...)`. */
  extra?: Record<string, string | number | boolean>;
}

function attr(value: string | number | boolean): string {
  return typeof value === "string" ? mdlString(value) : String(value);
}

/**
 * Verified syntax (§2.5.6):
 * ```
 * ALTER Object call2__v (
 *   ADD Field legacy_crm_id__c(
 *     label('Legacy CRM ID'), type('String'), max_length(18), active(true), required(false),
 *     list_column(false), unique(true), order(0))
 * );
 * ```
 */
export function buildAlterAddFieldMdl(opts: AddFieldMdlOptions): string {
  assertMdlName(opts.object, "object");
  assertMdlName(opts.field, "field");
  const type = opts.type ?? "String";
  const parts: string[] = [
    `label(${mdlString(opts.label)})`,
    `type(${mdlString(type)})`,
  ];
  if (type === "String" || type === "LongText")
    parts.push(`max_length(${opts.maxLength ?? 18})`);
  parts.push(
    `active(${opts.active ?? true})`,
    `required(${opts.required ?? false})`,
    `list_column(${opts.listColumn ?? false})`,
    `unique(${opts.unique ?? true})`,
    `order(${opts.order ?? 0})`,
  );
  for (const [k, v] of Object.entries(opts.extra ?? {})) {
    if (!/^[a-z_]+$/.test(k))
      throw new VaultRequestError(
        "INVALID_DATA",
        `Invalid MDL attribute name [${k}]`,
        { errorClass: "structural" },
      );
    parts.push(`${k}(${attr(v)})`);
  }
  return [
    `ALTER Object ${opts.object} (`,
    `  ADD Field ${opts.field}(`,
    `    ${parts.join(", ")})`,
    `);`,
  ].join("\n");
}

/** The §2.4 legacy-id field: `String(18)`, `unique(true)`, inactive-safe defaults. */
export function buildLegacyIdFieldMdl(
  object: string,
  field: string,
  opts: { label?: string; maxLength?: number } = {},
): string {
  return buildAlterAddFieldMdl({
    object,
    field,
    label: opts.label ?? "Legacy CRM ID",
    type: "String",
    maxLength: opts.maxLength ?? 18,
    unique: true,
    required: false,
    active: true,
    listColumn: false,
    order: 0,
  });
}

export interface MdlExecuteResult {
  ok: boolean;
  jobId?: string;
  message?: string;
  /** Raw envelope for auditing. */
  body?: unknown;
}

export interface MdlOptions {
  contentType?: string;
  referenceId?: string;
}

function resultOf(body: unknown): MdlExecuteResult {
  const o = (body ?? {}) as Record<string, unknown>;
  const out: MdlExecuteResult = {
    ok: String(o.responseStatus ?? "SUCCESS").toUpperCase() !== "FAILURE",
    body,
  };
  if (o.job_id !== undefined) out.jobId = String(o.job_id);
  else if (o.jobId !== undefined) out.jobId = String(o.jobId);
  if (typeof o.responseMessage === "string") out.message = o.responseMessage;
  else if (typeof o.message === "string") out.message = o.message;
  return out;
}

/** `POST /api/mdl/execute` — synchronous. */
export async function executeMdl(
  http: VaultHttp,
  mdl: string,
  opts: MdlOptions = {},
): Promise<MdlExecuteResult> {
  assertMdlStatement(mdl);
  const res = await http.request({
    method: "POST",
    path: "/api/mdl/execute",
    absolute: true,
    body: mdl,
    contentType: opts.contentType ?? "application/json",
    referenceId: opts.referenceId,
    retry: false,
  });
  return resultOf(res.body);
}

/** `POST /api/mdl/execute_async` → `job_id`. */
export async function executeMdlAsync(
  http: VaultHttp,
  mdl: string,
  opts: MdlOptions = {},
): Promise<MdlExecuteResult> {
  assertMdlStatement(mdl);
  const res = await http.request({
    method: "POST",
    path: "/api/mdl/execute_async",
    absolute: true,
    body: mdl,
    contentType: opts.contentType ?? "application/json",
    referenceId: opts.referenceId,
    retry: false,
  });
  return resultOf(res.body);
}

export type MdlJobStatus = "running" | "success" | "failure";

export interface MdlJobResult {
  status: MdlJobStatus;
  message?: string;
  body?: unknown;
}

/** `GET /api/mdl/execute_async/{job_id}/results`. */
export async function mdlResults(
  http: VaultHttp,
  jobId: string,
): Promise<MdlJobResult> {
  const res = await http.request<Record<string, unknown>>({
    method: "GET",
    path: `/api/mdl/execute_async/${encodeURIComponent(jobId)}/results`,
    absolute: true,
    allowFailure: true,
  });
  const o = res.body ?? {};
  const rs = String(o.responseStatus ?? "").toUpperCase();
  const jobStatus = String(
    (o.job_status ??
      o.status ??
      (o.data as Record<string, unknown>)?.status ??
      "") as string,
  ).toUpperCase();
  let status: MdlJobStatus;
  if (rs === "FAILURE" || rs === "EXCEPTION") status = "failure";
  else if (/RUNNING|QUEUED|SCHEDULED|IN_PROGRESS|PENDING/.test(jobStatus))
    status = "running";
  else if (/ERROR|FAIL/.test(jobStatus)) status = "failure";
  else status = "success";
  const out: MdlJobResult = { status, body: o };
  const err = (o.errors as Array<{ message?: string }> | undefined)?.[0];
  if (typeof o.responseMessage === "string") out.message = o.responseMessage;
  else if (err?.message) out.message = err.message;
  return out;
}

/** Poll `mdlResults` at most once per 10 s (§2.5.2 job-status limit). */
export async function waitForMdlJob(
  http: VaultHttp,
  jobId: string,
  opts: {
    pollMs?: number;
    timeoutMs?: number;
    sleep?: SleepFn;
    now?: () => number;
  } = {},
): Promise<MdlJobResult> {
  const pollMs = Math.max(10_000, opts.pollMs ?? 10_000);
  const timeoutMs = opts.timeoutMs ?? 30 * 60_000;
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;
  const started = now();
  for (;;) {
    const r = await mdlResults(http, jobId);
    if (r.status !== "running") return r;
    if (now() - started > timeoutMs)
      return {
        status: "running",
        message: `MDL job ${jobId} still running after ${timeoutMs} ms`,
        body: r.body,
      };
    await sleep(pollMs);
  }
}

/** `GET /api/mdl/components/Object.{object}` — read back the object's MDL script (raw text). */
export async function readObjectMdl(
  http: VaultHttp,
  objectName: string,
): Promise<string> {
  const res = await http.request<string>({
    method: "GET",
    path: `/api/mdl/components/Object.${encodeURIComponent(objectName)}`,
    absolute: true,
    raw: true,
    accept: "text/plain, application/json",
  });
  return res.body;
}
