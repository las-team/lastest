/**
 * Column list of a unit (§2.2 step 2):
 *   mapped source fields ∩ describe ∪ always-selected system columns ∪
 *   relationship columns needed for country / record-type resolution.
 *
 * Also derives the FK columns whose values feed the id-set collection of
 * §2.2 step 4, keyed by the **target object key** of the mapping transform
 * (never by `referenceTo` — closure fetches by object key).
 */
import { fieldList } from "../sfdc/soql";
import type {
  FieldMapping,
  MaterialisedMapping,
  ObjectKey,
  SfdcObjectDescribe,
  TransformSpec,
} from "../types";
import type { ResolvedTarget } from "../preflight/types";
import { scopeColumns } from "./scope";

/** Always selected when the describe has them (§2.2 step 2). */
export const SYSTEM_COLUMNS = [
  "Id",
  "IsDeleted",
  "SystemModstamp",
  "CreatedDate",
  "CreatedById",
  "LastModifiedDate",
  "LastModifiedById",
] as const;

/** Selected when present (org/object dependent). */
export const OPTIONAL_SYSTEM_COLUMNS = [
  "RecordTypeId",
  "CurrencyIsoCode",
  "OwnerId",
  "MasterRecordId",
] as const;

/** Columns a `nameTemplate` transform may read (§6.0.3), kept only when the describe has them. */
export const NAME_TEMPLATE_COLUMNS = [
  "FirstName",
  "MiddleName",
  "LastName",
  "Suffix",
  "Salutation",
];

export interface FkColumn {
  column: string;
  targetObjectKey: ObjectKey | "user";
  /** `OwnerId` (User|Group): keep `005` ids, record `00G` as queue owners (§2.2 step 4). */
  polymorphic: boolean;
}

export interface ColumnList {
  /** Ordered, de-duplicated SELECT list. */
  columns: string[];
  /** Reference columns to collect id-sets from. */
  fkColumns: FkColumn[];
  /** Mapped columns absent from the describe (already reported by preflight). */
  dropped: string[];
}

export interface ColumnOptions {
  /** Relationship paths required by the country strategy. */
  countryPaths?: readonly string[];
  /** Extra columns (partition/order/depth fields are added automatically from `mapping.load`). */
  extra?: readonly string[];
}

function unwrap(t: TransformSpec): TransformSpec {
  if (t.kind === "secondPass") return unwrap(t.inner);
  if (t.kind === "deferredBlob" && t.inner) return unwrap(t.inner);
  return t;
}

/** Source columns one mapping row reads (its `source` plus transform-declared inputs). */
export function rowSources(f: FieldMapping): string[] {
  const t = unwrap(f.transform);
  if (t.kind === "skip") return [];
  const out: string[] = [];
  if (f.source) out.push(f.source);
  if (t.kind === "statusFromFlag") out.push(t.sourceFlag);
  if (t.kind === "compositeExternalId")
    for (const part of Object.values(t.parts)) {
      if ("ref" in part) out.push(part.source);
      else if ("user" in part) out.push(part.user);
      else if ("field" in part) out.push(part.field);
    }
  if (t.kind === "nameTemplate") out.push(...NAME_TEMPLATE_COLUMNS);
  return out;
}

/** FK columns declared by the mapping (`ref`, `refUser`, composite parts). */
export function mappingFkColumns(
  mapping: Pick<MaterialisedMapping, "fields">,
): Array<{ column: string; targetObjectKey: ObjectKey | "user" }> {
  const out: Array<{ column: string; targetObjectKey: ObjectKey | "user" }> =
    [];
  const seen = new Set<string>();
  const add = (column: string, key: ObjectKey | "user") => {
    const k = `${column.toLowerCase()}→${key}`;
    if (seen.has(k) || !column || column.includes(".")) return;
    seen.add(k);
    out.push({ column, targetObjectKey: key });
  };
  for (const f of mapping.fields) {
    const t = unwrap(f.transform);
    if (t.kind === "ref") add(f.source, t.objectKey);
    else if (t.kind === "refUser") add(f.source, "user");
    else if (t.kind === "compositeExternalId")
      for (const part of Object.values(t.parts)) {
        if ("ref" in part) add(part.source, part.ref);
        else if ("user" in part) add(part.user, "user");
      }
  }
  return out;
}

function describeIndex(describe: SfdcObjectDescribe | undefined) {
  const fields = new Map<string, SfdcObjectDescribe["fields"][number]>();
  const relationships = new Map<string, string>();
  for (const f of describe?.fields ?? []) {
    fields.set(f.name.toLowerCase(), f);
    if (f.relationshipName)
      relationships.set(f.relationshipName.toLowerCase(), f.name);
  }
  return { fields, relationships };
}

/**
 * Build the SELECT list for a unit. Plain columns are kept when the describe
 * (or the preflight `target.columns` list) has them; relationship paths are
 * kept when their first segment is a known relationship of the object. With
 * no describe at all every mapped column is trusted.
 */
export function buildColumnList(
  mapping: MaterialisedMapping,
  target: Pick<ResolvedTarget, "describe" | "columns"> | undefined,
  opts: ColumnOptions = {},
): ColumnList {
  const describe = target?.describe;
  const idx = describeIndex(describe);
  const allowed = new Set((target?.columns ?? []).map((c) => c.toLowerCase()));
  const hasDescribe = !!describe;
  const dropped: string[] = [];
  const has = (name: string) => idx.fields.has(name.toLowerCase());

  const keep = (col: string): boolean => {
    if (!col) return false;
    if (!hasDescribe) return true;
    if (col.includes(".")) {
      const first = col.split(".")[0].toLowerCase();
      return idx.relationships.has(first);
    }
    if (has(col)) return true;
    return false;
  };

  const wanted: string[] = [];
  // 1. system columns
  for (const c of SYSTEM_COLUMNS)
    if (
      !hasDescribe ||
      has(c) ||
      c === "Id" ||
      c === "IsDeleted" ||
      c === "SystemModstamp"
    )
      wanted.push(c);
  for (const c of OPTIONAL_SYSTEM_COLUMNS)
    if (hasDescribe && has(c)) wanted.push(c);
  if (hasDescribe && has("RecordTypeId"))
    wanted.push("RecordType.DeveloperName");

  // 2. mapped source fields (∩ describe; ∩ preflight column list when given)
  for (const f of mapping.fields)
    for (const s of rowSources(f)) {
      const plain = !s.includes(".");
      if (plain && allowed.size && !allowed.has(s.toLowerCase()) && !has(s)) {
        dropped.push(s);
        continue;
      }
      if (keep(s)) wanted.push(s);
      else if (!NAME_TEMPLATE_COLUMNS.includes(s)) dropped.push(s);
    }

  // 3. match keys, self-ref sources, ordering/partition fields, scope + country paths
  for (const rule of mapping.match)
    for (const k of rule.keys ?? []) if (keep(k.source)) wanted.push(k.source);
  for (const sr of mapping.selfRefs)
    if (keep(sr.source)) wanted.push(sr.source);
  const load = mapping.load;
  for (const c of [
    load.partitionBy?.field,
    load.depthOrderBy,
    ...(load.orderBy ?? []),
  ])
    if (c && keep(c)) wanted.push(c);
  for (const c of scopeColumns(mapping.scope.spec)) if (keep(c)) wanted.push(c);
  for (const c of opts.countryPaths ?? []) if (keep(c)) wanted.push(c);
  for (const c of opts.extra ?? []) if (keep(c)) wanted.push(c);
  // queue-owner replacement reads the rep from `User_vod__c` (§3.4)
  if (hasDescribe && has("OwnerId") && has("User_vod__c"))
    wanted.push("User_vod__c");

  const columns = fieldList(wanted);
  const present = new Set(columns.map((c) => c.toLowerCase()));

  // 4. FK columns: mapping-declared refs + audit/owner system columns
  const fkColumns: FkColumn[] = [];
  const seenFk = new Set<string>();
  const addFk = (column: string, key: ObjectKey | "user") => {
    if (!present.has(column.toLowerCase())) return;
    const k = `${column.toLowerCase()}→${key}`;
    if (seenFk.has(k)) return;
    seenFk.add(k);
    const d = idx.fields.get(column.toLowerCase());
    const polymorphic =
      column === "OwnerId" || (d?.referenceTo ?? []).some((r) => r === "Group");
    fkColumns.push({ column, targetObjectKey: key, polymorphic });
  };
  for (const fk of mappingFkColumns(mapping))
    addFk(fk.column, fk.targetObjectKey);
  for (const c of ["CreatedById", "LastModifiedById", "OwnerId"])
    addFk(c, "user");

  return { columns, fkColumns, dropped: [...new Set(dropped)] };
}
