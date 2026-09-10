/**
 * The Plan stage: config -> units -> load order -> materialised mapping.
 *
 * This is the one part of the engine the console runs INLINE, on request,
 * during a page render. `buildPlan()` is documented as doing no I/O beyond the
 * config (`run/plan.ts`), and it is what makes the plan and the mapping
 * inspector work with no credentials at all — which matters, because the whole
 * point of the Plan stage is to look at what WOULD run before handing over a
 * password.
 *
 * Everything returned here is projected into plain serializable shapes. The
 * engine's `RunPlan` holds `Map`s and module closures; handing that to a client
 * component would not survive serialization.
 */

import "server-only";
import { getLogger } from "@/lib/logger";
import type { MigrationConfigSkeleton } from "./config-builder";

const log = getLogger("Migration");

/** One row of the demo's load-order table. */
export interface PlanUnitRow {
  index: number;
  objectKey: string;
  country: string;
  unitId: string;
  sourceObject: string;
  targetObject: string;
  dependsOn: string[];
  mappingHash: string;
  /** Which parallel step of the run this unit belongs to (§6.1). */
  step: number;
  /** Self-reference fields patched in the second pass, if any. */
  secondPass: string[];
}

/** One row of the demo's mapping table. */
export interface PlanFieldRow {
  source: string;
  target: string;
  transform: string;
  /** `K` legacy key · `Y` required · `n` optional — the demo's `req` column. */
  requirement: "K" | "Y" | "n";
  evidence?: string;
  notes?: string;
}

export interface PlanMapping {
  unitId: string;
  objectKey: string;
  country: string;
  sourceObject: string;
  targetObject: string;
  legacyIdField?: string;
  mappingHash: string;
  fields: PlanFieldRow[];
  /** Mapping-time findings (SCOPE_NARROWED, MAP_DUP_TARGET, …). */
  findings: Array<{ severity: string; code: string; detail: string }>;
}

export interface PlanResult {
  ok: true;
  wave?: string;
  countries: string[];
  /** Steps that run in parallel, in order. */
  steps: Array<{ index: number; units: string[] }>;
  units: PlanUnitRow[];
  mappings: PlanMapping[];
  /** Hash over every unit mapping hash — moves when any mapping changes. */
  planMappingHash: string;
}

export interface PlanFailure {
  ok: false;
  /** The engine's own message, including its `CONFIG_*` code where it has one. */
  error: string;
}

/**
 * The skeleton with placeholder credentials, purely so it parses.
 *
 * `buildPlan()` never authenticates — that is the whole reason the Plan stage
 * comes before Preflight — but `MigrationConfigSchema` requires an auth block
 * because a config that cannot connect is not a runnable config. Rather than
 * relax the engine's schema (it is right) or make the console demand a password
 * to draw a table (it should not), the two placeholder values below stand in
 * for the parse and are thrown away with the parsed object.
 *
 * They are inert by construction: nothing on this path opens a socket, and
 * `buildPlan` reads `config.source.auth` not at all.
 */
function planningConfig(skeleton: MigrationConfigSkeleton): unknown {
  const sourceKind = skeleton.source.auth?.kind ?? "clientCredentials";
  const targetKind = skeleton.target.auth?.kind ?? "password";
  return {
    ...skeleton,
    source: {
      ...skeleton.source,
      auth:
        sourceKind === "jwt"
          ? {
              kind: "jwt",
              clientId: skeleton.source.auth?.clientId || "planning",
              username: skeleton.source.auth?.username || "planning",
              privateKey: PLACEHOLDER,
            }
          : {
              kind: "clientCredentials",
              clientId: skeleton.source.auth?.clientId || "planning",
              clientSecret: PLACEHOLDER,
            },
    },
    target: {
      ...skeleton.target,
      auth:
        targetKind === "oauth"
          ? {
              kind: "oauth",
              profileId: skeleton.target.auth?.profileId || "planning",
              idpToken: PLACEHOLDER,
            }
          : { kind: "password", username: "planning", password: PLACEHOLDER },
    },
  };
}

/** Never a credential — it exists so a zod `.min(1)` is satisfied. */
const PLACEHOLDER = "planning-only";

function requirementOf(
  required: unknown,
  isLegacyKey: boolean,
): "K" | "Y" | "n" {
  if (isLegacyKey) return "K";
  // `Requirement` is `true | false | "conditional"`-ish across modules; only a
  // hard `true` earns `Y`, so a conditional requirement never reads as one the
  // operator must satisfy up front.
  return required === true ? "Y" : "n";
}

function detailText(detail: unknown): string {
  return typeof detail === "string" ? detail : JSON.stringify(detail);
}

/**
 * Build the plan for one wave.
 *
 * Returns `{ ok: false }` rather than throwing for a config the engine
 * rejects: an incomplete config is the NORMAL state of a migration someone is
 * still setting up, and the Plan stage's job is to say what is missing.
 */
export async function buildPlanPreview(
  skeleton: MigrationConfigSkeleton,
  opts: { wave?: string; countries?: string[]; objects?: string[] } = {},
): Promise<PlanResult | PlanFailure> {
  try {
    const {
      makeMigrationConfigSchema,
      mergeOverlays,
      loadBuiltinCountryOverlays,
      EMPTY_OVERLAYS,
      buildPlan,
      unitId,
      planMappingHash,
      formatTransform,
    } = await import("@lastest/veeva-migration");

    // The shipped `config/regions/*` and `config/countries/*` overlays are
    // read off disk by the package. In a bundled server build that directory
    // may not be traced, and a missing overlay must degrade to "no country
    // defaults" rather than break the Plan stage — the plan is still correct,
    // it just shows the global layer only.
    let overlays = EMPTY_OVERLAYS;
    try {
      overlays = loadBuiltinCountryOverlays();
    } catch (err) {
      log.warn(
        { err },
        "built-in country overlays unavailable; planning without them",
      );
    }

    const parsed = makeMigrationConfigSchema({
      knownRegions: Object.keys(overlays.regions),
    }).safeParse(planningConfig(skeleton));
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues
          .map((i) => `${i.path.join(".") || "config"}: ${i.message}`)
          .join("\n"),
      };
    }

    // NOTE: `loadConfigFromText`'s `interpolateEnv` step is deliberately NOT
    // used. That path exists so a YAML file on an operator's disk can read
    // `${VAULT_PASSWORD}`; this config comes from a database row a team member
    // edited in a browser, and letting it interpolate would make the app's
    // environment readable through the config editor.
    const config = mergeOverlays(parsed.data, { overlays });

    const plan = await buildPlan({
      mode: "init",
      config,
      wave: opts.wave,
      countries: opts.countries,
      objects: opts.objects as never,
    });

    const units: PlanUnitRow[] = [];
    const mappings: PlanMapping[] = [];

    for (const step of plan.steps) {
      const pass2ByUnit = new Map<string, string[]>();
      for (const p of step.pass2) {
        const list = pass2ByUnit.get(p.objectKey) ?? [];
        list.push(p.target);
        pass2ByUnit.set(p.objectKey, list);
      }
      for (const unit of step.units) {
        const id = unitId(unit);
        const mapping = plan.mappings.get(id);
        if (!mapping) continue;
        units.push({
          index: units.length + 1,
          objectKey: unit.objectKey,
          country: unit.country,
          unitId: id,
          sourceObject: mapping.sourceObject,
          targetObject: mapping.targetObject,
          dependsOn: mapping.dependsOn ?? [],
          mappingHash: mapping.mappingHash ?? "",
          step: step.index,
          secondPass: pass2ByUnit.get(unit.objectKey) ?? [],
        });
        mappings.push({
          unitId: id,
          objectKey: unit.objectKey,
          country: unit.country,
          sourceObject: mapping.sourceObject,
          targetObject: mapping.targetObject,
          legacyIdField: mapping.legacyIdField,
          mappingHash: mapping.mappingHash ?? "",
          fields: (mapping.fields ?? []).map((f) => ({
            source: f.source,
            target: f.target,
            transform: formatTransform(f.transform),
            requirement: requirementOf(
              mapping.required?.[f.target] ?? f.required,
              f.target === mapping.legacyIdField,
            ),
            evidence: f.evidence,
            notes: f.notes,
          })),
          findings: (mapping.findings ?? []).map((f) => ({
            severity: f.severity,
            code: f.code,
            detail: detailText(f.detail),
          })),
        });
      }
    }

    return {
      ok: true,
      wave: plan.wave,
      countries: plan.countries,
      steps: plan.steps.map((s) => ({
        index: s.index,
        units: s.units.map((u) => unitId(u)),
      })),
      units,
      mappings,
      planMappingHash: planMappingHash(plan),
    };
  } catch (err) {
    log.warn({ err }, "plan preview failed");
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
