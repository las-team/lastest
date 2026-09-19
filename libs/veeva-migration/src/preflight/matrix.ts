/**
 * §5.4 type compatibility matrix: which Vault field types a transform may
 * write to, and which transforms an SFDC describe type may feed. Anything
 * else is `VT_TYPE_INCOMPATIBLE` (blocking). The matrix is deliberately
 * permissive on the *widening* side (anything can be carried as text, `copy`
 * and `custom` are checked at run time) and strict where Vault validation
 * would reject the value (dates, numbers, booleans, references, picklists).
 */
import { innerTransform } from "../transform/spec";
import type {
  ResolvedFieldType,
  SfdcFieldType,
  TransformKind,
  TransformSpec,
} from "../types";

/** Vault types accepted per transform output; `undefined` = not checked. */
export const TRANSFORM_TARGET_TYPES: Partial<
  Record<TransformKind, readonly ResolvedFieldType[]>
> = {
  legacyId: ["string"],
  text: ["string", "longtext", "richtext"],
  longtext: ["longtext", "string", "richtext"],
  richtext: ["richtext", "longtext", "string"],
  bool: ["boolean", "picklist"],
  number: ["number", "currency"],
  date: ["date"],
  datetime: ["datetime"],
  datetimeToDate: ["date"],
  picklist: ["picklist"],
  multipicklist: ["picklist"],
  ref: ["object"],
  refUser: ["object"],
  refLookup: ["object"],
  territoryRef: ["object", "string"],
  nameTemplate: ["string"],
  userTimezone: ["picklist", "string"],
  localeLookup: ["object"],
  statusFromFlag: ["picklist"],
  compositeExternalId: ["string"],
  currency: ["object", "picklist", "string"],
};

/** Transforms an SFDC describe type may feed (§5.4 rows); `null` = never selected (compound). */
export const SFDC_TYPE_TRANSFORMS: Record<
  SfdcFieldType,
  readonly TransformKind[] | null
> = {
  id: ["legacyId", "copy", "text", "const", "custom", "skip"],
  string: TEXT_LIKE(),
  email: TEXT_LIKE(),
  phone: TEXT_LIKE(),
  url: TEXT_LIKE(),
  encryptedstring: TEXT_LIKE(),
  combobox: TEXT_LIKE(),
  textarea: [
    "longtext",
    "richtext",
    "text",
    "copy",
    "const",
    "custom",
    "skip",
    "deferredBlob",
  ],
  boolean: [
    "bool",
    "picklist",
    "statusFromFlag",
    "copy",
    "text",
    "const",
    "custom",
    "skip",
  ],
  int: NUMERIC(),
  double: NUMERIC(),
  percent: NUMERIC(),
  currency: [...NUMERIC(), "currency"],
  date: ["date", "copy", "text", "const", "custom", "skip"],
  datetime: [
    "datetime",
    "datetimeToDate",
    "copy",
    "text",
    "const",
    "custom",
    "skip",
  ],
  time: ["copy", "text", "const", "custom", "skip"],
  picklist: [
    "picklist",
    "copy",
    "text",
    "country",
    "currency",
    "userTimezone",
    "localeLookup",
    "statusFromFlag",
    "bool",
    "objectType",
    "state",
    "const",
    "custom",
    "skip",
  ],
  multipicklist: [
    "multipicklist",
    "copy",
    "text",
    "longtext",
    "const",
    "custom",
    "skip",
  ],
  reference: [
    "ref",
    "refLookup",
    "refUser",
    "objectType",
    "country",
    "territoryRef",
    "compositeExternalId",
    "copy",
    "text",
    "const",
    "custom",
    "skip",
  ],
  base64: ["deferredBlob", "skip", "custom"],
  anyType: ["copy", "text", "const", "custom", "skip"],
  location: null,
  address: null,
};

function TEXT_LIKE(): readonly TransformKind[] {
  return [
    "text",
    "longtext",
    "richtext",
    "copy",
    "country",
    "territoryRef",
    "nameTemplate",
    "compositeExternalId",
    "refLookup",
    "userTimezone",
    "localeLookup",
    "currency",
    "legacyId",
    "picklist",
    "multipicklist",
    "statusFromFlag",
    "const",
    "custom",
    "skip",
    "deferredBlob",
  ];
}
function NUMERIC(): readonly TransformKind[] {
  return ["number", "copy", "text", "const", "custom", "skip"];
}

export interface CompatibilityInput {
  transform: TransformSpec;
  /** Actual SFDC describe type (undefined = unknown / synthesised source). */
  sfdcType?: SfdcFieldType;
  /** Target field type (undefined = unknown, e.g. `object_type__v.api_name__v`). */
  targetType?: ResolvedFieldType;
}

export interface CompatibilityResult {
  ok: boolean;
  /** Which side failed. */
  side?: "source" | "target";
  reason?: string;
}

/** Effective transform kind for the matrix (wrappers unwrapped, `country` split by mode). */
export function effectiveKind(spec: TransformSpec): TransformKind {
  return innerTransform(spec).kind;
}

/** Target types for `country(mode)` depend on the mode. */
function countryTargets(spec: TransformSpec): readonly ResolvedFieldType[] {
  const inner = innerTransform(spec);
  if (inner.kind !== "country") return [];
  switch (inner.mode) {
    case "ref":
      return ["object"];
    case "picklist":
      return ["picklist"];
    default:
      return ["string"];
  }
}

/** §5.4 check for one mapping row. */
export function checkCompatibility(
  input: CompatibilityInput,
): CompatibilityResult {
  const outer = input.transform;
  const inner = innerTransform(outer);
  const kind = inner.kind;
  if (kind === "skip") return { ok: true };
  if (input.sfdcType !== undefined) {
    const allowed = SFDC_TYPE_TRANSFORMS[input.sfdcType];
    if (allowed === null)
      return {
        ok: false,
        side: "source",
        reason: `compound field type "${input.sfdcType}" is never selected (map its components)`,
      };
    if (allowed) {
      const wrapperOk =
        outer.kind === "deferredBlob" && allowed.includes("deferredBlob");
      if (!wrapperOk && !allowed.includes(kind))
        return {
          ok: false,
          side: "source",
          reason: `transform "${kind}" cannot consume SFDC type "${input.sfdcType}"`,
        };
    }
  }
  if (input.targetType !== undefined && input.targetType !== "unknown") {
    const accepted =
      kind === "country" ? countryTargets(outer) : TRANSFORM_TARGET_TYPES[kind];
    if (accepted && !accepted.includes(input.targetType))
      return {
        ok: false,
        side: "target",
        reason: `transform "${kind}" writes ${accepted.join("|")}, target is "${input.targetType}"`,
      };
  }
  return { ok: true };
}

/** SFDC describe types that hold text (for `VT_LENGTH` and text auto-switches). */
export function isTextualSfdcType(type: SfdcFieldType | undefined): boolean {
  return (
    type === "string" ||
    type === "email" ||
    type === "phone" ||
    type === "url" ||
    type === "encryptedstring" ||
    type === "textarea" ||
    type === "combobox"
  );
}

/** Coarse SFDC type groups used by `SF_FIELD_TYPE_MISMATCH` (a declared `string` matches an actual `email`). */
export function sfdcTypeGroup(type: SfdcFieldType): string {
  if (isTextualSfdcType(type)) return type === "textarea" ? "textarea" : "text";
  if (
    type === "int" ||
    type === "double" ||
    type === "percent" ||
    type === "currency"
  )
    return "number";
  return type;
}

/**
 * Auto-switch a transform to the one matching the actual source type when
 * the mapping declared another (§5.1 `SF_FIELD_TYPE_MISMATCH` → info).
 * Returns the new inner spec or `undefined` when no safe switch exists.
 */
export function autoSwitchTransform(
  spec: TransformSpec,
  actual: SfdcFieldType,
  opts: { length?: number } = {},
): TransformSpec | undefined {
  const inner = innerTransform(spec);
  let next: TransformSpec | undefined;
  switch (inner.kind) {
    case "country":
      if (actual === "reference" && inner.mode !== "ref")
        next = { kind: "country", mode: "ref" };
      else if (actual === "picklist" && inner.mode !== "picklist")
        next = { kind: "country", mode: "picklist" };
      else if (
        isTextualSfdcType(actual) &&
        inner.mode !== "iso2" &&
        inner.mode !== "name"
      )
        next = {
          kind: "country",
          mode: opts.length !== undefined && opts.length > 3 ? "name" : "iso2",
        };
      break;
    case "date":
      if (actual === "datetime") next = { kind: "datetimeToDate" };
      break;
    case "datetime":
      if (actual === "date") next = { kind: "date" };
      break;
    case "picklist":
      if (actual === "multipicklist")
        next = { kind: "multipicklist", mapKey: inner.mapKey };
      break;
    case "multipicklist":
      if (actual === "picklist")
        next = { kind: "picklist", mapKey: inner.mapKey };
      break;
    case "text":
      if (actual === "textarea" && inner.max === undefined)
        next = { kind: "longtext" };
      break;
    default:
      break;
  }
  if (!next) return undefined;
  return rewrap(spec, next);
}

/** Replace the inner transform, keeping `secondPass` / `deferredBlob` wrappers. */
export function rewrap(
  spec: TransformSpec,
  inner: TransformSpec,
): TransformSpec {
  if (spec.kind === "secondPass")
    return { kind: "secondPass", inner: rewrap(spec.inner, inner) };
  if (spec.kind === "deferredBlob" && spec.inner)
    return { ...spec, inner: rewrap(spec.inner, inner) };
  return inner;
}
