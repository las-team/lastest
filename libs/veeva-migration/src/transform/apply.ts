/**
 * §2.3 row transform: `applyMapping(row, mapping, ctx)` runs every mapping
 * row through the registry and assembles the pass-1 payload, the pass-2
 * patch set, deferred blobs, diagnostics, FK edges and the `source_hash`.
 *
 * Invariants:
 *  - the payload never contains Vault ids — references stay deferred (`$fk`,
 *    `$user`, `$composite`) and are resolved by the loader at send time;
 *  - `source_hash` is computed over the unresolved form plus `mapping_hash`
 *    (§8.2), so it is stable across re-keys and invalidated by mapping changes;
 *  - null/empty sources are omitted unless `clearOnNull` (§2.5.4);
 *  - an unresolved **required** FK yields `status = pending_fk` (§3.5) with the
 *    deferred reference kept; an unresolved optional lookup is omitted and
 *    recorded as `unresolved_fk`.
 */
import { hashObject } from "../hash";
import { isSfdcId, to18 } from "./ids";
import { applyTransform } from "./registry";
import { readSource } from "./source";
import {
  isDeferredComposite,
  isDeferredFk,
  isDeferredUser,
  type CountryContext,
  type CustomTransformFn,
  type FieldMapping,
  type IdResolver,
  type MaterialisedMapping,
  type ObjectKey,
  type Payload,
  type PayloadValue,
  type ResolvedMetadata,
  type RowDiagnostic,
  type RunMode,
  type SkipReason,
  type SourceRow,
  type TransformContext,
} from "../types";

export { readSource } from "./source";

export interface ApplyContext {
  country: CountryContext;
  metadata: ResolvedMetadata;
  ids: IdResolver;
  migrationUserId?: number;
  orgId15?: string;
  runMode: RunMode;
  /** Module `custom` functions (default none). */
  custom?: Record<string, CustomTransformFn>;
}

export interface UnresolvedFk {
  field: string;
  objectKey: ObjectKey | "user";
  sfdcId: string;
  /** True when the field is a pass-2 patch (retried after the step). */
  secondPass?: boolean;
}

export interface FkEdge {
  field: string;
  targetObjectKey: ObjectKey | "user";
  targetSfdcId: string;
}

export type ApplyStatus = "ok" | "pending_fk" | "failed" | "skipped";

export interface ApplyResult {
  sfdcId: string;
  status: ApplyStatus;
  payload: Payload;
  secondPass: Payload;
  blobs: Payload;
  diagnostics: RowDiagnostic[];
  unresolvedRequiredFks: UnresolvedFk[];
  unresolvedOptionalFks: UnresolvedFk[];
  /** Every deferred reference emitted (payload + pass 2) — written to `fk_index` (§4.2). */
  fkEdges: FkEdge[];
  sourceHash: string;
  /** Object type api name sent (if any). */
  objectType?: string;
  failure?: { code: string; message: string; field?: string };
  skipReason?: string;
}

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

/**
 * §8.8 gate vocabulary for `skipped` rows: `erased`, `rule`, `contact_ref`,
 * `country_unresolved`, `out_of_scope_ref`. Configured skips (a `null`
 * object type, `unmappedUserPolicy: skipRow`, …) are `rule`; the diagnostic
 * keeps the precise code.
 */
export function canonicalSkipReason(code: string | undefined): SkipReason {
  if (!code) return "rule";
  if (code === "ERASED_SKIPPED") return "erased";
  if (code.startsWith("CONTACT_REF")) return "contact_ref";
  if (code.startsWith("COUNTRY_UNRESOLVED")) return "country_unresolved";
  if (code.startsWith("OUT_OF_SCOPE_REF")) return "out_of_scope_ref";
  return "rule";
}

/**
 * `required = mapping.required[target] ?? (K|Y) ?? metadata.required`
 * (CONTRACTS §4), with one deliberate refinement: an `n` row with an empty
 * source defers to Vault's own default (`status__v` → `active__v`, §6.0.4)
 * instead of failing locally, whereas an unresolved reference on a
 * target-required field can never be defaulted — §3.5 routes it to
 * `pending_fk` (`forReference`).
 */
function isRequired(
  field: FieldMapping,
  mapping: MaterialisedMapping,
  metadata: ResolvedMetadata,
  outputField: string,
  forReference = false,
): boolean {
  const override =
    mapping.required[outputField] ?? mapping.required[field.target];
  if (override !== undefined) return override;
  if (field.required === "K" || field.required === "Y") return true;
  if (field.required === "-") return false;
  const meta = metadata.fields[outputField] ?? metadata.fields[field.target];
  if (meta?.required !== true) return false;
  return forReference || field.required !== "n";
}

function collectEdges(
  field: string,
  value: PayloadValue,
  edges: FkEdge[],
): void {
  if (isDeferredFk(value))
    edges.push({
      field,
      targetObjectKey: value.$fk.object,
      targetSfdcId: value.$fk.sfdcId,
    });
  else if (isDeferredUser(value))
    edges.push({ field, targetObjectKey: "user", targetSfdcId: value.$user });
  else if (isDeferredComposite(value))
    for (const p of Object.values(value.$composite.parts))
      if (typeof p !== "string") collectEdges(field, p, edges);
}

export function applyMapping(
  row: SourceRow,
  mapping: MaterialisedMapping,
  ctx: ApplyContext,
): ApplyResult {
  const diagnostics: RowDiagnostic[] = [];
  const payload: Payload = {};
  const secondPass: Payload = {};
  const blobs: Payload = {};
  const unresolvedRequiredFks: UnresolvedFk[] = [];
  const unresolvedOptionalFks: UnresolvedFk[] = [];
  const fkEdges: FkEdge[] = [];
  let failure: ApplyResult["failure"];
  let skipReason: string | undefined;
  let objectType: string | undefined;

  const rawId = row.Id;
  if (!isSfdcId(rawId)) {
    return finish("failed", {
      code: "INVALID_ID",
      message: `row Id "${String(rawId)}" is not a Salesforce id`,
    });
  }
  const sfdcId = to18(rawId);

  if (ctx.country.erased?.has(sfdcId)) {
    diagnostics.push({ kind: "skipped", code: "ERASED_SKIPPED" });
    return finish("skipped", undefined, "erased");
  }

  const base: Omit<TransformContext, "field" | "targetField"> = {
    objectKey: mapping.objectKey,
    country: ctx.country,
    metadata: ctx.metadata,
    ids: ctx.ids,
    mapping: {
      objectTypes: mapping.objectTypes,
      states: mapping.states,
      picklists: mapping.picklists,
      required: mapping.required,
      options: mapping.options,
    },
    migrationUserId: ctx.migrationUserId,
    orgId15: ctx.orgId15,
    runMode: ctx.runMode,
    custom: ctx.custom ?? {},
  };

  for (const field of mapping.fields) {
    const value = readSource(row, field.source);
    const tctx: TransformContext = {
      ...base,
      field,
      targetField: ctx.metadata.fields[field.target],
    };
    const result = applyTransform(field.transform, value, row, tctx);
    const outField = result.targetField ?? field.target;
    if (result.diagnostic) diagnostics.push(result.diagnostic);

    if (result.diagnostic?.fatal) {
      if (result.diagnostic.kind === "skipped") {
        skipReason ??= canonicalSkipReason(result.diagnostic.code);
      } else {
        failure ??= {
          code: result.diagnostic.code ?? result.diagnostic.kind.toUpperCase(),
          message:
            result.diagnostic.detail ??
            `${result.diagnostic.kind} on ${outField}`,
          field: outField,
        };
      }
      continue;
    }

    if ("omit" in result) {
      if (result.defer === "secondPass" && result.deferredValue !== undefined) {
        secondPass[outField] = result.deferredValue;
        collectEdges(outField, result.deferredValue, fkEdges);
        if (result.unresolved)
          unresolvedOptionalFks.push({
            field: outField,
            ...result.unresolved,
            secondPass: true,
          });
        continue;
      }
      if (result.defer === "blob" && result.deferredValue !== undefined) {
        blobs[outField] = result.deferredValue;
        continue;
      }
      if (field.clearOnNull && isEmpty(value)) {
        payload[outField] = null;
        continue;
      }
      if (result.unresolved) {
        if (isRequired(field, mapping, ctx.metadata, outField, true))
          unresolvedRequiredFks.push({ field: outField, ...result.unresolved });
        continue;
      }
      if (
        isRequired(field, mapping, ctx.metadata, outField) &&
        field.transform.kind !== "skip"
      ) {
        if (
          !result.diagnostic ||
          result.diagnostic.kind === "unresolved_fk" ||
          result.diagnostic.kind === "unmapped_picklist" ||
          result.diagnostic.kind === "invalid_value" ||
          result.diagnostic.kind === "out_of_range"
        ) {
          failure ??= {
            code: "REQUIRED_MISSING",
            message: `required field ${outField} has no value`,
            field: outField,
          };
          if (!result.diagnostic)
            diagnostics.push({
              kind: "required_missing",
              field: outField,
              code: "REQUIRED_MISSING",
              fatal: true,
            });
        }
      }
      continue;
    }

    // value branch
    if (result.unresolved) {
      const required = isRequired(field, mapping, ctx.metadata, outField, true);
      if (required) {
        unresolvedRequiredFks.push({ field: outField, ...result.unresolved });
        payload[outField] = result.value;
        collectEdges(outField, result.value, fkEdges);
      } else {
        // §3.5 optional lookup: omitted now, re-pointed by the FK-consistency pass later
        unresolvedOptionalFks.push({ field: outField, ...result.unresolved });
        collectEdges(outField, result.value, fkEdges);
      }
      continue;
    }
    payload[outField] = result.value;
    collectEdges(outField, result.value, fkEdges);
    if (
      outField === "object_type__v.api_name__v" &&
      typeof result.value === "string"
    )
      objectType = result.value;
  }

  if (skipReason) return finish("skipped", undefined, skipReason);
  if (failure) return finish("failed", failure);
  if (unresolvedRequiredFks.length) return finish("pending_fk");
  return finish("ok");

  function finish(
    status: ApplyStatus,
    fail?: ApplyResult["failure"],
    skip?: string,
  ): ApplyResult {
    const sourceHash = hashObject({
      m: mapping.mappingHash,
      p: payload,
      s: secondPass,
    });
    return {
      sfdcId: isSfdcId(rawId) ? to18(rawId) : String(rawId ?? ""),
      status,
      payload,
      secondPass,
      blobs,
      diagnostics,
      unresolvedRequiredFks,
      unresolvedOptionalFks,
      fkEdges,
      sourceHash,
      objectType,
      failure: fail,
      skipReason: skip,
    };
  }
}

/** Convenience: apply many rows lazily. */
export function* applyMappingAll(
  rows: Iterable<SourceRow>,
  mapping: MaterialisedMapping,
  ctx: ApplyContext,
): Generator<ApplyResult> {
  for (const row of rows) yield applyMapping(row, mapping, ctx);
}
