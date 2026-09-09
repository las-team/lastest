/**
 * §3.2 legacy-id field resolution (per object, at preflight). Pure: takes the
 * resolved target fields and the config and returns the chosen field, the
 * stored value format and the findings (`LEGACY_ID_FIELD_SELECTED` info or
 * `VT_LEGACY_ID_FIELD_MISSING` blocking). MDL (step 6) is prepared here and
 * executed by the caller under `--allow-mdl`.
 */
import { isSfdcId } from "../transform/ids";
import type { Finding, ObjectKey, ResolvedField } from "../types";

export const DEFAULT_LEGACY_ID_PREFERRED = [
  "legacy_crm_id__v",
  "external_id__v",
  "legacy_crm_id__c",
] as const;

/** Objects where integrations own `external_id__v` by default (§3.2 step 4). */
export const INTEGRATION_OWNED_EXTERNAL_ID: readonly ObjectKey[] = [
  "account",
  "address",
  "product",
  "key_message",
  "clm_presentation",
  "clm_presentation_slide",
  "approved_document",
  "territory",
];

export interface LegacyIdConfig {
  preferred: readonly string[];
  /** `{id18}` | `{id15}` (steps 2, 5, 6). */
  format: string;
  /** `SF:{orgId15}:{id18}` (step 4). */
  externalIdFormat: string;
}

export interface LegacyIdInput {
  objectKey: ObjectKey;
  targetObject: string;
  fields: Record<string, ResolvedField>;
  /** `objects.<key>.legacyIdField` (step 1). */
  explicit?: string;
  externalIdOwnedBy: "integration" | "migration";
  config: LegacyIdConfig;
  /** `--allow-mdl` / `legacyId.allowMdl` (step 6). */
  allowMdl: boolean;
  /** `user__sys`: match key only, never an idParam (§3.2 special cases). */
  matchOnly?: boolean;
}

export interface LegacyIdResolution {
  field?: string;
  format: string;
  /** §3.2 step that produced the choice (7 = none). */
  step: number;
  /** Step 3: `legacy_crm_id__v` exists but is not unique — still written for traceability. */
  traceabilityField?: string;
  /** Step 6: MDL to execute (field does not exist yet). */
  mdl?: string;
  /** Candidate fields examined with the reason they were rejected. */
  rejected: Array<{ field: string; reason: string }>;
  findings: Finding[];
}

/** Required stored length for a format (`{id18}` → 18, `SF:{orgId15}:{id18}` → 37). */
export function formatLength(format: string): number {
  return format
    .replace("{id18}", "x".repeat(18))
    .replace("{id15}", "x".repeat(15))
    .replace("{orgId15}", "x".repeat(15)).length;
}

/** MDL snippet adding `legacy_crm_id__c` to an object (§2.5.6 verified syntax). */
export function legacyIdMdl(targetObject: string, field = "legacy_crm_id__c") {
  return [
    `ALTER Object ${targetObject} (`,
    `  ADD Field ${field}(`,
    `    label('Legacy CRM ID'), type('String'), max_length(18), active(true), required(false),`,
    `    list_column(false), unique(true), order(0))`,
    `);`,
  ].join("\n");
}

function candidateProblem(
  f: ResolvedField | undefined,
  name: string,
  opts: { needUnique: boolean; needEditable: boolean; minLength: number },
): string | undefined {
  if (!f) return `${name} does not exist`;
  if (!f.active) return `${name} is inactive`;
  if (f.type !== "string") return `${name} is ${f.rawType}, not String`;
  if (opts.needUnique && !f.unique) return `${name} is not unique`;
  if (opts.needEditable && !f.editable) return `${name} is not editable`;
  if (f.maxLength !== undefined && f.maxLength < opts.minLength)
    return `${name} max_length ${f.maxLength} < ${opts.minLength}`;
  return undefined;
}

/** Resolve the legacy-id field per the §3.2 precedence table. */
export function resolveLegacyIdField(input: LegacyIdInput): LegacyIdResolution {
  const { fields, config, objectKey } = input;
  const rejected: LegacyIdResolution["rejected"] = [];
  const findings: Finding[] = [];
  const baseFormat = config.format || "{id18}";
  const done = (
    field: string,
    format: string,
    step: number,
    extra: Partial<LegacyIdResolution> = {},
  ): LegacyIdResolution => {
    findings.push({
      severity: "info",
      code: "LEGACY_ID_FIELD_SELECTED",
      objectKey,
      field,
      detail: {
        step,
        format,
        targetObject: input.targetObject,
        matchOnly: Boolean(input.matchOnly),
        ...(input.matchOnly
          ? { note: "match key only — users are updated by id (§3.2)" }
          : {}),
        rejected,
      },
    });
    return { field, format, step, rejected, findings, ...extra };
  };

  // step 1: explicit config
  if (input.explicit) {
    const p = candidateProblem(fields[input.explicit], input.explicit, {
      needUnique: true,
      needEditable: true,
      minLength: formatLength(baseFormat),
    });
    if (!p) return done(input.explicit, baseFormat, 1);
    rejected.push({ field: input.explicit, reason: `explicit: ${p}` });
    findings.push({
      severity: "warning",
      code: "VT_LEGACY_ID_FIELD_MISSING",
      objectKey,
      field: input.explicit,
      detail: `objects.${objectKey}.legacyIdField = ${input.explicit} rejected (${p}); falling back to the §3.2 defaults`,
    });
  }

  let traceabilityField: string | undefined;
  const preferred = config.preferred.length
    ? config.preferred
    : DEFAULT_LEGACY_ID_PREFERRED;
  for (const name of preferred) {
    const f = fields[name];
    if (name === "external_id__v") {
      // step 4
      if (input.externalIdOwnedBy === "integration") {
        rejected.push({
          field: name,
          reason: `objects.${objectKey}.externalIdOwnedBy = integration`,
        });
        continue;
      }
      const p = candidateProblem(f, name, {
        needUnique: true,
        needEditable: false,
        minLength: formatLength(config.externalIdFormat),
      });
      if (!p)
        return done(name, config.externalIdFormat, 4, { traceabilityField });
      rejected.push({ field: name, reason: p });
      continue;
    }
    const step =
      name === "legacy_crm_id__v" ? 2 : name === "legacy_crm_id__c" ? 5 : 2;
    const p = candidateProblem(f, name, {
      needUnique: true,
      needEditable: false,
      minLength: formatLength(baseFormat),
    });
    if (!p) return done(name, baseFormat, step, { traceabilityField });
    if (
      f &&
      f.type === "string" &&
      f.active &&
      !f.unique &&
      name === "legacy_crm_id__v"
    ) {
      // step 3: still written, never the idParam
      traceabilityField = name;
      rejected.push({
        field: name,
        reason: "not unique — written for traceability only (step 3)",
      });
      continue;
    }
    rejected.push({ field: name, reason: p });
  }

  // step 6: create legacy_crm_id__c via MDL
  if (input.allowMdl && !fields.legacy_crm_id__c) {
    return {
      field: "legacy_crm_id__c",
      format: baseFormat,
      step: 6,
      traceabilityField,
      mdl: legacyIdMdl(input.targetObject),
      rejected,
      findings,
    };
  }

  // step 7: none
  findings.push({
    severity: "blocking",
    code: "VT_LEGACY_ID_FIELD_MISSING",
    objectKey,
    detail: {
      targetObject: input.targetObject,
      rejected,
      hint: `no unique String field to use as idParam; set objects.${objectKey}.legacyIdField, or run with --allow-mdl to create legacy_crm_id__c`,
      mdl: legacyIdMdl(input.targetObject),
    },
  });
  return { format: baseFormat, step: 7, traceabilityField, rejected, findings };
}

/**
 * §5.2 `VT_LEGACY_ID_FORMAT`: does a stored value match the configured format?
 * Values that are not SFDC-id shaped at all (integration keys) are ignored by
 * the caller; this only decides 15 vs 18 chars and the `SF:` prefix.
 */
export function legacyIdValueMatches(value: string, format: string): boolean {
  const re = new RegExp(
    "^" +
      format
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace("\\{id18\\}", "[a-zA-Z0-9]{18}")
        .replace("\\{id15\\}", "[a-zA-Z0-9]{15}")
        .replace("\\{orgId15\\}", "[a-zA-Z0-9]{15}") +
      "$",
  );
  return re.test(value);
}

/** Is the value a candidate for the format check at all (some id or prefixed id)? */
export function looksLikeLegacyId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (isSfdcId(value)) return true;
  return /^SF:[a-zA-Z0-9]{15}:[a-zA-Z0-9]{15,18}$/.test(value);
}
