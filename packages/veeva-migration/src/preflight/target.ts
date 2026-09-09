/**
 * §5.2 target (Vault) checks: auth/vault identity/version, object and field
 * existence and state, §3.2 legacy-id resolution (+ MDL under `--allow-mdl`),
 * §5.4 type compatibility, lengths and ranges against the sample, required
 * coverage per object type, FK target objects, picklist value coverage with
 * the crosswalk/derivation rule and the `onUnmapped` policy, object types,
 * lifecycle states, currency/user lookups and the per-object action probes.
 *
 * Every `[UNVERIFIED]` target name degrades here: a missing non-required
 * field is a warning and the row is dropped from the materialised mapping.
 */
import { formatCountryOf } from "../country-of";
import { hashObject } from "../hash";
import { getLogger } from "../logger";
import type { MigrationConfig } from "../config/schema";
import type { StateStore } from "../store/types";
import { isQueueId, isUserId, to18 } from "../transform/ids";
import { renameObjectType, renamePicklistValue } from "../transform/rename";
import { innerTransform } from "../transform/spec";
import type { VaultClient, VaultSession } from "../vault/types";
import {
  GLOBAL_COUNTRY,
  normaliseVaultType,
  type FieldMapping,
  type MaterialisedMapping,
  type ObjectKey,
  type ResolvedField,
  type ResolvedMetadata,
  type SfdcFieldDescribe,
  type SfdcObjectDescribe,
  type SourceRow,
  type TransformSpec,
  type Unit,
  type VaultLifecycle,
  type VaultObjectMetadata,
  type VaultObjectTypeConfig,
} from "../types";
import type { PreflightInput, ResolvedTarget } from "./types";
import { FindingCollector } from "./findings";
import {
  legacyIdValueMatches,
  looksLikeLegacyId,
  resolveLegacyIdField,
  type LegacyIdResolution,
} from "./legacy-id";
import { isSkipRow } from "./lints";
import { checkCompatibility, isTextualSfdcType, rewrap } from "./matrix";
import type { SourceFacts } from "./source";

const log = getLogger("Preflight");

/** Objects whose Vault CRM triggers regenerate data (§2.5.4 `noTriggers` default true). */
export const TRIGGER_SENSITIVE_OBJECTS: readonly ObjectKey[] = [
  "call2",
  "call2_detail",
  "call2_discussion",
  "call2_key_message",
  "call2_sample",
  "sample_transaction",
  "sample_inventory",
  "sample_inventory_item",
  "em_event",
  "em_attendee",
  "em_event_speaker",
  "em_event_team_member",
  "expense_header",
  "expense_line",
  "order",
  "order_line",
  "sent_email",
  "email_activity",
  "multichannel_consent",
  "multichannel_activity",
  "multichannel_activity_line",
];

/** Fields only writable under `X-VaultAPI-MigrationMode` (§2.5.4). */
const MIGRATION_MODE_FIELDS = new Set([
  "created_by__v",
  "created_date__v",
  "modified_by__v",
  "modified_date__v",
  "status__v",
  "state__v",
  "object_type__v",
]);

/** Required fields Vault fills itself (§5.2 `VT_REQUIRED_UNMAPPED` exclusions). */
const SYSTEM_DEFAULTED = new Set([
  "id",
  "status__v",
  "state__v",
  "lifecycle__v",
  "object_type__v",
  "created_by__v",
  "created_date__v",
  "modified_by__v",
  "modified_date__v",
  "global_id__sys",
  "link__sys",
]);

export interface TargetContext {
  vault: VaultClient;
  vaultDns: string;
  session?: VaultSession;
  unavailable: boolean;
  metadata: Map<string, VaultObjectMetadata | null>;
  objectTypes: Map<string, VaultObjectTypeConfig[]>;
  picklists: Map<string, string[] | null>;
  lifecycles: Map<string, VaultLifecycle | null>;
  objectList?: Set<string>;
  legacy: Map<string, LegacyIdResolution>;
  legacyFormatChecked: Set<string>;
  objectProbed: Set<string>;
  limits?: Record<string, unknown> | null;
  userMapEmptyReported: boolean;
}

export function createTargetContext(vault: VaultClient): TargetContext {
  return {
    vault,
    vaultDns: vault.vaultDns,
    unavailable: false,
    metadata: new Map(),
    objectTypes: new Map(),
    picklists: new Map(),
    lifecycles: new Map(),
    legacy: new Map(),
    legacyFormatChecked: new Set(),
    objectProbed: new Set(),
    userMapEmptyReported: false,
  };
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------------------
// Global checks
// ---------------------------------------------------------------------------

export async function checkVaultGlobal(
  ctx: TargetContext,
  input: {
    config: MigrationConfig;
    target: {
      vaultDns?: string;
      apiVersion?: string;
      migrationUserId?: number;
    };
    findings: FindingCollector;
  },
): Promise<void> {
  const { findings, config } = input;
  const dns = input.target.vaultDns ?? config.target.vaultDns;
  const apiVersion = input.target.apiVersion ?? config.target.apiVersion;
  let session: VaultSession;
  try {
    session = await ctx.vault.authenticate();
  } catch (e) {
    findings.blocking(
      "VT_AUTH_FAILED",
      `Vault authentication failed for ${dns}: ${errMessage(e)}`,
    );
    ctx.unavailable = true;
    return;
  }
  ctx.session = session;
  const urls = session.vaultIds.map((v) => v.url);
  const matches =
    session.vaultDns === dns ||
    urls.some((u) => u.includes(dns)) ||
    ctx.vault.vaultDns === dns;
  if (!matches)
    findings.blocking(
      "VT_WRONG_VAULT",
      `session vault ${session.vaultDns} (vaultId ${session.vaultId}) does not match target.vaultDns ${dns}`,
    );
  try {
    const versions = await ctx.vault.availableVersions();
    if (!versions.includes(apiVersion))
      findings.blocking(
        "VT_API_VERSION_MISSING",
        `GET /api lacks target.apiVersion ${apiVersion} (available: ${versions.join(", ")})`,
      );
  } catch (e) {
    findings.warning(
      "VT_API_VERSIONS_UNAVAILABLE",
      `GET /api failed: ${errMessage(e)}`,
    );
  }
  try {
    const me = await ctx.vault.me();
    const wanted =
      input.target.migrationUserId ?? config.target.migrationUserId;
    if (wanted !== undefined && me.id !== wanted)
      findings.warning(
        "VT_MIGRATION_USER_MISMATCH",
        `objects/users/me id ${me.id} ≠ target.migrationUserId ${wanted}`,
      );
    else if (wanted === undefined)
      findings.info(
        "VT_MIGRATION_USER_MISMATCH",
        `target.migrationUserId unset; audit fallback will use the session user ${me.id}`,
      );
  } catch (e) {
    findings.warning(
      "VT_ME_UNAVAILABLE",
      `GET /objects/users/me failed: ${errMessage(e)}`,
    );
  }
  try {
    ctx.objectList = new Set(
      (await ctx.vault.listObjects()).map((o) => o.name),
    );
  } catch (e) {
    log.warn({ err: errMessage(e) }, "listObjects failed");
  }
}

// ---------------------------------------------------------------------------
// Metadata loading
// ---------------------------------------------------------------------------

export async function loadObjectMetadata(
  ctx: TargetContext,
  objectName: string,
): Promise<VaultObjectMetadata | undefined> {
  if (ctx.metadata.has(objectName))
    return ctx.metadata.get(objectName) ?? undefined;
  if (ctx.objectList && !ctx.objectList.has(objectName)) {
    ctx.metadata.set(objectName, null);
    return undefined;
  }
  try {
    const m = await ctx.vault.objectMetadata(objectName);
    ctx.metadata.set(objectName, m);
    return m;
  } catch (e) {
    log.debug({ objectName, err: errMessage(e) }, "objectMetadata failed");
    ctx.metadata.set(objectName, null);
    return undefined;
  }
}

export async function loadPicklist(
  ctx: TargetContext,
  name: string,
): Promise<string[] | undefined> {
  if (ctx.picklists.has(name)) return ctx.picklists.get(name) ?? undefined;
  try {
    const values = (await ctx.vault.picklistValues(name))
      .filter((v) => v.status !== "inactive")
      .map((v) => v.name);
    ctx.picklists.set(name, values);
    return values;
  } catch (e) {
    log.debug({ name, err: errMessage(e) }, "picklistValues failed");
    ctx.picklists.set(name, null);
    return undefined;
  }
}

async function loadObjectTypes(
  ctx: TargetContext,
  meta: VaultObjectMetadata,
): Promise<VaultObjectTypeConfig[]> {
  const cached = ctx.objectTypes.get(meta.name);
  if (cached) return cached;
  let out: VaultObjectTypeConfig[];
  try {
    out = await ctx.vault.objectTypes(meta.name);
  } catch (e) {
    log.debug({ object: meta.name, err: errMessage(e) }, "objectTypes failed");
    out = (meta.object_types ?? []).map((t) => ({
      name: t.name,
      object: meta.name,
      active: (t.status ?? ["active__v"]).includes("active__v"),
      type_fields: [],
    }));
  }
  ctx.objectTypes.set(meta.name, out);
  return out;
}

async function loadLifecycle(
  ctx: TargetContext,
  name: string,
): Promise<VaultLifecycle | undefined> {
  if (ctx.lifecycles.has(name)) return ctx.lifecycles.get(name) ?? undefined;
  try {
    const lc = await ctx.vault.lifecycleStates(name);
    ctx.lifecycles.set(name, lc);
    return lc;
  } catch (e) {
    log.debug({ name, err: errMessage(e) }, "lifecycleStates failed");
    ctx.lifecycles.set(name, null);
    return undefined;
  }
}

/** Raw metadata → `ResolvedField` map (picklist values filled in later). */
export function toResolvedFields(
  meta: VaultObjectMetadata,
): Record<string, ResolvedField> {
  const out: Record<string, ResolvedField> = {};
  for (const f of meta.fields) {
    const picklist = f.picklist?.replace(/^Picklist\./, "");
    out[f.name] = {
      name: f.name,
      type: normaliseVaultType(f.type),
      rawType: f.type,
      maxLength: f.max_length,
      scale: f.scale,
      minValue: f.min_value,
      maxValue: f.max_value,
      multiValue: Boolean(f.multi_value),
      picklist,
      referenceObject: f.object?.name,
      relationshipType: f.relationship_type,
      required: Boolean(f.required),
      unique: Boolean(f.unique),
      editable: f.editable !== false,
      active: (f.status ?? ["active__v"]).includes("active__v"),
      systemManagedName: f.system_managed_name,
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Row helpers
// ---------------------------------------------------------------------------

/** Base target field written by a row (`object_type__v.api_name__v` → `object_type__v`). */
export function outputField(row: FieldMapping, legacyField?: string): string {
  const inner = innerTransform(row.transform);
  switch (inner.kind) {
    case "objectType":
      return "object_type__v";
    case "state":
      return "state__v";
    case "currency":
      return "local_currency__sys";
    case "legacyId":
      return legacyField ?? row.target;
    default:
      return row.target.split(".")[0];
  }
}

function isRequiredRow(
  row: FieldMapping,
  mapping: MaterialisedMapping,
): boolean {
  const ov = mapping.required[row.target];
  if (ov !== undefined) return ov;
  return row.required === "K" || row.required === "Y";
}

/** Apply source-side drops and switches to the mapping rows. */
export function workingRows(
  mapping: MaterialisedMapping,
  drops: ReadonlyMap<string, string>,
  switches: ReadonlyMap<string, TransformSpec>,
): FieldMapping[] {
  return mapping.fields
    .filter((f) => !drops.has(f.target))
    .map((f) =>
      switches.has(f.target) ? { ...f, transform: switches.get(f.target)! } : f,
    );
}

/** Recompute `mappingHash` exactly as `materialise` does (findings excluded). */
export function rehashMapping(
  mapping: MaterialisedMapping,
): MaterialisedMapping {
  const { findings, mappingHash: _old, ...rest } = mapping;
  const hashable = {
    ...rest,
    countryOf: mapping.countryOf.map(formatCountryOf),
  };
  return { ...mapping, findings, mappingHash: hashObject(hashable) };
}

function sampleValues(
  sample: SourceRow[],
  source: string,
  multi = false,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of sample) {
    const v = r[source];
    if (v === null || v === undefined || v === "") continue;
    const parts = multi ? String(v).split(";") : [String(v)];
    for (const p of parts) if (p !== "") out.set(p, (out.get(p) ?? 0) + 1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Unit check
// ---------------------------------------------------------------------------

export interface TargetUnitInput {
  unit: Unit;
  mapping: MaterialisedMapping;
  describe?: SfdcObjectDescribe;
  sourceFields: ReadonlyMap<string, SfdcFieldDescribe>;
  sample: SourceRow[];
  drops: Map<string, string>;
  switches: ReadonlyMap<string, TransformSpec>;
  /** Expected rows in scope (from the source check). */
  count?: number;
  facts: SourceFacts;
  flags: PreflightInput["flags"];
  config: MigrationConfig;
  store: StateStore;
  mode: PreflightInput["mode"];
  /** Vault object of a mapped parent key (from the plan or the registry). */
  parentTarget: (key: ObjectKey) => string | undefined;
  currencies?: Map<string, string>;
  postLoad: {
    recalculateRollups: "auto" | "required" | "off";
    updateCorporateCurrency: boolean;
  };
  picklistPolicy: {
    derive: "strip_vod_lowercase_v" | "none";
    onUnmapped: "error" | "skip" | "createValue";
  };
}

export interface TargetUnitResult {
  resolved: ResolvedTarget;
  mapping: MaterialisedMapping;
  legacy?: LegacyIdResolution;
}

function emptyResolved(
  unit: Unit,
  mapping: MaterialisedMapping,
  describe: SfdcObjectDescribe | undefined,
  columns: string[],
): ResolvedTarget {
  return {
    objectKey: unit.objectKey,
    targetObject: mapping.targetObject,
    metadata: {
      targetObject: mapping.targetObject,
      legacyIdFormat: "{id18}",
      fields: {},
      allowTypes: false,
      objectTypes: {},
    },
    rawMetadata: { name: mapping.targetObject, status: [], fields: [] },
    objectTypes: [],
    picklists: {},
    describe,
    replicateable: describe?.replicateable ?? false,
    columns,
  };
}

/** §5.2 checks for one unit; returns the resolved target and the pruned mapping. */
export async function checkTargetUnit(
  ctx: TargetContext,
  input: TargetUnitInput,
  findings: FindingCollector,
  columns: string[],
): Promise<TargetUnitResult> {
  const { unit, mapping, config, flags } = input;
  const uctx = { objectKey: unit.objectKey, country: unit.country };
  const octx = { objectKey: unit.objectKey };
  const drops = new Map(input.drops);
  const rows = workingRows(mapping, drops, input.switches);
  const migrationMode =
    mapping.load.migrationMode ?? config.target.migrationMode;
  const resolvedTarget = emptyResolved(unit, mapping, input.describe, columns);

  const finish = (
    fields: FieldMapping[],
    extra: Partial<MaterialisedMapping> = {},
    legacy?: LegacyIdResolution,
  ): TargetUnitResult => {
    const kept = fields.filter((f) => !drops.has(f.target));
    const pruned = rehashMapping({ ...mapping, ...extra, fields: kept });
    return { resolved: resolvedTarget, mapping: pruned, legacy };
  };

  if (ctx.unavailable) return finish(rows);

  // --- object
  let meta = await loadObjectMetadata(ctx, mapping.targetObject);
  if (!meta || !meta.status.includes("active__v")) {
    const reason = !meta
      ? `${mapping.targetObject} not found in the vault (GET /metadata/vobjects/${mapping.targetObject})`
      : `${mapping.targetObject} is not active (${meta.status.join(",")})`;
    if (mapping.options.optional)
      findings.warning(
        "VT_OBJECT_MISSING",
        `${reason}; optional object disabled`,
        uctx,
      );
    else findings.blocking("VT_OBJECT_MISSING", reason, uctx);
    return finish(rows);
  }
  let fields = toResolvedFields(meta);

  // --- legacy id (§3.2) — per object
  let legacy = ctx.legacy.get(mapping.targetObject);
  if (!legacy) {
    legacy = resolveLegacyIdField({
      objectKey: unit.objectKey,
      targetObject: mapping.targetObject,
      fields,
      explicit: mapping.options.legacyIdField,
      externalIdOwnedBy: mapping.options.externalIdOwnedBy,
      config: config.legacyId,
      allowMdl:
        Boolean(flags.allowMdl || config.legacyId.allowMdl) && !flags.dryRun,
      matchOnly: unit.objectKey === "user",
    });
    if (legacy.mdl && legacy.field) {
      try {
        let big = false;
        try {
          big =
            (await ctx.vault.vqlCount(
              `SELECT id FROM ${mapping.targetObject} PAGESIZE 0`,
            )) >= 10_000;
        } catch {
          big = true;
        }
        const r = await ctx.vault.executeMdl(legacy.mdl, { async: big });
        if (!r.ok) throw new Error(r.message ?? "MDL rejected");
        findings.info(
          "LEGACY_ID_FIELD_SELECTED",
          {
            step: 6,
            format: legacy.format,
            mdl: legacy.mdl,
            jobId: r.jobId,
            async: big,
          },
          { ...octx, field: legacy.field },
        );
        ctx.metadata.delete(mapping.targetObject);
        meta = (await loadObjectMetadata(ctx, mapping.targetObject)) ?? meta;
        fields = toResolvedFields(meta);
        if (!fields[legacy.field]) {
          if (r.jobId)
            findings.blocking(
              "VT_LEGACY_ID_FIELD_MISSING",
              `MDL job ${r.jobId} queued for ${mapping.targetObject}.${legacy.field}; re-run preflight when it completes`,
              octx,
            );
          else
            findings.blocking(
              "VT_LEGACY_ID_FIELD_MISSING",
              `${legacy.field} still absent after MDL on ${mapping.targetObject}`,
              octx,
            );
          legacy = { ...legacy, field: undefined, step: 7 };
        }
      } catch (e) {
        findings.blocking(
          "VT_LEGACY_ID_FIELD_MISSING",
          {
            error: errMessage(e),
            mdl: legacy.mdl,
            targetObject: mapping.targetObject,
          },
          octx,
        );
        legacy = { ...legacy, field: undefined, step: 7 };
      }
    } else if (legacy.mdl) {
      // allowMdl was off: step 7 finding already carries the snippet
    }
    findings.addAll(legacy.findings);
    ctx.legacy.set(mapping.targetObject, legacy);
  } else if (
    mapping.options.legacyIdField &&
    legacy.step !== 1 &&
    mapping.options.legacyIdField !== legacy.field
  ) {
    findings.warning(
      "VT_LEGACY_ID_FIELD_MISSING",
      `objects.${unit.objectKey}.legacyIdField = ${mapping.options.legacyIdField} for ${unit.country} differs from the object-level choice ${legacy.field}; one idParam per object`,
      uctx,
    );
  }
  const legacyField = legacy.field;

  // VT_LEGACY_ID_FORMAT — sample of already-migrated values (once per object)
  if (legacyField && !ctx.legacyFormatChecked.has(mapping.targetObject)) {
    ctx.legacyFormatChecked.add(mapping.targetObject);
    try {
      const bad: string[] = [];
      let seen = 0;
      for await (const page of ctx.vault.vql(
        `SELECT ${legacyField} FROM ${mapping.targetObject} WHERE ${legacyField} != null LIMIT 20`,
      )) {
        for (const r of page.data) {
          const v = r[legacyField];
          if (!looksLikeLegacyId(v)) continue;
          seen++;
          if (!legacyIdValueMatches(v, legacy.format)) bad.push(v);
        }
        break;
      }
      if (bad.length)
        findings.blocking(
          "VT_LEGACY_ID_FORMAT",
          {
            field: legacyField,
            format: legacy.format,
            samples: bad.slice(0, 5),
            hint:
              bad.every((v) => v.length === 15) && legacy.format === "{id18}"
                ? "existing values are 15-char ids: set legacyId.format = '{id15}' for this object"
                : "existing values do not match legacyId.format / externalIdFormat",
          },
          { ...octx, field: legacyField, count: bad.length },
        );
      else if (seen)
        findings.info(
          "VT_LEGACY_ID_FORMAT",
          `${seen} sampled ${legacyField} values match ${legacy.format}`,
          { ...octx, field: legacyField },
        );
    } catch (e) {
      log.debug(
        { object: mapping.targetObject, err: errMessage(e) },
        "legacy id sample failed",
      );
    }
  }

  // rewrite rows for the chosen legacy field
  let work: FieldMapping[] = rows.map((f) =>
    f.required === "K" &&
    innerTransform(f.transform).kind === "legacyId" &&
    legacyField
      ? { ...f, target: legacyField }
      : f,
  );
  if (legacyField === "external_id__v") {
    const copyRow = work.find(
      (f) =>
        f.target === "external_id__v" &&
        innerTransform(f.transform).kind !== "legacyId",
    );
    if (copyRow) {
      // the K row now targets external_id__v; the Block S copy row would duplicate it
      work = work.filter((f) => f !== copyRow);
      findings.info(
        "LEGACY_ID_FIELD_SELECTED",
        "external_id__v is the legacy-id field; the External_ID_vod__c copy row is skipped (§3.2 step 4)",
        { ...octx, field: "external_id__v" },
      );
    }
  }
  if (
    legacy.traceabilityField &&
    fields[legacy.traceabilityField] &&
    !work.some((f) => f.target === legacy!.traceabilityField)
  )
    work.push({
      source: "Id",
      target: legacy.traceabilityField,
      transform: { kind: "copy" },
      required: "n",
      evidence: "OBS",
      notes:
        "§3.2 step 3: legacy_crm_id__v not unique — written for traceability only",
    });

  // --- object types / lifecycle / picklists
  const allowTypes = Boolean(meta.allow_types);
  const otConfigs = allowTypes ? await loadObjectTypes(ctx, meta) : [];
  const activeTypes = new Set(
    otConfigs.filter((t) => t.active).map((t) => t.name),
  );
  const lifecycleName = meta.available_lifecycles?.[0];
  const lifecycle = lifecycleName
    ? await loadLifecycle(ctx, lifecycleName)
    : undefined;
  const lifecycleStates = lifecycle?.states.map((s) => s.name);
  const picklists: Record<string, string[]> = {};

  const picklistUpdates: Record<string, Record<string, string | null>> = {};
  const mapped = new Set<string>(); // base target fields with a live row
  const finalRows: FieldMapping[] = [];

  for (const f of work) {
    if (isSkipRow(f)) {
      finalRows.push(f);
      continue;
    }
    const inner = innerTransform(f.transform);
    const base = outputField(f, legacyField);
    const fctx = { ...uctx, field: f.target };
    const required = isRequiredRow(f, mapping);
    const isLegacy = f.required === "K" && inner.kind === "legacyId";
    const isFk = inner.kind === "ref" || inner.kind === "refLookup";
    const custom = /__c$/.test(base);
    let row: FieldMapping = f;

    if (isLegacy && !legacyField) {
      drops.set(f.target, "VT_LEGACY_ID_FIELD_MISSING");
      continue;
    }
    if (inner.kind === "objectType" && !allowTypes) {
      findings.info(
        "VT_FIELD_MISSING",
        `${mapping.targetObject} has no object types; ${f.target} dropped`,
        fctx,
      );
      drops.set(f.target, "VT_FIELD_MISSING");
      continue;
    }
    if (inner.kind === "state" && !lifecycleName) {
      findings.info(
        "VT_FIELD_MISSING",
        `${mapping.targetObject} is not lifecycled; ${f.target} dropped`,
        fctx,
      );
      drops.set(f.target, "VT_FIELD_MISSING");
      continue;
    }

    const field = fields[base];
    if (!field) {
      const code = custom ? "VT_CUSTOM_FIELD_MISSING" : "VT_FIELD_MISSING";
      const detail = custom
        ? {
            message: `customer field ${base} is absent from ${mapping.targetObject} (never auto-created)`,
            mdl: `ALTER Object ${mapping.targetObject} (\n  ADD Field ${base}(label('${base}'), type('String'), max_length(255), active(true), required(false))\n);`,
          }
        : `target field ${base} not in ${mapping.targetObject} metadata${f.evidence === "UNV" ? " (name was [UNVERIFIED])" : ""}`;
      if (
        isLegacy ||
        required ||
        isFk ||
        inner.kind === "objectType" ||
        inner.kind === "state"
      )
        findings.blocking(code, detail, fctx);
      else {
        findings.warning(code, detail, fctx);
        drops.set(f.target, code);
      }
      continue;
    }
    if (!field.active) {
      if (required)
        findings.blocking("VT_FIELD_INACTIVE", `${base} is inactive`, fctx);
      else {
        findings.warning(
          "VT_FIELD_INACTIVE",
          `${base} is inactive; field dropped`,
          fctx,
        );
        drops.set(f.target, "VT_FIELD_INACTIVE");
      }
      continue;
    }
    const readonlyOk =
      migrationMode &&
      (MIGRATION_MODE_FIELDS.has(base) ||
        (base === "name__v" && field.systemManagedName));
    if (!field.editable && !readonlyOk && !isLegacy) {
      const why =
        field.type === "formula"
          ? "formula"
          : field.systemManagedName
            ? "system-managed name outside migration mode"
            : "editable = false";
      if (required)
        findings.blocking(
          "VT_FIELD_READONLY",
          `${base} is read-only (${why})`,
          fctx,
        );
      else {
        findings.warning(
          "VT_FIELD_READONLY",
          `${base} is read-only (${why}); field dropped`,
          fctx,
        );
        drops.set(f.target, "VT_FIELD_READONLY");
      }
      continue;
    }

    // --- §5.4 type compatibility
    const sf = input.sourceFields.get(f.target);
    const lookupRow =
      inner.kind === "objectType" ||
      inner.kind === "refLookup" ||
      inner.kind === "localeLookup";
    const compat = lookupRow
      ? field.type === "object" || field.type === "unknown"
        ? { ok: true }
        : {
            ok: false,
            reason: `${inner.kind} needs an Object field, ${base} is ${field.rawType}`,
          }
      : checkCompatibility({
          transform: f.transform,
          sfdcType: sf?.type,
          targetType: field.type,
        });
    if (!compat.ok) {
      findings.blocking(
        "VT_TYPE_INCOMPATIBLE",
        `${f.source || "(synthesised)"} → ${base}: ${compat.reason}`,
        fctx,
      );
      continue;
    }
    // --- multi-value
    if (field.type === "picklist") {
      const srcMulti = sf?.type === "multipicklist";
      if ((inner.kind === "multipicklist" || srcMulti) && !field.multiValue) {
        findings.blocking(
          "VT_PICKLIST_MULTIVALUE",
          `multi-value source ${f.source} mapped to single-value picklist ${base}`,
          fctx,
        );
        continue;
      }
      if (inner.kind === "picklist" && field.multiValue && !srcMulti) {
        findings.blocking(
          "VT_PICKLIST_MULTIVALUE",
          `single-value ${f.source} mapped to multi-value picklist ${base}; use multipicklist()`,
          fctx,
        );
        continue;
      }
    }

    // --- references
    if (inner.kind === "ref" || inner.kind === "refLookup") {
      const parent = input.parentTarget(inner.objectKey);
      if (parent && field.referenceObject && field.referenceObject !== parent) {
        findings.blocking(
          "VT_FK_TARGET_MISMATCH",
          `${base} references ${field.referenceObject} but ref(${inner.objectKey}) loads ${parent}`,
          fctx,
        );
        continue;
      }
      if (inner.kind === "refLookup" && parent) {
        const pm = await loadObjectMetadata(ctx, parent);
        const lookup = pm?.fields.find((x) => x.name === inner.lookupField);
        if (pm && (!lookup || !lookup.unique)) {
          findings.info(
            "VT_FK_LOOKUP_NOT_UNIQUE",
            `${parent}.${inner.lookupField} is ${lookup ? "not unique" : "absent"}; switched to id-based resolution ref(${inner.objectKey})`,
            fctx,
          );
          row = {
            ...row,
            transform: rewrap(row.transform, {
              kind: "ref",
              objectKey: inner.objectKey,
            }),
          };
        }
      }
    } else if (inner.kind === "refUser") {
      if (field.referenceObject && field.referenceObject !== "user__sys") {
        findings.blocking(
          "VT_FK_TARGET_MISMATCH",
          `${base} references ${field.referenceObject}, not user__sys`,
          fctx,
        );
        continue;
      }
    } else if (inner.kind === "country" && inner.mode === "ref") {
      if (field.referenceObject && field.referenceObject !== "country__v") {
        findings.blocking(
          "VT_FK_TARGET_MISMATCH",
          `${base} references ${field.referenceObject}, not country__v`,
          fctx,
        );
        continue;
      }
    } else if (inner.kind === "localeLookup") {
      if (
        field.referenceObject &&
        !/^(language|locale)__sys$/.test(field.referenceObject)
      )
        findings.warning(
          "VT_FK_TARGET_MISMATCH",
          `${base} references ${field.referenceObject}; localeLookup expected language__sys/locale__sys`,
          fctx,
        );
    }

    // --- length / ranges
    const textKinds = new Set([
      "text",
      "longtext",
      "richtext",
      "copy",
      "nameTemplate",
      "compositeExternalId",
      "legacyId",
    ]);
    if (
      field.maxLength !== undefined &&
      textKinds.has(inner.kind) &&
      f.source &&
      !isLegacy
    ) {
      const max =
        inner.kind === "text" && inner.max !== undefined
          ? Math.min(inner.max, field.maxLength)
          : field.maxLength;
      const policy = f.truncation ?? "truncate";
      if (input.sample.length) {
        let longest = 0;
        let over = 0;
        for (const r of input.sample) {
          const v = r[f.source];
          if (v === null || v === undefined) continue;
          const len = String(v).length;
          if (len > longest) longest = len;
          if (len > max) over++;
        }
        if (over)
          findings.push(
            policy === "fail" ? "blocking" : "warning",
            "VT_LENGTH",
            `${over} of ${input.sample.length} sampled ${f.source} values exceed max_length ${max} (longest ${longest}); truncation policy ${policy}`,
            { ...fctx, count: over },
          );
      } else if (
        sf &&
        isTextualSfdcType(sf.type) &&
        sf.length !== undefined &&
        sf.length > max
      ) {
        findings.info(
          "VT_LENGTH",
          `source length ${sf.length} > target max_length ${max}; truncation policy ${policy}`,
          fctx,
        );
      }
    }
    if (
      (field.type === "number" || field.type === "currency") &&
      inner.kind === "number" &&
      f.source &&
      input.sample.length
    ) {
      let out = 0;
      let scaleOver = 0;
      for (const r of input.sample) {
        const raw = r[f.source];
        if (raw === null || raw === undefined || raw === "") continue;
        const n = Number(raw);
        if (!Number.isFinite(n)) continue;
        if (
          (field.minValue !== undefined && n < field.minValue) ||
          (field.maxValue !== undefined && n > field.maxValue)
        )
          out++;
        if (field.scale !== undefined) {
          const dec = String(raw).split(".")[1]?.length ?? 0;
          if (dec > field.scale) scaleOver++;
        }
      }
      if (out)
        findings.push(
          (f.truncation ?? "truncate") === "fail" ? "blocking" : "warning",
          "VT_NUMBER_RANGE",
          `${out} sampled ${f.source} values outside [${field.minValue ?? "-∞"}, ${field.maxValue ?? "∞"}]`,
          { ...fctx, count: out },
        );
      if (scaleOver)
        findings.info(
          "VT_NUMBER_RANGE",
          `${scaleOver} sampled ${f.source} values exceed scale ${field.scale} (rounded)`,
          { ...fctx, count: scaleOver },
        );
    }

    // --- picklist value coverage
    if (
      (inner.kind === "picklist" || inner.kind === "multipicklist") &&
      field.type === "picklist"
    ) {
      const pl = field.picklist
        ? await loadPicklist(ctx, field.picklist)
        : undefined;
      if (field.picklist && pl) picklists[field.picklist] = pl;
      if (!pl) {
        findings.warning(
          "VT_PICKLIST_UNAVAILABLE",
          `cannot read picklist ${field.picklist ?? "(none)"} of ${base}; values unchecked`,
          fctx,
        );
      } else {
        const update = await checkPicklistCoverage(ctx, {
          row: f,
          mapKey: inner.mapKey,
          field,
          picklistName: field.picklist!,
          active: pl,
          map: mapping.picklists[inner.mapKey] ?? {},
          sourceValues: sf?.picklistValues.map((v) => v.value) ?? [],
          observed: sampleValues(
            input.sample,
            f.source,
            inner.kind === "multipicklist",
          ),
          policy: input.picklistPolicy,
          flags,
          findings,
          ctx: fctx,
        });
        if (update)
          picklistUpdates[inner.mapKey] = {
            ...(picklistUpdates[inner.mapKey] ?? {}),
            ...update,
          };
      }
    }
    if (
      inner.kind === "statusFromFlag" ||
      inner.kind === "userTimezone" ||
      inner.kind === "currency"
    ) {
      if (field.picklist) {
        const pl = await loadPicklist(ctx, field.picklist);
        if (pl) picklists[field.picklist] = pl;
      }
    }

    // --- object types
    if (inner.kind === "objectType") {
      for (const [dev, api] of Object.entries(mapping.objectTypes))
        if (!activeTypes.has(api))
          findings.blocking(
            "VT_OBJECT_TYPE_MISSING",
            `object type ${api} (record type ${dev}) not in ${mapping.targetObject}.object_types / inactive`,
            { ...fctx, field: api },
          );
      const observedRt = sampleValues(input.sample, f.source);
      const rts = (input.describe?.recordTypeInfos ?? []).filter(
        (r) => r.active && r.available && !r.master,
      );
      const candidates = new Set<string>([
        ...rts.map((r) => r.developerName),
        ...observedRt.keys(),
      ]);
      for (const dev of candidates) {
        if (dev in mapping.objectTypes) continue;
        const derived = renameObjectType(dev);
        const occurs = observedRt.get(dev) ?? 0;
        if (activeTypes.has(derived))
          findings.info(
            "SF_RECORD_TYPE_UNMAPPED",
            `record type ${dev} has no crosswalk entry; mechanically mapped to existing type ${derived}`,
            { ...fctx, field: dev, count: occurs },
          );
        else
          findings.blocking(
            "SF_RECORD_TYPE_UNMAPPED",
            `record type ${dev}${occurs ? ` (${occurs} sampled rows)` : ""} has no object-type crosswalk entry and ${derived} does not exist on ${mapping.targetObject}`,
            { ...fctx, field: dev, count: occurs },
          );
      }
    }

    // --- lifecycle states
    if (inner.kind === "state") {
      if (!lifecycleStates)
        findings.warning(
          "VT_LIFECYCLE_STATE_MISSING",
          `cannot read lifecycle ${lifecycleName}; states unchecked`,
          fctx,
        );
      else {
        if (!Object.keys(mapping.states).length)
          findings.blocking(
            "VT_LIFECYCLE_STATE_MISSING",
            `${mapping.targetObject} is lifecycled (${lifecycleName}) but no state mapping exists`,
            fctx,
          );
        for (const [status, state] of Object.entries(mapping.states))
          if (!lifecycleStates.includes(state))
            findings.blocking(
              "VT_LIFECYCLE_STATE_MISSING",
              `state ${state} (status ${status}) not in Objectlifecycle.${lifecycleName} [${lifecycleStates.join(", ")}]`,
              { ...fctx, field: state },
            );
        for (const [status, n] of sampleValues(input.sample, f.source))
          if (!(status in mapping.states))
            findings.blocking(
              "VT_LIFECYCLE_STATE_MISSING",
              `business status ${status} (${n} sampled rows) has no state mapping for ${mapping.targetObject}`,
              { ...fctx, field: status, count: n },
            );
      }
    }

    mapped.add(base);
    finalRows.push(row);
  }

  // --- required coverage per object type (§5.2 VT_REQUIRED_UNMAPPED)
  if (mapping.options.createPolicy !== "match-only") {
    const covered = (name: string) =>
      mapped.has(name) || mapping.required[name] === false;
    const systemDefault = (r: ResolvedField) =>
      SYSTEM_DEFAULTED.has(r.name) ||
      r.type === "formula" ||
      Boolean(r.systemManagedName) ||
      (!r.editable && r.name !== "name__v") ||
      (r.name.endsWith("__sys") && r.name !== "local_currency__sys");
    for (const r of Object.values(fields)) {
      const explicitlyRequired = mapping.required[r.name] === true;
      if (!r.active) continue;
      if (!r.required && !explicitlyRequired) continue;
      if (covered(r.name)) continue;
      if (!explicitlyRequired && systemDefault(r)) continue;
      findings.blocking(
        "VT_REQUIRED_UNMAPPED",
        r.name === "name__v"
          ? `name__v is required and not system-managed but no row maps it (preserveName = false?)`
          : `required field ${r.name} has no mapping row and no system default`,
        { ...uctx, field: r.name },
      );
    }
    if (allowTypes && !mapped.has("object_type__v"))
      findings.blocking(
        "VT_REQUIRED_UNMAPPED",
        `${mapping.targetObject} has allow_types = true but no object_type__v row`,
        { ...uctx, field: "object_type__v" },
      );
    const usedTypes = new Set(Object.values(mapping.objectTypes));
    for (const t of otConfigs) {
      if (usedTypes.size && !usedTypes.has(t.name)) continue;
      if (!t.active) continue;
      for (const tf of t.type_fields) {
        if (!tf.required || covered(tf.name)) continue;
        const r = fields[tf.name];
        if (r && systemDefault(r) && mapping.required[tf.name] !== true)
          continue;
        findings.blocking(
          "VT_REQUIRED_UNMAPPED",
          {
            message: `field ${tf.name} is required on object type ${t.name} and has no mapping row`,
            objectType: t.name,
          },
          { ...uctx, field: tf.name },
        );
      }
    }
  }

  // --- blobs / triggers / actions / consent / user
  const blobs = { ...mapping.options.blobs };
  for (const [name, policy] of Object.entries(blobs)) {
    if (policy !== "attachment" || meta.allow_attachments !== false) continue;
    const blobRow = finalRows.find(
      (f) =>
        (f.blobName ??
          (f.transform.kind === "deferredBlob"
            ? f.transform.blobName
            : undefined)) === name,
    );
    if (blobRow && isRequiredRow(blobRow, mapping))
      findings.blocking(
        "VT_ATTACHMENTS_DISABLED",
        `blob ${name} needs attachments but ${mapping.targetObject}.allow_attachments = false`,
        { ...uctx, field: name },
      );
    else {
      findings.warning(
        "VT_ATTACHMENTS_DISABLED",
        `blob ${name}: attachments disabled on ${mapping.targetObject}; policy downgraded to skip`,
        { ...uctx, field: name },
      );
      blobs[name] = "skip";
    }
  }
  if (
    mapping.load.noTriggers === false &&
    TRIGGER_SENSITIVE_OBJECTS.includes(unit.objectKey)
  )
    findings.warning(
      "VT_TRIGGER_RISK",
      `noTriggers = false on trigger-sensitive object ${unit.objectKey} (§2.5.4)`,
      uctx,
    );

  if (!ctx.objectProbed.has(mapping.targetObject)) {
    ctx.objectProbed.add(mapping.targetObject);
    const urls = meta.urls ?? {};
    const rollup = Object.entries(urls).some(
      ([k, v]) => /rollup/i.test(k) || /rollup/i.test(v),
    );
    const corp = Object.entries(urls).some(
      ([k, v]) =>
        /updatecorporatecurrency/i.test(k) ||
        /updatecorporatecurrency/i.test(v),
    );
    if (input.postLoad.recalculateRollups !== "off") {
      findings.info(
        "PROBE_RESULT",
        {
          probe: "rollupRecalc",
          object: mapping.targetObject,
          result: rollup ? "available" : "absent",
        },
        octx,
      );
      try {
        await input.store.probeResults.set({
          vaultDns: ctx.vaultDns,
          probe: `rollupRecalc:${mapping.targetObject}`,
          result: { available: rollup },
          checkedAt: new Date().toISOString(),
        });
      } catch (e) {
        log.debug({ err: errMessage(e) }, "probeResults.set failed");
      }
      if (input.postLoad.recalculateRollups === "required" && !rollup)
        findings.blocking(
          "VT_ROLLUP_RECALC_UNAVAILABLE",
          `postLoad.recalculateRollups = required but no *rollup* action on ${mapping.targetObject}`,
          octx,
        );
    }
    const hasCurrency =
      finalRows.some((f) => innerTransform(f.transform).kind === "currency") ||
      Object.values(fields).some((r) => r.type === "currency");
    if (input.postLoad.updateCorporateCurrency && hasCurrency && !corp)
      findings.warning(
        "VT_CORP_CURRENCY_UNAVAILABLE",
        `updatecorporatecurrency action absent on ${mapping.targetObject}; *_corpv__sys twins will not be recomputed`,
        octx,
      );
  }

  if (
    unit.objectKey === "user" &&
    mapping.options.mode === "create" &&
    !mapping.options.securityPolicyId
  )
    findings.blocking(
      "VT_USER_SECURITY_POLICY_MISSING",
      "objects.user.mode = create without objects.user.securityPolicyId",
      uctx,
    );

  if (
    unit.objectKey === "multichannel_consent" &&
    mapping.configObjects?.length
  ) {
    const maps = (mapping.options.configMaps ?? {}) as Record<
      string,
      Record<string, string> | undefined
    >;
    for (const name of mapping.configObjects)
      if (!maps[name] || !Object.keys(maps[name]!).length)
        findings.blocking(
          "VT_CONSENT_CONFIG_UNMATCHED",
          `objects.multichannel_consent.configMaps.${name} is empty — consent config rows cannot be matched (§6.3.42)`,
          { ...uctx, field: name },
        );
  }

  // --- currency values
  if (
    input.facts.multiCurrency &&
    finalRows.some((f) => innerTransform(f.transform).kind === "currency")
  ) {
    if (!input.currencies)
      findings.info(
        "VT_CURRENCY_UNMATCHED",
        "currency__sys not readable; CurrencyIsoCode values unchecked",
        uctx,
      );
    else {
      const observed = sampleValues(input.sample, "CurrencyIsoCode");
      const missing = [...observed].filter(
        ([iso]) => !input.currencies!.has(iso.toUpperCase()),
      );
      if (missing.length)
        findings.blocking(
          "VT_CURRENCY_UNMATCHED",
          { values: missing.map(([iso, n]) => ({ iso, rows: n })) },
          { ...uctx, field: "local_currency__sys", count: missing.length },
        );
    }
  }

  // --- users referenced by the sample
  if (input.sample.length) {
    const userRows = finalRows.filter(
      (f) => innerTransform(f.transform).kind === "refUser" && f.source,
    );
    const ids = new Set<string>();
    const ownerIds = new Set<string>();
    const referencing = new Map<string, number>();
    for (const r of input.sample)
      for (const f of userRows) {
        const v = r[f.source];
        if (!isUserId(v) || isQueueId(v)) continue;
        const id = to18(v as string);
        ids.add(id);
        referencing.set(id, (referencing.get(id) ?? 0) + 1);
        if (f.target === "ownerid__v") ownerIds.add(id);
      }
    if (ids.size) {
      try {
        const mappedUsers = await input.store.idMap.count("user");
        if (mappedUsers === 0) {
          if (!ctx.userMapEmptyReported) {
            ctx.userMapEmptyReported = true;
            findings.info(
              "VT_USER_UNMAPPED",
              "user map is empty — run the user step (wave 0) before loading business objects; per-object user checks deferred",
            );
          }
        } else {
          const found = await input.store.idMap.bulkGet("user", [...ids]);
          const unmapped = [...ids].filter((id) => !found.has(id));
          if (unmapped.length) {
            const ownerHit = unmapped.some((id) => ownerIds.has(id));
            const rowsHit = unmapped.reduce(
              (n, id) => n + (referencing.get(id) ?? 0),
              0,
            );
            findings.push(
              ownerHit && mapping.options.unmappedUserPolicy === "fail"
                ? "blocking"
                : "warning",
              "VT_USER_UNMAPPED",
              {
                users: unmapped.slice(0, 50),
                referencingRows: rowsHit,
                sampledRows: input.sample.length,
                policy: mapping.options.unmappedUserPolicy,
              },
              { ...uctx, count: unmapped.length },
            );
          }
        }
      } catch (e) {
        log.debug({ err: errMessage(e) }, "user map lookup failed");
      }
    }
  }

  // --- record headroom
  if (input.count !== undefined && ctx.vault.limits) {
    try {
      if (ctx.limits === undefined) ctx.limits = await ctx.vault.limits();
      const rpo = (ctx.limits as { records_per_object?: { standard?: number } })
        ?.records_per_object;
      const limit = rpo?.standard;
      if (typeof limit === "number") {
        const current = await ctx.vault.vqlCount(
          `SELECT id FROM ${mapping.targetObject} PAGESIZE 0`,
        );
        if (limit - current < input.count)
          findings.warning(
            "VT_RECORD_LIMIT",
            `record headroom ${limit - current} < planned rows ${input.count} on ${mapping.targetObject}`,
            { ...uctx, count: input.count },
          );
      }
    } catch (e) {
      log.debug({ err: errMessage(e) }, "limits check failed");
    }
  }

  // --- resolved metadata
  const resolvedFields: Record<string, ResolvedField> = {};
  for (const [name, r] of Object.entries(fields))
    resolvedFields[name] = {
      ...r,
      picklistValues: r.picklist ? picklists[r.picklist] : undefined,
    };
  const objectTypes: ResolvedMetadata["objectTypes"] = {};
  for (const t of otConfigs)
    objectTypes[t.name] = {
      active: t.active,
      requiredFields: t.type_fields
        .filter((x) => x.required)
        .map((x) => x.name),
    };
  const metadata: ResolvedMetadata = {
    targetObject: mapping.targetObject,
    legacyIdField: legacyField,
    legacyIdFormat: legacy.format,
    fields: resolvedFields,
    allowTypes,
    objectTypes,
    lifecycle: lifecycleName
      ? { name: lifecycleName, states: lifecycleStates ?? [] }
      : undefined,
    allowAttachments: meta.allow_attachments,
    systemManagedName: fields.name__v?.systemManagedName,
  };
  resolvedTarget.metadata = metadata;
  resolvedTarget.rawMetadata = meta;
  resolvedTarget.objectTypes = otConfigs;
  resolvedTarget.picklists = picklists;
  resolvedTarget.legacyIdField = legacyField;

  const mergedPicklists = { ...mapping.picklists };
  for (const [k, v] of Object.entries(picklistUpdates))
    mergedPicklists[k] = { ...(mergedPicklists[k] ?? {}), ...v };
  return finish(
    finalRows,
    {
      legacyIdField: legacyField,
      picklists: mergedPicklists,
      options: { ...mapping.options, blobs },
    },
    legacy,
  );
}

// ---------------------------------------------------------------------------
// Picklist coverage
// ---------------------------------------------------------------------------

interface PicklistCheck {
  row: FieldMapping;
  mapKey: string;
  field: ResolvedField;
  picklistName: string;
  active: string[];
  map: Record<string, string | null>;
  /** Source describe values (active + inactive). */
  sourceValues: string[];
  /** Sampled source value → row count. */
  observed: Map<string, number>;
  policy: TargetUnitInput["picklistPolicy"];
  flags: PreflightInput["flags"];
  findings: FindingCollector;
  ctx: { objectKey: ObjectKey; country: string; field: string };
}

/**
 * Crosswalk + derivation coverage against the active target values (§5.2
 * `VT_PICKLIST_VALUE_MISSING`). Returns crosswalk entries added by
 * `--allow-picklist-create` so the mapping can carry the created names.
 */
async function checkPicklistCoverage(
  tctx: TargetContext,
  c: PicklistCheck,
): Promise<Record<string, string | null> | undefined> {
  const active = new Set(c.active);
  const customer = c.field.name.endsWith("__c");
  const sources = new Set<string>([
    ...c.sourceValues,
    ...Object.keys(c.map),
    ...c.observed.keys(),
  ]);
  type Miss = {
    target: string;
    sources: string[];
    rows: number;
    explicit: boolean;
  };
  const misses = new Map<string, Miss>();
  const unmappable: Array<{ source: string; rows: number }> = [];
  for (const src of sources) {
    const explicit = src in c.map ? c.map[src] : undefined;
    if (explicit === null) continue; // configured skip
    let target: string;
    let isExplicit = false;
    if (explicit !== undefined) {
      target = explicit;
      isExplicit = true;
    } else if (c.policy.derive === "none") {
      unmappable.push({ source: src, rows: c.observed.get(src) ?? 0 });
      continue;
    } else target = renamePicklistValue(src, customer);
    if (active.has(target)) continue;
    const m = misses.get(target) ?? {
      target,
      sources: [],
      rows: 0,
      explicit: false,
    };
    m.sources.push(src);
    m.rows += c.observed.get(src) ?? 0;
    m.explicit = m.explicit || isExplicit;
    misses.set(target, m);
  }

  const updates: Record<string, string | null> = {};
  for (const m of [...misses.values()]) {
    // --allow-picklist-reactivate: the value may exist but be inactive (§2.5.6)
    if (c.flags.allowPicklistReactivate && tctx.vault.setPicklistValueStatus) {
      try {
        await tctx.vault.setPicklistValueStatus(
          c.picklistName,
          m.target,
          "active",
        );
        c.active.push(m.target);
        c.findings.info(
          "VT_PICKLIST_VALUE_REACTIVATED",
          {
            picklist: c.picklistName,
            value: m.target,
            sources: m.sources,
            note: "flipped back to inactive at run end unless picklists.leaveReactivated",
          },
          { ...c.ctx, count: m.rows },
        );
        misses.delete(m.target);
        continue;
      } catch {
        /* not an inactive value — fall through */
      }
    }
    if (c.flags.allowPicklistCreate && tctx.vault.createPicklistValues) {
      try {
        const created = await tctx.vault.createPicklistValues(
          c.picklistName,
          m.sources,
        );
        for (let i = 0; i < m.sources.length; i++) {
          const name = created[i]?.name ?? created[0]?.name;
          if (name) {
            updates[m.sources[i]] = name;
            c.active.push(name);
          }
        }
        c.findings.info(
          "VT_PICKLIST_VALUE_CREATED",
          {
            picklist: c.picklistName,
            created: created.map((v) => v.name),
            sources: m.sources,
          },
          { ...c.ctx, count: m.rows },
        );
        misses.delete(m.target);
      } catch (e) {
        c.findings.warning(
          "VT_PICKLIST_VALUE_MISSING",
          `create of ${m.target} on ${c.picklistName} failed: ${errMessage(e)}`,
          c.ctx,
        );
      }
    }
  }

  for (const m of misses.values()) {
    const detail = {
      picklist: c.picklistName,
      target: m.target,
      sources: m.sources,
      sampledRows: m.rows,
      explicit: m.explicit,
      policy: c.policy.onUnmapped,
    };
    let severity: "blocking" | "warning" | "info";
    if (m.explicit) severity = m.rows > 0 ? "blocking" : "warning";
    else if (c.policy.onUnmapped === "skip") severity = "info";
    else if (c.policy.onUnmapped === "createValue") severity = "warning";
    else severity = m.rows > 0 ? "blocking" : "warning";
    c.findings.push(severity, "VT_PICKLIST_VALUE_MISSING", detail, {
      ...c.ctx,
      count: m.rows,
    });
  }
  if (unmappable.length) {
    const rows = unmappable.reduce((n, u) => n + u.rows, 0);
    const severity =
      c.policy.onUnmapped === "skip"
        ? "info"
        : c.policy.onUnmapped === "createValue"
          ? "warning"
          : rows > 0
            ? "blocking"
            : "warning";
    c.findings.push(
      severity,
      "VT_PICKLIST_VALUE_MISSING",
      {
        picklist: c.picklistName,
        note: "picklists.derive = none and no crosswalk entry",
        sources: unmappable.map((u) => u.source),
        sampledRows: rows,
        policy: c.policy.onUnmapped,
      },
      { ...c.ctx, count: rows },
    );
  }
  return Object.keys(updates).length ? updates : undefined;
}

/** Vault DNS a unit targets (per-country `target.vaultDns` override, §1.2). */
export function unitVaultDns(
  config: MigrationConfig,
  countryTarget: { vaultDns?: string } | undefined,
): string {
  return countryTarget?.vaultDns ?? config.target.vaultDns;
}

export function isGlobalUnit(unit: Unit): boolean {
  return unit.country === GLOBAL_COUNTRY;
}
