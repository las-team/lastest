/**
 * Textual form of `TransformSpec` used in config overlays (§7.2 `fields.add[]`)
 * and in reports: `text`, `text(128)`, `picklist(account.specialty)`,
 * `ref(territory) secondPass`, `refLookup(product, external_id__v)`,
 * `statusFromFlag(Inactive_vod__c, true)`, `const(data_load__v)`, `custom(userStatus)`.
 */
import {
  isObjectKey,
  type CompositePart,
  type FlagCondition,
  type ObjectKey,
  type TransformSpec,
} from "../types";

export class TransformSpecError extends Error {
  readonly code = "MAP_TRANSFORM_INVALID";
}

function splitArgs(inner: string): string[] {
  return inner
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseScalar(raw: string): string | number | boolean | null {
  if (raw === "null") return null;
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw.replace(/^['"]|['"]$/g, "");
}

function parseCondition(raw: string): FlagCondition {
  const v = raw.trim();
  if (v.startsWith("in:"))
    return {
      in: splitArgs(v.slice(3)).map(parseScalar) as Array<
        string | number | boolean
      >,
    };
  if (v.startsWith("not:")) return { notEquals: parseScalar(v.slice(4)) };
  return { equals: parseScalar(v) };
}

/** `text(128)` / `number(2)` arguments must be non-negative integers — `text(abc)` would otherwise become `max: NaN` and empty every value. */
function parseIntArg(
  kind: string,
  argName: string,
  raw: string,
  text: string,
): number {
  if (!/^\d+$/.test(raw))
    throw new TransformSpecError(
      `${kind}(${argName}) must be a non-negative integer in "${text}"`,
    );
  return Number(raw);
}

/** Parse the textual form. Throws `TransformSpecError`. */
export function parseTransform(text: string): TransformSpec {
  const trimmed = text.trim();
  const m =
    /^([a-zA-Z]+)(?:\((.*)\))?((?:\s+(?:secondPass|deferredBlob))*)$/.exec(
      trimmed,
    );
  if (!m) throw new TransformSpecError(`Cannot parse transform "${text}"`);
  const [, name, argText = "", modifiers = ""] = m;
  const args = splitArgs(argText);
  let spec: TransformSpec;
  switch (name) {
    case "copy":
    case "richtext":
    case "bool":
    case "date":
    case "datetime":
    case "datetimeToDate":
    case "refUser":
    case "legacyId":
    case "territoryRef":
    case "currency":
    case "userTimezone":
    case "skip":
      spec = { kind: name };
      break;
    case "text":
    case "longtext":
      spec = args[0]
        ? { kind: name, max: parseIntArg(name, "max", args[0], text) }
        : { kind: name };
      break;
    case "number":
      spec = args[0]
        ? { kind: "number", scale: parseIntArg(name, "scale", args[0], text) }
        : { kind: "number" };
      break;
    case "picklist":
    case "multipicklist":
    case "objectType":
    case "state":
      if (!args[0])
        throw new TransformSpecError(`${name}(mapKey) needs a map key`);
      spec = { kind: name, mapKey: args[0] };
      break;
    case "ref":
      if (!isObjectKey(args[0]))
        throw new TransformSpecError(`ref(${args[0]}) is not an object key`);
      spec = { kind: "ref", objectKey: args[0] };
      break;
    case "refLookup":
      if (!isObjectKey(args[0]) || !args[1])
        throw new TransformSpecError(
          `refLookup(objectKey, lookupField) malformed: "${text}"`,
        );
      spec = { kind: "refLookup", objectKey: args[0], lookupField: args[1] };
      break;
    case "country":
      if (!["ref", "iso2", "picklist", "name"].includes(args[0]))
        throw new TransformSpecError(
          `country(mode) mode must be ref|iso2|picklist|name`,
        );
      spec = {
        kind: "country",
        mode: args[0] as "ref" | "iso2" | "picklist" | "name",
      };
      break;
    case "nameTemplate":
      spec = { kind: "nameTemplate", templateKey: args[0] ?? "person" };
      break;
    case "localeLookup":
      if (args[0] !== "language" && args[0] !== "locale")
        throw new TransformSpecError(
          `localeLookup(kind) kind must be language|locale`,
        );
      spec = { kind: "localeLookup", localeKind: args[0] };
      break;
    case "statusFromFlag":
      if (!args[0])
        throw new TransformSpecError(
          `statusFromFlag(sourceFlag, inactiveWhen)`,
        );
      spec = {
        kind: "statusFromFlag",
        sourceFlag: args[0],
        inactiveWhen: parseCondition(args.slice(1).join(",") || "true"),
      };
      break;
    case "const":
      spec = { kind: "const", value: parseScalar(argText.trim()) };
      break;
    case "compositeExternalId": {
      // compositeExternalId('{a}__{b}', a=ref:user:UserId, b=ref:territory:Territory2Id, c=field:Name, d=user:OwnerId)
      const [template, ...partArgs] = args;
      if (!template)
        throw new TransformSpecError(`compositeExternalId(template, parts…)`);
      const parts: Record<string, CompositePart> = {};
      for (const p of partArgs) {
        const eq = p.indexOf("=");
        if (eq < 0)
          throw new TransformSpecError(
            `compositeExternalId part "${p}" needs token=spec`,
          );
        const token = p.slice(0, eq).trim();
        const [ptype, a, b] = p.slice(eq + 1).split(":");
        if (ptype === "ref" && isObjectKey(a) && b)
          parts[token] = { ref: a, source: b };
        else if (ptype === "user" && a) parts[token] = { user: a };
        else if (ptype === "field" && a) parts[token] = { field: a };
        else if (ptype === "const" && a !== undefined)
          parts[token] = { const: a };
        else
          throw new TransformSpecError(
            `compositeExternalId part "${p}" malformed`,
          );
      }
      spec = {
        kind: "compositeExternalId",
        template: template.replace(/^['"]|['"]$/g, ""),
        parts,
      };
      break;
    }
    case "custom":
      if (!args[0])
        throw new TransformSpecError(`custom(fnName) needs a function name`);
      spec = { kind: "custom", fnName: args[0] };
      break;
    case "secondPass":
      spec = {
        kind: "secondPass",
        inner: args[0] ? parseTransform(argText) : { kind: "copy" },
      };
      break;
    case "deferredBlob":
      spec = args[0]
        ? { kind: "deferredBlob", blobName: args[0] }
        : { kind: "deferredBlob" };
      break;
    default:
      throw new TransformSpecError(`Unknown transform "${name}"`);
  }
  for (const mod of modifiers.trim().split(/\s+/).filter(Boolean)) {
    if (mod === "secondPass") spec = { kind: "secondPass", inner: spec };
    if (mod === "deferredBlob") spec = { kind: "deferredBlob", inner: spec };
  }
  return spec;
}

/** Inverse of `parseTransform` (stable, used in reports and hashes). */
export function formatTransform(spec: TransformSpec): string {
  switch (spec.kind) {
    case "text":
      return spec.max !== undefined ? `text(${spec.max})` : "text";
    case "longtext":
      return spec.max !== undefined ? `longtext(${spec.max})` : "longtext";
    case "number":
      return spec.scale !== undefined ? `number(${spec.scale})` : "number";
    case "picklist":
    case "multipicklist":
    case "objectType":
    case "state":
      return `${spec.kind}(${spec.mapKey})`;
    case "ref":
      return `ref(${spec.objectKey})`;
    case "refLookup":
      return `refLookup(${spec.objectKey}, ${spec.lookupField})`;
    case "country":
      return `country(${spec.mode})`;
    case "nameTemplate":
      return `nameTemplate(${spec.templateKey})`;
    case "localeLookup":
      return `localeLookup(${spec.localeKind})`;
    case "statusFromFlag": {
      const c = spec.inactiveWhen;
      const cond =
        "equals" in c
          ? String(c.equals)
          : "in" in c
            ? `in:${c.in.join(",")}`
            : `not:${String(c.notEquals)}`;
      return `statusFromFlag(${spec.sourceFlag}, ${cond})`;
    }
    case "const":
      return `const(${String(spec.value)})`;
    case "compositeExternalId": {
      const parts = Object.entries(spec.parts).map(([t, p]) => {
        if ("ref" in p) return `${t}=ref:${p.ref}:${p.source}`;
        if ("user" in p) return `${t}=user:${p.user}`;
        if ("field" in p) return `${t}=field:${p.field}`;
        return `${t}=const:${p.const}`;
      });
      return `compositeExternalId('${spec.template}'${parts.length ? ", " + parts.join(", ") : ""})`;
    }
    case "secondPass":
      return `${formatTransform(spec.inner)} secondPass`;
    case "deferredBlob":
      return spec.inner
        ? `${formatTransform(spec.inner)} deferredBlob`
        : spec.blobName
          ? `deferredBlob(${spec.blobName})`
          : "deferredBlob";
    case "custom":
      return `custom(${spec.fnName})`;
    default:
      return spec.kind;
  }
}

/** Accept either form (module tables use objects; config overlays use strings). */
export function toTransformSpec(t: TransformSpec | string): TransformSpec {
  return typeof t === "string" ? parseTransform(t) : t;
}

/** Unwrap `secondPass`/`deferredBlob` wrappers to the value transform. */
export function innerTransform(spec: TransformSpec): TransformSpec {
  if (spec.kind === "secondPass") return innerTransform(spec.inner);
  if (spec.kind === "deferredBlob" && spec.inner)
    return innerTransform(spec.inner);
  return spec;
}

export function isSecondPass(spec: TransformSpec): boolean {
  return spec.kind === "secondPass";
}
export function isDeferredBlob(spec: TransformSpec): boolean {
  return spec.kind === "deferredBlob";
}
/** Referenced object key for `ref`/`refLookup` (through wrappers). */
export function refTarget(spec: TransformSpec): ObjectKey | "user" | undefined {
  const inner = innerTransform(spec);
  if (inner.kind === "ref" || inner.kind === "refLookup")
    return inner.objectKey;
  if (inner.kind === "refUser") return "user";
  return undefined;
}
