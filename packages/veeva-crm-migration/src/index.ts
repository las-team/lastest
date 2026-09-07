/**
 * @lastest/veeva-crm-migration
 *
 * One function, three stages:
 *   extract   Veeva CRM (Salesforce) org configuration → `OrgSnapshot` JSON
 *   document  snapshot → per-country / per-rep-category Markdown
 *   plan      snapshot → Vault CRM change set (MDL + API calls + manual checklist)
 *   apply     execute the plan against a Vault CRM instance
 *
 * Each stage can be run on its own; later stages read the JSON the earlier
 * ones wrote to `outDir`, so a snapshot extracted once can be documented and
 * planned repeatedly without touching Salesforce again.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { classifySnapshot, type ClassifyOptions } from "./model/classify";
import type {
  ApplyReport,
  ClassifiedSnapshot,
  OrgSnapshot,
  VaultPlan,
} from "./model/types";
import {
  createSfdcClient,
  extractOrgSnapshot,
  type ExtractOptions,
  type SfdcAuth,
} from "./sfdc";
import { renderDocs, writeDocs } from "./docs";
import {
  applyVaultPlan,
  buildVaultPlan,
  createVaultClient,
  writePlan,
  type VaultAuth,
  type VaultPlanOptions,
} from "./vault";

export * from "./model/types";
export * from "./model/classify";
export * from "./sfdc";
export * from "./docs";
export * from "./vault";

export type MigrationStage = "extract" | "document" | "plan" | "apply";

export interface MigrateOptions {
  /** Which stages to run, in order. Defaults to `["extract", "document", "plan"]` (never `apply` by default). */
  stages?: MigrationStage[];
  /** Directory that receives `snapshot.json`, `docs/`, `vault-plan/` and `apply-report.json`. */
  outDir: string;
  /** Required for `extract`. */
  sfdc?: SfdcAuth &
    Pick<
      ExtractOptions,
      "apiVersion" | "objects" | "includeManagedObjects" | "maxRequests"
    >;
  /** Required for `apply`; optional for `plan` (used to pre-check target metadata). */
  vault?: VaultAuth & Pick<VaultPlanOptions, "apiVersion">;
  /** Restrict documentation and plan to these ISO country codes. */
  countries?: string[];
  /** Restrict documentation and plan to these rep categories. */
  repCategories?: string[];
  classify?: ClassifyOptions;
  /** `apply` executes nothing when true (default true): every step is reported as it would run. */
  dryRun?: boolean;
  /**
   * `apply`: run steps flagged `review` (personas, VMOCs, settings, layouts,
   * object types, picklist values — generated from an unverified grammar /
   * mapping). Off by default: those steps are reported as skipped.
   */
  allowReview?: boolean;
  /** `apply`: keep going after a failed step (dependants of the failure are still skipped). */
  continueOnError?: boolean;
  /** `apply`: use `POST /mdl/execute_async` for MDL steps (high-volume objects). */
  asyncMdl?: boolean;
  /** Progress / warning sink. Defaults to `console.error`. */
  log?: (message: string) => void;
  /** Injectable fetch for tests. */
  fetch?: typeof fetch;
  /** Clock, injectable for deterministic output. */
  now?: () => Date;
}

export interface MigrateResult {
  snapshot?: OrgSnapshot;
  classified?: ClassifiedSnapshot;
  docFiles?: string[];
  plan?: VaultPlan;
  planFiles?: string[];
  applyReport?: ApplyReport;
}

const SNAPSHOT_FILE = "snapshot.json";
const PLAN_FILE = "vault-plan/plan.json";

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function filterClassified(
  classified: ClassifiedSnapshot,
  options: MigrateOptions,
): ClassifiedSnapshot {
  const countries = options.countries?.map((c) => c.toUpperCase());
  const cats = options.repCategories;
  const keepCat = (c: string) => !cats || cats.includes(c);
  return {
    ...classified,
    countries: classified.countries
      .filter((c) => !countries || countries.includes(c.country.code))
      .map((c) => ({
        ...c,
        repConfigs: c.repConfigs.filter((r) => keepCat(r.category)),
      })),
    global: classified.global.filter((r) => keepCat(r.category)),
  };
}

/**
 * Extracts a Veeva CRM org's functional configuration, documents it per
 * country and rep category, and plans (optionally applies) the equivalent
 * Vault CRM setup.
 */
export async function migrateVeevaCrmConfig(
  options: MigrateOptions,
): Promise<MigrateResult> {
  const stages = options.stages ?? ["extract", "document", "plan"];
  const log = options.log ?? ((m: string) => console.error(m));
  const now = options.now ?? (() => new Date());
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const result: MigrateResult = {};
  const snapshotPath = path.join(options.outDir, SNAPSHOT_FILE);
  const planPath = path.join(options.outDir, PLAN_FILE);

  const needSnapshot = async (): Promise<OrgSnapshot> => {
    if (result.snapshot) return result.snapshot;
    log(`reading snapshot from ${snapshotPath}`);
    result.snapshot = await readJson<OrgSnapshot>(snapshotPath);
    return result.snapshot;
  };
  const needClassified = async (): Promise<ClassifiedSnapshot> => {
    if (result.classified) return result.classified;
    const snapshot = await needSnapshot();
    result.classified = filterClassified(
      classifySnapshot(snapshot, options.classify),
      options,
    );
    return result.classified;
  };

  for (const stage of stages) {
    switch (stage) {
      case "extract": {
        if (!options.sfdc)
          throw new Error(
            "`sfdc` credentials are required for the extract stage",
          );
        log(
          `extracting configuration from ${options.sfdc.instanceUrl ?? options.sfdc.loginUrl ?? "Salesforce"}`,
        );
        const client = await createSfdcClient(options.sfdc, {
          fetch: fetchImpl,
          log,
        });
        const snapshot = await extractOrgSnapshot(client, {
          apiVersion: options.sfdc.apiVersion,
          objects: options.sfdc.objects,
          includeManagedObjects: options.sfdc.includeManagedObjects,
          maxRequests: options.sfdc.maxRequests,
          log,
          now,
        });
        result.snapshot = snapshot;
        await writeJson(snapshotPath, snapshot);
        log(
          `snapshot written to ${snapshotPath} (${snapshot.warnings.length} warnings)`,
        );
        break;
      }
      case "document": {
        const classified = await needClassified();
        const docs = renderDocs(classified, { now });
        const docFiles = await writeDocs(
          docs,
          path.join(options.outDir, "docs"),
        );
        result.docFiles = docFiles;
        log(`wrote ${docFiles.length} documentation files`);
        break;
      }
      case "plan": {
        const classified = await needClassified();
        const plan = buildVaultPlan(classified, {
          apiVersion: options.vault?.apiVersion,
          vaultDns: options.vault?.vaultDns,
          now,
          keepEmptyProfiles: options.classify?.keepEmptyProfiles,
        });
        result.plan = plan;
        await writeJson(planPath, plan);
        result.planFiles = await writePlan(
          plan,
          path.join(options.outDir, "vault-plan"),
        );
        log(
          `plan: ${plan.steps.length} steps, ${plan.unmapped.length} unmapped components`,
        );
        break;
      }
      case "apply": {
        if (!options.vault)
          throw new Error(
            "`vault` credentials are required for the apply stage",
          );
        const plan = result.plan ?? (await readJson<VaultPlan>(planPath));
        const dryRun = options.dryRun ?? true;
        const client = await createVaultClient(options.vault, {
          fetch: fetchImpl,
          log,
        });
        const report = await applyVaultPlan(client, plan, {
          dryRun,
          allowReview: options.allowReview,
          continueOnError: options.continueOnError,
          asyncMdl: options.asyncMdl,
          log,
          now,
        });
        result.applyReport = report;
        await writeJson(path.join(options.outDir, "apply-report.json"), report);
        const count = (status: ApplyReport["results"][number]["status"]) =>
          report.results.filter((r) => r.status === status).length;
        log(
          `${dryRun ? "dry-run" : "apply"} finished: ${count("applied")} applied, ` +
            `${count("skipped")} skipped, ${count("failed")} failed, ${count("manual")} manual`,
        );
        break;
      }
      default: {
        const never: never = stage;
        throw new Error(`unknown stage ${String(never)}`);
      }
    }
  }
  return result;
}
