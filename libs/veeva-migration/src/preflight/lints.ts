/**
 * §5.3 offline mapping lints (no API): run on the materialised mappings of a
 * run. Module-structural lints already ran in `validateObjectModule`; these
 * are the plan-level ones — duplicates after overlays, picklist keys, FK
 * parents outside the plan, undeclared cycles against `loadOrder()`, scope
 * and country rules, and unused source columns when a describe is supplied.
 */
import { CycleError, loadOrder } from "../objects/registry";
import { innerTransform, refTarget } from "../transform/spec";
import {
  GLOBAL_COUNTRY,
  unitId,
  type CountryCode,
  type FieldMapping,
  type Finding,
  type MaterialisedMapping,
  type ObjectKey,
  type SfdcObjectDescribe,
  type Unit,
} from "../types";
import { FindingCollector } from "./findings";

export interface LintOptions {
  /** Is `objectKey` enabled for `country` (or GLOBAL)? Default: present in `mappings`. */
  isEnabled?: (objectKey: ObjectKey, country: CountryCode) => boolean;
  /** SFDC describes per source object (for `MAP_UNUSED_SOURCE`). */
  describes?: Map<string, SfdcObjectDescribe>;
}

export interface LintResult {
  findings: Finding[];
  /** unitId → targets to omit (`MAP_FK_PARENT_NOT_IN_PLAN`). */
  omitted: Map<string, string[]>;
}

/** Source columns never mapped by a user-facing row (system/routing columns excluded). */
const ROUTING_COLUMNS = new Set([
  "Id",
  "IsDeleted",
  "SystemModstamp",
  "LastActivityDate",
  "LastViewedDate",
  "LastReferencedDate",
  "MasterRecordId",
  "RecordTypeId",
  "CreatedDate",
  "CreatedById",
  "LastModifiedDate",
  "LastModifiedById",
  "OwnerId",
  "CurrencyIsoCode",
  "Name",
]);

function isParentInPlan(
  key: ObjectKey,
  country: CountryCode,
  mappings: Map<string, MaterialisedMapping>,
  isEnabled?: LintOptions["isEnabled"],
): boolean {
  if (isEnabled) return isEnabled(key, country);
  return (
    mappings.has(unitId({ objectKey: key, country })) ||
    mappings.has(unitId({ objectKey: key, country: GLOBAL_COUNTRY }))
  );
}

/** Run the plan-level lints. */
export function lintMappings(
  mappings: Map<string, MaterialisedMapping>,
  units: Unit[],
  opts: LintOptions = {},
): LintResult {
  const fc = new FindingCollector();
  const omitted = new Map<string, string[]>();

  for (const unit of units) {
    const id = unitId(unit);
    const m = mappings.get(id);
    if (!m) {
      fc.blocking("MAP_MAPPING_MISSING", `no materialised mapping for ${id}`, {
        objectKey: unit.objectKey,
        country: unit.country,
      });
      continue;
    }
    // findings raised by materialise (SCOPE_NARROWED, MAP_DUP_TARGET, …)
    fc.addAll(m.findings);
    const ctx = { objectKey: m.objectKey, country: m.country };

    // MAP_DUP_TARGET
    const counts = new Map<string, number>();
    for (const f of m.fields)
      counts.set(f.target, (counts.get(f.target) ?? 0) + 1);
    for (const [t, n] of counts)
      if (n > 1)
        fc.blocking("MAP_DUP_TARGET", `target mapped ${n} times`, {
          ...ctx,
          field: t,
        });

    // MAP_PICKLIST_KEY_UNKNOWN — a crosswalk key with no map at all
    for (const f of m.fields) {
      const t = innerTransform(f.transform);
      if (
        (t.kind === "picklist" || t.kind === "multipicklist") &&
        !m.picklists[t.mapKey]
      )
        fc.info(
          "MAP_PICKLIST_KEY_UNKNOWN",
          `picklist map "${t.mapKey}" has no crosswalk entries (derivation rule only)`,
          { ...ctx, field: f.target },
        );
      if (t.kind === "objectType" && Object.keys(m.objectTypes).length === 0)
        fc.warning(
          "MAP_PICKLIST_KEY_UNKNOWN",
          `objectType map "${t.mapKey}" is empty (record types will be renamed mechanically)`,
          { ...ctx, field: f.target },
        );
      if (t.kind === "state" && Object.keys(m.states).length === 0)
        fc.warning(
          "MAP_PICKLIST_KEY_UNKNOWN",
          `state map "${t.mapKey}" is empty`,
          { ...ctx, field: f.target },
        );
    }

    // MAP_FK_PARENT_NOT_IN_PLAN
    for (const f of m.fields) {
      const key = refTarget(f.transform);
      if (!key || key === "user" || key === m.objectKey) continue;
      if (!isParentInPlan(key, unit.country, mappings, opts.isEnabled)) {
        fc.warning(
          "MAP_FK_PARENT_NOT_IN_PLAN",
          `ref(${key}) but "${key}" is not enabled for ${unit.country}; field omitted`,
          { ...ctx, field: f.target },
        );
        const list = omitted.get(id) ?? [];
        list.push(f.target);
        omitted.set(id, list);
      }
    }

    // MAP_SCOPE_FIELD_MISSING
    const spec = m.scope.spec;
    if (spec.kind === "dated" && spec.predicates.length === 0)
      fc.blocking(
        "MAP_SCOPE_FIELD_MISSING",
        "dated scope without a date field",
        ctx,
      );
    if (spec.kind === "via-parent" && !spec.parentField)
      fc.blocking(
        "MAP_SCOPE_FIELD_MISSING",
        "via-parent scope without parentField",
        ctx,
      );
    if (
      spec.kind === "full" &&
      m.scope.historyMonths !== undefined &&
      m.scope.historyMonths > 0 &&
      m.scope.cutoffDate !== undefined
    )
      fc.blocking(
        "MAP_SCOPE_FIELD_MISSING",
        `historyMonths = ${m.scope.historyMonths} but the object has no scope date field`,
        ctx,
      );

    // MAP_COUNTRY_RULE_MISSING
    const allGlobal = m.countryOf.every((c) => c.kind === "global");
    if (!m.countryOf.length)
      fc.blocking("MAP_COUNTRY_RULE_MISSING", "countryOf is empty", ctx);
    else if (unit.country !== GLOBAL_COUNTRY && allGlobal)
      fc.blocking(
        "MAP_COUNTRY_RULE_MISSING",
        `unit ${id} is per-country but countryOf is "global"`,
        ctx,
      );

    // MAP_UNUSED_SOURCE (info) — needs a describe
    const describe = opts.describes?.get(m.sourceObject);
    if (describe) {
      const used = new Set<string>();
      for (const f of m.fields) if (f.source) used.add(f.source.split(".")[0]);
      for (const sr of m.selfRefs) used.add(sr.source.split(".")[0]);
      for (const rule of m.match)
        for (const k of rule.keys ?? []) used.add(k.source.split(".")[0]);
      const unused = describe.fields
        .filter(
          (fd) =>
            !used.has(fd.name) &&
            !ROUTING_COLUMNS.has(fd.name) &&
            !fd.calculated &&
            !fd.autoNumber &&
            !fd.compoundFieldName &&
            !/^zvod_/i.test(fd.name) &&
            fd.type !== "address" &&
            fd.type !== "location",
        )
        .map((fd) => fd.name);
      if (unused.length)
        fc.info(
          "MAP_UNUSED_SOURCE",
          { columns: unused.slice(0, 200), truncated: unused.length > 200 },
          { ...ctx, count: unused.length },
        );
    }
  }

  // MAP_CYCLE_UNDECLARED — per country against loadOrder()
  const countries = new Set(units.map((u) => u.country));
  for (const country of countries) {
    const list: Array<
      Pick<MaterialisedMapping, "objectKey" | "dependsOn" | "selfRefs"> & {
        key: ObjectKey;
      }
    > = [];
    const seen = new Set<ObjectKey>();
    for (const u of units) {
      if (u.country !== country && u.country !== GLOBAL_COUNTRY) continue;
      const m = mappings.get(unitId(u));
      if (!m || seen.has(m.objectKey)) continue;
      seen.add(m.objectKey);
      list.push({
        key: m.objectKey,
        objectKey: m.objectKey,
        dependsOn: m.dependsOn,
        selfRefs: m.selfRefs,
      });
    }
    try {
      loadOrder(list);
    } catch (e) {
      if (e instanceof CycleError) {
        for (const key of new Set(e.cycle))
          fc.blocking(
            "MAP_CYCLE_UNDECLARED",
            `dependency cycle not covered by selfRefs: ${e.cycle.join(" → ")}`,
            {
              objectKey: key,
              country: country === GLOBAL_COUNTRY ? undefined : country,
            },
          );
      } else throw e;
    }
  }

  return { findings: fc.findings, omitted };
}

/** Rows whose transform is `skip` need no source column and no target field. */
export function isSkipRow(f: FieldMapping): boolean {
  return innerTransform(f.transform).kind === "skip";
}
