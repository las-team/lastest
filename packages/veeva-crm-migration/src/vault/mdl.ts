/**
 * MDL (Vault Metadata Definition Language) generators — pure string builders.
 *
 * Grammar follows `docs/research/03-vault-crm-api-and-migration.md` §3:
 * `RECREATE Object x ( attr(value), Field f ( … ), Objecttype t ( … ) );`,
 * `ALTER Object x ( ADD Field f ( … ) );`, `RECREATE Picklist p ( … )`,
 * `RECREATE Permissionset ps ( Objectpermission …, Fieldpermission …,
 * Tabpermission … )`, `RECREATE Securityprofile sp ( permission_sets('…') )`.
 * Where the research doc marks the attribute / sub-component names as
 * inferred, the generator still emits a best-effort statement but returns
 * `review: true` so the plan step is flagged for a sandbox round-trip
 * (`GET /api/mdl/components/{type}.{name}` → diff → adjust).
 *
 * Every component name is sanitised: lower-case, `[a-z0-9_]`, `__c` suffix.
 * `__v` is Veeva-owned and is never generated for a customer component.
 */
import type {
  FieldConfig,
  FieldPermission,
  LayoutConfig,
  ObjectConfig,
  ObjectPermission,
  PicklistValue,
  RecordTypeConfig,
} from "../model/types";
import {
  mapFieldName,
  mapFieldType,
  mapObjectName,
  mapPicklistName,
  mapPicklistValueName,
  mapRecordTypeName,
  splitSuffix,
  toLowerSnake,
} from "./mapping";

export interface MdlStatement {
  mdl: string;
  /** Grammar or mapping not verified: the plan step must be reviewed. */
  review: boolean;
  notes: string[];
}

/** Doubles single quotes so a value can sit inside `'…'`. */
export function mdlEscape(value: string): string {
  return value.replace(/'/g, "''");
}

export function mdlString(value: string): string {
  return `'${mdlEscape(value)}'`;
}

/**
 * Lower-cases, replaces anything outside `[a-z0-9_]`, collapses underscores
 * and appends `__c`. An existing `__c`/`__v`/`_vod__c` suffix is stripped
 * first, so a Veeva-style name passed here still comes out customer-owned.
 * Names must start with a letter; a leading digit gets an `x_` prefix.
 */
export function sanitizeName(raw: string, suffix: "__c" | "" = "__c"): string {
  const base = splitSuffix(raw).base;
  let slug = toLowerSnake(base);
  if (!slug) slug = "unnamed";
  if (/^[0-9]/.test(slug)) slug = `x_${slug}`;
  return `${slug}${suffix}`;
}

/** Component name that is allowed to be Veeva-owned (`__v`) when the source was. */
export function vaultComponentName(raw: string): string {
  const name = mapFieldName(raw);
  return /__[cv]$/.test(name) ? name : sanitizeName(raw);
}

function attr(name: string, value: string | number | boolean): string {
  if (typeof value === "string") return `${name}(${mdlString(value)})`;
  return `${name}(${String(value)})`;
}

function block(head: string, items: readonly string[], indent = "  "): string {
  if (!items.length) return `${head} ()`;
  const inner = items
    .map((i) =>
      i
        .split("\n")
        .map((l) => `${indent}${l}`)
        .join("\n"),
    )
    .join(",\n");
  return `${head} (\n${inner}\n)`;
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

export interface FieldDefinition {
  /** Vault field name. */
  name: string;
  /** `Field <name> ( … )` sub-component text (no trailing comma). */
  text: string;
  review: boolean;
  notes: string[];
  /** Vault picklist the field references, when it is a picklist. */
  picklist?: string;
  /** Vault object the field references, when it is a lookup. */
  referenceTo?: string;
}

/** Simple formulas (field references, arithmetic, literals) are carried; anything else is manual. */
const SIMPLE_FORMULA_CHARS = /^[\sA-Za-z0-9_.+\-*/()'"]*$/;
const FUNCTION_CALL = /[A-Za-z_][A-Za-z0-9_]*\s*\(/;

export function isSimpleFormula(formula: string): boolean {
  return SIMPLE_FORMULA_CHARS.test(formula) && !FUNCTION_CALL.test(formula);
}

/**
 * Builds the `Field` sub-component for a Salesforce field, or `null` when the
 * type has no Vault equivalent (the caller lists it as unmapped).
 */
export function mdlFieldDefinition(
  objectApiName: string,
  field: FieldConfig,
): FieldDefinition | null {
  const name = mapFieldName(field.apiName);
  const mapped = mapFieldType(field.type, field);
  const notes: string[] = [];
  let review = mapped.confidence !== "confirmed";
  if (mapped.note) notes.push(mapped.note);
  const attrs: string[] = [attr("label", field.label || field.apiName)];
  const def: FieldDefinition = { name, text: "", review, notes };

  switch (mapped.type) {
    case "String": {
      attrs.push(attr("type", "String"));
      attrs.push(attr("max_length", Math.min(field.length || 255, 1500)));
      if (field.length && field.length > 1500)
        notes.push(`length ${field.length} capped at 1500`);
      break;
    }
    case "LongText": {
      attrs.push(attr("type", "LongText"));
      if (field.length) attrs.push(attr("max_length", field.length));
      break;
    }
    case "Number": {
      attrs.push(attr("type", "Number"));
      const scale = field.scale ?? 0;
      const precision = field.precision ?? 18;
      attrs.push(attr("max_length", Math.max(1, precision - scale)));
      attrs.push(attr("scale", scale));
      break;
    }
    case "Date":
    case "DateTime":
    case "Boolean": {
      attrs.push(attr("type", mapped.type));
      break;
    }
    case "Picklist": {
      const picklist = mapPicklistName(objectApiName, field.apiName);
      attrs.push(attr("type", "Picklist"));
      attrs.push(attr("picklist", picklist));
      attrs.push(attr("multi_value", !!mapped.multiValue));
      def.picklist = picklist;
      if (field.controllerName)
        notes.push(
          `dependent picklist controlled by ${field.controllerName}: recreate the dependency in Vault`,
        );
      break;
    }
    case "Object": {
      const target = field.referenceTo?.[0];
      if (!target) {
        notes.push("lookup without a target object");
        return null;
      }
      if (field.referenceTo && field.referenceTo.length > 1) {
        notes.push(
          `polymorphic lookup (${field.referenceTo.join(", ")}): first target used`,
        );
        review = true;
      }
      const vaultTarget = mapObjectName(target);
      attrs.push(attr("type", "Object"));
      attrs.push(attr("object", vaultTarget));
      def.referenceTo = vaultTarget;
      break;
    }
    case "Formula": {
      const formula = field.formula ?? "";
      if (!isSimpleFormula(formula)) {
        notes.push(
          "formula uses functions Vault cannot express: recreate by hand",
        );
        return null;
      }
      attrs.push(attr("type", "Formula"));
      attrs.push(attr("formula", convertFieldReferences(formula).text));
      review = true;
      break;
    }
    case "Unsupported":
      return null;
  }
  if (field.required && mapped.type !== "Boolean")
    attrs.push(attr("required", true));
  if (field.helpText) attrs.push(attr("help_content", field.helpText));
  def.review = review;
  def.text = block(`Field ${name}`, attrs);
  return def;
}

// ---------------------------------------------------------------------------
// Objects
// ---------------------------------------------------------------------------

export interface ObjectStatement extends MdlStatement {
  name: string;
  /** Fields that could not be expressed (apiName → reason). */
  unmapped: { field: string; reason: string }[];
  /** Picklists the object's fields reference. */
  picklists: string[];
  /** Vault objects referenced by lookups. */
  references: string[];
}

/**
 * `RECREATE Object <name> ( … )` for a customer object. `Name` becomes the
 * mandatory `name__v`; system fields are dropped; fields the caller wants to
 * add later (e.g. lookups to objects created by other steps) can be excluded.
 */
export function mdlObject(
  object: ObjectConfig,
  options: { excludeFields?: readonly string[] } = {},
): ObjectStatement {
  const name = sanitizeName(object.apiName);
  const exclude = new Set(options.excludeFields ?? []);
  const notes: string[] = [];
  const unmapped: { field: string; reason: string }[] = [];
  const picklists = new Set<string>();
  const references = new Set<string>();
  let review = false;

  const items: string[] = [
    attr("label", object.label || object.apiName),
    attr("label_plural", object.labelPlural || object.label || object.apiName),
    attr("active", true),
    attr("in_menu", true),
  ];
  const nameField = object.fields.find((f) => f.apiName === "Name");
  items.push(
    block("Field name__v", [
      attr("label", nameField?.label || "Name"),
      attr("type", "String"),
      attr("max_length", Math.min(nameField?.length || 128, 1500)),
      attr("required", true),
      attr("unique", false),
    ]),
  );
  const fields = [...object.fields]
    .filter((f) => f.custom && !f.managed && !exclude.has(f.apiName))
    .sort((a, b) => a.apiName.localeCompare(b.apiName));
  for (const field of fields) {
    const def = mdlFieldDefinition(object.apiName, field);
    if (!def) {
      unmapped.push({
        field: field.apiName,
        reason: `type ${field.type}${field.formula ? " (formula)" : ""} has no Vault equivalent`,
      });
      continue;
    }
    items.push(def.text);
    if (def.review) review = true;
    for (const n of def.notes) notes.push(`${field.apiName}: ${n}`);
    if (def.picklist) picklists.add(def.picklist);
    if (def.referenceTo) references.add(def.referenceTo);
  }
  items.push(
    block("Objecttype base__v", [attr("label", "Base"), attr("active", true)]),
  );
  return {
    name,
    mdl: `${block(`RECREATE Object ${name}`, items)};`,
    review,
    notes,
    unmapped,
    picklists: [...picklists].sort(),
    references: [...references].sort(),
  };
}

/** `ALTER Object <obj> ( ADD Field <f> ( … ) );` or `null` when inexpressible. */
export function mdlAddField(
  objectApiName: string,
  field: FieldConfig,
): (MdlStatement & FieldDefinition) | null {
  const def = mdlFieldDefinition(objectApiName, field);
  if (!def) return null;
  const objectName = mapObjectName(objectApiName);
  return {
    ...def,
    mdl: `${block(`ALTER Object ${objectName}`, [`ADD ${def.text}`])};`,
  };
}

// ---------------------------------------------------------------------------
// Picklists, object types
// ---------------------------------------------------------------------------

/** `RECREATE Picklist <name> ( label, active, Picklistentry … );` */
export function mdlPicklist(
  name: string,
  label: string,
  values: readonly PicklistValue[],
): MdlStatement {
  const pickName = /__[cv]$/.test(name) ? name : sanitizeName(name);
  const notes: string[] = [];
  const seen = new Set<string>();
  const entries: string[] = [];
  values.forEach((v, i) => {
    let entry = mapPicklistValueName(v.value);
    if (seen.has(entry)) {
      entry = `${entry.replace(/__[cv]$/, "")}_${i + 1}__c`;
      notes.push(`duplicate value name for "${v.value}" renamed to ${entry}`);
    }
    seen.add(entry);
    entries.push(
      block(`Picklistentry ${entry}`, [
        attr("value", v.label || v.value),
        attr("order", i + 1),
        attr("active", v.active),
      ]),
    );
  });
  return {
    mdl: `${block(`RECREATE Picklist ${pickName}`, [
      attr("label", label),
      attr("active", true),
      ...entries,
    ])};`,
    review: false,
    notes,
  };
}

/** `ALTER Object <obj> ( ADD Objecttype <t>__c ( label, active ) );` — grammar inferred. */
export function mdlObjectType(
  objectApiName: string,
  recordType: Pick<RecordTypeConfig, "developerName" | "name" | "active">,
): MdlStatement & { name: string } {
  const objectName = mapObjectName(objectApiName);
  const { managed } = splitSuffix(recordType.developerName);
  const name = managed
    ? mapRecordTypeName(recordType.developerName)
    : sanitizeName(recordType.developerName);
  const notes = [
    "Objecttype sub-component grammar inferred from the Object example; verify on a sandbox",
  ];
  if (managed)
    notes.push(
      `record type ${recordType.developerName} is Veeva-managed: the object type should already exist as ${name}`,
    );
  return {
    name,
    mdl: `${block(`ALTER Object ${objectName}`, [
      block(`ADD Objecttype ${name}`, [
        attr("label", recordType.name || recordType.developerName),
        attr("active", recordType.active),
      ]),
    ])};`,
    review: true,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Page layouts
// ---------------------------------------------------------------------------

/**
 * `RECREATE Pagelayout <obj>.<layout>__c ( label, active, Section … ( Layoutfield … ) )`.
 * The `Pagelayout` grammar is not verified — always flagged for review.
 */
export function mdlPageLayout(
  layout: LayoutConfig,
  names: { object: string; name: string; label: string },
): MdlStatement {
  const layoutName = /__c$/.test(names.name)
    ? names.name
    : sanitizeName(names.name);
  const notes = [
    "Pagelayout / Section / Layoutfield grammar is unverified: retrieve a real layout with GET /api/mdl/components/Pagelayout.<obj>.<name> and diff",
  ];
  const items: string[] = [attr("label", names.label), attr("active", true)];
  layout.sections.forEach((section, i) => {
    const secName = sanitizeName(section.heading || `section_${i + 1}`);
    const fields = section.fields.map((f) => {
      const item = section.items?.find((it) => it.field === f);
      const fieldAttrs: string[] = [];
      if (item?.behavior === "Required")
        fieldAttrs.push(attr("required", true));
      if (item?.behavior === "Readonly")
        fieldAttrs.push(attr("read_only", true));
      return fieldAttrs.length
        ? block(`Layoutfield ${mapFieldName(f)}`, fieldAttrs)
        : `Layoutfield ${mapFieldName(f)} ()`;
    });
    items.push(
      block(`Section ${secName}`, [
        attr("label", section.heading || `Section ${i + 1}`),
        attr("columns", section.columns || 1),
        ...fields,
      ]),
    );
  });
  if (layout.relatedLists.length)
    notes.push(
      `related lists to add by hand: ${layout.relatedLists.map(mapObjectName).join(", ")}`,
    );
  if (layout.buttons?.length)
    notes.push(
      `custom buttons have no MDL equivalent: ${layout.buttons.join(", ")}`,
    );
  return {
    mdl: `${block(`RECREATE Pagelayout ${names.object}.${layoutName}`, items)};`,
    review: true,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Permission sets, security profiles
// ---------------------------------------------------------------------------

export interface PermissionSetInput {
  name: string;
  label: string;
  /** Already merged; `object` is the Salesforce API name. */
  objectPermissions: readonly ObjectPermission[];
  /** `object` / `field` are Salesforce API names. */
  fieldPermissions: readonly FieldPermission[];
  /** Vault tab names → visible. */
  tabs?: readonly { tab: string; visible: boolean }[];
  /** Restrict to these Salesforce objects (unknown objects are dropped). */
  objectFilter?: (object: string) => boolean;
}

/**
 * `RECREATE Permissionset <name> ( label, active, Objectpermission …,
 * Fieldpermission …, Tabpermission … );` — sub-component names inferred.
 */
export function mdlPermissionSet(input: PermissionSetInput): MdlStatement {
  const name = /__c$/.test(input.name) ? input.name : sanitizeName(input.name);
  const keep = input.objectFilter ?? (() => true);
  const items: string[] = [attr("label", input.label), attr("active", true)];
  const objects = [...input.objectPermissions]
    .filter((p) => keep(p.object))
    .sort((a, b) => a.object.localeCompare(b.object));
  for (const p of objects) {
    items.push(
      block(`Objectpermission ${mapObjectName(p.object)}`, [
        attr("create", p.create),
        attr("read", p.read),
        attr("edit", p.edit),
        attr("delete", p.delete),
      ]),
    );
  }
  const fields = [...input.fieldPermissions]
    .filter((p) => keep(p.object))
    .sort(
      (a, b) =>
        a.object.localeCompare(b.object) || a.field.localeCompare(b.field),
    );
  for (const p of fields) {
    items.push(
      block(
        `Fieldpermission ${mapObjectName(p.object)}.${mapFieldName(p.field)}`,
        [attr("read", p.readable), attr("edit", p.editable)],
      ),
    );
  }
  for (const t of [...(input.tabs ?? [])].sort((a, b) =>
    a.tab.localeCompare(b.tab),
  )) {
    items.push(block(`Tabpermission ${t.tab}`, [attr("visible", t.visible)]));
  }
  return {
    mdl: `${block(`RECREATE Permissionset ${name}`, items)};`,
    review: true,
    notes: [
      "Objectpermission / Fieldpermission / Tabpermission sub-component names are inferred: compare with GET /api/mdl/components/Permissionset.<name> on a sandbox",
      "view-all / modify-all and page-layout assignments are not expressed in MDL: see the manual checklist",
    ],
  };
}

/** `RECREATE Securityprofile <name> ( label, active, permission_sets('a','b') );` */
export function mdlSecurityProfile(
  name: string,
  label: string,
  permissionSets: readonly string[],
): MdlStatement {
  const spName = /__c$/.test(name) ? name : sanitizeName(name);
  return {
    mdl: `${block(`RECREATE Securityprofile ${spName}`, [
      attr("label", label),
      attr("active", true),
      `permission_sets(${permissionSets.map(mdlString).join(", ")})`,
    ])};`,
    review: true,
    notes: [
      "Securityprofile attribute names are inferred: verify against GET /api/mdl/components/Securityprofile.<name>",
    ],
  };
}

// ---------------------------------------------------------------------------
// Where clauses / formulas
// ---------------------------------------------------------------------------

const FIELD_TOKEN =
  /\b([A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)*(?:_vod)?__[cr])\b/g;
const VOD_TOKEN = /@@[A-Z0-9_]+@@/g;

/** Rewrites `Foo_vod__c` / `Bar__c` references to Vault names; keeps `@@TOKENS@@` and reports them. */
export function convertFieldReferences(text: string): {
  text: string;
  unresolvedTokens: string[];
} {
  const tokens = new Set<string>();
  for (const m of text.matchAll(VOD_TOKEN)) tokens.add(m[0]);
  const converted = text.replace(FIELD_TOKEN, (t) => mapFieldName(t));
  return { text: converted, unresolvedTokens: [...tokens].sort() };
}

/** VMOC where clause → Vault field names; `@@VOD_*@@` tokens are kept and reported. */
export function convertWhereClause(where: string): {
  text: string;
  unresolvedTokens: string[];
} {
  return convertFieldReferences(where);
}
