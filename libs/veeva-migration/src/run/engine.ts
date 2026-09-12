/**
 * `DefaultRunEngine` — §2.7 run modes end to end:
 *
 *   preflight → (blocking? exit 2) → per §6.1 step: extract → closure →
 *   transform → load (parents of the step in parallel, §8.3) → pass-2
 *   patches → pending-FK rounds (§8.4) → deletes (§4.3 step 5) → reconcile
 *   (§2.8 / §8.8) → watermark advance (§4.1, only when the unit succeeded)
 *   → blob pass (§8.6) → post-load actions → report (§8.5).
 *
 * `--dry-run` never writes to Vault or moves watermarks (§8.9); `verify`
 * is read-only; `retry-failed` re-transforms failed rows from the stored
 * extract of an earlier run; `blobs` re-runs the blob pass for a run;
 * `final-delta` fixes `wm_hi = freezeAt` and applies the gate with
 * tolerance 0 (exit 4 when it fails). A crashed run resumes through
 * `extract_checkpoints`/`row_results` (§8.2) by re-running with the same
 * run directory: the loader skips rows with a terminal state.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { configHash } from "../config/load";
import { resolveCountry, type ResolvedCountryConfig } from "../config/resolve";
import type {
  ExtractFile,
  ExtractManifest,
  ExtractPlan,
  Extractor,
  FkIdSets,
} from "../extract/types";
import { getLogger } from "../logger";
import { DefaultLoader } from "../load/loader";
import {
  listPayloadFiles,
  blobsDir,
  readPayloadFiles,
  readUnitPayloads,
} from "../load/paths";
import { isRetryableRowErrorType } from "../load/retry";
import type {
  DeleteResult,
  LoadPlan,
  LoadResult,
  PayloadRow,
} from "../load/types";
import type { LoaderOptions } from "../load/context";
import type { DeleteOutcome } from "../load/deletes";
import { orderedKeys } from "../objects/registry";
import type { ObjectModule } from "../objects/types";
import { DefaultPreflight } from "../preflight/index";
import {
  FindingCollector,
  loadCurrencies,
  unitVaultDns,
} from "../preflight/index";
import type {
  Preflight,
  PreflightResult,
  ResolvedTarget,
} from "../preflight/types";
import {
  DefaultReconciler,
  loadGateExceptions,
  type GateExceptions,
} from "../reconcile/index";
import type { ReconcileInput, ReconcileResult } from "../reconcile/types";
import type { SfdcClient } from "../sfdc/types";
import type { StateStore } from "../store/types";
import { to15 } from "../transform/ids";
import {
  GLOBAL_COUNTRY,
  unitId,
  type CountryCode,
  type CountryContext,
  type Finding,
  type MaterialisedMapping,
  type ObjectKey,
  type RunRecord,
  type Unit,
} from "../types";
import type { VaultClient } from "../vault/types";
import {
  buildUnitResolver,
  loadErasureList,
  loadTerritoryNames,
  makeCountryContext,
  needsTerritoryNames,
} from "./context";
import { mapLimit, pLimit, type Limit } from "./p-limit";
import { buildPlan, planMappingHash, unitsOf, type PlanDeps } from "./plan";
import {
  renderReport,
  reportFromStore,
  writeReport,
  type RunReportInput,
  type UnitTiming,
} from "./report";
import { RunCancelled, throwIfCancelled } from "../cancel";
import { SimpleExtractor } from "./simple-extractor";
import { transformUnit, type TransformUnitResult } from "./transform";
import {
  EXIT_CODES,
  type ExitCode,
  type RunEngine,
  type RunOptions,
  type RunPlan,
  type RunSummary,
} from "./types";

export const TOOL_VERSION = "0.1.0";
const KEEP_ALIVE_MS = 10 * 60 * 1000;
const DELETE_WINDOW_DAYS = 30;

export interface EngineDeps {
  sfdc: SfdcClient;
  /** Vault client per DNS (§1.2). */
  vaults: Map<string, VaultClient>;
  store: StateStore;
  extractor?: Extractor;
  preflight?: Preflight;
  modules?: PlanDeps["modules"];
  now?: () => Date;
  toolVersion?: string;
  /** Session keep-alive interval (0 disables; default 10 min). */
  keepAliveMs?: number;
  loader?: LoaderOptions;
  /** Print the report path / summary (default stdout). */
  out?: (text: string) => void;
}

interface UnitContext {
  unit: Unit;
  mapping: MaterialisedMapping;
  target: ResolvedTarget;
  module?: ObjectModule;
  cc: ResolvedCountryConfig;
  dns: string;
  vault: VaultClient;
  loader: DefaultLoader;
  loadPlan: LoadPlan;
  country: CountryContext;
}

interface UnitState {
  unit: Unit;
  status: RunSummary["units"][number]["status"];
  reason?: string;
  manifest?: ExtractManifest;
  transform?: TransformUnitResult;
  load?: LoadResult;
  deletes?: DeleteOutcome;
  reconcile?: ReconcileResult;
  window?: { wmLo: string; wmHi: string };
  deletedLatestCovered?: string;
  pendingRounds: number;
  timing: UnitTiming;
  seenModstamps: Map<string, string>;
  deletedIds: Array<{
    sfdcId: string;
    deletedDate: string;
    /** SFDC merge loser → survivor (`MasterRecordId`, §3.4 a). */
    masterRecordId?: string;
  }>;
  pendingTargets?: Record<string, string[]>;
  sampleDiffs?: number;
  blobFiles: string[];
  /** Payload files written by closure loads after the unit's own step (pass 2 still owed, §6.1). */
  closureFiles: string[];
  /** Rows whose pass-2 reference was unresolved when the step ran (re-tried at run end, §3.5). */
  secondPassUnresolved: Set<string>;
}

class RunAbort extends Error {
  constructor(
    public readonly exitCode: ExitCode,
    message: string,
  ) {
    super(message);
    this.name = "RunAbort";
  }
}

function minIso(a: string, b?: string): string {
  return b && b < a ? b : a;
}

function shiftMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

export class DefaultRunEngine implements RunEngine {
  private readonly now: () => Date;
  constructor(private readonly deps: EngineDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  plan(opts: RunOptions): Promise<RunPlan> {
    return buildPlan(opts, {
      modules: this.deps.modules,
      now: opts.now ?? this.now,
    });
  }

  async execute(opts: RunOptions): Promise<RunSummary> {
    const plan = await this.plan(opts);
    const run = new RunExecution(this.deps, opts, plan, this.now);
    return run.execute();
  }
}

class RunExecution {
  private readonly log;
  private readonly runId: string;
  private readonly runDir: string;
  private readonly baseRunDir: string;
  private readonly findings: Finding[] = [];
  private readonly units = new Map<string, UnitState>();
  private readonly contexts = new Map<string, UnitContext>();
  private readonly loaders = new Map<string, DefaultLoader>();
  private readonly closureLocks = new Map<string, Limit>();
  private readonly ccCache = new Map<CountryCode, ResolvedCountryConfig>();
  private readonly countryContexts = new Map<string, CountryContext>();
  private preflight?: PreflightResult;
  private extractor!: Extractor;
  private sfdcNow = "";
  private wmHi = "";
  private keepAlive?: NodeJS.Timeout;
  private exceptions?: GateExceptions;
  private currencies = new Map<string, Map<string, string> | undefined>();
  /** `territory__v` name → id per vault DNS (`territoryRef`), loaded once per run. */
  private readonly territoryNames = new Map<
    string,
    Promise<ReadonlyMap<string, string>>
  >();
  private readonly dryRun: boolean;
  private readonly writes: boolean;

  constructor(
    private readonly deps: EngineDeps,
    private readonly opts: RunOptions,
    private readonly plan: RunPlan,
    private readonly now: () => Date,
  ) {
    this.runId = plan.runId;
    this.dryRun = Boolean(opts.dryRun);
    this.writes =
      !this.dryRun &&
      ["init", "delta", "final-delta", "retry-failed", "blobs"].includes(
        opts.mode,
      );
    // No fallback on purpose. `./runs` relative to the process CWD meant a run
    // started from the web tier wrote wherever the server happened to be, and
    // `staging.runDir` meant a settings form could aim it anywhere. The caller
    // states the directory or there is no run.
    this.baseRunDir = opts.context.runDir;
    this.runDir = path.join(this.baseRunDir, this.runId);
    this.log = getLogger("Run", { run_id: this.runId, mode: opts.mode });
  }

  private cc(country: CountryCode): ResolvedCountryConfig {
    let cc = this.ccCache.get(country);
    if (!cc)
      this.ccCache.set(
        country,
        (cc = resolveCountry(this.opts.config, country)),
      );
    return cc;
  }
  private dnsOf(unit: Unit): string {
    return unitVaultDns(this.opts.config, this.cc(unit.country).target);
  }
  private vaultOf(dns: string): VaultClient {
    const v = this.deps.vaults.get(dns);
    if (!v)
      throw new RunAbort(EXIT_CODES.configError, `no Vault client for ${dns}`);
    return v;
  }
  private out(text: string): void {
    (this.deps.out ?? ((t: string) => process.stdout.write(t + "\n")))(text);
  }
  private mainVault(): VaultClient | undefined {
    return (
      this.deps.vaults.get(this.opts.config.target.vaultDns) ??
      [...this.deps.vaults.values()][0]
    );
  }
  /** Cancellation checkpoint. Cooperative — see `./cancel.ts`. */
  private throwIfCancelled(): void {
    throwIfCancelled(this.opts.context.signal);
  }
  private async audit(
    event: string,
    detail?: Record<string, unknown>,
  ): Promise<void> {
    const entry = {
      runId: this.runId,
      at: this.now().toISOString(),
      actor: this.opts.context.actor,
      event,
      detail,
    };
    try {
      await this.deps.store.auditLog.append(entry);
      await fs.mkdir(this.runDir, { recursive: true });
      await fs.appendFile(
        path.join(this.runDir, "audit.jsonl"),
        JSON.stringify(entry) + "\n",
        "utf8",
      );
    } catch (e) {
      this.log.warn({ err: e }, "audit append failed");
    }
  }

  // ------------------------------------------------------------------ main

  async execute(): Promise<RunSummary> {
    const { opts, plan } = this;
    if (opts.mode === "report") return this.report();
    const store = this.deps.store;
    const startedAt = this.now().toISOString();
    const record: RunRecord = {
      runId: this.runId,
      mode: opts.mode,
      wave: plan.wave ?? null,
      countries: plan.countries,
      startedAt,
      status: "running",
      toolVersion: this.deps.toolVersion ?? TOOL_VERSION,
      configHash: configHash(opts.config),
      mappingHash: planMappingHash(plan),
      sourceOrgId: this.deps.sfdc.orgId,
      sourceApiVersion: this.deps.sfdc.apiVersion,
      targetVaultDns: opts.config.target.vaultDns,
      targetApiVersion: this.mainVault()?.apiVersion ?? null,
      freezeAt: opts.freezeAt ?? null,
      dryRun: this.dryRun,
    };
    await fs.mkdir(this.runDir, { recursive: true });
    await store.runs.create(record);
    await this.audit("run.start", {
      mode: opts.mode,
      wave: plan.wave,
      countries: plan.countries,
      dryRun: this.dryRun,
      configHash: record.configHash,
      mappingHash: record.mappingHash,
      justification: opts.justification,
    });
    let exitCode: ExitCode = EXIT_CODES.success;
    let status: RunRecord["status"] = "succeeded";
    try {
      await this.openSessions();
      if (opts.acceptGateExceptions) {
        this.exceptions = loadGateExceptions(opts.acceptGateExceptions);
        await this.audit("override.accept-gate-exceptions", {
          file: opts.acceptGateExceptions,
          justification: opts.justification,
        });
      }
      if (opts.acceptMappingChange)
        await this.audit("override.accept-mapping-change", {
          justification: opts.justification,
        });
      if (opts.allowMdl)
        await this.audit("override.allow-mdl", {
          justification: opts.justification,
        });
      this.extractor =
        this.deps.extractor ??
        new SimpleExtractor(
          { sfdc: this.deps.sfdc, store },
          { mappings: this.mappingsByKey(), feedEnd: () => this.wmHi },
        );
      if (this.writes) {
        const purged = await store.idMap.purgeDryRun();
        if (purged) this.log.info({ purged }, "dry-run id-map rows purged");
      }
      const pre = await this.runPreflight();
      const blocking = pre.findings.some((f) => f.severity === "blocking");
      if (opts.mode === "preflight") {
        exitCode = blocking ? EXIT_CODES.blockingFindings : EXIT_CODES.success;
        status = blocking ? "blocked" : "succeeded";
      } else if (pre.blocking) {
        exitCode = EXIT_CODES.blockingFindings;
        status = "blocked";
        this.log.error(
          {
            blocking: pre.findings.filter((f) => f.severity === "blocking")
              .length,
          },
          "preflight blocking findings — run stopped",
        );
      } else {
        await this.prepareClocks();
        await this.snapshotMappings();
        for (const unit of unitsOf(plan))
          this.units.set(unitId(unit), this.newUnitState(unit));
        for (const u of pre.blockedUnits) {
          const s = this.units.get(unitId(u));
          if (s) {
            s.status = "blocked";
            s.reason = "blocking preflight finding";
            s.timing.status = "blocked";
            s.timing.reason = s.reason;
          }
        }
        await this.skipFrozenCountries();
        switch (opts.mode) {
          case "init":
          case "delta":
          case "final-delta":
            await this.runLoadModes();
            break;
          case "verify":
            await this.runVerify();
            break;
          case "retry-failed":
            await this.runRetryFailed();
            break;
          case "blobs":
            await this.runBlobsMode();
            break;
        }
        exitCode = this.computeExitCode();
        status =
          exitCode === EXIT_CODES.success
            ? "succeeded"
            : exitCode === EXIT_CODES.blockingFindings
              ? "blocked"
              : "failed";
      }
    } catch (e) {
      if (e instanceof RunCancelled) {
        exitCode = EXIT_CODES.aborted;
        status = "aborted";
        // `warning`, not `blocking`: the run is incomplete, but nothing about
        // it is wrong, and a blocking finding would gate the next stage.
        this.findings.push({
          severity: "warning",
          code: "RUN_CANCELLED",
          detail: e.message,
        });
        this.log.warn("run cancelled by caller");
      } else if (e instanceof RunAbort) {
        exitCode = e.exitCode;
        status =
          exitCode === EXIT_CODES.blockingFindings ? "blocked" : "failed";
        this.findings.push({
          severity: "blocking",
          code: "RUN_ABORTED",
          detail: e.message,
        });
        this.log.error({ err: e }, "run aborted");
      } else {
        exitCode = EXIT_CODES.unitFailures;
        status = "failed";
        this.findings.push({
          severity: "blocking",
          code: "RUN_ERROR",
          detail: (e as Error).message,
        });
        this.log.error({ err: e }, "run failed");
      }
    } finally {
      await this.closeSessions();
    }
    const finishedAt = this.now().toISOString();
    try {
      if (this.findings.length)
        await store.findings.add(this.runId, this.findings);
      await store.runs.update(this.runId, {
        status,
        finishedAt,
        sfdcNowAtStart: this.sfdcNow || null,
      });
    } catch (e) {
      this.log.warn({ err: e }, "cannot finalise run record");
    }
    await this.audit("run.end", { status, exitCode });
    const reportPath = await this.writeRunReport(
      { ...record, status, finishedAt, sfdcNowAtStart: this.sfdcNow || null },
      exitCode,
    );
    const summary: RunSummary = {
      runId: this.runId,
      mode: opts.mode,
      exitCode,
      units: [...this.units.values()].map((u) => ({
        unit: u.unit,
        status: u.status,
        reason: u.reason,
      })),
      reportPath,
    };
    this.out(
      `run ${this.runId} ${status} (exit ${exitCode}) — report: ${reportPath}`,
    );
    return summary;
  }

  private computeExitCode(): ExitCode {
    const states = [...this.units.values()];
    if (states.some((u) => u.status === "failed"))
      return EXIT_CODES.unitFailures;
    if (
      this.opts.mode === "final-delta" &&
      states.some((u) => u.reconcile && !u.reconcile.pass)
    )
      return EXIT_CODES.gateFailed;
    if (
      this.opts.mode === "verify" &&
      states.some((u) => u.reconcile && !u.reconcile.pass)
    )
      return EXIT_CODES.gateFailed;
    return EXIT_CODES.success;
  }

  private newUnitState(unit: Unit): UnitState {
    return {
      unit,
      status: "skipped",
      pendingRounds: 0,
      timing: { unit, status: "skipped" },
      seenModstamps: new Map(),
      deletedIds: [],
      blobFiles: [],
      closureFiles: [],
      secondPassUnresolved: new Set(),
    };
  }

  // -------------------------------------------------------------- sessions

  private async openSessions(): Promise<void> {
    for (const [dns, vault] of this.deps.vaults) {
      try {
        await vault.authenticate();
      } catch (e) {
        this.findings.push({
          severity: "blocking",
          code: "VT_AUTH_FAILED",
          detail: `${dns}: ${(e as Error).message}`,
        });
        throw new RunAbort(
          EXIT_CODES.blockingFindings,
          `Vault authentication failed for ${dns}`,
        );
      }
    }
    const ms = this.deps.keepAliveMs ?? KEEP_ALIVE_MS;
    if (ms > 0) {
      this.keepAlive = setInterval(() => {
        for (const v of this.deps.vaults.values())
          v.keepAlive().catch((e) =>
            this.log.warn({ err: e }, "keep-alive failed"),
          );
      }, ms);
      this.keepAlive.unref?.();
    }
  }

  private async closeSessions(): Promise<void> {
    if (this.keepAlive) clearInterval(this.keepAlive);
    for (const v of this.deps.vaults.values()) {
      try {
        if (v.session) await v.endSession();
      } catch (e) {
        this.log.debug({ err: e }, "endSession failed");
      }
    }
  }

  // ------------------------------------------------------------- preflight

  private async runPreflight(): Promise<PreflightResult> {
    const preflight =
      this.deps.preflight ?? new DefaultPreflight({ now: this.now });
    const result = await preflight.run({
      runId: this.runId,
      mode: this.opts.mode,
      config: this.opts.config,
      units: unitsOf(this.plan),
      mappings: this.plan.mappings,
      sfdc: this.deps.sfdc,
      vaults: this.deps.vaults,
      store: this.deps.store,
      flags: {
        dryRun: this.dryRun,
        probeWrites: this.opts.probeWrites,
        allowMdl: this.opts.allowMdl,
        allowPicklistCreate: this.opts.allowPicklistCreate,
        allowPicklistReactivate: this.opts.allowPicklistReactivate,
        acceptMappingChange: this.opts.acceptMappingChange,
        reprobe: this.opts.reprobe,
      },
    });
    this.preflight = result;
    // pruned mappings replace the planned ones
    for (const [id, m] of result.mappings) this.plan.mappings.set(id, m);
    for (const dns of result.countries.keys()) {
      const vault = this.deps.vaults.get(dns);
      if (vault && !this.currencies.has(dns) && result.source.multiCurrency)
        this.currencies.set(
          dns,
          await loadCurrencies(vault, new FindingCollector()),
        );
    }
    this.log.info(
      {
        findings: result.findings.length,
        blocking: result.blocking,
        blocked_units: result.blockedUnits.length,
      },
      "preflight done",
    );
    return result;
  }

  private async prepareClocks(): Promise<void> {
    const cfg = this.opts.config;
    this.sfdcNow = await this.deps.sfdc.serverNow();
    let wmHi = shiftMinutes(this.sfdcNow, -cfg.delta.safetyLagMinutes);
    if (this.opts.mode === "final-delta") {
      const freezeAt =
        this.opts.freezeAt ??
        cfg.waves.find((w) => w.name === this.plan.wave)?.freezeAt;
      if (!freezeAt)
        throw new RunAbort(
          EXIT_CODES.configError,
          "final-delta requires --freeze-at (or waves[].freezeAt)",
        );
      wmHi = minIso(wmHi, new Date(freezeAt).toISOString());
      await this.deps.store.runs.update(this.runId, { freezeAt: wmHi });
    }
    this.wmHi = wmHi;
    await this.deps.store.runs.update(this.runId, {
      sfdcNowAtStart: this.sfdcNow,
    });
    this.log.info(
      { sfdc_now: this.sfdcNow, wm_hi: wmHi },
      "clocks fixed for the run",
    );
  }

  private async snapshotMappings(): Promise<void> {
    if (this.dryRun) return;
    const createdAt = this.now().toISOString();
    for (const [id, m] of this.plan.mappings) {
      try {
        await this.deps.store.mappingSnapshots.put({
          mappingHash: m.mappingHash,
          objectKey: m.objectKey,
          country: m.country,
          materialised: m,
          createdAt,
        });
      } catch (e) {
        this.log.warn({ unit: id, err: e }, "mapping snapshot not stored");
      }
    }
  }

  private async skipFrozenCountries(): Promise<void> {
    if (this.opts.unfreeze) return;
    for (const c of this.plan.countries) {
      if (!(await this.deps.store.countryStatus.isFrozen(c))) continue;
      for (const s of this.units.values())
        if (s.unit.country === c && s.status !== "blocked") {
          s.status = "skipped";
          s.reason = "country frozen after sign-off (§4.5) — pass --unfreeze";
          s.timing.status = "skipped";
          s.timing.reason = s.reason;
        }
      this.findings.push({
        severity: "info",
        code: "COUNTRY_FROZEN",
        country: c,
        detail: "frozen country skipped",
      });
    }
  }

  // ------------------------------------------------------------- contexts

  private mappingsByKey(
    country?: CountryCode,
  ): Map<ObjectKey, MaterialisedMapping> {
    const out = new Map<ObjectKey, MaterialisedMapping>();
    for (const m of this.plan.mappings.values())
      if (!country || m.country === country || m.country === GLOBAL_COUNTRY)
        out.set(m.objectKey, m);
    return out;
  }

  private targetOf(unit: Unit): ResolvedTarget | undefined {
    const dns = this.dnsOf(unit);
    const rt = this.preflight?.resolvedTargets;
    return rt?.get(`${unit.objectKey}@${dns}`) ?? rt?.get(unit.objectKey);
  }

  private countryContext(unit: Unit): CountryContext {
    const dns = this.dnsOf(unit);
    const key = `${unit.country}@${dns}`;
    let ctx = this.countryContexts.get(key);
    if (!ctx) {
      const cc = this.cc(unit.country);
      ctx = makeCountryContext({
        cc,
        iso2: unit.country,
        crosswalk: this.preflight?.countries.get(dns),
        currencies: this.currencies.get(dns),
        erased: loadErasureList(cc.privacy.erasureListPath),
      });
      this.countryContexts.set(key, ctx);
    }
    return ctx;
  }

  private loaderFor(dns: string, unit: Unit): DefaultLoader {
    let l = this.loaders.get(dns);
    if (!l) {
      l = new DefaultLoader(
        {
          vault: this.vaultOf(dns),
          store: this.deps.store,
          country: unit.country,
          targetObjectOf: (key) =>
            this.targetOf({ objectKey: key, country: unit.country })
              ?.targetObject,
        },
        {
          ...this.deps.loader,
          signal: this.opts.context.signal,
          now: this.now,
          blobBatchBytes:
            this.deps.loader?.blobBatchBytes ??
            this.opts.config.performance.blobBatchBytes,
        },
      );
      this.loaders.set(dns, l);
    }
    return l;
  }

  /** Context for a unit; parents outside the plan (closure) are materialised on demand. */
  private unitContext(unit: Unit): UnitContext | undefined {
    const id = unitId(unit);
    const cached = this.contexts.get(id);
    if (cached) return cached;
    const mapping = this.plan.mappings.get(id);
    const mod = this.plan.modules.get(unit.objectKey);
    if (!mapping) {
      const globalMapping = this.plan.mappings.get(
        unitId({ objectKey: unit.objectKey, country: GLOBAL_COUNTRY }),
      );
      if (globalMapping)
        return this.unitContext({
          objectKey: unit.objectKey,
          country: GLOBAL_COUNTRY,
        });
      return undefined;
    }
    const target = this.targetOf(unit);
    if (!target) return undefined;
    const cc = this.cc(unit.country);
    const dns = this.dnsOf(unit);
    const vault = this.vaultOf(dns);
    const loader = this.loaderFor(dns, unit);
    const cfg = this.opts.config;
    const loadPlan: LoadPlan = {
      runId: this.runId,
      unit,
      mapping,
      target,
      runDir: this.runDir,
      dryRun: this.dryRun,
      migrationMode: cc.target.migrationMode ?? cfg.target.migrationMode,
      unchangedFieldBehavior:
        cc.target.unchangedFieldBehavior ?? cfg.target.unchangedFieldBehavior,
      migrationUserId: cc.target.migrationUserId ?? cfg.target.migrationUserId,
      batchSize: cfg.performance.vaultBatch,
      batchWallTimeMs: cfg.performance.batchWallTimeMs,
    };
    const ctx: UnitContext = {
      unit,
      mapping,
      target,
      module: mod,
      cc,
      dns,
      vault,
      loader,
      loadPlan,
      country: this.countryContext(unit),
    };
    this.contexts.set(id, ctx);
    return ctx;
  }

  private state(unit: Unit): UnitState {
    const id = unitId(unit);
    let s = this.units.get(id);
    if (!s) this.units.set(id, (s = this.newUnitState(unit)));
    return s;
  }

  /** `territoryRef` input (§6.3.12): the vault's `territory__v` names, loaded once per DNS. */
  private territoriesFor(
    ctx: UnitContext,
  ): Promise<ReadonlyMap<string, string>> | undefined {
    if (!needsTerritoryNames(ctx.mapping)) return undefined;
    let p = this.territoryNames.get(ctx.dns);
    if (!p) {
      const object =
        this.targetOf({ objectKey: "territory", country: ctx.unit.country })
          ?.targetObject ?? "territory__v";
      p = loadTerritoryNames(ctx.vault, object)
        .then((r) => {
          if (r.duplicates.length)
            this.findings.push({
              severity: "warning",
              code: "TERRITORY_NAME_AMBIGUOUS",
              objectKey: "territory",
              detail: {
                duplicates: r.duplicates.length,
                sample: r.duplicates.slice(0, 10),
              },
              count: r.duplicates.length,
            });
          this.log.info(
            { dns: ctx.dns, territories: r.byName.size },
            "territory names loaded",
          );
          return r.byName;
        })
        .catch((e: Error) => {
          this.findings.push({
            severity: "warning",
            code: "TERRITORY_NAMES_UNAVAILABLE",
            objectKey: "territory",
            detail: e.message,
          });
          return new Map<string, string>();
        });
      this.territoryNames.set(ctx.dns, p);
    }
    return p;
  }

  // ------------------------------------------------------------ load modes

  private async runLoadModes(): Promise<void> {
    const cfg = this.opts.config;
    const concurrency = cfg.performance.vaultConcurrency;
    for (const step of this.plan.steps) {
      this.throwIfCancelled();
      const runnable = step.units.filter((u) => {
        const s = this.state(u);
        return s.status !== "blocked" && !(s.status === "skipped" && s.reason);
      });
      this.log.info(
        { step: step.index, keys: step.keys, units: runnable.length },
        "step start",
      );
      await mapLimit(runnable, concurrency, (u) => this.runUnit(u));
      // pass 2 after the step (§6.1)
      for (const p of step.pass2) {
        for (const u of runnable.filter((x) => x.objectKey === p.objectKey)) {
          const s = this.state(u);
          if (s.status !== "succeeded") continue;
          const ctx = this.unitContext(u)!;
          // the unit directory holds this step's closure files too
          s.closureFiles.length = 0;
          await this.secondPass(
            ctx,
            s,
            readUnitPayloads(this.runDir, u),
            p.target,
          );
        }
      }
      // parents of earlier steps that received closure rows in this step still owe their pass 2
      await this.closureSecondPass(step.index);
      // pending FK rounds for earlier units (§8.4)
      await this.pendingRound();
    }
    await this.pendingRound(true);
    await this.retrySecondPass();
    for (const s of this.units.values())
      if (s.status === "succeeded") await this.applyUnitDeletes(s);
    for (const s of this.units.values())
      if (s.status === "succeeded" || s.status === "failed")
        await this.reconcileUnit(s);
    await this.advanceWatermarks();
    await this.blobPass();
    await this.postLoad();
    for (const l of this.loaders.values())
      this.findings.push(...l.drainFindings());
  }

  /** One pass-2 run over `rows` for a unit; findings + unresolved bookkeeping (§6.1, §3.5). */
  private async secondPass(
    ctx: UnitContext,
    s: UnitState,
    rows: AsyncIterable<PayloadRow>,
    field?: string,
  ): Promise<void> {
    try {
      const r = await ctx.loader.secondPass(rows, ctx.loadPlan);
      for (const id of r.unresolvedIds) s.secondPassUnresolved.add(id);
      if (r.unresolved)
        this.findings.push({
          severity: "warning",
          code: "SECOND_PASS_UNRESOLVED",
          objectKey: s.unit.objectKey,
          country: s.unit.country,
          field,
          detail: { unresolved: r.unresolved, patched: r.patched },
          count: r.unresolved,
        });
      if (r.failed)
        this.findings.push({
          severity: "warning",
          code: "SECOND_PASS_FAILED",
          objectKey: s.unit.objectKey,
          country: s.unit.country,
          field,
          detail: { failed: r.failed },
          count: r.failed,
        });
    } catch (e) {
      this.failUnit(s, `second pass: ${(e as Error).message}`);
    }
  }

  private pass2Targets(key: ObjectKey): string[] {
    return this.plan.steps
      .flatMap((st) => st.pass2)
      .filter((p) => p.objectKey === key)
      .map((p) => p.target);
  }

  /**
   * Closure rows land in parent units *after* the parent's step ran its pass 2
   * (children of later steps fetch them), so their self references would never
   * be patched — and the hash skip would hide them from every later run.
   */
  private async closureSecondPass(stepIndex: number): Promise<void> {
    for (const s of this.units.values()) {
      if (!s.closureFiles.length || s.status !== "succeeded") continue;
      const inStep = this.plan.steps.some(
        (st) => st.index === stepIndex && st.keys.includes(s.unit.objectKey),
      );
      if (inStep) continue; // covered by the step's own pass 2 (whole unit dir)
      const targets = this.pass2Targets(s.unit.objectKey);
      const files = s.closureFiles.splice(0);
      if (!targets.length) continue;
      const ctx = this.unitContext(s.unit);
      if (!ctx) continue;
      this.log.info(
        { unit: unitId(s.unit), files: files.length, fields: targets },
        "pass 2 for closure-loaded rows",
      );
      await this.secondPass(ctx, s, readPayloadFiles(files), targets[0]);
    }
  }

  /** §3.5: pass-2 references unresolved at step time are re-tried once every unit landed. */
  private async retrySecondPass(): Promise<void> {
    for (const s of this.units.values()) {
      if (!s.secondPassUnresolved.size || s.status !== "succeeded") continue;
      const ctx = this.unitContext(s.unit);
      if (!ctx) continue;
      const ids = new Set(s.secondPassUnresolved);
      s.secondPassUnresolved.clear();
      const rows = (async function* (runDir: string, unit: Unit) {
        for await (const r of readUnitPayloads(runDir, unit))
          if (ids.has(r.sfdcId)) yield r;
      })(this.runDir, s.unit);
      this.log.info(
        { unit: unitId(s.unit), rows: ids.size },
        "retrying unresolved pass-2 references",
      );
      await this.secondPass(ctx, s, rows);
    }
  }

  private failUnit(s: UnitState, reason: string): void {
    s.status = "failed";
    s.reason = reason;
    s.timing.status = "failed";
    s.timing.reason = reason;
    this.findings.push({
      severity: "warning",
      code: "LOAD_UNIT_FAILED",
      objectKey: s.unit.objectKey,
      country: s.unit.country,
      detail: reason,
    });
  }

  private async runUnit(unit: Unit): Promise<void> {
    this.throwIfCancelled();
    const s = this.state(unit);
    const ctx = this.unitContext(unit);
    const started = Date.now();
    const log = getLogger("Run", {
      run_id: this.runId,
      object_key: unit.objectKey,
      country: unit.country,
    });
    if (!ctx) {
      this.failUnit(s, "no resolved target for the unit");
      return;
    }
    try {
      // §4.1 window
      const extractPlan = await this.extractPlan(ctx, s);
      if (!extractPlan) return;
      const t0 = Date.now();
      let manifest = await this.extractor.extractUnit(unit, extractPlan);
      // §2.8 extract completeness: mismatch → re-run with PK chunking; a second mismatch is blocking
      if (countMismatch(manifest, extractPlan)) {
        this.findings.push({
          severity: "warning",
          code: "EXTRACT_COUNT_MISMATCH",
          objectKey: unit.objectKey,
          country: unit.country,
          detail: {
            sfdcScopeCount: manifest.sfdcScopeCount,
            extractedLive: manifest.extractedLive,
            action: "re-extract with PK chunking",
          },
        });
        log.warn(
          {
            scope_count: manifest.sfdcScopeCount,
            extracted: manifest.extractedLive,
          },
          "extract count mismatch — re-extracting with PK chunking",
        );
        manifest = await this.extractor.extractUnit(unit, {
          ...extractPlan,
          pkChunking: true,
        });
        if (countMismatch(manifest, extractPlan)) {
          this.findings.push({
            severity: "blocking",
            code: "EXTRACT_COUNT_MISMATCH",
            objectKey: unit.objectKey,
            country: unit.country,
            detail: {
              sfdcScopeCount: manifest.sfdcScopeCount,
              extractedLive: manifest.extractedLive,
              action: "unit failed; watermark not advanced",
            },
          });
          s.manifest = manifest;
          s.timing.extractMs = Date.now() - t0;
          this.failUnit(
            s,
            `EXTRACT_COUNT_MISMATCH: COUNT() = ${manifest.sfdcScopeCount} but ${manifest.extractedLive} live rows extracted after PK chunking`,
          );
          return;
        }
      }
      s.manifest = manifest;
      s.timing.extractMs = Date.now() - t0;
      s.deletedIds.push(
        ...manifest.deletedIds.map((d) => ({
          sfdcId: d.id,
          deletedDate: d.deletedDate,
          masterRecordId: masterOf(d),
        })),
      );
      s.deletedLatestCovered = manifest.deletedLatestCovered;
      if (manifest.queueOwners.size)
        this.findings.push({
          severity: "info",
          code: "QUEUE_OWNER_REPLACED",
          objectKey: unit.objectKey,
          country: unit.country,
          detail: { queues: manifest.queueOwners.size },
          count: manifest.queueOwners.size,
        });
      // §2.2 step 5 closure
      await this.closure(ctx, manifest);
      // transform + load (partition by partition, §2.2 step 9)
      const groups = new Map<number, ExtractFile[]>();
      for (const f of manifest.files)
        (
          groups.get(f.partition ?? 0) ??
          groups.set(f.partition ?? 0, []).get(f.partition ?? 0)!
        ).push(f);
      const partitions = [...groups.keys()].sort((a, b) => a - b);
      let load: LoadResult | undefined;
      for (const p of partitions.length ? partitions : [0]) {
        const files = groups.get(p) ?? [];
        const r = await this.transformAndLoad(ctx, s, files, {
          prefix: p ? `p${p}-` : "",
        });
        load = load ? mergeLoad(load, r.load) : r.load;
        if (r.load.aborted) break;
      }
      s.load = load;
      if (load?.aborted) {
        this.failUnit(s, `load aborted: ${load.aborted.reason}`);
      } else {
        s.status = "succeeded";
        s.timing.status = "succeeded";
      }
    } catch (e) {
      // A cancellation stops the run; it does not fail the unit. Marking it
      // failed would leave a row `retry-failed` picks up later, re-applying
      // work the operator deliberately stopped.
      if (e instanceof RunCancelled) throw e;
      log.error({ err: e }, "unit failed");
      this.failUnit(s, (e as Error).message);
    } finally {
      s.timing.elapsedMs = Date.now() - started;
      s.timing.batches = s.load?.batches.length;
    }
  }

  private async extractPlan(
    ctx: UnitContext,
    s: UnitState,
  ): Promise<ExtractPlan | undefined> {
    const { unit, mapping, target } = ctx;
    const cfg = this.opts.config;
    const mode = this.opts.mode as ExtractPlan["mode"];
    const cutoffDate =
      mapping.scope.cutoffDate ??
      this.plan.cutoffDates.get(unit.country) ??
      this.plan.cutoffDates.get(GLOBAL_COUNTRY);
    const plan: ExtractPlan = {
      runId: this.runId,
      mode,
      runDir: this.runDir,
      mapping,
      target,
      cutoffDate,
      limit: this.dryRun ? this.opts.limit : undefined,
    };
    if (mode === "delta" || mode === "final-delta") {
      const wm = await this.deps.store.watermarks.get(
        unit.objectKey,
        unit.country,
        "modstamp",
      );
      if (!wm) {
        this.findings.push({
          severity: "warning",
          code: "DELTA_NO_WATERMARK",
          objectKey: unit.objectKey,
          country: unit.country,
          detail:
            "no modstamp watermark — unit extracted in full (init semantics)",
        });
      } else if (wm.cutoffDate && cutoffDate && cutoffDate < wm.cutoffDate) {
        // wider scope than the last run (§4.1): rows that aged into scope are only found by a full re-extract
        this.findings.push({
          severity: "warning",
          code: "SCOPE_CUTOFF_CHANGED",
          objectKey: unit.objectKey,
          country: unit.country,
          detail: {
            previous: wm.cutoffDate,
            current: cutoffDate,
            action: "full re-extract",
          },
        });
        // the delete feed still covers only the window since the last run (§4.3 step 1):
        // without it the `deleted` watermark would jump to wm_hi and lose those deletes
        const del = await this.deps.store.watermarks.get(
          unit.objectKey,
          unit.country,
          "deleted",
        );
        plan.deletedSince =
          del?.value ?? shiftMinutes(wm.value, -cfg.delta.overlapMinutes);
        plan.deletedUntil = this.wmHi;
      } else {
        const wmLo = shiftMinutes(wm.value, -cfg.delta.overlapMinutes);
        if (wmLo >= this.wmHi) {
          this.log.info({ wm_lo: wmLo, wm_hi: this.wmHi }, "window empty");
        }
        plan.window = { wmLo, wmHi: this.wmHi };
        s.window = plan.window;
        const del = await this.deps.store.watermarks.get(
          unit.objectKey,
          unit.country,
          "deleted",
        );
        const deletedSince = del?.value ?? wmLo;
        const ageDays =
          (new Date(this.wmHi).getTime() - new Date(deletedSince).getTime()) /
          86_400_000;
        if (target.replicateable && ageDays > DELETE_WINDOW_DAYS) {
          const detail = {
            deletedSince,
            wmHi: this.wmHi,
            days: Math.floor(ageDays),
          };
          if (mode === "delta") {
            this.findings.push({
              severity: "blocking",
              code: "DELETE_WINDOW_EXCEEDED",
              objectKey: unit.objectKey,
              country: unit.country,
              detail,
            });
            s.status = "blocked";
            s.reason = "DELETE_WINDOW_EXCEEDED: run verify first";
            s.timing.status = "blocked";
            s.timing.reason = s.reason;
            return undefined;
          }
          this.findings.push({
            severity: "warning",
            code: "DELETE_WINDOW_EXCEEDED",
            objectKey: unit.objectKey,
            country: unit.country,
            detail,
          });
        }
        plan.deletedSince = deletedSince;
      }
    }
    return plan;
  }

  private async closure(
    ctx: UnitContext,
    manifest: ExtractManifest,
  ): Promise<void> {
    const cfg = this.opts.config;
    const needed: FkIdSets = new Map();
    for (const [key, ids] of manifest.fkSets) {
      if (key === "user" || !ids.size) continue;
      needed.set(key, new Set(ids));
    }
    if (!needed.size) return;
    // subtract this unit's own extract (self references)
    const own = needed.get(ctx.unit.objectKey);
    if (own?.size) {
      for await (const { row } of this.extractor.readRows(manifest.files))
        own.delete(row.Id);
    }
    // dry run (§8.9): parents simulated earlier in this run carry `dry_run` id-map rows,
    // which the extractor's own id-map subtraction deliberately ignores
    if (this.dryRun)
      for (const [key, ids] of needed) {
        const list = [...ids];
        for (let i = 0; i < list.length; i += 500) {
          const got = await this.deps.store.idMap.bulkGet(
            key as ObjectKey,
            list.slice(i, i + 500),
          );
          for (const r of got.values()) if (r.dryRun) ids.delete(r.sfdcId);
        }
      }
    const country = ctx.unit.country;
    const mappings = this.mappingsByKey(country);
    const targets = new Map<ObjectKey, ResolvedTarget>();
    for (const key of needed.keys()) {
      const t = this.targetOf({ objectKey: key, country });
      if (t) targets.set(key, t);
    }
    const result = await this.extractor.closure({
      runId: this.runId,
      country,
      runDir: this.runDir,
      needed,
      mappings,
      targets,
      maxRounds: cfg.extract.closureMaxRounds,
      strategy: cfg.extract.closureStrategy,
    });
    if (
      result.rounds >= cfg.extract.closureMaxRounds &&
      [...result.dangling.values()].some((d) => d.size)
    )
      this.findings.push({
        severity: "warning",
        code: "CLOSURE_MAX_ROUNDS",
        objectKey: ctx.unit.objectKey,
        country,
        detail: { rounds: result.rounds },
      });
    for (const [key, ids] of result.dangling)
      if (ids.size)
        this.findings.push({
          severity: "info",
          code: "CLOSURE_DANGLING",
          objectKey: key,
          country,
          detail: {
            referencedBy: ctx.unit.objectKey,
            sample: [...ids].slice(0, 10),
          },
          count: ids.size,
        });
    if (!result.files.size) return;
    // load closure rows parents-first (their own dependencies landed in earlier steps)
    const order = orderedKeys(
      Object.fromEntries([...this.plan.modules].map(([k, m]) => [k, m])),
      [...this.plan.modules.keys()],
    );
    const keys = [...result.files.keys()].sort(
      (a, b) => order.indexOf(a) - order.indexOf(b),
    );
    for (const key of keys) {
      const files = result.files.get(key)!;
      const parentUnit: Unit = {
        objectKey: key,
        country: this.plan.mappings.has(unitId({ objectKey: key, country }))
          ? country
          : GLOBAL_COUNTRY,
      };
      const pctx = this.unitContext(parentUnit);
      const pstate = this.units.get(unitId(parentUnit));
      const unavailable = !pctx
        ? "no resolved target"
        : pstate?.status === "blocked"
          ? (pstate.reason ?? "blocked by preflight")
          : pstate?.status === "skipped" && pstate.reason
            ? pstate.reason
            : undefined;
      if (!pctx || unavailable) {
        // a blocked/frozen parent unit never receives writes (§4.5, preflight blocking)
        this.findings.push({
          severity: "warning",
          code: "CLOSURE_PARENT_UNAVAILABLE",
          objectKey: key,
          country,
          detail: {
            referencedBy: ctx.unit.objectKey,
            reason: unavailable,
            rows: files.reduce((a, f) => a + f.rows, 0),
          },
        });
        continue;
      }
      const lock =
        this.closureLocks.get(unitId(parentUnit)) ??
        this.closureLocks
          .set(unitId(parentUnit), pLimit(1))
          .get(unitId(parentUnit))!;
      await lock(async () => {
        const ps = this.state(parentUnit);
        const r = await this.transformAndLoad(pctx, ps, files, {
          prefix: `closure-${ctx.unit.objectKey}-${result.rounds}-${Date.now().toString(36)}-`,
        });
        ps.load = ps.load ? mergeLoad(ps.load, r.load) : r.load;
        ps.closureFiles.push(...r.transform.payloadFiles);
        if (ps.manifest) ps.manifest.closureRows += r.transform.closureRows;
        else
          ps.manifest = {
            ...emptyManifest(parentUnit),
            closureRows: r.transform.closureRows,
          };
        if (ps.status === "skipped" && !ps.reason) {
          ps.status = "succeeded";
          ps.timing.status = "succeeded";
        }
        if (r.load.aborted)
          this.failUnit(ps, `closure load aborted: ${r.load.aborted.reason}`);
      });
    }
  }

  private async transformAndLoad(
    ctx: UnitContext,
    s: UnitState,
    files: readonly ExtractFile[],
    o: { prefix: string; onlyIds?: ReadonlySet<string> },
  ): Promise<{ transform: TransformUnitResult; load: LoadResult }> {
    const { unit, mapping, target } = ctx;
    const t1 = Date.now();
    const ids = await buildUnitResolver(
      this.deps.store,
      mapping,
      files,
      this.extractor,
      { territories: await this.territoriesFor(ctx), dryRun: this.dryRun },
    );
    const transform = await transformUnit({
      runId: this.runId,
      unit,
      mapping,
      metadata: target.metadata,
      module: ctx.module,
      runDir: this.runDir,
      runMode: this.opts.mode,
      files,
      extractor: this.extractor,
      store: this.deps.store,
      country: ctx.country,
      ids,
      migrationUserId: ctx.loadPlan.migrationUserId,
      orgId15: to15(this.deps.sfdc.orgId),
      dryRun: this.dryRun,
      onlyIds: o.onlyIds,
      // last-wins (§4.3 step 5) only needs the modstamps of ids in the delete queue
      modstampIds: new Set(s.deletedIds.map((d) => d.sfdcId)),
      filePrefix: o.prefix,
      now: this.now,
    });
    s.transform = s.transform
      ? mergeTransform(s.transform, transform)
      : transform;
    for (const [k, v] of transform.seenModstamps) s.seenModstamps.set(k, v);
    s.blobFiles.push(...transform.blobFiles);
    s.timing.transformMs = (s.timing.transformMs ?? 0) + (Date.now() - t1);
    for (const [code, n] of Object.entries(transform.diagnostics))
      if (
        [
          "CONTACT_REF_DROPPED",
          "QUEUE_OWNER_REPLACED",
          "AUDIT_USER_FALLBACK",
          "UNMAPPED_USER",
          "SF_DATETIME_RANGE",
          "TRUNCATED",
        ].includes(code)
      )
        this.findings.push({
          severity: "info",
          code,
          objectKey: unit.objectKey,
          country: unit.country,
          detail: { rows: n },
          count: n,
        });
    const t2 = Date.now();
    const load = await ctx.loader.loadBatches(
      readPayloadFiles(transform.payloadFiles),
      ctx.loadPlan,
    );
    s.timing.loadMs = (s.timing.loadMs ?? 0) + (Date.now() - t2);
    return { transform, load };
  }

  private async pendingRound(final = false): Promise<void> {
    const max = this.opts.config.pendingFk.maxRounds;
    for (const s of this.units.values()) {
      if (s.status !== "succeeded") continue;
      const ctx = this.unitContext(s.unit);
      if (!ctx) continue;
      const pending = await this.deps.store.pendingFk
        .countUnresolved(this.runId, s.unit.objectKey, s.unit.country)
        .catch(() => 0);
      const queued = pending > 0 || (s.load?.pendingFk ?? 0) > 0;
      if (queued && s.pendingRounds < max) {
        s.pendingRounds++;
        const r = await ctx.loader.retryPending(ctx.loadPlan, s.pendingRounds);
        if (s.load) s.load = mergeLoad(s.load, { ...r, pendingFk: 0 });
        if (r.aborted)
          this.failUnit(s, `pending retry aborted: ${r.aborted.reason}`);
      }
      if (final) {
        const fin = await ctx.loader.finalisePending(ctx.loadPlan);
        if (fin.failed) s.pendingTargets = fin.targets;
      }
    }
  }

  private async applyUnitDeletes(s: UnitState): Promise<void> {
    const ctx = this.unitContext(s.unit);
    if (!ctx || !s.deletedIds.length) return;
    const policy = ctx.mapping.options.deletePolicy;
    try {
      s.deletes = await ctx.loader.applyDeletesDetailed(
        {
          unit: s.unit,
          policy,
          ids: s.deletedIds,
          seenModstamps: s.seenModstamps,
        },
        ctx.loadPlan,
      );
      // §3.4 a / §4.2: SFDC merges — loser → survivor in the id map, children re-pointed
      const merges = s.deletedIds
        .filter((d) => d.masterRecordId)
        .map((d) => ({
          loser: d.sfdcId,
          survivor: d.masterRecordId!,
          deletedDate: d.deletedDate,
        }));
      if (merges.length) {
        const m = await ctx.loader.applyMerges(
          { unit: s.unit, merges, seenModstamps: s.seenModstamps },
          ctx.loadPlan,
        );
        this.findings.push({
          severity: "info",
          code: "ACCOUNT_MERGED",
          objectKey: s.unit.objectKey,
          country: s.unit.country,
          detail: {
            merged: m.merged,
            childrenRepointed: m.childrenRepointed,
            childrenFailed: m.childrenFailed,
            skipped: m.skipped,
          },
          count: m.merged,
        });
        if (m.childrenFailed)
          this.findings.push({
            severity: "warning",
            code: "MERGE_FANOUT_FAILED",
            objectKey: s.unit.objectKey,
            country: s.unit.country,
            detail: { childrenFailed: m.childrenFailed },
            count: m.childrenFailed,
          });
      }
      if (s.deletes.ignored)
        this.findings.push({
          severity: "info",
          code: policy === "ignore" ? "DELETE_IGNORED" : "DELETE_NOT_APPLIED",
          objectKey: s.unit.objectKey,
          country: s.unit.country,
          detail: countBy(s.deletes.ignoredDetail.map((d) => d.reason)),
          count: s.deletes.ignored,
        });
    } catch (e) {
      this.failUnit(s, `deletes: ${(e as Error).message}`);
    }
  }

  private reconcileInput(
    ctx: UnitContext,
    s: UnitState,
    tolerance: number,
    sampleSize: number,
  ): ReconcileInput {
    const crosswalk = this.preflight?.countries
      .get(ctx.dns)
      ?.find((c) => c.iso2 === ctx.unit.country);
    const pred =
      crosswalk?.vaultId &&
      ctx.target.metadata.fields.country__v?.type === "object"
        ? `country__v = '${crosswalk.vaultId}'`
        : undefined;
    return {
      runId: this.runId,
      unit: ctx.unit,
      mapping: ctx.mapping,
      target: ctx.target,
      manifest: s.manifest,
      load: s.load,
      deletes: s.deletes ? stripDeletes(s.deletes) : undefined,
      tolerance,
      sampleSize,
      vaultCountryPredicate: pred,
      verifySampleRollups: ctx.unit.objectKey === "sample_transaction",
    };
  }

  private reconcilerFor(ctx: UnitContext): DefaultReconciler {
    return new DefaultReconciler(
      { sfdc: this.deps.sfdc, vault: ctx.vault, store: this.deps.store },
      { now: this.now, runDir: this.runDir, exceptions: this.exceptions },
    );
  }

  private async reconcileUnit(s: UnitState): Promise<void> {
    const ctx = this.unitContext(s.unit);
    if (!ctx) return;
    const tolerance =
      this.opts.mode === "final-delta" ? 0 : ctx.cc.reconcile.tolerance;
    const reconciler = this.reconcilerFor(ctx);
    try {
      s.reconcile = await reconciler.reconcileUnit(
        this.reconcileInput(ctx, s, tolerance, ctx.cc.reconcile.sampleSize),
      );
      this.findings.push(...s.reconcile.findings);
      if (this.opts.mode === "final-delta" && !this.dryRun) {
        const diffs = await reconciler.sample(
          this.reconcileInput(ctx, s, tolerance, ctx.cc.reconcile.sampleSize),
        );
        s.sampleDiffs = diffs.length;
        if (diffs.length && s.reconcile) s.reconcile.pass = false;
      }
    } catch (e) {
      this.findings.push({
        severity: "warning",
        code: "RECON_FAILED",
        objectKey: s.unit.objectKey,
        country: s.unit.country,
        detail: (e as Error).message,
      });
    }
  }

  private async advanceWatermarks(): Promise<void> {
    if (
      !this.writes ||
      !["init", "delta", "final-delta"].includes(this.opts.mode)
    )
      return;
    const updatedAt = this.now().toISOString();
    const passedByCountry = new Map<CountryCode, boolean>();
    for (const s of this.units.values()) {
      const { unit } = s;
      const gateOk =
        this.opts.mode !== "final-delta" || (s.reconcile?.pass ?? false);
      passedByCountry.set(
        unit.country,
        (passedByCountry.get(unit.country) ?? true) &&
          s.status === "succeeded" &&
          gateOk,
      );
      if (s.status !== "succeeded" || !gateOk) continue;
      const cutoffDate =
        this.unitContext(unit)?.mapping.scope.cutoffDate ??
        this.plan.cutoffDates.get(unit.country);
      await this.deps.store.watermarks.set({
        objectKey: unit.objectKey,
        country: unit.country,
        kind: "modstamp",
        value: this.wmHi,
        cutoffDate,
        runId: this.runId,
        updatedAt,
      });
      await this.deps.store.watermarks.set({
        objectKey: unit.objectKey,
        country: unit.country,
        kind: "deleted",
        value: s.deletedLatestCovered ?? this.wmHi,
        cutoffDate,
        runId: this.runId,
        updatedAt,
      });
    }
    if (this.opts.mode === "final-delta")
      for (const [country, ok] of passedByCountry)
        if (ok && country !== GLOBAL_COUNTRY) {
          await this.deps.store.countryStatus.setFrozen(country, updatedAt);
          await this.audit("country.frozen", { country });
        }
  }

  private async blobPass(): Promise<void> {
    if (!this.plan.postLoad.blobs) return;
    for (const s of this.units.values()) {
      if (s.status !== "succeeded" || !s.blobFiles.length) continue;
      const ctx = this.unitContext(s.unit);
      if (!ctx?.loader.loadBlobs) continue;
      const rows = (async function* () {
        for await (const r of readPayloadFiles(s.blobFiles))
          yield { sfdcId: r.sfdcId, blobs: r.payload };
      })();
      const r = await ctx.loader.loadBlobs(rows, ctx.loadPlan);
      if (r.failed)
        this.findings.push({
          severity: "warning",
          code: "BLOB_ROWS_FAILED",
          objectKey: s.unit.objectKey,
          country: s.unit.country,
          detail: { failed: r.failed, updated: r.updated },
          count: r.failed,
        });
    }
  }

  private async postLoad(): Promise<void> {
    if (!this.writes) return;
    const { recalculateRollups, updateCorporateCurrency } = this.plan.postLoad;
    const done = new Set<string>();
    for (const s of this.units.values()) {
      if (
        s.status !== "succeeded" ||
        !(s.load && s.load.created + s.load.updated > 0)
      )
        continue;
      const ctx = this.unitContext(s.unit);
      if (!ctx) continue;
      const key = `${ctx.dns}/${ctx.target.targetObject}`;
      if (done.has(key)) continue;
      done.add(key);
      const action = ctx.vault.objectAction?.bind(ctx.vault);
      if (
        recalculateRollups !== "off" &&
        ctx.target.rawMetadata.urls &&
        Object.keys(ctx.target.rawMetadata.urls).some((u) => /rollup/i.test(u))
      ) {
        const name = Object.keys(ctx.target.rawMetadata.urls).find((u) =>
          /rollup/i.test(u),
        )!;
        const r = action
          ? await action(ctx.target.targetObject, name).catch((e: Error) => ({
              ok: false,
              message: e.message,
            }))
          : { ok: false, message: "objectAction unsupported" };
        if (!r.ok)
          this.findings.push({
            severity:
              recalculateRollups === "required" ? "blocking" : "warning",
            code: "VT_ROLLUP_RECALC_UNAVAILABLE",
            objectKey: s.unit.objectKey,
            detail: r.message ?? "action failed",
          });
      } else if (recalculateRollups === "required")
        this.findings.push({
          severity: "blocking",
          code: "VT_ROLLUP_RECALC_UNAVAILABLE",
          objectKey: s.unit.objectKey,
          detail: "no roll-up recalculation action on the object",
        });
      const hasCurrency = Object.values(ctx.target.metadata.fields).some(
        (f) => f.type === "currency",
      );
      if (updateCorporateCurrency && hasCurrency && action) {
        const r = await action(
          ctx.target.targetObject,
          "updatecorporatecurrency",
        ).catch((e: Error) => ({ ok: false, message: e.message }));
        if (!r.ok)
          this.findings.push({
            severity: "warning",
            code: "VT_CORP_CURRENCY_UNAVAILABLE",
            objectKey: s.unit.objectKey,
            detail: r.message ?? "action failed",
          });
      }
    }
  }

  // --------------------------------------------------------------- verify

  private async runVerify(): Promise<void> {
    const v = this.opts.verify ?? {};
    for (const s of this.units.values()) {
      if (s.status === "blocked" || (s.status === "skipped" && s.reason))
        continue;
      const ctx = this.unitContext(s.unit);
      if (!ctx) {
        this.failUnit(s, "no resolved target for the unit");
        continue;
      }
      const started = Date.now();
      try {
        const sampleSize =
          v.sample ?? (v.samples ? ctx.cc.reconcile.sampleSize : 0);
        const reconciler = this.reconcilerFor(ctx);
        let manifest: ExtractManifest | undefined;
        if (sampleSize > 0) {
          const extractPlan = await this.extractPlan(ctx, s);
          if (extractPlan) {
            manifest = await this.extractor.extractUnit(s.unit, extractPlan);
            const ids = await buildUnitResolver(
              this.deps.store,
              ctx.mapping,
              manifest.files,
              this.extractor,
              { territories: await this.territoriesFor(ctx) },
            );
            const t = await transformUnit({
              runId: this.runId,
              unit: s.unit,
              mapping: ctx.mapping,
              metadata: ctx.target.metadata,
              module: ctx.module,
              runDir: this.runDir,
              runMode: "verify",
              files: manifest.files,
              extractor: this.extractor,
              store: this.deps.store,
              country: ctx.country,
              ids,
              migrationUserId: ctx.loadPlan.migrationUserId,
              orgId15: to15(this.deps.sfdc.orgId),
              dryRun: true,
              now: this.now,
            });
            s.transform = t;
            // rows to sample are those already loaded by earlier runs: mark them as such for the reconciler
            await this.markLoadedFromIdMap(s.unit, t.payloadFiles);
          }
        }
        const input = this.reconcileInput(
          ctx,
          s,
          ctx.cc.reconcile.tolerance,
          sampleSize,
        );
        input.manifest = manifest;
        const orphan = await reconciler.orphanFks(input);
        let pass = !orphan.some((o) => o.count > 0);
        const findings: Finding[] = [];
        if (!pass)
          findings.push({
            severity: "warning",
            code: "RECON_ORPHAN_FK",
            objectKey: s.unit.objectKey,
            country: s.unit.country,
            detail: { fields: orphan.filter((o) => o.count > 0) },
          });
        let diffs = 0;
        if (sampleSize > 0) {
          diffs = (await reconciler.sample(input)).length;
          if (diffs) pass = false;
        }
        if (v.keys) {
          const ks = await reconciler.keySet(input);
          if (ks.missingInVault.length || ks.goneInSource.length) pass = false;
        }
        if (v.fk) {
          const fk = await reconciler.fkConsistency(input);
          if (fk.length) pass = false;
        }
        const vaultCount = await ctx.vault
          .vqlCount(
            `SELECT id FROM ${ctx.target.targetObject} WHERE ${ctx.target.legacyIdField ?? ctx.mapping.legacyIdField ?? "id"} != null PAGESIZE 0`,
          )
          .catch(() => null);
        const mapped = await this.deps.store.idMap.count(
          s.unit.objectKey,
          s.unit.country === GLOBAL_COUNTRY ? undefined : s.unit.country,
        );
        const row = {
          runId: this.runId,
          objectKey: s.unit.objectKey,
          country: s.unit.country,
          sfdcScopeCount: manifest?.sfdcScopeCount ?? null,
          extracted: manifest?.extractedLive ?? 0,
          closure: 0,
          transformed: s.transform?.transformed ?? 0,
          skipped: s.transform?.skipped ?? 0,
          pendingFk: 0,
          created: 0,
          updated: 0,
          unchanged: mapped,
          failed: 0,
          deleted: 0,
          vaultCount,
          aggHashSrc: null,
          aggHashTgt: null,
          status: pass ? ("pass" as const) : ("fail" as const),
        };
        await this.deps.store.reconciliation.upsert(row);
        s.reconcile = {
          row,
          findings,
          pass,
          orphanFks: orphan.filter((o) => o.count > 0),
        };
        s.sampleDiffs = diffs;
        this.findings.push(...findings);
        s.status = "succeeded";
        s.timing.status = "succeeded";
      } catch (e) {
        this.failUnit(s, (e as Error).message);
      } finally {
        s.timing.elapsedMs = Date.now() - started;
      }
    }
  }

  /** verify: rows present in the id map count as loaded for the sample read-back. */
  private async markLoadedFromIdMap(
    unit: Unit,
    files: string[],
  ): Promise<void> {
    const now = this.now().toISOString();
    let buf: string[] = [];
    const flush = async () => {
      if (!buf.length) return;
      const got = await this.deps.store.idMap.bulkGet(unit.objectKey, buf);
      await this.deps.store.rowResults.upsert(
        [...got.values()]
          .filter((r) => !r.deletedAt && !r.dryRun && !r.mergedInto)
          .map((r) => ({
            runId: this.runId,
            objectKey: unit.objectKey,
            country: unit.country,
            sfdcId: r.sfdcId,
            state: "loaded_unchanged" as const,
            attempt: 1,
            vaultId: r.vaultId,
            updatedAt: now,
          })),
      );
      buf = [];
    };
    for await (const r of readPayloadFiles(files)) {
      buf.push(r.sfdcId);
      if (buf.length >= 500) await flush();
    }
    await flush();
  }

  // --------------------------------------------------------- retry-failed

  private async runRetryFailed(): Promise<void> {
    const source = this.opts.runId;
    if (!source)
      throw new RunAbort(
        EXIT_CODES.configError,
        "retry-failed requires --run <runId>",
      );
    const src = await this.deps.store.runs.get(source);
    if (!src)
      throw new RunAbort(EXIT_CODES.configError, `run ${source} not found`);
    const failed = await this.deps.store.rowResults.query({
      runId: source,
      state: "failed",
      errorType: this.opts.errorType,
    });
    const byUnit = new Map<string, Set<string>>();
    for (const r of failed) {
      if (
        !this.opts.errorType &&
        !isRetryableRowErrorType(r.errorType ?? undefined)
      )
        continue;
      const id = unitId({ objectKey: r.objectKey, country: r.country });
      (byUnit.get(id) ?? byUnit.set(id, new Set()).get(id)!).add(r.sfdcId);
    }
    await this.audit("retry-failed", {
      sourceRun: source,
      rows: failed.length,
      errorType: this.opts.errorType,
    });
    const sourceDir = path.join(this.baseRunDir, source);
    for (const [id, ids] of byUnit) {
      const s = [...this.units.values()].find((u) => unitId(u.unit) === id);
      if (!s || s.status === "blocked") continue;
      const ctx = this.unitContext(s.unit);
      if (!ctx) {
        this.failUnit(s, "no resolved target for the unit");
        continue;
      }
      const started = Date.now();
      try {
        const cps = await this.deps.store.checkpoints.list(
          source,
          s.unit.objectKey,
          s.unit.country,
        );
        const files: ExtractFile[] = cps.map((cp) => ({
          path: path.isAbsolute(cp.file)
            ? cp.file
            : path.join(sourceDir, cp.file),
          jobId: cp.jobId,
          pageNo: cp.pageNo,
          rows: cp.rows,
          closure: /closure/.test(cp.file),
        }));
        if (!files.length) {
          this.failUnit(s, `no extract checkpoints for ${id} in run ${source}`);
          continue;
        }
        const r = await this.transformAndLoad(ctx, s, files, {
          prefix: "retry-",
          onlyIds: ids,
        });
        s.load = r.load;
        s.manifest = {
          ...emptyManifest(s.unit),
          extractedLive:
            r.transform.transformed + r.transform.skipped + r.transform.failed,
          files,
        };
        if (r.load.aborted)
          this.failUnit(s, `load aborted: ${r.load.aborted.reason}`);
        else {
          s.status = "succeeded";
          s.timing.status = "succeeded";
        }
      } catch (e) {
        this.failUnit(s, (e as Error).message);
      } finally {
        s.timing.elapsedMs = Date.now() - started;
      }
    }
    await this.pendingRound(true);
    for (const s of this.units.values())
      if (s.status === "succeeded") await this.reconcileUnit(s);
    for (const l of this.loaders.values())
      this.findings.push(...l.drainFindings());
  }

  // ---------------------------------------------------------------- blobs

  private async runBlobsMode(): Promise<void> {
    const source = this.opts.runId;
    if (!source)
      throw new RunAbort(
        EXIT_CODES.configError,
        "blobs requires --run <runId>",
      );
    const sourceDir = path.join(this.baseRunDir, source);
    for (const s of this.units.values()) {
      if (s.status === "blocked") continue;
      const ctx = this.unitContext(s.unit);
      if (!ctx?.loader.loadBlobs) continue;
      const files = await listPayloadFiles(blobsDir(sourceDir, s.unit));
      if (!files.length) continue;
      const started = Date.now();
      try {
        const rows = (async function* () {
          for await (const r of readPayloadFiles(files))
            yield { sfdcId: r.sfdcId, blobs: r.payload };
        })();
        const r = await ctx.loader.loadBlobs(rows, ctx.loadPlan);
        s.load = r;
        s.status = r.failed ? "failed" : "succeeded";
        s.timing.status = s.status;
        if (r.failed) s.reason = `${r.failed} blob row(s) failed`;
      } catch (e) {
        this.failUnit(s, (e as Error).message);
      } finally {
        s.timing.elapsedMs = Date.now() - started;
      }
    }
    for (const l of this.loaders.values())
      this.findings.push(...l.drainFindings());
  }

  // --------------------------------------------------------------- report

  private async writeRunReport(
    record: RunRecord,
    exitCode: ExitCode,
  ): Promise<string> {
    const stored = await this.deps.store.findings
      .list(this.runId)
      .catch(() => [] as Finding[]);
    const seen = new Set(
      stored.map((f) =>
        JSON.stringify([
          f.code,
          f.objectKey,
          f.country,
          f.field,
          typeof f.detail === "string" ? f.detail : JSON.stringify(f.detail),
        ]),
      ),
    );
    const findings = [
      ...stored,
      ...this.findings.filter(
        (f) =>
          !seen.has(
            JSON.stringify([
              f.code,
              f.objectKey,
              f.country,
              f.field,
              typeof f.detail === "string"
                ? f.detail
                : JSON.stringify(f.detail),
            ]),
          ),
      ),
    ];
    const reconciliation = await this.deps.store.reconciliation
      .list(this.runId)
      .catch(() => []);
    const input: RunReportInput = {
      run: record,
      exitCode,
      units: [...this.units.values()].map((u) => u.timing),
      findings,
      reconciliation,
      ignoredDeletes: Object.fromEntries(
        [...this.units.values()]
          .filter((u) => u.deletes?.ignoredDetail.length)
          .map((u) => [
            unitId(u.unit),
            countBy(u.deletes!.ignoredDetail.map((d) => d.reason)),
          ]),
      ),
      pendingTargets: Object.fromEntries(
        [...this.units.values()]
          .filter((u) => u.pendingTargets)
          .map((u) => [unitId(u.unit), u.pendingTargets!]),
      ),
      sampleDiffs: Object.fromEntries(
        [...this.units.values()]
          .filter((u) => u.sampleDiffs)
          .map((u) => [unitId(u.unit), u.sampleDiffs!]),
      ),
      generatedAt: this.now().toISOString(),
    };
    const paths = await writeReport(this.runDir, renderReport(input));
    return paths.markdown;
  }

  private async report(): Promise<RunSummary> {
    const runId = this.opts.runId ?? this.runId;
    const input = await reportFromStore(this.deps.store, runId, this.now());
    if (!input) {
      this.out(`run ${runId} not found`);
      return {
        runId,
        mode: "report",
        exitCode: EXIT_CODES.configError,
        units: [],
      };
    }
    const report = renderReport(input);
    const dir = path.join(this.baseRunDir, runId);
    const paths = await writeReport(dir, report);
    this.out(report.markdown);
    return {
      runId,
      mode: "report",
      exitCode: EXIT_CODES.success,
      units: input.units.map((u) => ({ unit: u.unit, status: u.status })),
      reportPath: paths.markdown,
    };
  }
}

// ---------------------------------------------------------------- helpers

function mergeLoad(a: LoadResult, b: LoadResult): LoadResult {
  return {
    unit: a.unit,
    batches: [...a.batches, ...b.batches],
    created: a.created + b.created,
    updated: a.updated + b.updated,
    unchanged: a.unchanged + b.unchanged,
    failed: a.failed + b.failed,
    pendingFk: a.pendingFk + b.pendingFk,
    skipped: a.skipped + b.skipped,
    typeChanged: a.typeChanged + b.typeChanged,
    aborted: b.aborted ?? a.aborted,
  };
}

function mergeTransform(
  a: TransformUnitResult,
  b: TransformUnitResult,
): TransformUnitResult {
  const sum = (x: Record<string, number>, y: Record<string, number>) => {
    const o = { ...x };
    for (const [k, v] of Object.entries(y)) o[k] = (o[k] ?? 0) + v;
    return o;
  };
  return {
    payloadFiles: [...a.payloadFiles, ...b.payloadFiles],
    blobFiles: [...a.blobFiles, ...b.blobFiles],
    transformed: a.transformed + b.transformed,
    skipped: a.skipped + b.skipped,
    failed: a.failed + b.failed,
    pendingFk: a.pendingFk + b.pendingFk,
    closureRows: a.closureRows + b.closureRows,
    seenModstamps: new Map([...a.seenModstamps, ...b.seenModstamps]),
    diagnostics: sum(a.diagnostics, b.diagnostics),
    skippedByReason: sum(a.skippedByReason, b.skippedByReason),
    failedByCode: sum(a.failedByCode, b.failedByCode),
    secondPassRows: a.secondPassRows + b.secondPassRows,
  };
}

/** §2.8 extract completeness (`--limit` runs are never complete by design). */
function countMismatch(manifest: ExtractManifest, plan: ExtractPlan): boolean {
  return (
    manifest.sfdcScopeCount !== undefined &&
    manifest.sfdcScopeCount !== manifest.extractedLive &&
    !plan.limit
  );
}

/** `MasterRecordId` of a deleted-id entry when the extractor recorded one (Bulk path, §3.4 a). */
function masterOf(d: { id: string; deletedDate: string }): string | undefined {
  const m = (d as { masterRecordId?: unknown }).masterRecordId;
  return typeof m === "string" && m ? m : undefined;
}

function emptyManifest(unit: Unit): ExtractManifest {
  return {
    unit,
    files: [],
    fkSets: new Map(),
    extractedLive: 0,
    extractedDeleted: 0,
    closureRows: 0,
    deletedIds: [],
    predicate: "",
    columns: [],
    queueOwners: new Set(),
  };
}

function stripDeletes(d: DeleteOutcome): DeleteResult {
  const { ignoredDetail: _i, ...rest } = d;
  return rest;
}

function countBy(items: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) out[i] = (out[i] ?? 0) + 1;
  return out;
}
