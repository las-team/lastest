/**
 * Preflight entry point (§2.6, §5): `runPreflight(input)` runs the source
 * checks, the offline lints, the target checks (with §3.2 legacy-id
 * resolution), the crosswalks and the write probes, persists the findings
 * and returns the `PreflightResult` plus the pruned mappings and the
 * `resolvedTargets` consumed by transform/load. Never writes business data.
 */
import { resolveCountry } from "../config/resolve";
import { getLogger } from "../logger";
import { OBJECT_MODULES } from "../objects/registry";
import {
  GLOBAL_COUNTRY,
  unitId,
  type CountryCode,
  type Finding,
  type MaterialisedMapping,
  type ObjectKey,
  type Unit,
} from "../types";
import type {
  Preflight,
  PreflightInput,
  PreflightResult,
  ResolvedTarget,
} from "./types";
import {
  buildCountryCrosswalk,
  loadCurrencies,
  type CountryCrosswalk,
} from "./crosswalks";
import {
  FindingCollector,
  blockedUnits,
  isGlobalBlocking,
  newSinceLastRun,
} from "./findings";
import { lintMappings } from "./lints";
import { runProbes } from "./probes";
import { buildReport, type PreflightReport } from "./report";
import {
  checkSourceGlobal,
  checkSourceUnit,
  createSourceContext,
  getDescribe,
  type SourceContext,
} from "./source";
import {
  checkTargetUnit,
  checkVaultGlobal,
  createTargetContext,
  unitVaultDns,
  type TargetContext,
} from "./target";
import { SFDC_COUNTRY_OBJECT } from "./crosswalks";

export * from "./types";
export * from "./findings";
export * from "./matrix";
export * from "./legacy-id";
export * from "./lints";
export * from "./crosswalks";
export * from "./source";
export * from "./target";
export * from "./probes";
export * from "./report";

const log = getLogger("Preflight");

export interface PreflightOptions {
  /** Rows sampled per unit for length/range/picklist/user checks (default 2000; 0 = no sample). */
  sampleSize?: number;
  now?: () => Date;
}

/** `PreflightResult` plus the diff and the rendered report. */
export interface PreflightOutcome extends PreflightResult {
  newSinceLastRun: Finding[];
  report: PreflightReport;
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function runPreflight(
  input: PreflightInput,
  opts: PreflightOptions = {},
): Promise<PreflightOutcome> {
  const { config, units, mappings, store, flags, runId } = input;
  const now = opts.now ?? (() => new Date());
  const fc = new FindingCollector();
  const rlog = getLogger("Preflight", { run_id: runId, mode: input.mode });
  rlog.info(
    { units: units.length, vaults: [...input.vaults.keys()] },
    "preflight start",
  );

  // ---------------------------------------------------------------- source
  const sctx: SourceContext = createSourceContext(input.sfdc, {
    sampleSize: opts.sampleSize,
  });
  await checkSourceGlobal(sctx, {
    config,
    store,
    findings: fc,
    plannedJobs: units.length,
  });

  // ---------------------------------------------------------------- vaults
  const countryCfg = new Map<CountryCode, ReturnType<typeof resolveCountry>>();
  const ccOf = (country: CountryCode) => {
    let cc = countryCfg.get(country);
    if (!cc) {
      cc = resolveCountry(config, country);
      countryCfg.set(country, cc);
    }
    return cc;
  };
  const targets = new Map<string, TargetContext>();
  const dnsOf = (unit: Unit) => unitVaultDns(config, ccOf(unit.country).target);
  for (const unit of units) {
    const dns = dnsOf(unit);
    if (targets.has(dns)) continue;
    const vault = input.vaults.get(dns);
    if (!vault) {
      fc.blocking(
        "VT_AUTH_FAILED",
        `no Vault client for ${dns}`,
        dns === config.target.vaultDns ? {} : { country: unit.country },
      );
      continue;
    }
    const tctx = createTargetContext(vault);
    targets.set(dns, tctx);
    await checkVaultGlobal(tctx, {
      config,
      target: ccOf(unit.country).target,
      findings: fc,
    });
  }

  // ---------------------------------------------------------------- source units
  const sourceResults = new Map<
    string,
    Awaited<ReturnType<typeof checkSourceUnit>>
  >();
  for (const unit of units) {
    const mapping = mappings.get(unitId(unit));
    if (!mapping) continue;
    sourceResults.set(
      unitId(unit),
      await checkSourceUnit(sctx, unit, mapping, fc),
    );
  }

  // ---------------------------------------------------------------- lints
  const describes = new Map(
    [...sctx.describes].filter(
      (e): e is [string, NonNullable<(typeof e)[1]>] => e[1] !== null,
    ),
  );
  const isEnabled = (key: ObjectKey, country: CountryCode): boolean => {
    const m =
      mappings.get(unitId({ objectKey: key, country })) ??
      mappings.get(unitId({ objectKey: key, country: GLOBAL_COUNTRY }));
    if (m) return m.options.enabled;
    const ov = ccOf(country).objects[key]?.enabled;
    if (ov !== undefined) return ov;
    return OBJECT_MODULES[key]?.enabledByDefault ?? false;
  };
  const lint = lintMappings(mappings, units, { isEnabled, describes });
  fc.addAll(lint.findings);

  // ---------------------------------------------------------------- crosswalks
  const countries = new Map<string, CountryCrosswalk>();
  const currencies = new Map<string, Map<string, string> | undefined>();
  const sfdcCountry = await getDescribe(sctx, SFDC_COUNTRY_OBJECT);
  for (const [dns, tctx] of targets) {
    if (tctx.unavailable) continue;
    const targetKeyField = (
      config.objects?.country as { targetKeyField?: string } | undefined
    )?.targetKeyField;
    const cw = await buildCountryCrosswalk({
      sfdc: input.sfdc,
      vault: tctx.vault,
      sfdcDescribe: sfdcCountry,
      targetKeyField,
      findings: fc,
    });
    countries.set(dns, cw);
    if (sctx.facts.multiCurrency)
      currencies.set(dns, await loadCurrencies(tctx.vault, fc));
    const byIso = new Map(cw.entries.map((e) => [e.iso2, e] as const));
    for (const country of new Set(
      units.filter((u) => dnsOf(u) === dns).map((u) => u.country),
    )) {
      if (country === GLOBAL_COUNTRY) continue;
      const e = byIso.get(country);
      if (cw.vaultAvailable && !e?.vaultId)
        fc.blocking(
          "VT_COUNTRY_UNMATCHED",
          `no country__v row for ${country} in ${dns}`,
          { country },
        );
      if (cw.sfdcAvailable && !e?.sfdcId)
        fc.blocking(
          "VT_COUNTRY_UNMATCHED",
          `no Country_vod__c row with Alpha_2_Code_vod__c = ${country}`,
          { country },
        );
    }
  }

  // ---------------------------------------------------------------- target units
  const resolvedTargets = new Map<string, ResolvedTarget>();
  const pruned = new Map<string, MaterialisedMapping>();
  const parentTarget = (key: ObjectKey, country: CountryCode) =>
    mappings.get(unitId({ objectKey: key, country }))?.targetObject ??
    mappings.get(unitId({ objectKey: key, country: GLOBAL_COUNTRY }))
      ?.targetObject ??
    [...mappings.values()].find((m) => m.objectKey === key)?.targetObject ??
    OBJECT_MODULES[key]?.target;

  for (const unit of units) {
    const id = unitId(unit);
    const mapping = mappings.get(id);
    const src = sourceResults.get(id);
    if (!mapping || !src) continue;
    const dns = dnsOf(unit);
    const tctx = targets.get(dns);
    const drops = new Map(src.drops);
    for (const t of lint.omitted.get(id) ?? [])
      drops.set(t, "MAP_FK_PARENT_NOT_IN_PLAN");
    if (!tctx) {
      pruned.set(id, mapping);
      continue;
    }
    const cc = ccOf(unit.country);
    const tr = await checkTargetUnit(
      tctx,
      {
        unit,
        mapping,
        describe: src.describe,
        sourceFields: src.sourceFields,
        sample: src.sample,
        drops,
        switches: src.switches,
        count: src.count,
        facts: sctx.facts,
        flags,
        config,
        store,
        mode: input.mode,
        parentTarget: (key) => parentTarget(key, unit.country),
        currencies: currencies.get(dns),
        postLoad: cc.postLoad,
        picklistPolicy: cc.picklists,
      },
      fc,
      src.columns,
    );
    const key =
      dns === config.target.vaultDns
        ? unit.objectKey
        : `${unit.objectKey}@${dns}`;
    if (!resolvedTargets.has(key)) resolvedTargets.set(key, tr.resolved);
    pruned.set(id, tr.mapping);

    // MAP_HASH_CHANGED against the last snapshot of the unit
    try {
      const snap = await store.mappingSnapshots.latestFor(
        unit.objectKey,
        unit.country,
      );
      if (snap && snap.mappingHash !== tr.mapping.mappingHash) {
        const blocking =
          input.mode === "final-delta" && !flags.acceptMappingChange;
        fc.push(
          blocking ? "blocking" : "info",
          "MAP_HASH_CHANGED",
          `materialised mapping hash ${tr.mapping.mappingHash.slice(0, 12)} differs from the last run's ${snap.mappingHash.slice(0, 12)}${blocking ? " (final-delta: pass --accept-mapping-change)" : ""}`,
          { objectKey: unit.objectKey, country: unit.country },
        );
      }
    } catch (e) {
      log.debug({ err: errMessage(e) }, "mappingSnapshots.latestFor failed");
    }
  }

  // ---------------------------------------------------------------- probes
  for (const [dns, tctx] of targets) {
    const currencyName = currencies.get(dns)?.keys().next().value as
      | string
      | undefined;
    await runProbes({
      ctx: tctx,
      config,
      flags,
      store,
      runId,
      findings: fc,
      migrationUserId: config.target.migrationUserId,
      currencyName,
    });
  }

  // ---------------------------------------------------------------- persist + result
  let previous: Finding[] = [];
  try {
    await store.findings.add(runId, fc.findings);
    previous = await store.findings.previous(runId);
  } catch (e) {
    log.warn({ err: errMessage(e) }, "cannot persist findings");
  }

  const result: PreflightResult = {
    runId,
    findings: fc.findings,
    resolvedTargets,
    mappings: pruned,
    blockedUnits: blockedUnits(fc.findings, units),
    blocking: fc.findings.some(isGlobalBlocking),
    source: {
      orgId: sctx.facts.orgId,
      apiVersion: sctx.facts.apiVersion,
      multiCurrency: sctx.facts.multiCurrency,
      personAccounts: sctx.facts.personAccounts,
      territory2: sctx.facts.territory2,
      now: sctx.facts.now,
    },
    countries: new Map(
      [...countries].map(([dns, cw]) => [
        dns,
        cw.entries.map((e) => ({
          iso2: e.iso2,
          sfdcId: e.sfdcId,
          vaultId: e.vaultId,
          name: e.name,
        })),
      ]),
    ),
  };
  const report = buildReport(result, {
    mode: input.mode,
    previous,
    now: now(),
  });
  rlog.info(
    {
      blocking: report.json.summary.blocking,
      warning: report.json.summary.warning,
      info: report.json.summary.info,
      blockedUnits: result.blockedUnits.map(unitId),
      exitCode: report.exitCode,
    },
    "preflight done",
  );
  return {
    ...result,
    newSinceLastRun: newSinceLastRun(fc.findings, previous),
    report,
  };
}

/** `Preflight` implementation (§2.6). */
export class DefaultPreflight implements Preflight {
  constructor(private readonly opts: PreflightOptions = {}) {}
  run(input: PreflightInput): Promise<PreflightResult> {
    return runPreflight(input, this.opts);
  }
}
