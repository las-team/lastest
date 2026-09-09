/**
 * Vault metadata, picklists, object types, lifecycles, limits (§2.5.6).
 *
 * Field `type` casing for `LongText`, `RichText`, `Currency`, `Formula`,
 * `Lookup` is `[UNVERIFIED]` — normalised case-insensitively to the
 * canonical `VaultFieldType` spelling. The field-metadata `picklist`
 * property may carry a `Picklist.` prefix `[UNVERIFIED]` — stripped.
 * Configuration endpoint payload shapes (`/configuration/Objecttype.*`,
 * `/configuration/Objectlifecycle.*`) are parsed defensively.
 */
import {
  normaliseVaultType,
  type VaultFieldMetadata,
  type VaultLifecycle,
  type VaultObjectMetadata,
  type VaultObjectTypeConfig,
  type VaultObjectTypeRef,
  type VaultPicklistValue,
} from "../types";
import { toVaultError, VaultRequestError } from "./errors";
import type { VaultHttp } from "./http";

const CANONICAL_TYPE: Record<string, string> = {
  id: "ID",
  string: "String",
  number: "Number",
  boolean: "Boolean",
  date: "Date",
  datetime: "DateTime",
  picklist: "Picklist",
  object: "Object",
  longtext: "LongText",
  richtext: "RichText",
  currency: "Currency",
  formula: "Formula",
  lookup: "Lookup",
};

/** Canonical casing for a Vault field type (unknown types pass through). */
export function canonicalVaultType(type: unknown): string {
  const raw = String(type ?? "");
  const n = normaliseVaultType(raw);
  return n === "unknown" ? raw : CANONICAL_TYPE[n];
}

/** Strip an optional `Picklist.` prefix `[UNVERIFIED]`. */
export function stripPicklistPrefix(name: unknown): string | undefined {
  if (typeof name !== "string" || !name) return undefined;
  return name.replace(/^picklist\./i, "");
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === "string" && v) return [v];
  return [];
}

function asBool(v: unknown, dflt = false): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.toLowerCase() === "true";
  return dflt;
}

function asNumber(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Normalise one raw field record (§2.5.6 keys). */
export function normaliseFieldMetadata(raw: unknown): VaultFieldMetadata {
  const f = (raw ?? {}) as Record<string, unknown>;
  const out: VaultFieldMetadata = {
    ...(f as Partial<VaultFieldMetadata>),
    name: String(f.name ?? ""),
    type: canonicalVaultType(f.type),
    required: asBool(f.required),
    status: asStringArray(f.status),
  };
  if (f.label !== undefined) out.label = String(f.label);
  if (f.unique !== undefined) out.unique = asBool(f.unique);
  if (f.editable !== undefined) out.editable = asBool(f.editable);
  if (f.multi_value !== undefined) out.multi_value = asBool(f.multi_value);
  if (f.system_managed_name !== undefined)
    out.system_managed_name = asBool(f.system_managed_name);
  const maxLength = asNumber(f.max_length);
  if (maxLength !== undefined) out.max_length = maxLength;
  const maxValue = asNumber(f.max_value);
  if (maxValue !== undefined) out.max_value = maxValue;
  const minValue = asNumber(f.min_value);
  if (minValue !== undefined) out.min_value = minValue;
  const scale = asNumber(f.scale);
  if (scale !== undefined) out.scale = scale;
  const picklist = stripPicklistPrefix(f.picklist);
  if (picklist) out.picklist = picklist;
  else delete (out as { picklist?: string }).picklist;
  if (f.object && typeof f.object === "object") {
    const o = f.object as Record<string, unknown>;
    out.object = { name: String(o.name ?? "") };
    if (o.label !== undefined) out.object.label = String(o.label);
  } else if (typeof f.object === "string" && f.object) {
    out.object = { name: f.object };
  } else delete (out as { object?: unknown }).object;
  return out;
}

function normaliseObjectTypeRef(raw: unknown): VaultObjectTypeRef {
  const t = (raw ?? {}) as Record<string, unknown>;
  const out: VaultObjectTypeRef = { name: String(t.name ?? "") };
  if (t.label !== undefined) out.label = String(t.label);
  if (t.status !== undefined) out.status = asStringArray(t.status);
  if (typeof t.url === "string") out.url = t.url;
  return out;
}

/** Normalise `GET /metadata/vobjects/{object}` → `object{}`. */
export function normaliseObjectMetadata(raw: unknown): VaultObjectMetadata {
  const o = (raw ?? {}) as Record<string, unknown>;
  const fields = Array.isArray(o.fields) ? o.fields : [];
  const out: VaultObjectMetadata = {
    ...(o as Partial<VaultObjectMetadata>),
    name: String(o.name ?? ""),
    status: asStringArray(o.status),
    fields: fields.map(normaliseFieldMetadata),
  };
  if (o.allow_types !== undefined) out.allow_types = asBool(o.allow_types);
  if (o.allow_attachments !== undefined)
    out.allow_attachments = asBool(o.allow_attachments);
  if (o.system_managed !== undefined)
    out.system_managed = asBool(o.system_managed);
  if (o.auditable !== undefined) out.auditable = asBool(o.auditable);
  if (Array.isArray(o.object_types))
    out.object_types = o.object_types.map(normaliseObjectTypeRef);
  if (Array.isArray(o.available_lifecycles))
    out.available_lifecycles = o.available_lifecycles.map((x) =>
      typeof x === "string"
        ? x
        : String((x as Record<string, unknown>)?.name ?? x),
    );
  if (o.urls && typeof o.urls === "object" && !Array.isArray(o.urls)) {
    const urls: Record<string, string> = {};
    for (const [k, v] of Object.entries(o.urls as Record<string, unknown>))
      if (typeof v === "string") urls[k] = v;
    out.urls = urls;
  }
  return out;
}

/** `GET /metadata/vobjects` → `objects[]{name,label,status}`. */
export async function listObjects(
  http: VaultHttp,
): Promise<Array<{ name: string; label?: string; status?: string[] }>> {
  const body = await http.json<Record<string, unknown>>({
    method: "GET",
    path: "/metadata/vobjects",
  });
  const objects = Array.isArray(body.objects) ? body.objects : [];
  return objects.map((raw) => {
    const o = (raw ?? {}) as Record<string, unknown>;
    const out: { name: string; label?: string; status?: string[] } = {
      name: String(o.name ?? ""),
    };
    if (o.label !== undefined) out.label = String(o.label);
    if (o.status !== undefined) out.status = asStringArray(o.status);
    return out;
  });
}

/** `GET /metadata/vobjects/{object}` (`?loc=true` optional). */
export async function objectMetadata(
  http: VaultHttp,
  objectName: string,
  opts: { loc?: boolean } = {},
): Promise<VaultObjectMetadata> {
  const body = await http.json<Record<string, unknown>>({
    method: "GET",
    path: `/metadata/vobjects/${encodeURIComponent(objectName)}`,
    query: opts.loc ? { loc: "true" } : undefined,
  });
  const raw = body.object ?? body.data;
  if (!raw || typeof raw !== "object")
    throw new VaultRequestError(
      "INVALID_DATA",
      `Object [${objectName}] metadata response carried no object`,
      { errorClass: "structural" },
    );
  const meta = normaliseObjectMetadata(raw);
  if (!meta.name) meta.name = objectName;
  return meta;
}

/** `GET /metadata/vobjects/{object}/fields/{field}`. */
export async function fieldMetadata(
  http: VaultHttp,
  objectName: string,
  fieldName: string,
): Promise<VaultFieldMetadata> {
  const body = await http.json<Record<string, unknown>>({
    method: "GET",
    path: `/metadata/vobjects/${encodeURIComponent(objectName)}/fields/${encodeURIComponent(fieldName)}`,
  });
  const raw = body.field ?? body.data;
  if (!raw || typeof raw !== "object")
    throw new VaultRequestError(
      "INVALID_DATA",
      `Field [${objectName}.${fieldName}] metadata response carried no field`,
      { errorClass: "structural" },
    );
  return normaliseFieldMetadata(raw);
}

export interface VaultPicklistSummary {
  name: string;
  label?: string;
  kind?: string;
  system?: boolean;
  usedIn?: Array<{ objectName: string; propertyName: string }>;
}

/** `GET /objects/picklists`. */
export async function listPicklists(
  http: VaultHttp,
): Promise<VaultPicklistSummary[]> {
  const body = await http.json<Record<string, unknown>>({
    method: "GET",
    path: "/objects/picklists",
  });
  const list = Array.isArray(body.picklists) ? body.picklists : [];
  return list.map((raw) => {
    const p = (raw ?? {}) as Record<string, unknown>;
    const out: VaultPicklistSummary = { name: String(p.name ?? "") };
    if (p.label !== undefined) out.label = String(p.label);
    if (p.kind !== undefined) out.kind = String(p.kind);
    if (p.system !== undefined) out.system = asBool(p.system);
    if (Array.isArray(p.usedIn))
      out.usedIn = p.usedIn.map((u) => {
        const x = (u ?? {}) as Record<string, unknown>;
        return {
          objectName: String(x.objectName ?? ""),
          propertyName: String(x.propertyName ?? ""),
        };
      });
    return out;
  });
}

function normalisePicklistValues(body: unknown): VaultPicklistValue[] {
  const o = (body ?? {}) as Record<string, unknown>;
  const list = Array.isArray(o.picklistValues) ? o.picklistValues : [];
  return list.map((raw) => {
    const v = (raw ?? {}) as Record<string, unknown>;
    const out: VaultPicklistValue = { name: String(v.name ?? "") };
    if (v.label !== undefined) out.label = String(v.label);
    if (v.status !== undefined) out.status = String(v.status).toLowerCase();
    return out;
  });
}

/** `GET /objects/picklists/{name}` — active values only (§2.5.6). */
export async function picklistValues(
  http: VaultHttp,
  picklistName: string,
): Promise<VaultPicklistValue[]> {
  const body = await http.json({
    method: "GET",
    path: `/objects/picklists/${encodeURIComponent(stripPicklistPrefix(picklistName) ?? picklistName)}`,
  });
  return normalisePicklistValues(body).filter(
    (v) => v.status === undefined || v.status === "active",
  );
}

/** `POST /objects/picklists/{name}` form `value_1=Label…` (≤ 1024 values). */
export async function createPicklistValues(
  http: VaultHttp,
  picklistName: string,
  labels: string[],
): Promise<VaultPicklistValue[]> {
  if (labels.length === 0) return [];
  if (labels.length > 1024)
    throw new VaultRequestError(
      "INVALID_DATA",
      `Cannot create ${labels.length} picklist values in one call (max 1024)`,
      { errorClass: "structural" },
    );
  const form = new URLSearchParams();
  labels.forEach((label, i) => form.set(`value_${i + 1}`, label));
  const body = await http.json({
    method: "POST",
    path: `/objects/picklists/${encodeURIComponent(picklistName)}`,
    body: form,
  });
  return normalisePicklistValues(body);
}

/** `PUT /objects/picklists/{name}/{value}` body `status=active|inactive` (§2.5.6 reactivation). */
export async function setPicklistValueStatus(
  http: VaultHttp,
  picklistName: string,
  valueName: string,
  status: "active" | "inactive",
): Promise<void> {
  await http.request({
    method: "PUT",
    path: `/objects/picklists/${encodeURIComponent(picklistName)}/${encodeURIComponent(valueName)}`,
    body: new URLSearchParams({ status }),
  });
}

function normaliseObjectTypeConfig(
  raw: unknown,
  objectName: string,
  typeName?: string,
): VaultObjectTypeConfig {
  const t = (raw ?? {}) as Record<string, unknown>;
  const fields = Array.isArray(t.type_fields) ? t.type_fields : [];
  const object =
    typeof t.object === "string"
      ? t.object
      : t.object && typeof t.object === "object"
        ? String((t.object as Record<string, unknown>).name ?? objectName)
        : objectName;
  return {
    name: String(t.name ?? typeName ?? ""),
    object,
    active: asBool(t.active, true),
    type_fields: fields.map((raw) => {
      const f = (raw ?? {}) as Record<string, unknown>;
      const out: { name: string; required: boolean; source?: string } = {
        name: String(f.name ?? ""),
        required: asBool(f.required),
      };
      if (f.source !== undefined) out.source = String(f.source);
      return out;
    }),
  };
}

function configurationData(body: unknown): unknown[] {
  const o = (body ?? {}) as Record<string, unknown>;
  const d = o.data ?? o.object_types ?? o.objecttypes;
  if (Array.isArray(d)) return d;
  if (d && typeof d === "object") return [d];
  return [];
}

/**
 * `GET /configuration/Objecttype.{object}.{type}` for every type of the
 * object (required-ness is per type). Types come from `metadata.object_types`
 * when given, otherwise from `GET /configuration/Objecttype` filtered by
 * object. A type whose configuration cannot be read degrades to an empty
 * `type_fields` list (logged) — the shape is documented, not observed.
 */
export async function objectTypes(
  http: VaultHttp,
  objectName: string,
  metadata?: VaultObjectMetadata,
): Promise<VaultObjectTypeConfig[]> {
  const names = (metadata?.object_types ?? [])
    .map((t) => t.name)
    .filter(Boolean);
  if (names.length === 0) {
    const body = await http.json({
      method: "GET",
      path: "/configuration/Objecttype",
    });
    return configurationData(body)
      .map((raw) => normaliseObjectTypeConfig(raw, objectName))
      .filter((t) => t.object === objectName);
  }
  const out: VaultObjectTypeConfig[] = [];
  for (const type of names) {
    try {
      const body = await http.json({
        method: "GET",
        path: `/configuration/Objecttype.${encodeURIComponent(objectName)}.${encodeURIComponent(type)}`,
      });
      const [first] = configurationData(body);
      out.push(normaliseObjectTypeConfig(first, objectName, type));
    } catch (e) {
      const err = toVaultError(e);
      if (err.errorClass === "retryable" || err.errorClass === "session")
        throw err;
      out.push({
        name: type,
        object: objectName,
        active: true,
        type_fields: [],
      });
    }
  }
  return out;
}

/** `GET /configuration/Objectlifecycle.{lifecycle}` → state API names. */
export async function lifecycleStates(
  http: VaultHttp,
  lifecycleName: string,
): Promise<VaultLifecycle> {
  const body = await http.json({
    method: "GET",
    path: `/configuration/Objectlifecycle.${encodeURIComponent(lifecycleName)}`,
  });
  const [raw] = configurationData(body);
  const lc = (raw ?? {}) as Record<string, unknown>;
  const statesRaw = Array.isArray(lc.states)
    ? lc.states
    : Array.isArray(lc.objectlifecyclestates)
      ? lc.objectlifecyclestates
      : [];
  const states = statesRaw.map((raw) => {
    const s = (raw ?? {}) as Record<string, unknown>;
    const out: { name: string; label?: string; initial?: boolean } = {
      name: String(s.name ?? ""),
    };
    if (s.label !== undefined) out.label = String(s.label);
    const initial =
      s.initial ?? s.initial_state ?? s.is_initial ?? s.state_type;
    if (typeof initial === "boolean") out.initial = initial;
    else if (typeof initial === "string")
      out.initial = /^(true|initial(_state)?(__v)?)$/i.test(initial);
    return out;
  });
  const out: VaultLifecycle = {
    name: String(lc.name ?? lifecycleName),
    states,
  };
  if (lc.label !== undefined) out.label = String(lc.label);
  return out;
}

/** `GET /metadata/objects/users` — Users API field metadata. */
export async function usersMetadata(
  http: VaultHttp,
): Promise<Array<Record<string, unknown>>> {
  const body = await http.json<Record<string, unknown>>({
    method: "GET",
    path: "/metadata/objects/users",
  });
  const list = body.properties ?? body.fields ?? body.data;
  return Array.isArray(list) ? (list as Array<Record<string, unknown>>) : [];
}

/** `GET /objects/users/{id}/permissions?filter=object.{name}.{actions}` — permission probe. */
export async function userPermissions(
  http: VaultHttp,
  userId: number | string,
  filter?: string,
): Promise<Array<Record<string, unknown>>> {
  const body = await http.json<Record<string, unknown>>({
    method: "GET",
    path: `/objects/users/${encodeURIComponent(String(userId))}/permissions`,
    query: filter ? { filter } : undefined,
  });
  const list = body.data ?? body.permissions;
  return Array.isArray(list) ? (list as Array<Record<string, unknown>>) : [];
}

/** `GET /limits` → everything but the envelope keys. */
export async function limits(
  http: VaultHttp,
): Promise<Record<string, unknown>> {
  const body = await http.json<Record<string, unknown>>({
    method: "GET",
    path: "/limits",
  });
  const {
    responseStatus: _rs,
    responseMessage: _rm,
    errors: _e,
    warnings: _w,
    ...rest
  } = body;
  return rest;
}
