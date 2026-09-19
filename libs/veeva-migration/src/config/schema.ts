/**
 * Zod schema for the complete configuration key reference (§7.2.1, §7.3).
 * Country-level keys may appear at `global` (top level), `regions.<R>` and
 * `countries.<ISO>`; global-only keys are rejected inside a region/country.
 * Unknown keys are rejected everywhere except inside `objects.<key>` (module
 * specific flags are open, listed ones are typed) and `picklists` (map keys).
 */
import { z } from "zod";
import { parseTransform } from "../transform/spec";
import { OBJECT_KEYS } from "../types";

// ---------------------------------------------------------------------------
// Auth unions
// ---------------------------------------------------------------------------

export const SourceAuthSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("jwt"),
      clientId: z.string().min(1),
      username: z.string().min(1),
      /**
       * `aud` claim: login/test/My Domain login URL (§2.1.1). Unset → the
       * origin of `source.loginUrl` (derived in `sfdc/auth.ts`), so a
       * sandbox never sends the production audience by accident.
       */
      aud: z.string().url().optional(),
      privateKeyPath: z.string().optional(),
      privateKey: z.string().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("clientCredentials"),
      clientId: z.string().min(1),
      clientSecret: z.string().min(1),
    })
    .strict(),
]);

export const TargetAuthSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("password"),
      username: z.string().min(1),
      password: z.string().min(1),
    })
    .strict(),
  z
    .object({ kind: z.literal("accessToken"), token: z.string().min(1) })
    .strict(),
  z
    .object({
      kind: z.literal("oauth"),
      /** `oath_oidc_profile_id` path segment (spelling verbatim, §2.5.1). */
      profileId: z.string().min(1),
      idpToken: z.string().min(1),
      clientId: z.string().optional(),
    })
    .strict(),
]);

// ---------------------------------------------------------------------------
// Country-level blocks
// ---------------------------------------------------------------------------

export const TargetSchema = z
  .object({
    vaultDns: z.string().min(1).optional(),
    apiVersion: z
      .string()
      .regex(/^v\d+\.\d+$/)
      .optional(),
    auth: TargetAuthSchema.optional(),
    clientId: z
      .string()
      .max(100)
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional(),
    migrationMode: z.boolean().optional(),
    unchangedFieldBehavior: z
      .enum(["AlwaysIgnore", "IgnoreSetOnCreateOnly", "NeverIgnore"])
      .optional(),
    /** Numeric Vault user id used for audit fallback / `unmappedUserPolicy = migrationUser`. */
    migrationUserId: z.number().int().positive().optional(),
    /** Derived from auth; read-only. */
    vaultId: z.number().int().optional(),
  })
  .strict();

/**
 * `staging` is gone from the config, deliberately.
 *
 * It carried two fields and both were defects. `databaseUrl` is how the app's
 * own `DATABASE_URL` became feature config, threaded from a server action into
 * a connection the engine opened for itself; `runDir` is how a free-text
 * settings field became the base directory for `fs.mkdir`. The store is now
 * injected by the caller and the run directory comes from `RunContext`, so
 * neither belongs in a file a customer edits.
 *
 * Note for anyone restoring it for data residency: per-country `staging` was
 * never implemented. `createEngineDeps` built exactly one store from the
 * top-level config and logged a warning when a country targeted another vault
 * (`src/run/wiring.ts`), so the `staging:` line in the CN sample config
 * described an intention, not behaviour. Residency belongs to whoever provides
 * the store, which is now the host.
 */

export const ObjectScopeSchema = z
  .object({ historyMonths: z.number().int().min(0).nullable().optional() })
  .strict();

export const ScopeSchema = z
  .object({
    historyMonths: z.number().int().min(0).optional(),
    cutoffDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    sampleRetentionMonths: z.number().int().min(0).optional(),
    tovRetentionMonths: z.number().int().min(0).optional(),
    samplesIncludeCalls: z.boolean().optional(),
    objects: z.record(z.string(), ObjectScopeSchema).optional(),
  })
  .strict();

export const ReconcileSchema = z
  .object({
    sampleSize: z.number().int().min(0).optional(),
    tolerance: z.number().int().min(0).optional(),
  })
  .strict();

export const PostLoadSchema = z
  .object({
    recalculateRollups: z.enum(["auto", "required", "off"]).optional(),
    updateCorporateCurrency: z.boolean().optional(),
  })
  .strict();

/** `picklists.<object>.<field>: { src: tgt | null }` plus the three policy keys. */
export const PicklistMapSchema = z.record(z.string(), z.string().nullable());
export const PicklistsSchema = z
  .object({
    derive: z.enum(["strip_vod_lowercase_v", "none"]).optional(),
    onUnmapped: z.enum(["error", "skip", "createValue"]).optional(),
    leaveReactivated: z.boolean().optional(),
  })
  .catchall(PicklistMapSchema);

export const RequirementSchema = z.union([
  z.enum(["K", "Y", "y?", "n", "-"]),
  z.boolean(),
]);

/**
 * Same shape as a mapping row (§7.2 field map). `transform` is textual and
 * must parse (`parseTransform`) — a typo is `CONFIG_INVALID` (exit 5) at load
 * time (`MAP_TRANSFORM_INVALID`), never a crash in `materialise`.
 */
export const FieldOverrideSchema = z
  .object({
    source: z.string(),
    target: z.string().min(1),
    transform: z.string().min(1),
    required: RequirementSchema.optional(),
    clearOnNull: z.boolean().optional(),
    truncation: z.enum(["truncate", "fail", "omit"]).optional(),
    evidence: z.string().optional(),
    blobName: z.string().optional(),
    notes: z.string().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    try {
      parseTransform(v.transform);
    } catch (e) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `MAP_TRANSFORM_INVALID: ${(e as Error).message}`,
        path: ["transform"],
      });
    }
  });

export const FieldsOverrideSchema = z
  .object({
    add: z.array(FieldOverrideSchema).optional(),
    override: z.array(FieldOverrideSchema).optional(),
    remove: z.array(z.string()).optional(),
    /** Tolerated shorthand seen in §7.4.1 (`fields: { required: {...} }`). */
    required: z.record(z.string(), z.boolean()).optional(),
  })
  .strict();

export const ObjectLoadSchema = z
  .object({
    noTriggers: z.boolean().optional(),
    migrationMode: z.boolean().optional(),
    batchSize: z.number().int().min(1).max(500).optional(),
    partitionBy: z
      .object({
        field: z.string().min(1),
        /** `["null", notNull]` — the §7.3 excerpt's bare YAML `null` is accepted and normalised to the literal. */
        order: z
          .tuple([
            z
              .union([z.literal("null"), z.null()])
              .transform(() => "null" as const),
            z.literal("notNull"),
          ])
          .optional(),
      })
      .strict()
      .optional(),
    orderBy: z.array(z.string().min(1)).optional(),
    depthOrderBy: z.string().optional(),
    sampleStrategy: z
      .enum([
        "noTriggersRecalc",
        "noTriggersVerify",
        "triggersOnTransactions",
        "triggersOnCallSamples",
      ])
      .optional(),
    fallbackStrategy: z
      .enum([
        "noTriggersRecalc",
        "noTriggersVerify",
        "triggersOnTransactions",
        "triggersOnCallSamples",
      ])
      .optional(),
    sampleTriggerRejectFallback: z.boolean().optional(),
    strategy: z.enum(["vobjects", "loader"]).optional(),
  })
  .strict();

const CountryOfValue = z.union([z.string(), z.array(z.string())]);

/** `objects.<key>` overrides (§7.2.1 row "objects.<key>.*" + object-specific keys). Extra keys pass through for module-specific flags. */
export const ObjectOverrideSchema = z
  .object({
    enabled: z.boolean().optional(),
    optional: z.boolean().optional(),
    countryOf: CountryOfValue.optional(),
    deletePolicy: z.enum(["delete", "inactivate", "ignore"]).optional(),
    inactivateBy: z
      .array(
        z
          .object({
            field: z.string(),
            value: z.union([z.string(), z.boolean(), z.number(), z.null()]),
          })
          .strict(),
      )
      .optional(),
    createPolicy: z.enum(["create", "match-only"]).optional(),
    statusFromFlag: z.boolean().optional(),
    inactiveStatuses: z.array(z.string()).optional(),
    preserveName: z.boolean().optional(),
    preserveAutoNumberName: z.boolean().optional(),
    loadUnlockFlag: z.boolean().optional(),
    allowTypeChange: z.boolean().optional(),
    dateRange: z.enum(["omit", "fail"]).optional(),
    unmappedUserPolicy: z
      .enum(["fail", "migrationUser", "skipRow", "omit"])
      .optional(),
    legacyIdField: z.string().optional(),
    externalIdOwnedBy: z.enum(["integration", "migration"]).optional(),
    rewriteCompositeExternalId: z.boolean().optional(),
    customFields: z
      .object({
        mode: z.enum(["none", "listed", "allMatching"]).optional(),
        include: z.array(z.string()).optional(),
        exclude: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
    required: z.record(z.string(), z.boolean()).optional(),
    fields: FieldsOverrideSchema.optional(),
    objectType: z.record(z.string(), z.string()).optional(),
    state: z.record(z.string(), z.string()).optional(),
    scope: ObjectScopeSchema.optional(),
    load: ObjectLoadSchema.optional(),
    blobs: z
      .record(
        z.string(),
        z.enum(["required", "optional", "attachment", "skip"]),
      )
      .optional(),
    // --- user (§3.3, §6.3.2; global only in practice)
    mode: z.enum(["match", "create"]).optional(),
    usernameTemplate: z.string().optional(),
    securityPolicyId: z.union([z.string(), z.number()]).optional(),
    licenseType: z.string().optional(),
    securityProfile: z.record(z.string(), z.string()).optional(),
    // --- account
    vidField: z.string().optional(),
    contactToPersonAccount: z.boolean().optional(),
    useParentIdFallback: z.boolean().optional(),
    loadFormattedName: z.boolean().optional(),
    depthOrder: z.boolean().optional(),
    // --- address
    line1Overflow: z.enum(["truncate", "spillToLine2", "fail"]).optional(),
    // --- approved_document / sent_email
    htmlOverflow: z.enum(["truncate", "fail", "attachment"]).optional(),
    publishMethod: z.string().optional(),
    contentOverflow: z.enum(["truncate", "fail", "attachment"]).optional(),
    // --- call2
    loadCallType: z.boolean().optional(),
    loadDeviceFields: z.boolean().optional(),
    // --- country
    targetKeyField: z.string().optional(),
    // --- territory
    countryPrefixMap: z.record(z.string(), z.string()).optional(),
    // --- em_event
    configurationMap: z.record(z.string(), z.string()).optional(),
    stageMap: z.record(z.string(), z.string()).optional(),
    // --- multichannel_consent (§6.3.42): keyed by SFDC 18-char Id → vault id | external_id:<v> | name:<v>
    configMaps: z
      .object({
        consentType: z.record(z.string(), z.string()).optional(),
        consentLine: z.record(z.string(), z.string()).optional(),
        contentType: z.record(z.string(), z.string()).optional(),
        consentTemplate: z.record(z.string(), z.string()).optional(),
      })
      .strict()
      .optional(),
    // --- email_activity
    loadIpAddress: z.boolean().optional(),
  })
  .passthrough();

export const NameTemplatesSchema = z
  .object({
    person: z.string().optional(),
    speaker: z.string().optional(),
    userTerritory: z.string().optional(),
    separator: z.string().optional(),
  })
  .catchall(z.string());

export const FormatsSchema = z
  .object({
    date: z.string().optional(),
    datetime: z.string().optional(),
    decimalSeparator: z.string().optional(),
    thousandsSeparator: z.string().optional(),
  })
  .strict();

export const PhoneSchema = z
  .object({
    normalise: z.boolean().optional(),
    defaultRegion: z.string().length(2).optional(),
  })
  .strict();

export const PostalCodeSchema = z
  .object({
    pattern: z.string().optional(),
    onMismatch: z.enum(["warn", "fail"]).optional(),
  })
  .strict();

export const PrivacySchema = z
  .object({
    erasureListPath: z.string().optional(),
    consentFullHistory: z.boolean().optional(),
    crossBorderTransfer: z.enum(["allowed", "forbidden"]).optional(),
  })
  .strict();

export const DataResidencySchema = z.enum(["eu", "us", "cn", "jp"]);

/** Keys that may be set at global, region or country level (§7.2.1 "country"). */
export const CountryLayerSchema = z
  .object({
    target: TargetSchema.optional(),
    dataResidency: DataResidencySchema.optional(),
    scope: ScopeSchema.optional(),
    reconcile: ReconcileSchema.optional(),
    postLoad: PostLoadSchema.optional(),
    picklists: PicklistsSchema.optional(),
    objects: z.record(z.string(), ObjectOverrideSchema).optional(),
    nameTemplates: NameTemplatesSchema.optional(),
    formats: FormatsSchema.optional(),
    phone: PhoneSchema.optional(),
    postalCode: PostalCodeSchema.optional(),
    defaultTimezone: z.string().optional(),
    privacy: PrivacySchema.optional(),
  })
  .strict();

export const CountryEntrySchema = CountryLayerSchema.extend({
  region: z.string().optional(),
}).strict();

// ---------------------------------------------------------------------------
// Global-only blocks
// ---------------------------------------------------------------------------

export const SourceSchema = z
  .object({
    apiVersion: z
      .string()
      .regex(/^\d+\.\d+$/)
      .default("67.0"),
    loginUrl: z.string().url(),
    auth: SourceAuthSchema,
    timezone: z.string().default("UTC"),
  })
  .strict();

export const LegacyIdSchema = z
  .object({
    preferred: z
      .array(z.string())
      .default(["legacy_crm_id__v", "external_id__v", "legacy_crm_id__c"]),
    format: z.string().default("{id18}"),
    externalIdFormat: z.string().default("SF:{orgId15}:{id18}"),
    allowMdl: z.boolean().default(false),
  })
  .strict();

export const DeltaSchema = z
  .object({
    overlapMinutes: z.number().int().min(5).max(15).default(10),
    safetyLagMinutes: z.number().int().min(0).default(5),
  })
  .strict();

export const PerformanceSchema = z
  .object({
    sfdcBulkConcurrency: z.number().int().min(1).max(25).default(4),
    /** Bulk 2.0 `maxRecords` per results page (§2.1.5; bounds memory per page). */
    sfdcBulkMaxRecords: z.number().int().positive().default(100_000),
    sfdcRestConcurrency: z.number().int().min(1).default(2),
    vaultConcurrency: z.number().int().min(1).default(4),
    vaultBatch: z.number().int().min(1).max(500).default(500),
    burstFloor: z.number().int().min(0).default(200),
    sfdcApiFloorPct: z.number().int().min(0).max(100).default(20),
    batchWallTimeMs: z.number().int().min(1000).default(60000),
    sortChunkRows: z.number().int().min(1000).default(500000),
    /** §8.6 blob batch cap (bytes). */
    blobBatchBytes: z
      .number()
      .int()
      .min(1024)
      .default(64 * 1024 * 1024),
  })
  .strict();

export const ExtractSchema = z
  .object({
    closureStrategy: z.enum(["soqlIn", "composite"]).default("soqlIn"),
    closureMaxRounds: z.number().int().min(1).default(20),
  })
  .strict();

export const LoadSchema = z
  .object({ strategy: z.enum(["vobjects", "loader"]).default("vobjects") })
  .strict();
export const PendingFkSchema = z
  .object({ maxRounds: z.number().int().min(0).default(3) })
  .strict();

export const PreflightSchema = z
  .object({
    probeWrites: z.boolean().default(false),
    probeObject: z.string().optional(),
    naturalKeyReview: z.boolean().default(true),
    reprobe: z.boolean().default(false),
  })
  .strict();

export const LocalesSchema = z
  .object({
    language: z.record(z.string(), z.string()).default({}),
    locale: z.record(z.string(), z.string()).default({}),
  })
  .strict();

export const WaveSchema = z
  .object({
    name: z.string().min(1),
    countries: z.array(z.string().regex(/^[A-Z]{2}$/)).min(1),
    freezeAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export interface ConfigRefineOptions {
  /**
   * Region names that exist outside the file (the shipped `config/regions/*`
   * overlays): a `countries.<ISO>.region` naming one of them passes the
   * `CONFIG_REGION_UNKNOWN` check because the merge adds the region.
   */
  knownRegions?: readonly string[];
}

/** Unrefined shape (no cross-key checks) — use `MigrationConfigSchema` / `makeMigrationConfigSchema`. */
export const MigrationConfigBaseSchema = CountryLayerSchema.extend({
  version: z.literal(1),
  source: SourceSchema,
  target: TargetSchema.extend({
    vaultDns: z.string().min(1),
    apiVersion: z
      .string()
      .regex(/^v\d+\.\d+$/)
      .default("v26.2"),
    auth: TargetAuthSchema,
    migrationMode: z.boolean().default(true),
    unchangedFieldBehavior: z
      .enum(["AlwaysIgnore", "IgnoreSetOnCreateOnly", "NeverIgnore"])
      .default("AlwaysIgnore"),
  }),
  legacyId: LegacyIdSchema.default({}),
  delta: DeltaSchema.default({}),
  performance: PerformanceSchema.default({}),
  extract: ExtractSchema.default({}),
  load: LoadSchema.default({}),
  pendingFk: PendingFkSchema.default({}),
  preflight: PreflightSchema.default({}),
  locales: LocalesSchema.default({}),
  regions: z.record(z.string(), CountryLayerSchema).default({}),
  countries: z
    .record(z.string().regex(/^[A-Z]{2}$/), CountryEntrySchema)
    .default({}),
  waves: z.array(WaveSchema).default([]),
}).strict();

function refineConfig(
  cfg: z.infer<typeof MigrationConfigBaseSchema>,
  ctx: z.RefinementCtx,
  opts: ConfigRefineOptions,
): void {
  const knownRegions = new Set(opts.knownRegions ?? []);
  // §7.3: every wave country must have an overlay (or an explicit region line).
  for (const wave of cfg.waves) {
    for (const iso of wave.countries) {
      if (!cfg.countries[iso]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `CONFIG_COUNTRY_NO_OVERLAY: wave "${wave.name}" lists ${iso} but countries.${iso} has no overlay`,
          path: ["waves"],
        });
      }
    }
  }
  for (const [iso, entry] of Object.entries(cfg.countries)) {
    if (
      entry.region &&
      !cfg.regions[entry.region] &&
      !knownRegions.has(entry.region)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `CONFIG_REGION_UNKNOWN: countries.${iso}.region "${entry.region}" is not defined in regions`,
        path: ["countries", iso, "region"],
      });
    }
  }
  const checkObjects = (
    objects: Record<string, unknown> | undefined,
    path: string[],
  ) => {
    for (const key of Object.keys(objects ?? {})) {
      if (!(OBJECT_KEYS as readonly string[]).includes(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `CONFIG_OBJECT_KEY_UNKNOWN: "${key}" is not an object key`,
          path: [...path, "objects", key],
        });
      }
    }
  };
  checkObjects(cfg.objects, []);
  for (const [r, layer] of Object.entries(cfg.regions))
    checkObjects(layer.objects, ["regions", r]);
  for (const [c, layer] of Object.entries(cfg.countries))
    checkObjects(layer.objects, ["countries", c]);
}

/** Full schema with the cross-key checks; `knownRegions` relaxes `CONFIG_REGION_UNKNOWN` for shipped regions. */
export function makeMigrationConfigSchema(opts: ConfigRefineOptions = {}) {
  return MigrationConfigBaseSchema.superRefine((cfg, ctx) =>
    refineConfig(cfg, ctx, opts),
  );
}

export const MigrationConfigSchema = makeMigrationConfigSchema();

export type MigrationConfig = z.infer<typeof MigrationConfigSchema>;
export type MigrationConfigInput = z.input<typeof MigrationConfigSchema>;
export type CountryLayer = z.infer<typeof CountryLayerSchema>;
export type CountryEntry = z.infer<typeof CountryEntrySchema>;
export type ObjectOverride = z.infer<typeof ObjectOverrideSchema>;
export type FieldOverride = z.infer<typeof FieldOverrideSchema>;
export type FieldsOverride = z.infer<typeof FieldsOverrideSchema>;
export type SourceAuth = z.infer<typeof SourceAuthSchema>;
export type TargetAuth = z.infer<typeof TargetAuthSchema>;
export type Wave = z.infer<typeof WaveSchema>;

/** Built-in defaults for the country-level settings (§7.2.1 "Default" column). */
export const COUNTRY_DEFAULTS = {
  scope: { historyMonths: 24, samplesIncludeCalls: false },
  reconcile: { sampleSize: 200, tolerance: 0 },
  postLoad: {
    recalculateRollups: "auto" as const,
    updateCorporateCurrency: true,
  },
  picklists: {
    derive: "strip_vod_lowercase_v" as const,
    onUnmapped: "error" as const,
    leaveReactivated: false,
  },
  nameTemplates: {
    person: "{FirstName} {LastName}",
    speaker: "{LastName}, {FirstName}",
    userTerritory: "{username}:{territory}",
    separator: " ",
  },
  formats: {},
  phone: { normalise: false },
  postalCode: { onMismatch: "warn" as const },
  defaultTimezone: "UTC",
  privacy: {
    consentFullHistory: false,
    crossBorderTransfer: "allowed" as const,
  },
};

/** Built-in `locales.*` crosswalk (§6.0.3), overridable by config. */
export const DEFAULT_LOCALES = {
  language: {
    en_US: "English",
    en_GB: "English",
    de: "German",
    fr: "French",
    es: "Spanish",
    it: "Italian",
    ja: "Japanese",
    zh_CN: "Chinese (Simplified)",
    pt_BR: "Portuguese (Brazil)",
    ko: "Korean",
    nl_NL: "Dutch",
  },
  locale: {
    en_US: "United States",
    en_GB: "United Kingdom",
    en_CA: "Canada",
    fr_CA: "Canada",
    de_DE: "Germany",
    fr_FR: "France",
    es_ES: "Spain",
    it_IT: "Italy",
    nl_NL: "Netherlands",
    ja_JP: "Japan",
    zh_CN: "China",
    pt_BR: "Brazil",
    es_MX: "Mexico",
    ko_KR: "Korea",
    en_AU: "Australia",
  },
};

/** Parse + validate a raw object (already env-interpolated). Throws `ZodError`. */
export function parseConfig(raw: unknown): MigrationConfig {
  return MigrationConfigSchema.parse(raw);
}
