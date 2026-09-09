/**
 * §5.1 source (SFDC) checks: org/version/quota facts, describe-driven
 * object/field validation per unit, declared-type mismatches with safe
 * auto-switches, record-type crosswalk coverage, selectivity/size
 * estimates and a bounded row sample reused by the target checks.
 *
 * The output of a unit check is the *effective column list* (mapped ∩
 * describe) plus the rows to drop from the materialised mapping.
 */
import { buildCountryPredicate, countryOfSoqlPath } from "../country-of";
import { getLogger } from "../logger";
import type { SfdcClient } from "../sfdc/types";
import type { StateStore } from "../store/types";
import type { MigrationConfig } from "../config/schema";
import { to18 } from "../transform/ids";
import { innerTransform, refTarget } from "../transform/spec";
import {
  GLOBAL_COUNTRY,
  unitId,
  type FieldMapping,
  type MaterialisedMapping,
  type SfdcFieldDescribe,
  type SfdcGlobalDescribeEntry,
  type SfdcObjectDescribe,
  type SourceRow,
  type TransformSpec,
  type Unit,
} from "../types";
import { FindingCollector } from "./findings";
import { isSkipRow } from "./lints";
import { autoSwitchTransform, sfdcTypeGroup } from "./matrix";

const log = getLogger("Preflight");

/** Bulk 2.0 result cap per job (§5.1 `SF_BULK_RESULT_SIZE`). */
export const BULK_RESULT_CAP_BYTES = 15 * 1024 ** 3;
/** Units above this expected size get an explain plan (§5.1 `SF_QUERY_NON_SELECTIVE`). */
export const NON_SELECTIVE_THRESHOLD = 200_000;
/** Default preflight sample size (§5.2 `VT_LENGTH`). */
export const DEFAULT_SAMPLE_SIZE = 2000;

export interface SourceFacts {
  orgId: string;
  apiVersion: string;
  multiCurrency: boolean;
  personAccounts: boolean;
  territory2: boolean;
  now: string;
  /** `User.Country_vod__c` is a lookup (→ `Country_vod__r.Alpha_2_Code_vod__c`) rather than a picklist. */
  userCountryIsLookup: boolean;
}

export interface SourceContext {
  sfdc: SfdcClient;
  /** describe cache; `null` = not describable (missing / no permission). */
  describes: Map<string, SfdcObjectDescribe | null>;
  global?: Map<string, SfdcGlobalDescribeEntry>;
  facts: SourceFacts;
  sampleSize: number;
  /** Auth / version failed — unit checks are skipped. */
  unavailable: boolean;
}

export function createSourceContext(
  sfdc: SfdcClient,
  opts: { sampleSize?: number } = {},
): SourceContext {
  return {
    sfdc,
    describes: new Map(),
    facts: {
      orgId: sfdc.orgId,
      apiVersion: sfdc.apiVersion,
      multiCurrency: false,
      personAccounts: false,
      territory2: false,
      now: new Date().toISOString(),
      userCountryIsLookup: false,
    },
    sampleSize: opts.sampleSize ?? DEFAULT_SAMPLE_SIZE,
    unavailable: false,
  };
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Cached describe; `undefined` when the object is absent or not describable. */
export async function getDescribe(
  ctx: SourceContext,
  objectName: string,
): Promise<SfdcObjectDescribe | undefined> {
  if (ctx.describes.has(objectName))
    return ctx.describes.get(objectName) ?? undefined;
  if (ctx.global && !ctx.global.has(objectName)) {
    ctx.describes.set(objectName, null);
    return undefined;
  }
  try {
    const d = await ctx.sfdc.describe(objectName);
    ctx.describes.set(objectName, d);
    return d;
  } catch (e) {
    log.debug({ objectName, err: errMessage(e) }, "describe failed");
    ctx.describes.set(objectName, null);
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Global checks
// ---------------------------------------------------------------------------

export interface SourceGlobalInput {
  config: MigrationConfig;
  store: StateStore;
  findings: FindingCollector;
  /** Bulk jobs the run will create (≈ units). */
  plannedJobs: number;
}

/** Auth, API version, org identity, quota, org facts (§5.1 global rows). */
export async function checkSourceGlobal(
  ctx: SourceContext,
  input: SourceGlobalInput,
): Promise<void> {
  const { findings, config } = input;
  let versions: string[];
  try {
    versions = await ctx.sfdc.availableVersions();
  } catch (e) {
    findings.blocking(
      "SF_AUTH_FAILED",
      `SFDC authentication failed: ${errMessage(e)}`,
    );
    ctx.unavailable = true;
    return;
  }
  if (!versions.includes(config.source.apiVersion))
    findings.blocking(
      "SF_API_VERSION_MISSING",
      `GET /services/data/ lacks source.apiVersion ${config.source.apiVersion} (available: ${versions.join(", ")})`,
    );
  ctx.facts.apiVersion = config.source.apiVersion;

  // SF_ORG_MISMATCH against the id map's earlier runs
  try {
    const prev = await input.store.runs.latestSucceeded();
    if (prev?.sourceOrgId && to18(prev.sourceOrgId) !== to18(ctx.sfdc.orgId))
      findings.blocking(
        "SF_ORG_MISMATCH",
        `org ${ctx.sfdc.orgId} differs from runs.source_org_id ${prev.sourceOrgId} of the id map's earlier runs`,
      );
  } catch (e) {
    log.warn({ err: errMessage(e) }, "cannot read previous runs");
  }

  try {
    ctx.facts.now = await ctx.sfdc.serverNow();
  } catch (e) {
    log.warn({ err: errMessage(e) }, "serverNow failed; using local clock");
  }

  try {
    const entries = await ctx.sfdc.describeGlobal();
    ctx.global = new Map(entries.map((e) => [e.name, e] as const));
  } catch (e) {
    findings.warning(
      "SF_DESCRIBE_GLOBAL_FAILED",
      `GET /sobjects failed: ${errMessage(e)}`,
    );
  }

  // org facts
  ctx.facts.territory2 = Boolean(ctx.global?.has("Territory2"));
  const account = await getDescribe(ctx, "Account");
  if (account) {
    ctx.facts.personAccounts = account.fields.some(
      (f) => f.name === "IsPersonAccount",
    );
    ctx.facts.multiCurrency = account.fields.some(
      (f) => f.name === "CurrencyIsoCode",
    );
  }
  const user = await getDescribe(ctx, "User");
  if (user) {
    const c = user.fields.find((f) => f.name === "Country_vod__c");
    ctx.facts.userCountryIsLookup = c?.type === "reference";
    if (!ctx.facts.multiCurrency)
      ctx.facts.multiCurrency = user.fields.some(
        (f) => f.name === "CurrencyIsoCode",
      );
  }
  if (ctx.facts.multiCurrency)
    findings.info(
      "SF_MULTICURRENCY",
      "CurrencyIsoCode present — multi-currency org (local_currency__sys mapped)",
    );
  if (ctx.facts.personAccounts)
    findings.info(
      "SF_PERSON_ACCOUNTS",
      "IsPersonAccount present — person accounts enabled",
    );
  if (ctx.facts.territory2)
    findings.info(
      "SF_TERRITORY2",
      "Territory2 present — Enterprise Territory Management",
    );

  // quota
  try {
    const limits = await ctx.sfdc.limits();
    const api = limits.DailyApiRequests;
    const floor = Math.ceil(
      (api.Max * config.performance.sfdcApiFloorPct) / 100,
    );
    if (api.Remaining < floor)
      findings.blocking(
        "SF_QUOTA_LOW",
        `DailyApiRequests.Remaining ${api.Remaining} < floor ${floor} (${config.performance.sfdcApiFloorPct}% of ${api.Max})`,
      );
    const bulk = limits.DailyBulkV2QueryJobs;
    if (bulk && bulk.Remaining < input.plannedJobs)
      findings.blocking(
        "SF_QUOTA_LOW",
        `DailyBulkV2QueryJobs.Remaining ${bulk.Remaining} < planned jobs ${input.plannedJobs}`,
      );
  } catch (e) {
    findings.warning(
      "SF_LIMITS_UNAVAILABLE",
      `GET /limits failed: ${errMessage(e)}`,
    );
  }

  findings.info(
    "SF_EXPORT_POLICY",
    "large extractions may trip Salesforce anomalous-export / Event Monitoring policies — inform the org's security team before init",
  );
}

// ---------------------------------------------------------------------------
// Column resolution
// ---------------------------------------------------------------------------

export interface ColumnResolution {
  status: "found" | "missing" | "unknown";
  /** Terminal field describe (when found). */
  field?: SfdcFieldDescribe;
  /** Describe holding the terminal field. */
  describe?: SfdcObjectDescribe;
  reason?: string;
}

/**
 * Resolve a column or relationship path (`Account_vod__r.Country_vod__r.Alpha_2_Code_vod__c`)
 * against describes. Hops are followed through `relationshipName` →
 * `referenceTo[0]`; when a hop's object cannot be described the result is
 * `unknown` (kept, never blocking).
 */
export async function resolveSourcePath(
  ctx: SourceContext,
  describe: SfdcObjectDescribe,
  path: string,
): Promise<ColumnResolution> {
  const parts = path.split(".");
  let cur: SfdcObjectDescribe = describe;
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i];
    const last = i === parts.length - 1;
    if (last) {
      const f = cur.fields.find((x) => x.name === seg);
      return f
        ? { status: "found", field: f, describe: cur }
        : {
            status: "missing",
            reason: `field ${seg} not in describe(${cur.name})`,
            describe: cur,
          };
    }
    const rel = cur.fields.find(
      (x) =>
        x.relationshipName === seg ||
        (seg === "RecordType" && x.name === "RecordTypeId"),
    );
    if (!rel)
      return {
        status: "missing",
        reason: `relationship ${seg} not in describe(${cur.name})`,
        describe: cur,
      };
    const target =
      rel.referenceTo[0] ?? (seg === "RecordType" ? "RecordType" : undefined);
    if (!target)
      return {
        status: "unknown",
        reason: `relationship ${seg} has no referenceTo`,
      };
    const next = await getDescribe(ctx, target);
    if (!next)
      return { status: "unknown", reason: `cannot describe ${target}` };
    cur = next;
  }
  return { status: "unknown" };
}

// ---------------------------------------------------------------------------
// Unit checks
// ---------------------------------------------------------------------------

export interface RowClass {
  legacy: boolean;
  fk: boolean;
  requiredTarget: boolean;
  scopeDate: boolean;
}

/** Scope date paths of a mapping (dated predicates / via-parent path). */
export function scopeDateFields(mapping: MaterialisedMapping): string[] {
  const s = mapping.scope.spec;
  if (s.kind === "dated") return s.predicates.map((p) => p.field);
  if (s.kind === "via-parent") return [s.parentField];
  return [];
}

export function classifyRow(
  f: FieldMapping,
  mapping: MaterialisedMapping,
): RowClass {
  const inner = innerTransform(f.transform);
  const req = mapping.required[f.target];
  return {
    legacy: f.required === "K" && inner.kind === "legacyId",
    fk: inner.kind === "ref" || inner.kind === "refLookup",
    requiredTarget:
      req === true ||
      (req === undefined && (f.required === "K" || f.required === "Y")),
    scopeDate: scopeDateFields(mapping).includes(f.source),
  };
}

export interface SourceUnitResult {
  describe?: SfdcObjectDescribe;
  replicateable: boolean;
  /** Effective selectable columns (mapped ∩ describe + routing/scope/country columns). */
  columns: string[];
  /** target → reason: rows removed from the materialised mapping. */
  drops: Map<string, string>;
  /** target → replacement transform (auto-switched on the actual source type). */
  switches: Map<string, TransformSpec>;
  /** Terminal describe field per mapping target (found rows only). */
  sourceFields: Map<string, SfdcFieldDescribe>;
  sample: SourceRow[];
  /** Expected rows in scope (undefined when COUNT() failed). */
  count?: number;
  /** SOQL WHERE fragment used for count/sample (scope + country). */
  predicate?: string;
}

function scopePredicate(mapping: MaterialisedMapping): string | undefined {
  const s = mapping.scope.spec;
  const cutoff = mapping.scope.cutoffDate;
  if (!cutoff) return undefined;
  if (s.kind === "dated") {
    const terms = s.predicates.map((p) =>
      p.type === "datetime"
        ? `${p.field} >= ${cutoff}T00:00:00Z`
        : `${p.field} >= ${cutoff}`,
    );
    if (s.openPredicate) terms.push(`(${s.openPredicate})`);
    return terms.length ? `(${terms.join(" OR ")})` : undefined;
  }
  if (s.kind === "via-parent")
    return s.type === "datetime"
      ? `${s.parentField} >= ${cutoff}T00:00:00Z`
      : `${s.parentField} >= ${cutoff}`;
  return undefined;
}

/** Approximate bytes per row for `SF_BULK_RESULT_SIZE`. */
function estimateRowBytes(
  describe: SfdcObjectDescribe,
  columns: string[],
): number {
  const byName = new Map(describe.fields.map((f) => [f.name, f] as const));
  let bytes = 0;
  for (const c of columns) {
    const f = byName.get(c);
    if (!f) {
      bytes += 18;
      continue;
    }
    switch (f.type) {
      case "textarea":
        bytes += Math.min(f.length ?? 2000, 32000) / 8;
        break;
      case "string":
      case "email":
      case "phone":
      case "url":
      case "encryptedstring":
        bytes += Math.min(f.length ?? 40, 255) / 2;
        break;
      case "id":
      case "reference":
        bytes += 18;
        break;
      case "datetime":
        bytes += 24;
        break;
      default:
        bytes += 10;
    }
  }
  return bytes + columns.length; // separators
}

function yearOf(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const m = /^(-?\d{4})-\d{2}-\d{2}/.exec(value);
  return m ? Number(m[1]) : undefined;
}

/** §5.1 checks for one unit. */
export async function checkSourceUnit(
  ctx: SourceContext,
  unit: Unit,
  mapping: MaterialisedMapping,
  findings: FindingCollector,
): Promise<SourceUnitResult> {
  const uctx = { objectKey: unit.objectKey, country: unit.country };
  const result: SourceUnitResult = {
    replicateable: false,
    columns: [],
    drops: new Map(),
    switches: new Map(),
    sourceFields: new Map(),
    sample: [],
  };
  if (ctx.unavailable) return result;

  const describe = await getDescribe(ctx, mapping.sourceObject);
  if (!describe || !describe.queryable) {
    const reason = !describe
      ? ctx.global && !ctx.global.has(mapping.sourceObject)
        ? `${mapping.sourceObject} absent from GET /sobjects (no Read permission or not in org)`
        : `${mapping.sourceObject} cannot be described`
      : `${mapping.sourceObject} is not queryable`;
    if (mapping.options.optional)
      findings.warning(
        "SF_OBJECT_MISSING",
        `${reason}; optional object disabled`,
        uctx,
      );
    else findings.blocking("SF_OBJECT_MISSING", reason, uctx);
    return result;
  }
  result.describe = describe;
  result.replicateable = describe.replicateable;
  if (!describe.replicateable)
    findings.info(
      "SF_NOT_REPLICATEABLE",
      `${mapping.sourceObject} is not replicateable: /deleted/ and /updated/ skipped, key-set reconciliation used (§2.1.6)`,
      uctx,
    );

  const columns = new Set<string>(["Id", "IsDeleted", "SystemModstamp"]);
  const sysNames = new Set(describe.fields.map((f) => f.name));
  for (const c of [...columns])
    if (!sysNames.has(c) && c !== "Id") columns.delete(c);

  // --- mapped rows
  for (const f of mapping.fields) {
    if (isSkipRow(f) || !f.source) continue;
    const cls = classifyRow(f, mapping);
    const res = await resolveSourcePath(ctx, describe, f.source);
    const fctx = { ...uctx, field: f.target };
    if (res.status === "unknown") {
      columns.add(f.source);
      continue;
    }
    if (res.status === "missing") {
      const detail = `source ${f.source}: ${res.reason} (FLS or not in org)`;
      if (f.optionalSource || f.unverifiedSource) {
        findings.info("SF_FIELD_MISSING", detail, fctx);
        result.drops.set(f.target, "SF_FIELD_MISSING");
      } else if (cls.legacy || cls.fk || cls.scopeDate || cls.requiredTarget) {
        findings.blocking("SF_FIELD_MISSING", detail, fctx);
      } else {
        findings.warning("SF_FIELD_MISSING", `${detail}; field dropped`, fctx);
        result.drops.set(f.target, "SF_FIELD_MISSING");
      }
      continue;
    }
    const fd = res.field!;
    result.sourceFields.set(f.target, fd);

    // calculated / autoNumber
    const preservedAutoNumber =
      fd.autoNumber && fd.nameField && f.enabledBy === "preserveAutoNumberName";
    if (fd.calculated || (fd.autoNumber && !preservedAutoNumber)) {
      if (cls.legacy || cls.fk) {
        findings.blocking(
          "SF_FIELD_CALCULATED",
          `source ${f.source} is ${fd.calculated ? "calculated" : "autoNumber"} but drives a ${cls.legacy ? "legacy id" : "reference"}`,
          fctx,
        );
      } else {
        findings.warning(
          "SF_FIELD_CALCULATED",
          `source ${f.source} is ${fd.calculated ? "calculated" : "autoNumber"}; field skipped`,
          fctx,
        );
        result.drops.set(f.target, "SF_FIELD_CALCULATED");
      }
      continue;
    }

    // declared type vs actual
    const inner = innerTransform(f.transform);
    const switched = autoSwitchTransform(f.transform, fd.type, {
      length: fd.length,
    });
    if (
      f.sourceType &&
      sfdcTypeGroup(f.sourceType) !== sfdcTypeGroup(fd.type)
    ) {
      if (switched) {
        result.switches.set(f.target, switched);
        findings.info(
          "SF_FIELD_TYPE_MISMATCH",
          `source ${f.source} is ${fd.type}, mapping declared ${f.sourceType}; transform auto-switched (${inner.kind} → ${innerTransform(switched).kind}${innerTransform(switched).kind === "country" ? ":" + (innerTransform(switched) as { mode: string }).mode : ""})`,
          fctx,
        );
      } else {
        findings.blocking(
          "SF_FIELD_TYPE_MISMATCH",
          `source ${f.source} is ${fd.type}, mapping declared ${f.sourceType} and no transform for the actual type exists`,
          fctx,
        );
        continue;
      }
    } else if (switched) {
      // undeclared but clearly wrong mode (e.g. country(picklist) on a reference)
      result.switches.set(f.target, switched);
      findings.info(
        "SF_FIELD_TYPE_MISMATCH",
        `source ${f.source} is ${fd.type}; transform auto-switched to ${innerTransform(switched).kind}`,
        fctx,
      );
    }

    // crosswalk source values vs describe picklist values
    if (
      (inner.kind === "picklist" || inner.kind === "multipicklist") &&
      fd.picklistValues.length
    ) {
      const known = new Set(fd.picklistValues.map((v) => v.value));
      const unknown = Object.keys(mapping.picklists[inner.mapKey] ?? {}).filter(
        (v) => !known.has(v),
      );
      if (unknown.length)
        findings.info(
          "SF_PICKLIST_VALUE_UNKNOWN",
          {
            mapKey: inner.mapKey,
            values: unknown,
            note: "inactive values are legal on old rows",
          },
          { ...fctx, count: unknown.length },
        );
    }
    columns.add(f.source);
  }

  // --- scope date fields
  for (const path of scopeDateFields(mapping)) {
    const res = await resolveSourcePath(ctx, describe, path);
    if (res.status === "missing")
      findings.blocking(
        "SF_FIELD_MISSING",
        `scope date field ${path}: ${res.reason}`,
        {
          ...uctx,
          field: path,
        },
      );
    else columns.add(path);
  }

  // --- countryOf paths
  if (unit.country !== GLOBAL_COUNTRY) {
    let anyPath = false;
    for (const spec of mapping.countryOf) {
      const path = countryOfSoqlPath(spec, {
        userCountryIsLookup: ctx.facts.userCountryIsLookup,
      });
      if (!path) {
        if (spec.kind === "parent" || spec.kind === "const") anyPath = true; // id-set / constant
        continue;
      }
      const res = await resolveSourcePath(ctx, describe, path);
      if (res.status === "missing")
        findings.warning(
          "SF_FIELD_MISSING",
          `countryOf path ${path}: ${res.reason}`,
          {
            ...uctx,
            field: path,
          },
        );
      else {
        anyPath = true;
        columns.add(path);
      }
    }
    if (!anyPath && mapping.countryOf.length)
      findings.blocking(
        "SF_FIELD_MISSING",
        `no countryOf rule of ${unit.objectKey} resolves against describe(${mapping.sourceObject}); rows cannot be attributed to ${unit.country}`,
        uctx,
      );
  }

  // --- ordering / pass-2 / match columns
  const extra: Array<[string, string]> = [];
  if (mapping.load.partitionBy)
    extra.push([mapping.load.partitionBy.field, "partitionBy"]);
  for (const o of mapping.load.orderBy ?? []) extra.push([o, "orderBy"]);
  if (mapping.load.depthOrderBy)
    extra.push([mapping.load.depthOrderBy, "depthOrderBy"]);
  for (const sr of mapping.selfRefs)
    extra.push([sr.source, `selfRef ${sr.target}`]);
  for (const rule of mapping.match)
    for (const k of rule.keys ?? [])
      extra.push([k.source, `match ${rule.method}`]);
  for (const [path, use] of extra) {
    if (!path || columns.has(path)) continue;
    const res = await resolveSourcePath(ctx, describe, path);
    if (res.status === "missing")
      findings.warning(
        "SF_FIELD_MISSING",
        `${use} column ${path}: ${res.reason}`,
        {
          ...uctx,
          field: path,
        },
      );
    else columns.add(path);
  }

  // --- record types referenced by the crosswalk
  const rtNames = new Set(describe.recordTypeInfos.map((r) => r.developerName));
  if (describe.recordTypeInfos.length)
    for (const dev of Object.keys(mapping.objectTypes))
      if (!rtNames.has(dev))
        findings.warning(
          "SF_RECORD_TYPE_MISSING",
          `record type ${dev} referenced by objects.${unit.objectKey}.objectType is absent from recordTypeInfos (unused crosswalk entry)`,
          { ...uctx, field: dev },
        );

  result.columns = [...columns];

  // --- count / selectivity / size
  const terms: string[] = [];
  const scope = scopePredicate(mapping);
  if (scope) terms.push(scope);
  if (unit.country !== GLOBAL_COUNTRY) {
    const cp = buildCountryPredicate(mapping.countryOf, unit.country, {
      userCountryIsLookup: ctx.facts.userCountryIsLookup,
    });
    if (cp) terms.push(`(${cp})`);
  }
  const predicate = terms.length ? terms.join(" AND ") : undefined;
  result.predicate = predicate;
  try {
    result.count = await ctx.sfdc.count(mapping.sourceObject, predicate);
  } catch (e) {
    log.debug({ unit: unitId(unit), err: errMessage(e) }, "count failed");
  }
  if (result.count !== undefined && result.count > NON_SELECTIVE_THRESHOLD) {
    try {
      const plans = await ctx.sfdc.explain(
        `SELECT Id FROM ${mapping.sourceObject}${predicate ? ` WHERE ${predicate}` : ""}`,
      );
      if (plans[0]?.leadingOperationType === "TableScan")
        findings.warning(
          "SF_QUERY_NON_SELECTIVE",
          `leading operation TableScan on ~${result.count} rows; PK chunking forced`,
          { ...uctx, count: result.count },
        );
    } catch (e) {
      log.debug({ unit: unitId(unit), err: errMessage(e) }, "explain failed");
    }
    const bytes = result.count * estimateRowBytes(describe, result.columns);
    if (bytes > BULK_RESULT_CAP_BYTES)
      findings.warning(
        "SF_BULK_RESULT_SIZE",
        `estimated result ${(bytes / 1024 ** 3).toFixed(1)} GB > 15 GB per job; split by PK range`,
        { ...uctx, count: result.count },
      );
  }

  // --- sample
  if (ctx.sampleSize > 0) {
    const cols = result.columns.join(", ");
    const soqlFor = (where?: string) =>
      `SELECT ${cols} FROM ${mapping.sourceObject}${where ? ` WHERE ${where}` : ""} LIMIT ${ctx.sampleSize}`;
    for (const where of predicate ? [predicate, undefined] : [undefined]) {
      try {
        const rows: SourceRow[] = [];
        for await (const r of ctx.sfdc.query(soqlFor(where))) rows.push(r);
        result.sample = rows;
        break;
      } catch (e) {
        log.debug(
          { unit: unitId(unit), err: errMessage(e) },
          "sample query failed",
        );
      }
    }
  }

  // --- SF_DATETIME_RANGE on sampled values
  if (result.sample.length) {
    for (const f of mapping.fields) {
      const kind = innerTransform(
        result.switches.get(f.target) ?? f.transform,
      ).kind;
      if (kind !== "date" && kind !== "datetime" && kind !== "datetimeToDate")
        continue;
      if (!f.source || result.drops.has(f.target)) continue;
      let bad = 0;
      for (const r of result.sample) {
        const y = yearOf(r[f.source]);
        if (y !== undefined && (y < 1700 || y > 4000)) bad++;
      }
      if (bad)
        findings.warning(
          "SF_DATETIME_RANGE",
          `${bad} sampled ${f.source} values outside 1700-01-01..4000-12-31; loaded with the value omitted (dateRange = ${mapping.options.dateRange})`,
          { ...uctx, field: f.target, count: bad },
        );
    }
  }

  return result;
}

/** Referenced object keys of a mapping (for parent target resolution). */
export function referencedKeys(mapping: MaterialisedMapping): string[] {
  const out = new Set<string>();
  for (const f of mapping.fields) {
    const k = refTarget(f.transform);
    if (k && k !== "user") out.add(k);
  }
  return [...out];
}
