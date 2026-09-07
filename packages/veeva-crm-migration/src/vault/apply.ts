/**
 * Executes a `VaultPlan` against a `VaultClient`.
 *
 * - steps run in topological order (`orderSteps`)
 * - `manual` steps are reported as `manual`
 * - `dryRun` (default in the CLI) sends nothing: every automated step is
 *   `skipped` with a message describing the request it would make
 * - `review` steps are skipped unless `allowReview`
 * - idempotency: `obj:` / `field:` / `picklist:` / `objecttype:` MDL steps
 *   are pre-checked against the metadata endpoints and skipped when present
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
  type VaultResponse,
} from "./client";
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
}

/** Vault object / field / picklist / object type named by an MDL step id. */
function targetOf(step: PlanStep): {
  kind: "obj" | "field" | "picklist" | "objecttype";
  object?: string;
  name: string;
} | null {
  const m = /^(obj|field|picklist|objecttype):(.+)$/.exec(step.id);
  if (!m) return null;
  const kind = m[1] as "obj" | "field" | "picklist" | "objecttype";
  const rest = m[2]!;
  if (kind === "obj" || kind === "picklist") return { kind, name: rest };
  const dot = rest.indexOf(".");
  if (dot < 0) return null;
  return { kind, object: rest.slice(0, dot), name: rest.slice(dot + 1) };
}

/** Returns `exists: true` when the component an MDL step creates is already in the vault. */
export async function precheckStep(
  client: VaultClient,
  step: PlanStep,
): Promise<Precheck> {
  const target = targetOf(step);
  if (!target || step.kind !== "mdl") return { exists: false };
  const absent = (err: unknown): Precheck => {
    if (err instanceof VaultApiError)
      return { exists: false, detail: err.message };
    throw err;
  };
  try {
    switch (target.kind) {
      case "obj": {
        const meta = await client.getObjectMetadata(target.name);
        return { exists: !!meta, detail: `object ${target.name} present` };
      }
      case "field": {
        await client.request({
          method: "GET",
          path: `/metadata/vobjects/${target.object}/fields/${target.name}`,
        });
        return {
          exists: true,
          detail: `field ${target.object}.${target.name} present`,
        };
      }
      case "picklist": {
        await client.request({
          method: "GET",
          path: `/objects/picklists/${target.name}`,
        });
        return { exists: true, detail: `picklist ${target.name} present` };
      }
      case "objecttype": {
        const meta = await client.getObjectMetadata(target.object!);
        const found = (meta.object_types ?? []).some(
          (t) => t.name === target.name,
        );
        return {
          exists: found,
          detail: found
            ? `object type ${target.object}.${target.name} present`
            : undefined,
        };
      }
    }
  } catch (err) {
    return absent(err);
  }
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
        const pre = await precheckStep(client, step);
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
          record({
            stepId: step.id,
            status: "failed",
            message: failure,
            response: result,
          });
          if (!options.continueOnError) haltedBy = step.id;
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
        const call: VaultApiCall = {
          ...step.api,
          body: step.api.body
            ? (resolvePlaceholders(step.api.body, captures) as Record<
                string,
                unknown
              >)
            : undefined,
        };
        log(`${step.id}: ${call.method} ${call.path}`);
        const response = await client.request<VaultResponse>(call);
        let message = `${call.method} ${call.path} → SUCCESS`;
        if (step.captures) {
          const id = extractRecordId(response);
          if (id) {
            captures[step.id] = { recordId: id };
            message += ` (record ${id})`;
          } else {
            record({
              stepId: step.id,
              status: "failed",
              message: `${message} but no record id in the response`,
              response,
            });
            if (!options.continueOnError) haltedBy = step.id;
            continue;
          }
        }
        record({ stepId: step.id, status: "applied", message, response });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`${step.id}: failed: ${message}`);
      record({
        stepId: step.id,
        status: "failed",
        message,
        response: err instanceof VaultApiError ? err.body : undefined,
      });
      if (!options.continueOnError) haltedBy = step.id;
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
