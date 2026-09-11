/**
 * Pure planner: `ClassifiedSnapshot` → `VaultPlan`.
 *
 * Emission order (each later group depends on the earlier ones through
 * `dependsOn`, and `orderSteps` re-sorts topologically anyway):
 *
 *   1. picklists for customer picklist fields          `picklist:<name>`      mdl
 *   2. customer objects                                `obj:<name>`           mdl
 *   3. customer fields on Veeva / customer objects     `field:<obj>.<field>`  mdl
 *   4. customer-added values on Veeva picklists        `picklist-values:<n>`  api  (review)
 *   5. customer record types → object types            `objecttype:<obj>.<t>` mdl  (review)
 *   6. per country × rep category                      `ps:` `sp:` `app:` `layout:` `layout-assign:` `vmoc:` `setting:`
 *   7. per country: customer messages                  `messages:<CC>`        manual (+ `plan.translations`)
 *   8. org-level settings, profile-less VMOCs          `settings-org:` `vmoc:GLOBAL.all.…`
 *
 * A persona (country × category) merges every in-scope profile of the group
 * into one permission set. The merge is the OR of the profiles' flags; every
 * flag that not all profiles granted is listed in the step notes and in
 * `plan.unmapped`, so the widening is a documented decision, not a silent one.
 *
 * Everything with no Vault CRM equivalent goes to `plan.unmapped` with a
 * reason. The planner never talks to a vault: idempotency lives in `apply`.
 */
import {
  GLOBAL_COUNTRY,
  type ClassifiedProfile,
  type ClassifiedSnapshot,
  type CountryCode,
  type CountryRepConfig,
  type FieldConfig,
  type FieldPermission,
  type LayoutConfig,
  type ObjectConfig,
  type ObjectPermission,
  type PlanStep,
  type RepCategory,
  type TranslationRow,
  type VaultPlan,
  type VeevaMessage,
  type VeevaSettingRecord,
  type VmocConfig,
} from "../model/types";
import { normalizeVaultApiVersion } from "./client";
import {
  UNMAPPED_STANDARD_OBJECTS,
  VAULT_CRM_CONFIG_OBJECTS,
  lookupObjectMapping,
  mapFieldName,
  mapLayoutName,
  mapObjectName,
  mapPersonaName,
  mapPicklistName,
  mapRecordTypeName,
  mapTabName,
  splitSuffix,
} from "./mapping";
import {
  convertWhereClause,
  mdlAddField,
  mdlObject,
  mdlObjectType,
  mdlPageLayout,
  mdlPermissionSet,
  mdlPicklist,
  mdlSecurityProfile,
} from "./mdl";

export interface VaultPlanOptions {
  apiVersion?: string;
  vaultDns?: string;
  now?: () => Date;
  /** Plan country × category groups whose profiles have no active users (default false). */
  keepEmptyProfiles?: boolean;
}

/** `{{step:<id>.recordId}}` placeholder for a record id captured by an earlier step. */
export function recordIdPlaceholder(stepId: string): string {
  return `{{step:${stepId}.recordId}}`;
}

export function parsePlaceholder(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = /^\{\{step:(.+)\.recordId\}\}$/.exec(value);
  return m?.[1] ?? null;
}

/**
 * Stable topological order by `dependsOn` (Kahn's algorithm, ties broken by
 * the input order). Throws on an unknown dependency or a cycle.
 */
export function orderSteps(steps: readonly PlanStep[]): PlanStep[] {
  const byId = new Map(steps.map((s) => [s.id, s]));
  for (const s of steps)
    for (const d of s.dependsOn)
      if (!byId.has(d))
        throw new Error(`step ${s.id} depends on unknown step ${d}`);
  const indegree = new Map<string, number>();
  const dependants = new Map<string, string[]>();
  for (const s of steps) {
    indegree.set(s.id, new Set(s.dependsOn).size);
    for (const d of new Set(s.dependsOn))
      dependants.set(d, [...(dependants.get(d) ?? []), s.id]);
  }
  const ready = steps.filter((s) => indegree.get(s.id) === 0).map((s) => s.id);
  const position = new Map(steps.map((s, i) => [s.id, i]));
  const out: PlanStep[] = [];
  while (ready.length) {
    ready.sort((a, b) => position.get(a)! - position.get(b)!);
    const id = ready.shift()!;
    out.push(byId.get(id)!);
    for (const next of dependants.get(id) ?? []) {
      const n = indegree.get(next)! - 1;
      indegree.set(next, n);
      if (n === 0) ready.push(next);
    }
  }
  if (out.length !== steps.length) {
    const stuck = steps.filter((s) => !out.includes(s)).map((s) => s.id);
    throw new Error(`dependency cycle among steps: ${stuck.join(", ")}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

type ObjectKind = "custom" | "veeva" | "unmapped";

/**
 * `custom`: customer-created, the plan creates it. `veeva`: Veeva-owned
 * (mapping table or `_vod__c`), assumed to exist as `__v`. `unmapped`:
 * standard Salesforce object with no Vault CRM equivalent.
 */
function objectKind(
  o: Pick<ObjectConfig, "apiName" | "custom" | "managed">,
): ObjectKind {
  if (UNMAPPED_STANDARD_OBJECTS.has(o.apiName)) return "unmapped";
  if (lookupObjectMapping(o.apiName)) return "veeva";
  if (o.managed || /_vod__c$/i.test(o.apiName)) return "veeva";
  if (o.custom) return "custom";
  return "unmapped";
}

/** Lower-case `[a-z0-9_]` slug for step ids (no camel-case splitting: `iPad` → `ipad`). */
function idSlug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function totalUsers(p: ClassifiedProfile): number {
  return Object.values(p.profile.activeUsersByCountry).reduce(
    (a, n) => a + n,
    0,
  );
}

function isCustomerField(f: FieldConfig): boolean {
  return f.custom && !f.managed;
}

function byName<T>(key: (t: T) => string): (a: T, b: T) => number {
  return (a, b) => key(a).localeCompare(key(b));
}

/** OR-merge of several profiles plus the flags not every profile granted. */
interface Merged<T> {
  merged: T[];
  /** `Object.flag: Profile A only` — granted by some, not all, of the profiles. */
  widened: string[];
}

/** Records which profile granted a flag so the merge can report where profiles differ. */
function grant(
  grantedBy: Map<string, Set<string>>,
  key: string,
  profile: string,
): void {
  grantedBy.set(key, (grantedBy.get(key) ?? new Set<string>()).add(profile));
}

function widenedFrom(
  grantedBy: Map<string, Set<string>>,
  profiles: readonly ClassifiedProfile[],
): string[] {
  if (profiles.length < 2) return [];
  return [...grantedBy.entries()]
    .filter(([, g]) => g.size < profiles.length)
    .map(([k, g]) => `${k}: ${[...g].sort().join(", ")} only`)
    .sort();
}

const OBJECT_FLAGS = [
  "create",
  "read",
  "edit",
  "delete",
  "viewAll",
  "modifyAll",
] as const;

function mergeObjectPermissions(
  profiles: readonly ClassifiedProfile[],
): Merged<ObjectPermission> {
  const merged = new Map<string, ObjectPermission>();
  const grantedBy = new Map<string, Set<string>>();
  for (const cp of profiles) {
    for (const p of cp.profile.objectPermissions) {
      const cur = merged.get(p.object) ?? {
        object: p.object,
        create: false,
        read: false,
        edit: false,
        delete: false,
        viewAll: false,
        modifyAll: false,
      };
      for (const flag of OBJECT_FLAGS) {
        if (!p[flag]) continue;
        cur[flag] = true;
        grant(grantedBy, `${p.object}.${flag}`, cp.profile.name);
      }
      merged.set(p.object, cur);
    }
  }
  return {
    merged: [...merged.values()].sort(byName((p) => p.object)),
    widened: widenedFrom(grantedBy, profiles),
  };
}

const FIELD_FLAGS = ["readable", "editable"] as const;

function mergeFieldPermissions(
  profiles: readonly ClassifiedProfile[],
): Merged<FieldPermission> {
  const merged = new Map<string, FieldPermission>();
  const grantedBy = new Map<string, Set<string>>();
  for (const cp of profiles) {
    for (const p of cp.profile.fieldPermissions) {
      const key = `${p.object}.${p.field}`;
      const cur = merged.get(key) ?? {
        object: p.object,
        field: p.field,
        readable: false,
        editable: false,
      };
      for (const flag of FIELD_FLAGS) {
        if (!p[flag]) continue;
        cur[flag] = true;
        grant(grantedBy, `${key}.${flag}`, cp.profile.name);
      }
      merged.set(key, cur);
    }
  }
  return {
    merged: [...merged.values()].sort(
      (a, b) =>
        a.object.localeCompare(b.object) || a.field.localeCompare(b.field),
    ),
    widened: widenedFrom(grantedBy, profiles),
  };
}

const MAX_LISTED = 40;

/** `a; b; c (+N more)` — keeps notes and unmapped reasons bounded. */
function listSome(items: readonly string[], max = MAX_LISTED): string {
  const shown = items.slice(0, max);
  return `${shown.join("; ")}${items.length > shown.length ? ` (+${items.length - shown.length} more)` : ""}`;
}

function settingValueBody(
  values: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(values).sort()) {
    if (
      /^(Id|Name|SetupOwnerId|SetupOwner|attributes|IsDeleted|SystemModstamp|CreatedDate|CreatedById|LastModifiedDate|LastModifiedById)$/.test(
        k,
      )
    )
      continue;
    const v = values[k];
    if (v === null || v === undefined) continue;
    out[mapFieldName(k)] = v;
  }
  return out;
}

function summarizeMessages(
  messages: readonly Pick<VeevaMessage, "name" | "category" | "language">[],
): string {
  const counts = new Map<string, number>();
  for (const m of messages) {
    const key = `${m.category} / ${m.language}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const lines = [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, n]) => `- ${k}: ${n} message${n === 1 ? "" : "s"}`);
  const names = [...new Set(messages.map((m) => m.name))].sort();
  const shown = names.slice(0, 50);
  lines.push(
    `Names: ${shown.join(", ")}${names.length > shown.length ? ` … (+${names.length - shown.length} more)` : ""}`,
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// builder
// ---------------------------------------------------------------------------

class PlanBuilder {
  readonly steps = new Map<string, PlanStep>();
  readonly unmapped: { source: string; reason: string }[] = [];
  private readonly unmappedKeys = new Set<string>();

  add(step: PlanStep): PlanStep {
    const existing = this.steps.get(step.id);
    if (existing) return existing;
    const clean: PlanStep = {
      ...step,
      dependsOn: [...new Set(step.dependsOn)].filter((d) => d !== step.id),
    };
    if (!clean.review) delete clean.review;
    if (!clean.notes) delete clean.notes;
    this.steps.set(clean.id, clean);
    return clean;
  }

  has(id: string): boolean {
    return this.steps.has(id);
  }

  unmap(source: string, reason: string): void {
    const key = JSON.stringify([source, reason]);
    if (this.unmappedKeys.has(key)) return;
    this.unmappedKeys.add(key);
    this.unmapped.push({ source, reason });
  }
}

interface Context {
  builder: PlanBuilder;
  objects: ObjectConfig[];
  kinds: Map<string, ObjectKind>;
  /** Salesforce object → step id creating it. */
  objectSteps: Map<string, string>;
  /** `Object.Field` → step id creating the field. */
  fieldSteps: Map<string, string>;
  /** Vault picklist name → step id creating it. */
  picklistSteps: Map<string, string>;
  /** `Object.RecordType` → step id creating the object type. */
  objectTypeSteps: Map<string, string>;
  /** Layout full name → step id (or null when the layout is managed / not emitted). */
  layoutSteps: Map<string, string | null>;
  keepEmptyProfiles: boolean;
}

function noteText(notes: readonly string[]): string | undefined {
  return notes.length ? notes.join("\n") : undefined;
}

// --- 1–5: data model --------------------------------------------------------

function planDataModel(ctx: Context): void {
  const { builder, objects, kinds } = ctx;

  // picklists for customer picklist fields (any object we keep)
  for (const o of objects) {
    if (kinds.get(o.apiName) === "unmapped") continue;
    for (const f of [...o.fields].sort(byName((f) => f.apiName))) {
      if (
        !isCustomerField(f) ||
        !/^(picklist|multipicklist|multiselectpicklist)$/i.test(f.type)
      )
        continue;
      const name = mapPicklistName(o.apiName, f.apiName);
      const id = `picklist:${name}`;
      if (!builder.has(id)) {
        const stmt = mdlPicklist(
          name,
          f.label || f.apiName,
          f.picklistValues ?? [],
        );
        builder.add({
          id,
          kind: "mdl",
          title: `Create picklist ${name} (${(f.picklistValues ?? []).length} values)`,
          country: GLOBAL_COUNTRY,
          category: "all",
          source: `${o.apiName}.${f.apiName}`,
          target: `Picklist.${name}`,
          mdl: stmt.mdl,
          dependsOn: [],
          review: stmt.review,
          notes: noteText(stmt.notes),
        });
      }
      ctx.picklistSteps.set(name, id);
    }
  }

  // customer objects
  const customObjects = objects.filter(
    (o) => kinds.get(o.apiName) === "custom",
  );
  const customNames = new Set(customObjects.map((o) => o.apiName));
  const deferredFields: { object: ObjectConfig; field: FieldConfig }[] = [];
  for (const o of customObjects) {
    const excluded = o.fields
      .filter(
        (f) =>
          isCustomerField(f) &&
          /^(reference|lookup|masterdetail)$/i.test(f.type) &&
          (f.referenceTo ?? []).some((t) => customNames.has(t)),
      )
      .map((f) => f.apiName);
    const stmt = mdlObject(o, { excludeFields: excluded });
    const id = `obj:${stmt.name}`;
    ctx.objectSteps.set(o.apiName, id);
    builder.add({
      id,
      kind: "mdl",
      title: `Create object ${stmt.name} (${o.label})`,
      country: GLOBAL_COUNTRY,
      category: "all",
      source: o.apiName,
      target: `Object.${stmt.name}`,
      mdl: stmt.mdl,
      dependsOn: stmt.picklists
        .map((p) => ctx.picklistSteps.get(p))
        .filter((s): s is string => !!s),
      review: stmt.review,
      notes: noteText(stmt.notes),
    });
    for (const u of stmt.unmapped)
      builder.unmap(`${o.apiName}.${u.field}`, u.reason);
    for (const f of o.fields)
      if (excluded.includes(f.apiName))
        deferredFields.push({ object: o, field: f });
    for (const f of o.fields)
      if (isCustomerField(f) && !excluded.includes(f.apiName))
        ctx.fieldSteps.set(`${o.apiName}.${f.apiName}`, id);
  }

  // customer fields on Veeva objects + deferred lookups between customer objects
  const fieldWork: { object: ObjectConfig; field: FieldConfig }[] = [
    ...deferredFields,
  ];
  for (const o of objects) {
    const kind = kinds.get(o.apiName);
    if (kind === "veeva")
      for (const f of o.fields)
        if (isCustomerField(f)) fieldWork.push({ object: o, field: f });
    if (kind === "unmapped") {
      const customFields = o.fields.filter(isCustomerField);
      builder.unmap(
        o.apiName,
        `standard object has no Vault CRM equivalent${
          customFields.length
            ? ` (${customFields.length} custom field${customFields.length === 1 ? "" : "s"} dropped: ${customFields
                .map((f) => f.apiName)
                .sort()
                .join(", ")})`
            : ""
        }`,
      );
    }
  }
  fieldWork.sort(
    (a, b) =>
      a.object.apiName.localeCompare(b.object.apiName) ||
      a.field.apiName.localeCompare(b.field.apiName),
  );
  for (const { object: o, field: f } of fieldWork) {
    const stmt = mdlAddField(o.apiName, f);
    const source = `${o.apiName}.${f.apiName}`;
    if (!stmt) {
      builder.unmap(
        source,
        `field type ${f.type}${f.formula ? ` with formula \`${f.formula}\`` : ""} cannot be expressed in Vault`,
      );
      continue;
    }
    const vaultObject = mapObjectName(o.apiName);
    const id = `field:${vaultObject}.${stmt.name}`;
    const dependsOn: string[] = [];
    const objStep = ctx.objectSteps.get(o.apiName);
    if (objStep) dependsOn.push(objStep);
    if (stmt.picklist && ctx.picklistSteps.has(stmt.picklist))
      dependsOn.push(ctx.picklistSteps.get(stmt.picklist)!);
    for (const t of f.referenceTo ?? []) {
      const s = ctx.objectSteps.get(t);
      if (s) dependsOn.push(s);
    }
    ctx.fieldSteps.set(source, id);
    builder.add({
      id,
      kind: "mdl",
      title: `Add field ${stmt.name} to ${vaultObject}`,
      country: GLOBAL_COUNTRY,
      category: "all",
      source,
      target: `Object.${vaultObject}.${stmt.name}`,
      mdl: stmt.mdl,
      dependsOn,
      review: stmt.review,
      notes: noteText(stmt.notes),
    });
  }

  // customer-added values on Veeva picklists
  for (const o of objects) {
    if (kinds.get(o.apiName) !== "veeva") continue;
    for (const f of [...o.fields].sort(byName((f) => f.apiName))) {
      if (!f.managed || !f.picklistValues?.length) continue;
      const added = f.picklistValues.filter(
        (v) => v.active && !splitSuffix(v.value).managed && v.value.trim(),
      );
      if (!added.length) continue;
      const name = mapPicklistName(o.apiName, f.apiName);
      const body: Record<string, unknown> = {};
      added.forEach((v, i) => (body[`value_${i + 1}`] = v.label || v.value));
      builder.add({
        id: `picklist-values:${name}`,
        kind: "api",
        title: `Add ${added.length} customer value${added.length === 1 ? "" : "s"} to picklist ${name}`,
        country: GLOBAL_COUNTRY,
        category: "all",
        source: `${o.apiName}.${f.apiName}`,
        target: `Picklist.${name}`,
        api: {
          method: "POST",
          path: `/objects/picklists/${name}`,
          body,
          contentType: "application/x-www-form-urlencoded",
        },
        dependsOn: [],
        review: true,
        notes: `Vault picklist name assumed from the field name; values: ${added.map((v) => v.value).join(", ")}`,
      });
    }
  }

  // record types → object types
  for (const o of objects) {
    const kind = kinds.get(o.apiName);
    if (kind === "unmapped") continue;
    for (const rt of [...o.recordTypes].sort(byName((r) => r.developerName))) {
      if (!rt.active) continue;
      if (splitSuffix(rt.developerName).managed) continue; // exists as <x>__v
      const stmt = mdlObjectType(o.apiName, rt);
      const vaultObject = mapObjectName(o.apiName);
      const id = `objecttype:${vaultObject}.${stmt.name}`;
      ctx.objectTypeSteps.set(`${o.apiName}.${rt.developerName}`, id);
      const objStep = ctx.objectSteps.get(o.apiName);
      builder.add({
        id,
        kind: "mdl",
        title: `Add object type ${stmt.name} to ${vaultObject} (record type ${rt.name})`,
        country: GLOBAL_COUNTRY,
        category: "all",
        source: `${o.apiName}.${rt.developerName}`,
        target: `Objecttype.${vaultObject}.${stmt.name}`,
        mdl: stmt.mdl,
        dependsOn: objStep ? [objStep] : [],
        review: true,
        notes: noteText([
          ...stmt.notes,
          ...(rt.picklistValues
            ? [
                `record-type picklist subsets to recreate as picklist dependencies: ${Object.keys(rt.picklistValues).sort().join(", ")}`,
              ]
            : []),
        ]),
      });
    }
  }
}

// --- 6: personas ------------------------------------------------------------

function planLayout(
  ctx: Context,
  layout: LayoutConfig,
  country: CountryCode,
  category: RepCategory,
): string | null {
  const cached = ctx.layoutSteps.get(layout.fullName);
  if (cached !== undefined) return cached;
  if (layout.managed) {
    ctx.layoutSteps.set(layout.fullName, null);
    return null;
  }
  const names = mapLayoutName(layout.fullName);
  const id = `layout:${names.object}.${names.name}`;
  const dependsOn: string[] = [];
  const objStep = ctx.objectSteps.get(layout.object);
  if (objStep) dependsOn.push(objStep);
  for (const s of layout.sections)
    for (const f of s.fields) {
      const fs = ctx.fieldSteps.get(`${layout.object}.${f}`);
      if (fs) dependsOn.push(fs);
    }
  if (layout.sections.length) {
    const stmt = mdlPageLayout(layout, names);
    ctx.builder.add({
      id,
      kind: "mdl",
      title: `Create page layout ${names.name} on ${names.object}`,
      country,
      category,
      source: layout.fullName,
      target: `Pagelayout.${names.object}.${names.name}`,
      mdl: stmt.mdl,
      dependsOn,
      review: true,
      notes: noteText(stmt.notes),
    });
  } else {
    const lines = [
      `Create page layout "${names.label}" on ${names.object} (${names.name}).`,
      "The Salesforce layout body was not extracted; rebuild it from the Salesforce page-layout editor.",
    ];
    if (layout.relatedLists.length)
      lines.push(
        `Related lists: ${layout.relatedLists.map(mapObjectName).join(", ")}`,
      );
    if (layout.buttons?.length)
      lines.push(`Buttons: ${layout.buttons.join(", ")}`);
    ctx.builder.add({
      id,
      kind: "manual",
      title: `Recreate page layout ${names.name} on ${names.object} by hand`,
      country,
      category,
      source: layout.fullName,
      target: `Pagelayout.${names.object}.${names.name}`,
      manual: lines.join("\n"),
      dependsOn,
    });
  }
  ctx.layoutSteps.set(layout.fullName, id);
  return id;
}

function planPersona(ctx: Context, rep: CountryRepConfig): void {
  const { builder } = ctx;
  const { country, category } = rep;
  const profiles = [...rep.profiles].sort(byName((p) => p.profile.name));
  const live = profiles.filter((p) => totalUsers(p) > 0);
  const inScope = ctx.keepEmptyProfiles ? profiles : live;
  for (const p of profiles)
    if (!inScope.includes(p))
      builder.unmap(
        `Profile ${p.profile.name}`,
        `dropped from the plan: 0 active users (country ${country}, ${category})`,
      );
  if (!inScope.length) return;
  const names = mapPersonaName(country, category);
  const key = `${country}.${category}`;
  const profileNames = inScope.map((p) => p.profile.name).join(", ");
  const known = (object: string): boolean => {
    const k = ctx.kinds.get(object);
    return k === "veeva" || k === "custom";
  };

  // permission set — OR-merge of the group's profiles, differences reported
  const { merged: objectPerms, widened: widenedObjects } =
    mergeObjectPermissions(inScope);
  const { merged: fieldPerms, widened: widenedFields } =
    mergeFieldPermissions(inScope);
  const tabMap = new Map<string, boolean>();
  const tabVisibleBy = new Map<string, Set<string>>();
  for (const p of inScope)
    for (const t of p.profile.tabVisibilities) {
      const object = t.tab.replace(/^standard-/, "");
      if (!known(object)) continue;
      const tab = mapTabName(t.tab);
      const visible = t.visibility !== "Hidden";
      tabMap.set(tab, (tabMap.get(tab) ?? false) || visible);
      if (visible) grant(tabVisibleBy, `tab ${tab}.visible`, p.profile.name);
    }
  const objectOf = (key: string): string => key.split(".")[0] ?? key;
  const widened = [
    ...widenedObjects.filter((w) => known(objectOf(w))),
    ...widenedFields.filter((w) => known(objectOf(w))),
    ...widenedFrom(tabVisibleBy, inScope),
  ];

  // objects the profiles have permissions on but the snapshot does not carry
  const referenced = new Set<string>();
  for (const p of inScope) {
    for (const o of p.profile.objectPermissions) referenced.add(o.object);
    for (const f of p.profile.fieldPermissions) referenced.add(f.object);
    for (const a of p.profile.layoutAssignments) referenced.add(a.object);
  }
  const notExtracted = [...referenced]
    .filter((o) => !ctx.kinds.has(o) && !UNMAPPED_STANDARD_OBJECTS.has(o))
    .sort();
  const psDeps = new Set<string>();
  for (const p of objectPerms) {
    const s = ctx.objectSteps.get(p.object);
    if (s) psDeps.add(s);
  }
  for (const p of fieldPerms) {
    const s = ctx.fieldSteps.get(`${p.object}.${p.field}`);
    if (s) psDeps.add(s);
  }
  const psStmt = mdlPermissionSet({
    name: names.permissionSet,
    label: `${names.label} permissions`,
    objectPermissions: objectPerms,
    fieldPermissions: fieldPerms,
    tabs: [...tabMap.entries()].map(([tab, visible]) => ({ tab, visible })),
    objectFilter: known,
  });
  const psId = `ps:${key}`;
  const extraNotes: string[] = [];
  const viewAll = objectPerms.filter(
    (p) => known(p.object) && (p.viewAll || p.modifyAll),
  );
  if (viewAll.length)
    extraNotes.push(
      `view-all / modify-all on ${viewAll.map((p) => mapObjectName(p.object)).join(", ")}: grant through Vault sharing settings`,
    );
  const userPerms = [
    ...new Set(inScope.flatMap((p) => p.profile.userPermissions ?? [])),
  ].sort();
  if (userPerms.length)
    extraNotes.push(
      `Salesforce user permissions to review: ${userPerms.join(", ")}`,
    );
  const personaSource = `Profile ${profileNames} (${country} ${category})`;
  if (widened.length) {
    const summary = `merged ${inScope.length} profiles into ${names.permissionSet}; where they differ the most permissive setting was taken (${widened.length} difference${widened.length === 1 ? "" : "s"}): ${listSome(widened)}`;
    extraNotes.push(summary);
    builder.unmap(
      personaSource,
      `${summary} — decide per item whether the group really shares it or needs its own persona`,
    );
  }
  if (notExtracted.length) {
    const summary = `permissions on ${notExtracted.length} object${notExtracted.length === 1 ? "" : "s"} outside the extracted object set were dropped from ${names.permissionSet}: ${listSome(notExtracted)}`;
    extraNotes.push(summary);
    builder.unmap(
      personaSource,
      `${summary} — re-run extract with --include-managed (Veeva objects) or --objects to carry them`,
    );
  }
  builder.add({
    id: psId,
    kind: "mdl",
    title: `Create permission set ${names.permissionSet} (${country} ${category}: ${profileNames})`,
    country,
    category,
    source: `Profile ${profileNames}`,
    target: `Permissionset.${names.permissionSet}`,
    mdl: psStmt.mdl,
    dependsOn: [...psDeps].sort(),
    review: true,
    notes: noteText([...psStmt.notes, ...extraNotes]),
  });

  // security profile
  const spStmt = mdlSecurityProfile(names.securityProfile, names.label, [
    names.permissionSet,
  ]);
  const spId = `sp:${key}`;
  builder.add({
    id: spId,
    kind: "mdl",
    title: `Create security profile ${names.securityProfile} (${country} ${category})`,
    country,
    category,
    source: `Profile ${profileNames}`,
    target: `Securityprofile.${names.securityProfile}`,
    mdl: spStmt.mdl,
    dependsOn: [psId],
    review: true,
    notes: noteText(spStmt.notes),
  });

  // application profile (Veeva Settings / VMOC scope)
  const appId = `app:${key}`;
  builder.add({
    id: appId,
    kind: "api",
    title: `Create application profile "${names.label}"`,
    country,
    category,
    source: `Profile ${profileNames}`,
    target: `${VAULT_CRM_CONFIG_OBJECTS.applicationProfile}.${names.applicationProfile}`,
    api: {
      method: "POST",
      path: `/vobjects/${VAULT_CRM_CONFIG_OBJECTS.applicationProfile}`,
      body: { name__v: names.label },
      contentType: "application/json",
    },
    dependsOn: [],
    review: true,
    captures: { recordId: "id" },
    notes:
      "Vault CRM application profiles group users sharing Veeva Settings + VMOCs; the record shape (name__v) is assumed",
  });

  // page layouts + assignments
  const layoutIds: string[] = [];
  for (const layout of [...rep.layouts].sort(byName((l) => l.fullName))) {
    const id = planLayout(ctx, layout, country, category);
    if (id) layoutIds.push(id);
  }
  const assignments = new Map<string, string>();
  const assignedBy = new Map<string, Map<string, string[]>>();
  for (const p of inScope)
    for (const a of p.profile.layoutAssignments) {
      if (!known(a.object)) continue;
      const key = `${a.object}|${a.recordType ?? ""}`;
      assignments.set(key, a.layout);
      const byLayout = assignedBy.get(key) ?? new Map<string, string[]>();
      byLayout.set(a.layout, [
        ...(byLayout.get(a.layout) ?? []),
        p.profile.name,
      ]);
      assignedBy.set(key, byLayout);
    }
  const layoutConflicts = [...assignedBy.entries()]
    .filter(([, byLayout]) => byLayout.size > 1)
    .map(([key, byLayout]) => {
      const [object = "", rt = ""] = key.split("|");
      const options = [...byLayout.entries()]
        .map(([layout, who]) => `${layout} (${who.sort().join(", ")})`)
        .join(" vs ");
      return `${object}/${rt || "master"}: ${options}; ${assignments.get(key)} used`;
    })
    .sort();
  if (assignments.size) {
    const lines = [...assignments.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, layout]) => {
        const [object = "", rt = ""] = k.split("|");
        const l = mapLayoutName(layout);
        const type = rt ? mapRecordTypeName(rt) : "base__v";
        return `- ${l.object} (${object}) / object type ${type} → layout ${l.name}`;
      });
    builder.add({
      id: `layout-assign:${key}`,
      kind: "manual",
      title: `Assign page layouts per object type in permission set ${names.permissionSet}`,
      country,
      category,
      source: `Profile ${profileNames} layout assignments`,
      target: `Permissionset.${names.permissionSet}`,
      manual: [
        `In Admin > Users & Groups > Permission Sets > ${names.permissionSet}, set the page layout per object type:`,
        ...lines,
      ].join("\n"),
      dependsOn: [psId, ...layoutIds].sort(),
      notes: layoutConflicts.length
        ? `the group's profiles assign different layouts (last profile wins): ${listSome(layoutConflicts)}`
        : undefined,
    });
    if (layoutConflicts.length)
      builder.unmap(
        personaSource,
        `profiles in the group assign different page layouts (${layoutConflicts.length}): ${listSome(layoutConflicts)} — pick one per object type or split the persona`,
      );
  }

  // VMOCs
  const vmocIds = new Map<string, number>();
  for (const v of [...rep.vmocs].sort(
    (a, b) =>
      a.objectApiName.localeCompare(b.objectApiName) ||
      a.device.localeCompare(b.device) ||
      a.name.localeCompare(b.name),
  )) {
    planVmoc(ctx, v, country, category, appId, vmocIds);
  }

  // Veeva Settings profile overrides
  const settingIds = new Map<string, number>();
  for (const s of [...rep.settings].sort(
    (a, b) =>
      a.settingObject.localeCompare(b.settingObject) ||
      (a.ownerName ?? "").localeCompare(b.ownerName ?? ""),
  )) {
    if (s.level !== "profile") continue;
    planSetting(ctx, s, country, category, appId, settingIds);
  }
}

function planVmoc(
  ctx: Context,
  v: VmocConfig,
  country: CountryCode,
  category: RepCategory | "all",
  appId: string | null,
  counters: Map<string, number>,
): void {
  const vaultObject = mapObjectName(v.objectApiName);
  const base = `vmoc:${country}.${category}.${vaultObject}.${idSlug(v.device) || "device"}`;
  const n = (counters.get(base) ?? 0) + 1;
  counters.set(base, n);
  const id = n === 1 ? base : `${base}.${n}`;
  const body: Record<string, unknown> = {
    name__v: v.name,
    object_name__v: vaultObject,
    device__v: v.device,
    active__v: v.active,
  };
  const notes: string[] = [
    "Vault CRM VMOC record fields are assumed from the suffix rule; sync configuration may differ — review before applying",
  ];
  if (v.whereClause) {
    const conv = convertWhereClause(v.whereClause);
    body.where_clause__v = conv.text;
    if (conv.unresolvedTokens.length)
      notes.push(
        `where clause keeps Veeva CRM tokens ${conv.unresolvedTokens.join(", ")}: map to Vault CRM equivalents`,
      );
  }
  if (v.enhancedSync !== undefined)
    body.enable_enhanced_sync__v = v.enhancedSync;
  if (v.metaDataOnly !== undefined) body.meta_data_only__v = v.metaDataOnly;
  for (const [k, val] of Object.entries(v.extra).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (val === null || val === undefined || /^(Id|Name|attributes)$/.test(k))
      continue;
    const mapped = mapFieldName(k);
    if (!(mapped in body)) body[mapped] = val;
  }
  if (appId) body.application_profile__v = recordIdPlaceholder(appId);
  const objStep = ctx.objectSteps.get(v.objectApiName);
  ctx.builder.add({
    id,
    kind: "api",
    title: `Create VMOC ${v.name} (${vaultObject} / ${v.device})`,
    country,
    category,
    source: `VMOC ${v.name}`,
    target: `${VAULT_CRM_CONFIG_OBJECTS.vmoc}.${v.name}`,
    api: {
      method: "POST",
      path: `/vobjects/${VAULT_CRM_CONFIG_OBJECTS.vmoc}`,
      body,
      contentType: "application/json",
    },
    dependsOn: [...(appId ? [appId] : []), ...(objStep ? [objStep] : [])],
    review: true,
    notes: notes.join("\n"),
  });
}

function planSetting(
  ctx: Context,
  s: VeevaSettingRecord,
  country: CountryCode,
  category: RepCategory,
  appId: string,
  counters: Map<string, number>,
): void {
  const vaultObject = mapObjectName(s.settingObject);
  const base = `setting:${country}.${category}.${vaultObject}`;
  const n = (counters.get(base) ?? 0) + 1;
  counters.set(base, n);
  const id = n === 1 ? base : `${base}.${n}`;
  const values = settingValueBody(s.values);
  ctx.builder.add({
    id,
    kind: "api",
    title: `Create ${vaultObject} override for ${country} ${category} (${Object.keys(values).length} fields)`,
    country,
    category,
    source: `${s.settingObject} (profile ${s.ownerName ?? "?"})`,
    target: `${vaultObject} record`,
    api: {
      method: "POST",
      path: `/vobjects/${vaultObject}`,
      body: {
        name__v: `${s.ownerName ?? country} ${category}`,
        application_profile__v: recordIdPlaceholder(appId),
        ...values,
      },
      contentType: "application/json",
    },
    dependsOn: [appId],
    review: true,
    notes: `settings field names follow the suffix rule (X_vod__c → x__v); fields missing in Vault CRM must be dropped by hand${n > 1 ? "; several profiles in this group carry their own override" : ""}`,
  });
}

// --- 7–8: messages, org settings, profile-less VMOCs --------------------------

/** `MessageName;;Category` pointer values in Veeva Settings (format inferred, research doc 02 §2.1). */
const MESSAGE_POINTER = /^\s*([^;]+);;([^;]+?)\s*$/;

function messageKey(name: string, category: string): string {
  return `${name.trim().toLowerCase()}|${category.trim().toLowerCase()}`;
}

/** Messages referenced from any Veeva Setting value, as `name|category` keys. */
export function settingsMessagePointers(
  settings: readonly VeevaSettingRecord[],
): Set<string> {
  const out = new Set<string>();
  for (const s of settings)
    for (const v of Object.values(s.values)) {
      if (typeof v !== "string") continue;
      const m = MESSAGE_POINTER.exec(v);
      if (m) out.add(messageKey(m[1]!, m[2]!));
    }
  return out;
}

/**
 * Why a message counts as a customer message (in priority order), or `null`
 * for a Veeva-shipped one: referenced from a Veeva Setting pointer; last
 * modified by someone not matching `/veeva/i` (needs `lastModifiedBy` in the
 * snapshot); scoped to a country.
 */
export function customerMessageReason(
  m: VeevaMessage,
  pointers: ReadonlySet<string>,
): TranslationRow["reason"] | null {
  if (pointers.has(messageKey(m.name, m.category))) return "referenced";
  if (m.lastModifiedBy && !/veeva/i.test(m.lastModifiedBy))
    return "customer_modified";
  if (m.country !== null) return "country_scoped";
  return null;
}

export interface CustomerMessages {
  rows: TranslationRow[];
  /** Active messages assumed Veeva-shipped and not carried. */
  skipped: number;
  /** `lastModifiedBy` was present on at least one message. */
  lastModifiedByAvailable: boolean;
}

/** Active messages worth loading into the Message Catalog, sorted by language / category / name. */
export function selectCustomerMessages(
  messages: readonly VeevaMessage[],
  settings: readonly VeevaSettingRecord[],
): CustomerMessages {
  const pointers = settingsMessagePointers(settings);
  const rows: TranslationRow[] = [];
  let skipped = 0;
  for (const m of messages) {
    if (!m.active) continue;
    const reason = customerMessageReason(m, pointers);
    if (!reason) {
      skipped++;
      continue;
    }
    rows.push({
      language: m.language,
      name: m.name,
      category: m.category,
      text: m.text,
      country: m.country,
      reason,
    });
  }
  rows.sort(
    (a, b) =>
      a.language.localeCompare(b.language) ||
      a.category.localeCompare(b.category) ||
      a.name.localeCompare(b.name) ||
      (a.country ?? "").localeCompare(b.country ?? ""),
  );
  return {
    rows,
    skipped,
    lastModifiedByAvailable: messages.some(
      (m) => m.lastModifiedBy !== undefined && m.lastModifiedBy !== null,
    ),
  };
}

function planGlobal(
  ctx: Context,
  classified: ClassifiedSnapshot,
): TranslationRow[] {
  const { builder } = ctx;
  const snapshot = classified.snapshot;
  const plannedCountries = new Set<CountryCode>([
    GLOBAL_COUNTRY,
    ...classified.countries.map((c) => c.country.code),
  ]);

  // customer messages per country → Bulk Translations CSVs + one manual import step
  const selected = selectCustomerMessages(
    snapshot.messages.filter((m) =>
      plannedCountries.has(m.country ?? GLOBAL_COUNTRY),
    ),
    snapshot.veevaSettings,
  );
  const byCountry = new Map<CountryCode, TranslationRow[]>();
  for (const r of selected.rows) {
    const c = r.country ?? GLOBAL_COUNTRY;
    byCountry.set(c, [...(byCountry.get(c) ?? []), r]);
  }
  const heuristicNote = selected.lastModifiedByAvailable
    ? undefined
    : `LastModifiedBy was not extracted: Veeva-shipped and customer-modified messages cannot be told apart, so only settings-referenced and country-scoped messages are listed; ${selected.skipped} other active message${selected.skipped === 1 ? " was" : "s were"} assumed Veeva-shipped`;
  for (const [country, rows] of [...byCountry.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const languages = [...new Set(rows.map((r) => r.language))].sort();
    const reasons = new Map<TranslationRow["reason"], number>();
    for (const r of rows)
      reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1);
    builder.add({
      id: `messages:${country}`,
      kind: "manual",
      title: `Import ${rows.length} customer Veeva Message${rows.length === 1 ? "" : "s"} for ${country} (Message Catalog)`,
      country,
      category: "all",
      source: `Message_vod__c (${country})`,
      target: `Message Catalog / ${VAULT_CRM_CONFIG_OBJECTS.message}`,
      manual: [
        `Import through Admin > Settings > Message Catalog > Bulk Translations, one file per language: ${languages.map((l) => `translations/${l}.csv`).join(", ")} (rows with country = ${country}). The files are a plain export (message_name, category, language, country, text, reason); map the columns onto the Bulk Translations template exported from the target vault before importing.`,
        'The daily "Vault Message to Veeva Message Copy" job populates message__v for the mobile app; keep a Full-Sync VMOC for message__v active per platform.',
        `Why these rows: ${[...reasons.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([r, n]) => `${n} ${r.replace(/_/g, " ")}`)
          .join(", ")}.`,
        summarizeMessages(rows),
      ].join("\n"),
      dependsOn: [],
      notes: heuristicNote,
    });
  }
  if (selected.skipped)
    builder.unmap(
      `Message_vod__c (${selected.skipped} active message${selected.skipped === 1 ? "" : "s"})`,
      `assumed Veeva-shipped and not carried (Vault CRM ships its own Veeva Messages): ${
        selected.lastModifiedByAvailable
          ? "last modified by a Veeva user and not referenced from a Veeva Setting"
          : "LastModifiedBy was not extracted, so only settings-referenced and country-scoped messages were kept — extract it to detect customer overrides"
      }`,
    );

  // org-level settings → manual (the vault-level record exists; we cannot know its id offline)
  const orgSettings = snapshot.veevaSettings
    .filter((s) => s.level === "org")
    .sort(byName((s) => s.settingObject));
  for (const s of orgSettings) {
    const vaultObject = mapObjectName(s.settingObject);
    const values = settingValueBody(s.values);
    if (!Object.keys(values).length) continue;
    builder.add({
      id: `settings-org:${vaultObject}`,
      kind: "manual",
      title: `Set vault-level ${vaultObject} defaults (${Object.keys(values).length} fields)`,
      country: GLOBAL_COUNTRY,
      category: "all",
      source: `${s.settingObject} (org default)`,
      target: `${vaultObject} vault-level record`,
      manual: [
        `Update the vault-level ${vaultObject} record (no application/security profile) in Business Admin:`,
        ...Object.entries(values).map(
          ([k, v]) => `- ${k} = ${JSON.stringify(v)}`,
        ),
      ].join("\n"),
      dependsOn: [],
    });
  }
  for (const s of snapshot.veevaSettings.filter((s) => s.level === "user"))
    builder.unmap(
      `${s.settingObject} (user ${s.ownerName ?? "?"})`,
      "user-level Veeva Settings are not supported in Vault CRM; move the override to an application profile or drop it",
    );

  // VMOCs without a profile
  const counters = new Map<string, number>();
  for (const v of snapshot.vmocs
    .filter((v) => v.profile === null)
    .sort(
      (a, b) =>
        a.objectApiName.localeCompare(b.objectApiName) ||
        a.device.localeCompare(b.device) ||
        a.name.localeCompare(b.name),
    )) {
    if (ctx.kinds.get(v.objectApiName) === "unmapped") {
      builder.unmap(
        `VMOC ${v.name}`,
        `object ${v.objectApiName} has no Vault CRM equivalent`,
      );
      continue;
    }
    planVmoc(ctx, v, GLOBAL_COUNTRY, "all", null, counters);
  }
  return selected.rows;
}

function planUnmapped(ctx: Context, classified: ClassifiedSnapshot): void {
  const { builder } = ctx;
  const snapshot = classified.snapshot;
  for (const a of [...(snapshot.automation ?? [])].sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name),
  )) {
    if (a.managed) continue;
    const label = {
      apex_trigger: "Apex trigger",
      flow: "Flow",
      workflow_rule: "Workflow rule",
    }[a.kind];
    builder.unmap(
      `${label} ${a.name}${a.object ? ` (${a.object})` : ""}`,
      `${a.active ? "active" : "inactive"} ${label.toLowerCase()} has no Vault CRM equivalent; re-express as Vault configuration (lifecycle, workflow, layout rule, job)${a.countryLogic ? " — contains country logic" : ""}`,
    );
  }
  for (const o of [...snapshot.objects].sort(byName((o) => o.apiName))) {
    for (const r of [...o.validationRules].sort(byName((r) => r.name))) {
      if (/vod/i.test(r.name)) continue; // Veeva-shipped rule
      builder.unmap(
        `Validation rule ${o.apiName}.${r.name}`,
        `${r.active ? "active" : "inactive"} validation rule${r.errorConditionFormula ? ` \`${r.errorConditionFormula}\`` : ""}${r.errorMessage ? ` ("${r.errorMessage}")` : ""}: recreate as a Vault layout rule / entry criteria by hand`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

export function buildVaultPlan(
  classified: ClassifiedSnapshot,
  options: VaultPlanOptions = {},
): VaultPlan {
  const now = options.now ?? (() => new Date());
  const objects = [...classified.snapshot.objects].sort(
    byName((o) => o.apiName),
  );
  const ctx: Context = {
    builder: new PlanBuilder(),
    objects,
    kinds: new Map(objects.map((o) => [o.apiName, objectKind(o)])),
    objectSteps: new Map(),
    fieldSteps: new Map(),
    picklistSteps: new Map(),
    objectTypeSteps: new Map(),
    layoutSteps: new Map(),
    keepEmptyProfiles: options.keepEmptyProfiles ?? false,
  };

  planDataModel(ctx);
  for (const c of [...classified.countries].sort((a, b) =>
    a.country.code.localeCompare(b.country.code),
  ))
    for (const rep of [...c.repConfigs].sort(byName((r) => r.category)))
      planPersona(ctx, rep);
  for (const rep of [...classified.global].sort(byName((r) => r.category)))
    planPersona(ctx, rep);
  const translations = planGlobal(ctx, classified);
  planUnmapped(ctx, classified);

  const steps = orderSteps([...ctx.builder.steps.values()]);
  const plan: VaultPlan = {
    schemaVersion: 1,
    createdAt: now().toISOString(),
    apiVersion: normalizeVaultApiVersion(options.apiVersion),
    steps,
    unmapped: [...ctx.builder.unmapped].sort(
      (a, b) =>
        a.source.localeCompare(b.source) || a.reason.localeCompare(b.reason),
    ),
    translations,
  };
  if (options.vaultDns) plan.vaultDns = options.vaultDns;
  return plan;
}

/** `country/category` key used to group steps into files and report sections. */
export function stepGroup(
  step: Pick<PlanStep, "country" | "category">,
): string {
  return `${step.country}/${step.category}`;
}
