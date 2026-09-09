/**
 * Transform registry (§6.0.3). Every entry is a pure, deterministic function
 * `(spec, value, row, ctx) → TransformResult`. No I/O: the id map is read
 * through `ctx.ids`, crosswalks through `ctx.country` / `ctx.mapping`.
 *
 * Output conventions:
 *  - `{ value }` — send `value` (a scalar or a deferred reference, §2.3);
 *    `targetField` overrides the output column.
 *  - `{ omit: true }` — key left out (Vault keeps the field as is on update;
 *    `clearOnNull` is handled by `apply.ts`).
 *  - `defer: "secondPass" | "blob"` — value held for pass 2 / the blob pass.
 *  - `diagnostic.fatal` — the row must not be loaded (policy `fail`).
 */
import {
  isContactId,
  isQueueId,
  isSfdcId,
  isUserId,
  formatLegacyId,
  to18,
} from "./ids";
import {
  renameObjectType,
  renamePicklistValue,
  renameTimezone,
} from "./rename";
import type {
  CompositePart,
  DeferredFk,
  DeferredUser,
  FlagCondition,
  PayloadScalar,
  PayloadValue,
  RowDiagnostic,
  SourceRow,
  TransformContext,
  TransformResult,
  TransformSpec,
} from "../types";

export * from "./rename";
export {
  parseTransform,
  formatTransform,
  toTransformSpec,
  innerTransform,
  refTarget,
} from "./spec";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

export const OMIT: TransformResult = { omit: true };

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

function omitWith(
  kind: RowDiagnostic["kind"],
  ctx: TransformContext,
  extra: Partial<RowDiagnostic> = {},
): TransformResult {
  return {
    omit: true,
    diagnostic: { kind, field: ctx.field.target, ...extra },
  };
}

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/** §5.1 `SF_DATETIME_RANGE`: 1700-01-01 … 4000-12-31. */
export function isInDateRange(iso: string): boolean {
  const year = Number(iso.slice(0, 4));
  return Number.isFinite(year) && year >= 1700 && year <= 4000;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3})\d*)?(Z|[+-]\d{2}:?\d{2})?$/;

/** Normalise an SFDC datetime to `YYYY-MM-DDTHH:MM:SS.SSSZ` (UTC, §2.5.4). Returns undefined when unparsable. */
export function normaliseDatetime(raw: string): string | undefined {
  const s = raw.trim();
  const m = DATETIME_RE.exec(s);
  if (!m) {
    if (DATE_RE.test(s)) return `${s}T00:00:00.000Z`;
    return undefined;
  }
  const [, y, mo, d, h, mi, sec = "00", ms = "000", tz] = m;
  if (!tz || tz === "Z" || tz === "+00:00" || tz === "+0000") {
    return `${y}-${mo}-${d}T${h}:${mi}:${sec}.${ms.padEnd(3, "0")}Z`;
  }
  const offset = tz.includes(":") ? tz : `${tz.slice(0, 3)}:${tz.slice(3)}`;
  const t = Date.parse(
    `${y}-${mo}-${d}T${h}:${mi}:${sec}.${ms.padEnd(3, "0")}${offset}`,
  );
  if (Number.isNaN(t)) return undefined;
  return new Date(t).toISOString();
}

export function normaliseDate(raw: string): string | undefined {
  const s = raw.trim();
  if (DATE_RE.test(s)) return s;
  const m = DATETIME_RE.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return undefined;
}

function maxLengthFor(
  ctx: TransformContext,
  explicit?: number,
  fallback?: number,
): number | undefined {
  return explicit ?? ctx.targetField?.maxLength ?? fallback;
}

function truncate(
  text: string,
  max: number | undefined,
  ctx: TransformContext,
): TransformResult {
  if (max === undefined || text.length <= max) return { value: text };
  const policy = ctx.field.truncation ?? "truncate";
  if (policy === "fail")
    return {
      omit: true,
      diagnostic: {
        kind: "truncated",
        field: ctx.field.target,
        code: "TRUNCATION_FAIL",
        fatal: true,
        detail: `${text.length} > ${max}`,
      },
    };
  if (policy === "omit")
    return omitWith("truncated", ctx, {
      code: "TRUNCATION_OMIT",
      detail: `${text.length} > ${max}`,
    });
  return {
    value: text.slice(0, max),
    diagnostic: {
      kind: "truncated",
      field: ctx.field.target,
      detail: `${text.length} > ${max}`,
    },
  };
}

/** C0 controls except TAB/LF/CR, plus DEL. Built from a string so the source holds no raw control bytes. */
const CONTROL_RE = new RegExp(
  "[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]",
  "g",
);

function cleanText(raw: string): string {
  return raw.normalize("NFC").replace(CONTROL_RE, "").trim();
}

function evalCondition(cond: FlagCondition, value: unknown): boolean {
  const norm = (v: unknown): unknown => {
    if (typeof v === "string") {
      const t = v.trim();
      if (t.toLowerCase() === "true") return true;
      if (t.toLowerCase() === "false") return false;
      if (t === "") return null;
      return t;
    }
    return v ?? null;
  };
  const v = norm(value);
  if ("equals" in cond) return v === norm(cond.equals);
  if ("notEquals" in cond) return v !== norm(cond.notEquals);
  return cond.in.map(norm).includes(v);
}

function derivePicklist(ctx: TransformContext, sourceValue: string): string {
  const customer = ctx.targetField?.name.endsWith("__c") ?? false;
  return renamePicklistValue(sourceValue, customer);
}

/**
 * Crosswalk one picklist value (§7.1 order: layered map → derivation → onUnmapped).
 * Returns `{ value }`, `{ skip }` (configured null / policy skip) or a fatal diagnostic.
 */
export function crosswalkPicklist(
  ctx: TransformContext,
  mapKey: string,
  sourceValue: string,
): { value?: string; skip?: boolean; diagnostic?: RowDiagnostic } {
  const explicit = ctx.country.picklist(mapKey, sourceValue);
  const fromMapping = ctx.mapping.picklists[mapKey];
  let target: string | null | undefined = explicit;
  if (target === undefined && fromMapping && sourceValue in fromMapping)
    target = fromMapping[sourceValue];
  if (target === null) return { skip: true };
  let derived = false;
  if (target === undefined) {
    if (ctx.country.picklistPolicy.derive === "none") return unmapped();
    target = derivePicklist(ctx, sourceValue);
    derived = true;
  }
  const known = ctx.targetField?.picklistValues;
  if (known && known.length && !known.includes(target)) {
    if (!derived) {
      // explicit crosswalk to an unknown target value — preflight reports VT_PICKLIST_VALUE_MISSING
      return {
        value: target,
        diagnostic: {
          kind: "unmapped_picklist",
          field: ctx.field.target,
          value: sourceValue,
          code: "VT_PICKLIST_VALUE_MISSING",
        },
      };
    }
    return unmapped();
  }
  return { value: target };

  function unmapped(): {
    value?: string;
    skip?: boolean;
    diagnostic?: RowDiagnostic;
  } {
    const policy = ctx.country.picklistPolicy.onUnmapped;
    const base: RowDiagnostic = {
      kind: "unmapped_picklist",
      field: ctx.field.target,
      value: sourceValue,
      code: "UNMAPPED_PICKLIST",
    };
    if (policy === "skip") return { skip: true, diagnostic: base };
    if (policy === "createValue")
      return {
        value: derivePicklist(ctx, sourceValue),
        diagnostic: { ...base, code: "PICKLIST_VALUE_CREATED" },
      };
    return { diagnostic: { ...base, fatal: true } };
  }
}

function deferredFk(
  objectKey: DeferredFk["$fk"]["object"],
  sfdcId: string,
): DeferredFk {
  return { $fk: { object: objectKey, sfdcId } };
}
function deferredUser(sfdcId: string): DeferredUser {
  return { $user: sfdcId };
}

function isAuditField(target: string): boolean {
  return target === "created_by__v" || target === "modified_by__v";
}

function resolveUserRef(
  ctx: TransformContext,
  rawId: string,
  opts: { audit: boolean },
): TransformResult {
  const id = to18(rawId);
  if (ctx.ids.resolveUser(id) !== undefined) return { value: deferredUser(id) };
  if (opts.audit) {
    if (ctx.migrationUserId !== undefined)
      return {
        value: ctx.migrationUserId,
        diagnostic: {
          kind: "audit_user_fallback",
          field: ctx.field.target,
          code: "AUDIT_USER_FALLBACK",
          value: id,
        },
      };
    return omitWith("audit_user_fallback", ctx, {
      code: "AUDIT_USER_FALLBACK",
      value: id,
    });
  }
  const policy = ctx.mapping.options.unmappedUserPolicy;
  const unresolved = { objectKey: "user" as const, sfdcId: id };
  switch (policy) {
    case "migrationUser":
      if (ctx.migrationUserId !== undefined)
        return {
          value: ctx.migrationUserId,
          diagnostic: {
            kind: "unmapped_user",
            field: ctx.field.target,
            code: "UNMAPPED_USER_REPLACED",
            value: id,
          },
        };
      return {
        omit: true,
        diagnostic: {
          kind: "unmapped_user",
          field: ctx.field.target,
          code: "UNMAPPED_USER",
          value: id,
          fatal: true,
        },
        unresolved,
      };
    case "skipRow":
      return {
        omit: true,
        diagnostic: {
          kind: "skipped",
          field: ctx.field.target,
          code: "UNMAPPED_USER_SKIP",
          value: id,
          fatal: true,
        },
        unresolved,
      };
    case "fail":
      return {
        omit: true,
        diagnostic: {
          kind: "unmapped_user",
          field: ctx.field.target,
          code: "UNMAPPED_USER",
          value: id,
          fatal: true,
        },
        unresolved,
      };
    default:
      // omit: the deferred reference is still emitted so a later user match can re-point (§3.5)
      return {
        value: deferredUser(id),
        diagnostic: {
          kind: "unresolved_fk",
          field: ctx.field.target,
          code: "UNMAPPED_USER",
          value: id,
        },
        unresolved,
      };
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

type Spec<K extends TransformSpec["kind"]> = Extract<
  TransformSpec,
  { kind: K }
>;
export type TransformFn<K extends TransformSpec["kind"]> = (
  spec: Spec<K>,
  value: unknown,
  row: SourceRow,
  ctx: TransformContext,
) => TransformResult;

export const TRANSFORMS: { [K in TransformSpec["kind"]]: TransformFn<K> } = {
  copy(_s, value) {
    if (isEmpty(value)) return OMIT;
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    )
      return { value };
    return { value: asString(value) };
  },

  text(spec, value, _row, ctx) {
    if (isEmpty(value)) return OMIT;
    const text = cleanText(asString(value));
    if (!text) return OMIT;
    return truncate(
      text,
      maxLengthFor(
        ctx,
        spec.max,
        ctx.targetField?.type === "longtext" ? 32000 : 1500,
      ),
      ctx,
    );
  },

  longtext(spec, value, _row, ctx) {
    if (isEmpty(value)) return OMIT;
    const text = asString(value)
      .normalize("NFC")
      .replace(CONTROL_RE, "")
      .replace(/\r\n/g, "\n")
      .trim();
    if (!text) return OMIT;
    return truncate(text, maxLengthFor(ctx, spec.max, 32000), ctx);
  },

  richtext(_s, value, _row, ctx) {
    if (isEmpty(value)) return OMIT;
    const raw = asString(value).normalize("NFC").replace(CONTROL_RE, "");
    const type = ctx.targetField?.type;
    let text: string;
    if (type === "richtext" || type === undefined) {
      text = sanitiseRichText(raw);
    } else {
      text = raw
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .trim();
    }
    if (!text) return OMIT;
    return truncate(text, maxLengthFor(ctx, undefined, 32000), ctx);
  },

  bool(_s, value, _row, ctx) {
    if (isEmpty(value)) return OMIT;
    if (typeof value === "boolean") return { value };
    const s = asString(value).trim().toLowerCase();
    if (s === "true" || s === "1" || s === "yes") return { value: true };
    if (s === "false" || s === "0" || s === "no") return { value: false };
    return omitWith("invalid_value", ctx, {
      value: s,
      code: "INVALID_BOOLEAN",
    });
  },

  number(spec, value, _row, ctx) {
    if (isEmpty(value)) return OMIT;
    const n =
      typeof value === "number" ? value : Number(asString(value).trim());
    if (!Number.isFinite(n))
      return omitWith("invalid_value", ctx, {
        value: asString(value),
        code: "INVALID_NUMBER",
      });
    const scale = spec.scale ?? ctx.targetField?.scale;
    const rounded = scale !== undefined ? Number(n.toFixed(scale)) : n;
    const { minValue, maxValue } = ctx.targetField ?? {};
    if (
      (minValue !== undefined && rounded < minValue) ||
      (maxValue !== undefined && rounded > maxValue)
    )
      return omitWith("out_of_range", ctx, {
        value: String(rounded),
        code: "VT_NUMBER_RANGE",
      });
    return { value: rounded };
  },

  date(_s, value, _row, ctx) {
    if (isEmpty(value)) return OMIT;
    const d = normaliseDate(asString(value));
    if (!d)
      return omitWith("invalid_value", ctx, {
        value: asString(value),
        code: "INVALID_DATE",
      });
    return dateRangeCheck(d, ctx);
  },

  datetime(_s, value, _row, ctx) {
    if (isEmpty(value)) return OMIT;
    const dt = normaliseDatetime(asString(value));
    if (!dt)
      return omitWith("invalid_value", ctx, {
        value: asString(value),
        code: "INVALID_DATETIME",
      });
    return dateRangeCheck(dt, ctx);
  },

  datetimeToDate(_s, value, _row, ctx) {
    if (isEmpty(value)) return OMIT;
    const d = normaliseDate(asString(value));
    if (!d)
      return omitWith("invalid_value", ctx, {
        value: asString(value),
        code: "INVALID_DATETIME",
      });
    return dateRangeCheck(d, ctx);
  },

  picklist(spec, value, _row, ctx) {
    if (isEmpty(value)) return OMIT;
    const r = crosswalkPicklist(ctx, spec.mapKey, asString(value).trim());
    if (r.skip || r.value === undefined)
      return { omit: true, diagnostic: r.diagnostic };
    return { value: r.value, diagnostic: r.diagnostic };
  },

  multipicklist(spec, value, _row, ctx) {
    if (isEmpty(value)) return OMIT;
    const parts = asString(value)
      .split(";")
      .map((p) => p.trim())
      .filter(Boolean);
    const out: string[] = [];
    let diagnostic: RowDiagnostic | undefined;
    for (const p of parts) {
      const r = crosswalkPicklist(ctx, spec.mapKey, p);
      if (r.diagnostic?.fatal) return { omit: true, diagnostic: r.diagnostic };
      if (r.diagnostic && !diagnostic) diagnostic = r.diagnostic;
      if (r.value !== undefined) out.push(r.value);
    }
    if (!out.length) return { omit: true, diagnostic };
    // §2.5.4: comma-separated names, literal commas doubled
    return {
      value: out.map((v) => v.replace(/,/g, ",,")).join(","),
      diagnostic,
    };
  },

  objectType(spec, value, row, ctx) {
    const devName = isEmpty(value) ? row["RecordType.DeveloperName"] : value;
    if (isEmpty(devName)) return OMIT;
    const name = asString(devName).trim();
    const target =
      ctx.mapping.objectTypes[name] ??
      ctx.country.picklist(spec.mapKey, name) ??
      renameObjectType(name);
    if (target === null)
      return omitWith("skipped", ctx, {
        code: "OBJECT_TYPE_SKIPPED",
        value: name,
        fatal: true,
      });
    if (
      ctx.metadata.allowTypes &&
      Object.keys(ctx.metadata.objectTypes).length &&
      !(target in ctx.metadata.objectTypes)
    )
      return {
        omit: true,
        diagnostic: {
          kind: "invalid_value",
          field: "object_type__v.api_name__v",
          code: "VT_OBJECT_TYPE_MISSING",
          value: name,
          fatal: true,
        },
      };
    return { value: target, targetField: "object_type__v.api_name__v" };
  },

  state(spec, value, _row, ctx) {
    if (isEmpty(value)) return OMIT;
    const status = asString(value).trim();
    const state =
      ctx.mapping.states[status] ?? ctx.country.picklist(spec.mapKey, status);
    if (state === null || state === undefined)
      return {
        omit: true,
        diagnostic: {
          kind: "unmapped_picklist",
          field: "state__v",
          code: "VT_LIFECYCLE_STATE_MISSING",
          value: status,
          fatal: ctx.metadata.lifecycle !== undefined,
        },
      };
    if (
      ctx.metadata.lifecycle &&
      !ctx.metadata.lifecycle.states.includes(state)
    )
      return {
        omit: true,
        diagnostic: {
          kind: "unmapped_picklist",
          field: "state__v",
          code: "VT_LIFECYCLE_STATE_MISSING",
          value: status,
          fatal: true,
        },
      };
    return { value: state, targetField: "state__v" };
  },

  ref(spec, value, _row, ctx) {
    if (isEmpty(value)) return OMIT;
    const raw = asString(value).trim();
    if (!isSfdcId(raw))
      return omitWith("invalid_value", ctx, { value: raw, code: "INVALID_ID" });
    if (isContactId(raw))
      return omitWith("contact_ref_dropped", ctx, {
        code: "CONTACT_REF_DROPPED",
        value: raw,
      });
    const id = to18(raw);
    const resolved = ctx.ids.resolve(spec.objectKey, id);
    const result: TransformResult = { value: deferredFk(spec.objectKey, id) };
    if (resolved === undefined) {
      result.unresolved = { objectKey: spec.objectKey, sfdcId: id };
      result.diagnostic = {
        kind: "unresolved_fk",
        field: ctx.field.target,
        objectKey: spec.objectKey,
        value: id,
        code: "UNRESOLVED_FK",
      };
    }
    return result;
  },

  refUser(_s, value, row, ctx) {
    if (isEmpty(value)) return OMIT;
    const raw = asString(value).trim();
    if (!isSfdcId(raw))
      return omitWith("invalid_value", ctx, { value: raw, code: "INVALID_ID" });
    const audit = isAuditField(ctx.field.target);
    if (isQueueId(raw)) {
      // §3.4 queue owners → rep from User_vod__c, else migration user
      const rep = row["User_vod__c"];
      if (isUserId(rep)) {
        const r = resolveUserRef(ctx, rep as string, { audit });
        return {
          ...r,
          diagnostic: r.diagnostic ?? {
            kind: "queue_owner_replaced",
            field: ctx.field.target,
            code: "QUEUE_OWNER_REPLACED",
            value: raw,
          },
        };
      }
      if (ctx.migrationUserId !== undefined)
        return {
          value: ctx.migrationUserId,
          diagnostic: {
            kind: "queue_owner_replaced",
            field: ctx.field.target,
            code: "QUEUE_OWNER_REPLACED",
            value: raw,
          },
        };
      return omitWith("queue_owner_replaced", ctx, {
        code: "QUEUE_OWNER_REPLACED",
        value: raw,
      });
    }
    if (!isUserId(raw))
      return omitWith("invalid_value", ctx, {
        value: raw,
        code: "NOT_A_USER_ID",
      });
    return resolveUserRef(ctx, raw, { audit });
  },

  refLookup(spec, value, _row, ctx) {
    if (isEmpty(value)) return OMIT;
    return {
      value: asString(value).trim(),
      targetField: `${ctx.field.target}.${spec.lookupField}`,
    };
  },

  legacyId(_s, value, row, ctx) {
    const raw = isEmpty(value) ? row.Id : value;
    if (isEmpty(raw) || !isSfdcId(raw))
      return {
        omit: true,
        diagnostic: {
          kind: "invalid_value",
          field: ctx.field.target,
          code: "INVALID_ID",
          fatal: true,
        },
      };
    const target = ctx.metadata.legacyIdField ?? ctx.field.target;
    return {
      value: formatLegacyId(
        raw as string,
        ctx.metadata.legacyIdFormat || "{id18}",
        ctx.orgId15,
      ),
      targetField: target,
    };
  },

  country(spec, value, _row, ctx) {
    if (isEmpty(value)) return OMIT;
    const raw: string = asString(value).trim();
    const entry = isSfdcId(raw)
      ? ctx.country.countries.bySfdcId(to18(raw))
      : ctx.country.countries.byIso2((raw as string).toUpperCase());
    if (!entry)
      return omitWith("unresolved_fk", ctx, {
        code: "VT_COUNTRY_UNMATCHED",
        value: raw,
        objectKey: "country",
      });
    switch (spec.mode) {
      case "ref":
        if (entry.vaultId) return { value: entry.vaultId };
        if (entry.sfdcId) return { value: deferredFk("country", entry.sfdcId) };
        return omitWith("unresolved_fk", ctx, {
          code: "VT_COUNTRY_UNMATCHED",
          value: raw,
          objectKey: "country",
        });
      case "iso2":
        return { value: entry.iso2 };
      case "name":
        return entry.name ? { value: entry.name } : OMIT;
      case "picklist": {
        if (entry.picklistValue) return { value: entry.picklistValue };
        const r = crosswalkPicklist(
          ctx,
          `${ctx.objectKey}.${ctx.field.target}`,
          entry.iso2,
        );
        return r.value !== undefined
          ? { value: r.value, diagnostic: r.diagnostic }
          : { omit: true, diagnostic: r.diagnostic };
      }
    }
  },

  territoryRef(_s, value, _row, ctx) {
    if (isEmpty(value)) return OMIT;
    const name = cleanText(asString(value));
    if (!name) return OMIT;
    if (ctx.targetField && ctx.targetField.type !== "object")
      return truncate(name, maxLengthFor(ctx), ctx);
    const id = ctx.ids.resolveTerritoryByName?.(name);
    if (id) return { value: id };
    return omitWith("unresolved_fk", ctx, {
      code: "TERRITORY_UNRESOLVED",
      value: name,
      objectKey: "territory",
    });
  },

  nameTemplate(spec, _value, row, ctx) {
    const tpl =
      ctx.country.nameTemplates[spec.templateKey] ??
      ctx.country.nameTemplates.person;
    const sep = ctx.country.nameTemplates.separator ?? " ";
    const token = (name: string): string => {
      if (name === "separator") return sep;
      const v = row[name] ?? row[`${name}_vod__c`] ?? row[`${name}__c`];
      return isEmpty(v) ? "" : cleanText(asString(v));
    };
    let out = tpl.replace(/\{([A-Za-z0-9_]+)\}/g, (_m, n: string) => token(n));
    out = out.replace(/\s{2,}/g, " ").replace(/^[\s,]+|[\s,]+$/g, "");
    if (!out) return OMIT;
    return truncate(out, maxLengthFor(ctx, undefined, 128), ctx);
  },

  currency(_s, value, _row, ctx) {
    if (isEmpty(value)) return OMIT;
    const iso = asString(value).trim().toUpperCase();
    const v = ctx.country.currency(iso);
    if (v === undefined)
      return omitWith("unresolved_fk", ctx, {
        code: "VT_CURRENCY_UNMATCHED",
        value: iso,
      });
    return { value: v, targetField: "local_currency__sys" };
  },

  userTimezone(_s, value) {
    if (isEmpty(value)) return OMIT;
    return { value: renameTimezone(asString(value).trim()) };
  },

  localeLookup(spec, value, _row, ctx) {
    if (isEmpty(value)) return OMIT;
    const code = asString(value).trim();
    const name = ctx.country.locales[spec.localeKind][code];
    if (!name)
      return omitWith("unmapped_picklist", ctx, {
        code: "VT_LOCALE_UNMATCHED",
        value: code,
      });
    return { value: name, targetField: `${ctx.field.target}.name__v` };
  },

  statusFromFlag(spec, _value, row) {
    const flag = row[spec.sourceFlag];
    if (evalCondition(spec.inactiveWhen, flag))
      return { value: "inactive__v", targetField: "status__v" };
    return OMIT;
  },

  const(spec) {
    return { value: spec.value };
  },

  compositeExternalId(spec, _value, row, ctx) {
    const parts: Record<string, DeferredFk | DeferredUser | string> = {};
    for (const [token, part] of Object.entries(spec.parts)) {
      const rendered = renderPart(part, row);
      if (rendered === undefined)
        return omitWith("invalid_value", ctx, {
          code: "COMPOSITE_PART_MISSING",
          detail: token,
        });
      parts[token] = rendered;
    }
    const allLiteral = Object.values(parts).every((p) => typeof p === "string");
    if (allLiteral)
      return {
        value: spec.template.replace(
          /\{([^}]+)\}/g,
          (_m, t: string) => parts[t] as string,
        ),
      };
    return { value: { $composite: { template: spec.template, parts } } };
  },

  secondPass(spec, value, row, ctx) {
    const inner = applyTransform(spec.inner, value, row, ctx);
    if ("omit" in inner) return inner;
    return {
      omit: true,
      defer: "secondPass",
      deferredValue: inner.value,
      targetField: inner.targetField,
      diagnostic: inner.diagnostic ?? {
        kind: "second_pass",
        field: ctx.field.target,
      },
      unresolved: inner.unresolved,
    };
  },

  deferredBlob(spec, value, row, ctx) {
    if (isEmpty(value)) return OMIT;
    const inner = spec.inner
      ? applyTransform(spec.inner, value, row, ctx)
      : ({ value: asString(value) } as TransformResult);
    if ("omit" in inner) return inner;
    return {
      omit: true,
      defer: "blob",
      deferredValue: inner.value,
      diagnostic: {
        kind: "deferred_blob",
        field: ctx.field.target,
        code: spec.blobName ?? ctx.field.blobName,
      },
    };
  },

  skip() {
    return OMIT;
  },

  custom(spec, value, row, ctx) {
    const fn = ctx.custom[spec.fnName];
    if (!fn)
      return {
        omit: true,
        diagnostic: {
          kind: "custom",
          field: ctx.field.target,
          code: "MAP_CUSTOM_FN_MISSING",
          value: spec.fnName,
          fatal: true,
        },
      };
    const r = fn(value, row, ctx);
    if (r === undefined) return OMIT;
    if (typeof r === "object" && r !== null && ("omit" in r || "value" in r))
      return r as TransformResult;
    return { value: r as PayloadValue };
  },
};

function renderPart(
  part: CompositePart,
  row: SourceRow,
): DeferredFk | DeferredUser | string | undefined {
  if ("const" in part) return part.const;
  if ("field" in part) {
    const v = row[part.field];
    return isEmpty(v) ? undefined : asString(v);
  }
  if ("user" in part) {
    const v = row[part.user];
    return isSfdcId(v) ? deferredUser(to18(v)) : undefined;
  }
  const v = row[part.source];
  return isSfdcId(v) ? deferredFk(part.ref, to18(v)) : undefined;
}

function dateRangeCheck(iso: string, ctx: TransformContext): TransformResult {
  if (isInDateRange(iso)) return { value: iso };
  const fatal = ctx.mapping.options.dateRange === "fail";
  return {
    omit: true,
    diagnostic: {
      kind: "out_of_range",
      field: ctx.field.target,
      code: "SF_DATETIME_RANGE",
      value: iso,
      fatal,
    },
  };
}

const ALLOWED_TAGS = new Set([
  "b",
  "i",
  "strong",
  "em",
  "ul",
  "ol",
  "li",
  "a",
  "p",
  "br",
  "u",
]);

/** Keep bold/italic/lists/links/paragraphs; strip everything else (§5.4 richtext). */
export function sanitiseRichText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(
      /<\s*(\/?)\s*([a-zA-Z0-9]+)([^>]*)>/g,
      (_m, close: string, tag: string, attrs: string) => {
        const t = tag.toLowerCase();
        if (!ALLOWED_TAGS.has(t)) return "";
        if (t === "a" && !close) {
          const href =
            /href\s*=\s*"([^"]*)"/i.exec(attrs)?.[1] ??
            /href\s*=\s*'([^']*)'/i.exec(attrs)?.[1];
          return href && /^(https?:|mailto:)/i.test(href)
            ? `<a href="${href}">`
            : "<a>";
        }
        return `<${close}${t}>`;
      },
    )
    .trim();
}

/** Dispatch one spec. */
export function applyTransform(
  spec: TransformSpec,
  value: unknown,
  row: SourceRow,
  ctx: TransformContext,
): TransformResult {
  const fn = TRANSFORMS[spec.kind] as unknown as
    | ((
        s: TransformSpec,
        v: unknown,
        r: SourceRow,
        c: TransformContext,
      ) => TransformResult)
    | undefined;
  if (!fn)
    return {
      omit: true,
      diagnostic: {
        kind: "custom",
        field: ctx.field.target,
        code: "MAP_TRANSFORM_INVALID",
        value: (spec as { kind: string }).kind,
        fatal: true,
      },
    };
  return fn(spec, value, row, ctx);
}

/** Convenience for tests and modules: the scalar/deferred value of a spec, or undefined when omitted. */
export function transformValue(
  spec: TransformSpec,
  value: unknown,
  row: SourceRow,
  ctx: TransformContext,
): PayloadScalar | PayloadValue | undefined {
  const r = applyTransform(spec, value, row, ctx);
  return "omit" in r ? undefined : r.value;
}
