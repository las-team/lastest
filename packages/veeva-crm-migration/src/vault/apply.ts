/**
 * Executes a `VaultPlan` against a `VaultClient`.
 *
 * - steps run in topological order (`orderSteps`)
 * - `manual` steps are reported as `manual`
 * - `dryRun` (default in the CLI) sends nothing: every automated step is
 *   `skipped` with a message describing the request it would make
 * - `review` steps are skipped unless `allowReview`
 * - idempotency (`precheckStep`): every automated step is pre-checked before
 *   it runs and `skipped` with `already present` when its target exists:
 *     - `CREATE Object` / `CREATE Picklist` → the metadata / picklist endpoints
 *     - any other `CREATE <Type> <name>` (Permissionset, Securityprofile,
 *       Pagelayout, …) → `GET /configuration/{Type}.{name}`
 *     - `ALTER Object … ADD Field` / `ADD Objecttype` → field / object metadata
 *     - `POST /vobjects/{object}` → VQL `SELECT id … WHERE name__v = '…'`; an
 *       existing record is updated with `PUT /vobjects/{object}/{id}` instead
 *     - `POST /objects/picklists/{name}` → values already present are dropped
 *   Only a positive not-found answer counts as absent; any other error from a
 *   precheck fails the step, so a transient error can never turn into a run
 *   against a component that does exist.
 * - object-record bodies are sent as `[ { … } ]` (bulk create); the per-record
 *   `data[]` status is checked, not just the envelope
 * - `api` steps may capture a record id (`captures.recordId`) that later
 *   steps reference as `{{step:<id>.recordId}}`
 * - stops on the first failure unless `continueOnError`; remaining steps are
 *   `skipped` with `not run: <id> failed`
 */
import type {
  ApplyReport,
  ApplyStepResult,
  PlanStep,
  VaultApiCall,
  VaultPlan,
} from "../model/types";
import {
  VaultApiError,
  type MdlResult,
  type VaultClient,
  type VaultRequest,
  type VaultResponse,
} from "./client";
import { mapPicklistValueName } from "./mapping";
import { orderSteps, parsePlaceholder } from "./plan";

export interface ApplyOptions {
  dryRun: boolean;
  log?: (message: string) => void;
  now?: () => Date;
  /** Keep going after a failed step (dependants of the failure are still skipped). */
  continueOnError?: boolean;
  /** Run steps flagged `review` (generated from an unverified grammar / mapping). */
  allowReview?: boolean;
  /** Use `POST /mdl/execute_async` for MDL steps (needed for high-volume objects). */
  asyncMdl?: boolean;
}

export interface Precheck {
  exists: boolean;
  detail?: string;
  /** Id of the record that already exists (`api` record steps): applied as a `PUT` to it. */
  recordId?: string;
  /** `api` steps: body to send instead of the step's (values already present removed). */
  body?: Record<string, unknown>;
}

/** What an MDL script creates, read from its first statement. */
export type MdlTarget =
  | { kind: "component"; type: string; name: string }
  | { kind: "field"; object: string; name: string }
  | { kind: "objecttype"; object: string; name: string };

const MDL_CREATE = /^(?:CREATE|RECREATE)\s+([A-Za-z]+)\s+([A-Za-z0-9_.]+)/i;
const MDL_ALTER_ADD =
  /^ALTER\s+Object\s+([A-Za-z0-9_]+)\s*\(\s*ADD\s+(Field|Objecttype)\s+([A-Za-z0-9_]+)/i;

/** Parses `CREATE <Type> <name>` / `ALTER Object <o> ( ADD Field|Objecttype <n>` from a script. */
export function mdlTarget(mdl: string): MdlTarget | null {
  const head = mdl
    .split("\n")
    .filter((l) => !/^\s*--/.test(l))
    .join("\n")
    .trim();
  const create = MDL_CREATE.exec(head);
  if (create) return { kind: "component", type: create[1]!, name: create[2]! };
  const alter = MDL_ALTER_ADD.exec(head);
  if (alter)
    return {
      kind: alter[2]!.toLowerCase() === "field" ? "field" : "objecttype",
      object: alter[1]!,
      name: alter[3]!,
    };
  return null;
}

const NOT_FOUND_TYPES = new Set(["INVALID_DATA", "MALFORMED_URL", "NOT_FOUND"]);
const NOT_FOUND_MESSAGE =
  /does not exist|not exist|not found|no such|unknown|not a valid|invalid (?:object|field|picklist|component|name|record)/i;

/**
 * True only for a positive "no such component / record" answer: HTTP 404, or
 * a Vault error whose type and message both say so. A 5xx, 429, permission
 * or session error is NOT not-found — the caller must fail instead of guessing.
 */
export function isNotFoundError(err: unknown): boolean {
  if (!(err instanceof VaultApiError)) return false;
  if (err.status === 404) return true;
  return err.errors.some(
    (e) => NOT_FOUND_TYPES.has(e.type) && NOT_FOUND_MESSAGE.test(e.message),
  );
}

/** Escapes a string literal for VQL (`'…'`). */
export function vqlString(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

const RECORD_PATH = /^\/vobjects\/([A-Za-z0-9_]+)$/;
const PICKLIST_PATH = /^\/objects\/picklists\/([A-Za-z0-9_]+)$/;

async function existsOrNotFound(
  probe: () => Promise<unknown>,
  detail: string,
): Promise<Precheck> {
  try {
    await probe();
    return { exists: true, detail };
  } catch (err) {
    if (isNotFoundError(err)) return { exists: false };
    throw err;
  }
}

async function precheckMdl(
  client: VaultClient,
  target: MdlTarget,
): Promise<Precheck> {
  switch (target.kind) {
    case "component": {
      const type = target.type.toLowerCase();
      if (type === "object")
        return existsOrNotFound(
          () => client.getObjectMetadata(target.name),
          `object ${target.name} present`,
        );
      if (type === "picklist")
        return existsOrNotFound(
          () =>
            client.request({
              method: "GET",
              path: `/objects/picklists/${target.name}`,
            }),
          `picklist ${target.name} present`,
        );
      const component = `${target.type}.${target.name}`;
      return existsOrNotFound(
        () =>
          client.request({
            method: "GET",
            path: `/configuration/${component}`,
          }),
        `${component} present`,
      );
    }
    case "field":
      return existsOrNotFound(
        () =>
          client.request({
            method: "GET",
            path: `/metadata/vobjects/${target.object}/fields/${target.name}`,
          }),
        `field ${target.object}.${target.name} present`,
      );
    case "objecttype": {
      let found = false;
      try {
        const meta = await client.getObjectMetadata(target.object);
        found = (meta.object_types ?? []).some((t) => t.name === target.name);
      } catch (err) {
        if (!isNotFoundError(err)) throw err;
      }
      return {
        exists: found,
        detail: found
          ? `object type ${target.object}.${target.name} present`
          : undefined,
      };
    }
  }
}

interface PicklistValuesResponse extends VaultResponse {
  picklistValues?: { name?: string; label?: string; status?: string }[];
}

async function precheckApi(
  client: VaultClient,
  call: VaultApiCall,
): Promise<Precheck> {
  if (call.method !== "POST" || !call.body) return { exists: false };
  const record = RECORD_PATH.exec(call.path);
  if (record) {
    const object = record[1]!;
    const name = call.body.name__v;
    if (typeof name !== "string" || !name) return { exists: false };
    const scope: string[] = [`name__v = ${vqlString(name)}`];
    const profile = call.body.application_profile__v;
    if (typeof profile === "string" && profile && !parsePlaceholder(profile))
      scope.push(`application_profile__v = ${vqlString(profile)}`);
    const rows = await client.query<{ id?: string | number }>(
      `SELECT id FROM ${object} WHERE ${scope.join(" AND ")}`,
    );
    const ids = rows
      .map((r) => r.id)
      .filter((id): id is string | number => id !== undefined && id !== null)
      .map(String);
    const id = ids[0];
    if (id === undefined) return { exists: false };
    return {
      exists: true,
      recordId: id,
      detail: `${object} record "${name}" exists (${id}${ids.length > 1 ? `, ${ids.length} matches` : ""})`,
    };
  }
  const picklist = PICKLIST_PATH.exec(call.path);
  if (picklist) {
    const res = await client.request<PicklistValuesResponse>({
      method: "GET",
      path: call.path,
    });
    const labels = new Set<string>();
    const names = new Set<string>();
    for (const v of res.picklistValues ?? []) {
      if (typeof v.label === "string") labels.add(v.label.trim().toLowerCase());
      if (typeof v.name === "string") names.add(v.name.toLowerCase());
    }
    const wanted = Object.entries(call.body)
      .filter(([k]) => /^value_\d+$/.test(k))
      .map(([, v]) => String(v));
    const missing = wanted.filter(
      (label) =>
        !labels.has(label.trim().toLowerCase()) &&
        !names.has(mapPicklistValueName(label).toLowerCase()),
    );
    if (!missing.length)
      return {
        exists: true,
        detail: `picklist ${picklist[1]} already has ${wanted.length === 1 ? "the value" : `all ${wanted.length} values`}`,
      };
    const body: Record<string, unknown> = {};
    missing.forEach((label, i) => (body[`value_${i + 1}`] = label));
    return {
      exists: false,
      body,
      detail:
        missing.length < wanted.length
          ? `${wanted.length - missing.length} of ${wanted.length} values already present`
          : undefined,
    };
  }
  return { exists: false };
}

/**
 * Returns `exists: true` when the component / record a step creates is
 * already in the vault. `captures` resolves `{{step:…}}` placeholders in the
 * API body first (needed to scope a VMOC / settings lookup to its
 * application profile). Throws (a `VaultApiError`) when the vault could not
 * answer — never guesses "absent".
 */
export async function precheckStep(
  client: VaultClient,
  step: PlanStep,
  captures: Readonly<Record<string, { recordId: string }>> = {},
): Promise<Precheck> {
  if (step.kind === "mdl") {
    if (!step.mdl) return { exists: false };
    const target = mdlTarget(step.mdl);
    if (!target)
      return { exists: false, detail: "no precheck: unrecognised MDL head" };
    return precheckMdl(client, target);
  }
  if (step.kind === "api" && step.api) {
    const body = step.api.body
      ? (resolvePlaceholders(step.api.body, captures) as Record<
          string,
          unknown
        >)
      : undefined;
    return precheckApi(client, { ...step.api, body });
  }
  return { exists: false };
}

/** Replaces `{{step:<id>.recordId}}` strings anywhere in `body`; throws on an unknown capture. */
export function resolvePlaceholders(
  body: unknown,
  captures: Readonly<Record<string, { recordId: string }>>,
): unknown {
  if (typeof body === "string") {
    const id = parsePlaceholder(body);
    if (id === null) return body;
    const cap = captures[id];
    if (!cap) throw new Error(`no record id captured from step ${id}`);
    return cap.recordId;
  }
  if (Array.isArray(body))
    return body.map((v) => resolvePlaceholders(v, captures));
  if (body && typeof body === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body))
      out[k] = resolvePlaceholders(v, captures);
    return out;
  }
  return body;
}

/** Finds the created record id in a Vault object-record response. */
export function extractRecordId(response: unknown): string | undefined {
  if (!response || typeof response !== "object") return undefined;
  const r = response as Record<string, unknown>;
  const direct = r.id ?? r.record_id;
  if (typeof direct === "string" || typeof direct === "number")
    return String(direct);
  const data = r.data;
  const first = Array.isArray(data) ? data[0] : data;
  if (first && typeof first === "object") {
    const f = first as Record<string, unknown>;
    const id = f.id ?? (f.data as Record<string, unknown> | undefined)?.id;
    if (typeof id === "string" || typeof id === "number") return String(id);
  }
  return undefined;
}

/**
 * Per-record failures of an object-record create / update (`data[]` items
 * whose `responseStatus` is not `SUCCESS`), or `null` when every record
 * succeeded. The outer envelope is `SUCCESS` even when a record fails.
 */
export function recordFailureMessage(response: unknown): string | null {
  if (!response || typeof response !== "object") return null;
  const data = (response as Record<string, unknown>).data;
  const items = Array.isArray(data)
    ? data
    : data && typeof data === "object"
      ? [data]
      : [];
  const bad = items.filter(
    (i): i is Record<string, unknown> =>
      !!i &&
      typeof i === "object" &&
      typeof (i as Record<string, unknown>).responseStatus === "string" &&
      (i as Record<string, unknown>).responseStatus !== "SUCCESS",
  );
  if (!bad.length) return null;
  return bad
    .map((i) => {
      const errors = Array.isArray(i.errors) ? i.errors : [];
      const details = errors
        .map((e) =>
          e && typeof e === "object"
            ? `${(e as Record<string, unknown>).type ?? "ERROR"}: ${(e as Record<string, unknown>).message ?? JSON.stringify(e)}`
            : String(e),
        )
        .join("; ");
      return `${String(i.responseStatus)}${details ? `: ${details}` : ""}`;
    })
    .join(" | ");
}

/** Failures / exceptions reported per statement, or `null` when the script ran clean. */
export function mdlFailureMessage(result: MdlResult): string | null {
  const bad = (result.statement_execution ?? []).filter(
    (s) =>
      (Array.isArray(s.failures) && s.failures.length) ||
      (Array.isArray(s.exceptions) && s.exceptions.length) ||
      (typeof s.response === "string" && /FAIL|EXCEPTION/i.test(s.response)),
  );
  if (!bad.length) return null;
  return bad
    .map((s) => {
      const details = [...(s.failures ?? []), ...(s.exceptions ?? [])]
        .map((d) => (typeof d === "string" ? d : JSON.stringify(d)))
        .join("; ");
      return `${s.response ?? "FAILURE"}${s.message ? ` ${s.message}` : ""}${details ? `: ${details}` : ""}`;
    })
    .join(" | ");
}

function describeCall(call: VaultApiCall): string {
  const body = call.body ? ` body ${JSON.stringify(call.body)}` : "";
  return `${call.method} ${call.path}${body}`;
}

function firstLine(mdl: string): string {
  return mdl.split("\n")[0]?.trim() ?? "";
}

/** Object-record creates go out as a one-element array (Vault's bulk shape); everything else as is. */
function toRequest(call: VaultApiCall): VaultRequest {
  if (
    call.method === "POST" &&
    RECORD_PATH.test(call.path) &&
    call.body &&
    (call.contentType ?? "application/json") === "application/json"
  )
    return { ...call, body: [call.body] };
  return call;
}

export async function applyVaultPlan(
  client: VaultClient,
  plan: VaultPlan,
  options: ApplyOptions,
): Promise<ApplyReport> {
  const log = options.log ?? (() => {});
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const ordered = orderSteps(plan.steps);
  const results: ApplyStepResult[] = [];
  const status = new Map<string, ApplyStepResult["status"]>();
  const blockedBy = new Map<string, string>();
  const captures: Record<string, { recordId: string }> = {};
  let haltedBy: string | null = null;

  const record = (r: ApplyStepResult): void => {
    results.push(r);
    status.set(r.stepId, r.status);
  };
  const fail = (r: Omit<ApplyStepResult, "status">): void => {
    record({ ...r, status: "failed" });
    if (!options.continueOnError) haltedBy = r.stepId;
  };
  const precheck = async (step: PlanStep): Promise<Precheck> => {
    try {
      return await precheckStep(client, step, captures);
    } catch (err) {
      if (err instanceof VaultApiError)
        throw new VaultApiError(`precheck failed: ${err.message}`, err);
      throw err;
    }
  };

  for (const step of ordered) {
    if (step.kind === "manual") {
      record({ stepId: step.id, status: "manual", message: step.title });
      continue;
    }
    if (haltedBy) {
      record({
        stepId: step.id,
        status: "skipped",
        message: `not run: ${haltedBy} failed`,
      });
      continue;
    }
    const failedDep = step.dependsOn.find(
      (d) => status.get(d) === "failed" || blockedBy.has(d),
    );
    if (failedDep) {
      const root = blockedBy.get(failedDep) ?? failedDep;
      blockedBy.set(step.id, root);
      record({
        stepId: step.id,
        status: "skipped",
        message: `not run: ${root} failed`,
      });
      continue;
    }
    if (options.dryRun) {
      const what =
        step.kind === "mdl"
          ? `dry-run: would execute MDL ${firstLine(step.mdl ?? "")} (${(step.mdl ?? "").length} chars)`
          : `dry-run: would call ${step.api ? describeCall(step.api) : "?"}`;
      record({
        stepId: step.id,
        status: "skipped",
        message: step.review ? `${what} [review]` : what,
      });
      continue;
    }
    if (step.review && !options.allowReview) {
      record({
        stepId: step.id,
        status: "skipped",
        message:
          "review required: generated from an unverified grammar/mapping (pass allowReview to run)",
      });
      continue;
    }
    try {
      if (step.kind === "mdl") {
        if (!step.mdl) throw new Error("mdl step without a script");
        const pre = await precheck(step);
        if (pre.exists) {
          log(`${step.id}: already present, skipping`);
          record({
            stepId: step.id,
            status: "skipped",
            message: `already present: ${pre.detail ?? ""}`.trim(),
          });
          continue;
        }
        log(`${step.id}: executing MDL`);
        const result = await client.executeMdl(step.mdl, {
          async: options.asyncMdl,
        });
        const failure = mdlFailureMessage(result);
        if (failure) {
          fail({ stepId: step.id, message: failure, response: result });
          continue;
        }
        record({
          stepId: step.id,
          status: "applied",
          message: "MDL executed",
          response: result,
        });
      } else {
        if (!step.api) throw new Error("api step without a call");
        const pre = await precheck(step);
        if (pre.exists && !pre.recordId) {
          log(`${step.id}: already present, skipping`);
          record({
            stepId: step.id,
            status: "skipped",
            message: `already present: ${pre.detail ?? ""}`.trim(),
          });
          continue;
        }
        const body = step.api.body
          ? (resolvePlaceholders(step.api.body, captures) as Record<
              string,
              unknown
            >)
          : undefined;
        let call: VaultApiCall = {
          ...step.api,
          body: pre.body ?? body,
        };
        if (pre.recordId) {
          call = {
            ...call,
            method: "PUT",
            path: `${call.path}/${pre.recordId}`,
          };
        }
        log(`${step.id}: ${call.method} ${call.path}`);
        const response = await client.request<VaultResponse>(toRequest(call));
        let message = `${call.method} ${call.path} → SUCCESS`;
        if (pre.detail) message += ` (${pre.detail})`;
        const isRecord = call.path.startsWith("/vobjects/");
        if (isRecord) {
          const failure = recordFailureMessage(response);
          if (failure) {
            fail({
              stepId: step.id,
              message: `${call.method} ${call.path} → record ${failure}`,
              response,
            });
            continue;
          }
          const data = (response as Record<string, unknown>).data;
          if (call.method === "POST" && Array.isArray(data) && !data.length) {
            fail({
              stepId: step.id,
              message: `${message} but no record in the response`,
              response,
            });
            continue;
          }
        }
        if (step.captures) {
          const id = pre.recordId ?? extractRecordId(response);
          if (id) {
            captures[step.id] = { recordId: id };
            message += ` (record ${id})`;
          } else {
            fail({
              stepId: step.id,
              message: `${message} but no record id in the response`,
              response,
            });
            continue;
          }
        }
        record({ stepId: step.id, status: "applied", message, response });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`${step.id}: failed: ${message}`);
      fail({
        stepId: step.id,
        message,
        response: err instanceof VaultApiError ? err.body : undefined,
      });
    }
  }

  return {
    startedAt,
    finishedAt: now().toISOString(),
    dryRun: options.dryRun,
    results,
    ok: results.every((r) => r.status !== "failed"),
  };
}

/** Markdown rendering of an apply report (`| # | Step | Kind | Country | Status | Message |`). */
export function renderApplyReport(
  report: ApplyReport,
  plan: VaultPlan,
): string {
  const byId = new Map(plan.steps.map((s) => [s.id, s]));
  const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const lines = [
    `# Vault CRM apply report`,
    "",
    `- mode: ${report.dryRun ? "dry-run" : "apply"}`,
    `- started: ${report.startedAt}`,
    `- finished: ${report.finishedAt}`,
    `- result: ${report.ok ? "ok" : "FAILED"}`,
    "",
    "| # | Step | Kind | Country | Status | Message |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  report.results.forEach((r, i) => {
    const step = byId.get(r.stepId);
    lines.push(
      `| ${i + 1} | ${cell(r.stepId)} | ${step?.kind ?? ""} | ${step?.country ?? ""} | ${r.status} | ${cell(r.message ?? "")} |`,
    );
  });
  const failures = report.results.filter((r) => r.status === "failed");
  if (failures.length) {
    lines.push("", "## Failures", "");
    for (const f of failures) {
      lines.push(`### ${f.stepId}`, "", f.message ?? "", "");
      if (f.response !== undefined)
        lines.push("```json", JSON.stringify(f.response, null, 2), "```", "");
    }
  }
  return lines.join("\n") + "\n";
}
