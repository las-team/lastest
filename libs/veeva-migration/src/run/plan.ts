/**
 * §2.7 / §6.1 run planning: units = enabled objects × wave countries
 * (`GLOBAL` objects once), steps from `loadOrder()` (pass-2 patches carried
 * per step), one materialised mapping + hash per unit, explicit cutoff dates
 * per country (§1.1 #2). No I/O beyond the config.
 */
import type { MigrationConfig } from "../config/schema";
import {
  computeCutoffDate,
  materialise,
  resolveCountry,
  type ResolvedCountryConfig,
} from "../config/resolve";
import { isGlobalCountryOf, isTerritoryCountryRule } from "../country-of";
import { hashObject } from "../hash";
import { OBJECT_MODULES, loadOrder } from "../objects/registry";
import type { ObjectModule } from "../objects/types";
import {
  GLOBAL_COUNTRY,
  OBJECT_KEYS,
  isObjectKey,
  unitId,
  type CountryCode,
  type MaterialisedMapping,
  type ObjectKey,
  type Unit,
} from "../types";
import type { RunOptions, RunPlan, RunStep } from "./types";

export interface PlanDeps {
  /** Complete registry replacement (tests): only these modules exist. */
  modules?: Partial<Record<ObjectKey, ObjectModule>>;
  now?: () => Date;
}

export class PlanError extends Error {
  readonly exitCode = 5;
  constructor(message: string) {
    super(message);
    this.name = "PlanError";
  }
}

export function newRunId(mode: string, now: Date): string {
  const ts = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  const rand = Math.random().toString(36).slice(2, 6);
  return `${mode}-${ts}-${rand}`;
}

/** Countries of the run: `--country` narrows the wave; without a wave, all configured countries. */
export function planCountries(opts: RunOptions): {
  countries: CountryCode[];
  wave?: string;
} {
  const cfg = opts.config;
  let countries: CountryCode[];
  let wave: string | undefined;
  if (opts.wave) {
    const w = cfg.waves.find((x) => x.name === opts.wave);
    if (!w)
      throw new PlanError(
        `CONFIG_WAVE_UNKNOWN: wave "${opts.wave}" is not defined in config.waves`,
      );
    countries = [...w.countries];
    wave = w.name;
  } else countries = Object.keys(cfg.countries);
  if (opts.countries?.length) {
    const wanted = opts.countries.map((c) => c.toUpperCase());
    const unknown = wanted.filter((c) => !countries.includes(c));
    if (unknown.length)
      throw new PlanError(
        `CONFIG_COUNTRY_NOT_IN_WAVE: ${unknown.join(", ")} not in ${wave ? `wave ${wave}` : "config.countries"}`,
      );
    countries = countries.filter((c) => wanted.includes(c));
  }
  return { countries, wave };
}

export function parseObjectKeys(
  text: string | undefined,
): ObjectKey[] | undefined {
  if (!text) return undefined;
  const keys = text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const bad = keys.filter((k) => !isObjectKey(k));
  if (bad.length)
    throw new PlanError(`CONFIG_OBJECT_KEY_UNKNOWN: ${bad.join(", ")}`);
  return keys as ObjectKey[];
}

export function isGlobalModule(
  module: ObjectModule,
  cc: ResolvedCountryConfig,
): boolean {
  const ov = cc.objects[module.key]?.countryOf;
  // the territory country rule (`fromUsers` | `field:` | …) is a per-row
  // derivation, not a unit rule — the unit stays global (see config/resolve)
  if (
    ov !== undefined &&
    !(module.key === "territory" && isTerritoryCountryRule(ov))
  ) {
    const list = Array.isArray(ov) ? ov : [ov];
    return list.length === 1 && list[0].trim() === "global";
  }
  return isGlobalCountryOf(module.countryOf);
}

export async function buildPlan(
  opts: RunOptions,
  deps: PlanDeps = {},
): Promise<RunPlan> {
  const now = (deps.now ?? opts.now ?? (() => new Date()))();
  const cfg: MigrationConfig = opts.config;
  const registry = (deps.modules ?? OBJECT_MODULES) as Record<
    ObjectKey,
    ObjectModule
  >;
  const { countries, wave } = planCountries(opts);
  const requested = opts.objects;
  for (const k of requested ?? [])
    if (!registry[k]) throw new PlanError(`CONFIG_OBJECT_KEY_UNKNOWN: ${k}`);

  const ccByCountry = new Map<CountryCode, ResolvedCountryConfig>();
  const ccOf = (c: CountryCode) => {
    let cc = ccByCountry.get(c);
    if (!cc) ccByCountry.set(c, (cc = resolveCountry(cfg, c)));
    return cc;
  };
  const globalCc = ccOf(GLOBAL_COUNTRY);

  const cutoffDates = new Map<CountryCode, string>();
  for (const c of countries) {
    const cc = ccOf(c);
    cutoffDates.set(
      c,
      cc.scope.cutoffDate ?? computeCutoffDate(now, cc.scope.historyMonths),
    );
  }
  cutoffDates.set(
    GLOBAL_COUNTRY,
    globalCc.scope.cutoffDate ??
      computeCutoffDate(now, globalCc.scope.historyMonths),
  );

  const mappings = new Map<string, MaterialisedMapping>();
  const modules = new Map<ObjectKey, ObjectModule>();
  const unitsByKey = new Map<ObjectKey, Unit[]>();
  const candidateKeys = (requested ?? [...OBJECT_KEYS]).filter(
    (k) => registry[k],
  );
  for (const key of candidateKeys) {
    const mod = registry[key];
    const units: Unit[] = [];
    if (isGlobalModule(mod, globalCc)) {
      const m = materialise(mod, globalCc, cfg, { now });
      if (m.options.enabled || requested?.includes(key)) {
        const unit = { objectKey: key, country: GLOBAL_COUNTRY };
        mappings.set(unitId(unit), m);
        units.push(unit);
      }
    } else {
      for (const c of countries) {
        const m = materialise(mod, ccOf(c), cfg, { now });
        if (!m.options.enabled && !requested?.includes(key)) continue;
        const unit = { objectKey: key, country: c };
        mappings.set(unitId(unit), m);
        units.push(unit);
      }
    }
    if (units.length) {
      modules.set(key, mod);
      unitsByKey.set(key, units);
    }
  }
  const enabledKeys = [...modules.keys()];
  const steps: RunStep[] = loadOrder(registry, enabledKeys).map((s) => ({
    index: s.index,
    keys: s.keys,
    units: s.keys.flatMap((k) => unitsByKey.get(k) ?? []),
    pass2: s.pass2,
  }));

  const blobs = [...mappings.values()].some((m) =>
    m.fields.some((f) => f.transform.kind === "deferredBlob"),
  );
  const runId =
    opts.mode === "report" && opts.runId
      ? opts.runId
      : newRunId(opts.mode, now);
  return {
    runId,
    mode: opts.mode,
    wave,
    countries,
    steps,
    mappings,
    modules,
    cutoffDates,
    postLoad: {
      blobs,
      recalculateRollups: globalCc.postLoad.recalculateRollups,
      updateCorporateCurrency: globalCc.postLoad.updateCorporateCurrency,
    },
  };
}

/** Hash over every unit mapping hash (`runs.mapping_hash`). */
export function planMappingHash(plan: RunPlan): string {
  const entries = [...plan.mappings.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, m]) => [k, m.mappingHash]);
  return hashObject(entries);
}

export function unitsOf(plan: RunPlan): Unit[] {
  return plan.steps.flatMap((s) => s.units);
}
