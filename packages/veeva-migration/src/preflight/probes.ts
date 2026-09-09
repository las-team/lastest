/**
 * §5.3 runtime probes (`preflight.probeWrites = true` / `--probe-writes`).
 * All write probes run against the designated scratch object
 * `preflight.probeObject` (never guessed, never a business object): each
 * creates ≤ 2 rows named `VEEVA-MIGRATION-PROBE {run_id}` keyed
 * `PROBE:{run_id}:{n}`, reads them back by VQL and deletes them in the same
 * preflight. Results are `info PROBE_RESULT`, cached in `probe_results` per
 * vault and re-probed when `target.apiVersion` changes or `--reprobe`.
 */
import { getLogger } from "../logger";
import type { MigrationConfig } from "../config/schema";
import type { StateStore } from "../store/types";
import { VaultApiError, type VaultRow } from "../vault/types";
import { normaliseVaultType, type VaultObjectMetadata } from "../types";
import type { PreflightInput } from "./types";
import { FindingCollector } from "./findings";
import { loadObjectMetadata, type TargetContext } from "./target";

const log = getLogger("Preflight");

export const PROBE_OBJECT_DEFAULT = "migration_probe__c";

/** MDL for the recommended scratch object (§5.3 "Probe object"). */
export function probeObjectMdl(name = PROBE_OBJECT_DEFAULT): string {
  return [
    `CREATE Object ${name} (`,
    `  label('Migration Probe'), label_plural('Migration Probes'), active(true), allow_types(false),`,
    `  Field name__v(label('Name'), type('String'), max_length(128), required(true)),`,
    `  Field legacy_crm_id__c(label('Legacy CRM ID'), type('String'), max_length(40), unique(true), required(false)),`,
    `  Field amount__c(label('Amount'), type('Currency'), required(false)),`,
    `  Field owner__c(label('Owner'), type('Object'), object('user__sys'), required(false)),`,
    `  Field note__c(label('Note'), type('String'), max_length(255), required(false))`,
    `);`,
  ].join("\n");
}

export interface ProbeInput {
  ctx: TargetContext;
  config: MigrationConfig;
  flags: PreflightInput["flags"];
  store: StateStore;
  runId: string;
  findings: FindingCollector;
  migrationUserId?: number;
  /** First known currency name (probe 15). */
  currencyName?: string;
}

export const PROBE_NAMES = [
  "migrationMode",
  "createdByForm",
  "localCurrencyForm",
  "deleteByIdParam",
  "nullClearsField",
] as const;
export type ProbeName = (typeof PROBE_NAMES)[number];

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isPermissionError(e: unknown): boolean {
  if (e instanceof VaultApiError)
    return /INSUFFICIENT_ACCESS|OPERATION_NOT_ALLOWED|PERMISSION/i.test(e.type);
  return /INSUFFICIENT_ACCESS|OPERATION_NOT_ALLOWED/i.test(errMessage(e));
}

interface ProbeSetup {
  object: string;
  meta: VaultObjectMetadata;
  keyField: string;
  currencyField?: string;
  userField?: string;
  textField?: string;
}

async function probeSetup(input: ProbeInput): Promise<ProbeSetup | undefined> {
  const { findings, config, ctx } = input;
  const object = config.preflight.probeObject;
  const mdl = probeObjectMdl();
  if (!object) {
    findings.blocking("VT_PROBE_OBJECT_MISSING", {
      message:
        "preflight.probeWrites = true but preflight.probeObject is unset",
      mdl,
    });
    return undefined;
  }
  const meta = await loadObjectMetadata(ctx, object);
  if (!meta || !meta.status.includes("active__v")) {
    findings.blocking("VT_PROBE_OBJECT_MISSING", {
      message: `preflight.probeObject ${object} is absent from the vault or inactive`,
      mdl,
    });
    return undefined;
  }
  const fields = meta.fields.filter((f) =>
    (f.status ?? ["active__v"]).includes("active__v"),
  );
  const keyField = fields.find(
    (f) =>
      f.unique &&
      normaliseVaultType(f.type) === "string" &&
      f.name !== "name__v",
  )?.name;
  if (!keyField) {
    findings.blocking("VT_PROBE_OBJECT_MISSING", {
      message: `${object} has no unique String field for the probe idParam (expected legacy_crm_id__c)`,
      mdl,
    });
    return undefined;
  }
  if (meta.allow_types || meta.available_lifecycles?.length)
    findings.warning(
      "VT_PROBE_OBJECT_MISSING",
      `${object} has object types or a lifecycle; the probe object must be plain (allow_types = false, no lifecycle)`,
    );
  return {
    object,
    meta,
    keyField,
    currencyField: fields.find((f) => normaliseVaultType(f.type) === "currency")
      ?.name,
    userField: fields.find(
      (f) => f.object?.name === "user__sys" && f.editable !== false,
    )?.name,
    textField: fields.find(
      (f) =>
        normaliseVaultType(f.type) === "string" &&
        !f.required &&
        !f.unique &&
        f.editable !== false &&
        f.name !== "name__v" &&
        !f.system_managed_name,
    )?.name,
  };
}

/** Run every probe (skipping cached ones). */
export async function runProbes(input: ProbeInput): Promise<void> {
  const { findings, config, flags, store, runId, ctx } = input;
  if (!(flags.probeWrites || config.preflight.probeWrites) || flags.dryRun) {
    findings.info(
      "PROBE_SKIPPED",
      flags.dryRun
        ? "dry-run never runs write probes"
        : "preflight.probeWrites = false (use --probe-writes)",
    );
    return;
  }
  if (ctx.unavailable) return;
  const setup = await probeSetup(input);
  if (!setup) return;
  const apiVersion = config.target.apiVersion;
  const reprobe = Boolean(flags.reprobe || config.preflight.reprobe);

  const cached = async (probe: ProbeName): Promise<boolean> => {
    if (reprobe) return false;
    try {
      const r = await store.probeResults.get(probe);
      if (r && r.result.apiVersion === apiVersion) {
        findings.info("PROBE_RESULT", {
          probe,
          ...r.result,
          cached: true,
          checkedAt: r.checkedAt,
        });
        return true;
      }
    } catch (e) {
      log.debug({ err: errMessage(e) }, "probeResults.get failed");
    }
    return false;
  };
  const record = async (probe: ProbeName, result: Record<string, unknown>) => {
    findings.info("PROBE_RESULT", { probe, ...result });
    try {
      await store.probeResults.set({
        vaultDns: ctx.vaultDns,
        probe,
        result: { ...result, apiVersion },
        checkedAt: new Date().toISOString(),
      });
    } catch (e) {
      log.debug({ err: errMessage(e) }, "probeResults.set failed");
    }
  };

  let n = 0;
  const vault = ctx.vault;
  const key = () => `PROBE:${runId}:${++n}`;
  const name = `VEEVA-MIGRATION-PROBE ${runId}`;
  const created: string[] = [];

  const upsertOne = async (
    row: Record<string, unknown>,
    migrationMode: boolean,
  ) => {
    const k = key();
    const res = await vault.upsert(
      setup.object,
      [{ ...(row as VaultRow), name__v: name, [setup.keyField]: k }],
      {
        idParam: setup.keyField,
        migrationMode,
        noTriggers: true,
        referenceId: `${runId}:probe:${n}`,
      },
    );
    const r = res.data[0];
    if (r?.responseStatus === "SUCCESS" && r.data?.id) created.push(r.data.id);
    return { key: k, row: r, id: r?.data?.id };
  };
  const readBack = async (k: string, fields: string[]) => {
    for await (const page of vault.vql(
      `SELECT id, ${fields.join(", ")} FROM ${setup.object} WHERE ${setup.keyField} = '${k}'`,
    ))
      return page.data[0];
    return undefined;
  };

  // 13: migration-mode permission (created_date__v accepted)
  if (!(await cached("migrationMode"))) {
    const stamp = "2001-02-03T04:05:06.000Z";
    try {
      const { key: k, row } = await upsertOne({ created_date__v: stamp }, true);
      if (row?.responseStatus !== "SUCCESS") {
        const err = row?.errors?.[0];
        findings.blocking(
          "VT_MIGRATION_PERMISSION",
          `probe 13: migration-mode create rejected (${err?.type}: ${err?.message}) — the user lacks Vault Owner Actions: Record Migration`,
        );
        await record("migrationMode", { result: "rejected", error: err });
      } else {
        const back = await readBack(k, ["created_date__v"]);
        const honoured =
          typeof back?.created_date__v === "string" &&
          back.created_date__v.startsWith("2001-02-03");
        if (!honoured)
          findings.blocking(
            "VT_MIGRATION_PERMISSION",
            "probe 13: created_date__v was not honoured under X-VaultAPI-MigrationMode — Record Migration permission missing",
          );
        await record("migrationMode", {
          result: honoured ? "accepted" : "ignored",
        });
      }
    } catch (e) {
      if (isPermissionError(e))
        findings.blocking(
          "VT_MIGRATION_PERMISSION",
          `probe 13: ${errMessage(e)}`,
        );
      else
        findings.warning(
          "PROBE_FAILED",
          `probe 13 migrationMode: ${errMessage(e)}`,
        );
    }
  }

  // 14: created_by__v accepted form
  if (!(await cached("createdByForm"))) {
    if (input.migrationUserId === undefined)
      findings.info(
        "PROBE_SKIPPED",
        "probe 14 createdByForm: target.migrationUserId unset",
      );
    else {
      try {
        const r1 = await upsertOne(
          { created_by__v: input.migrationUserId },
          true,
        );
        if (r1.row?.responseStatus === "SUCCESS")
          await record("createdByForm", { result: "numeric" });
        else {
          const me = await vault.me();
          const r2 = await upsertOne(
            { "created_by__v.user_name__v": me.user_name__v },
            true,
          );
          await record("createdByForm", {
            result:
              r2.row?.responseStatus === "SUCCESS"
                ? "user_name__v"
                : "rejected",
            error: r2.row?.errors?.[0],
          });
        }
      } catch (e) {
        findings.warning(
          "PROBE_FAILED",
          `probe 14 createdByForm: ${errMessage(e)}`,
        );
      }
    }
  }

  // 15: local_currency__sys accepted form
  if (!(await cached("localCurrencyForm"))) {
    if (!setup.currencyField || !input.currencyName)
      findings.info(
        "PROBE_SKIPPED",
        `probe 15 localCurrencyForm: ${setup.currencyField ? "no currency__sys value known" : `${setup.object} has no Currency field`}`,
      );
    else {
      try {
        const r1 = await upsertOne(
          { [setup.currencyField]: 1, local_currency__sys: input.currencyName },
          true,
        );
        await record("localCurrencyForm", {
          result: r1.row?.responseStatus === "SUCCESS" ? "name" : "rejected",
          error: r1.row?.errors?.[0],
        });
      } catch (e) {
        await record("localCurrencyForm", {
          result: "unsupported",
          error: errMessage(e),
        });
      }
    }
  }

  // 16: DELETE ?idParam — the client contract deletes by id only
  if (!(await cached("deleteByIdParam")))
    await record("deleteByIdParam", {
      result: "unsupported_by_client",
      note: "deletes use Vault ids from the id map (§2.5.4)",
    });

  // 18: null clears a field on PUT
  if (!(await cached("nullClearsField"))) {
    if (!setup.textField)
      findings.info(
        "PROBE_SKIPPED",
        `probe 18 nullClearsField: ${setup.object} has no optional String field`,
      );
    else {
      try {
        const r1 = await upsertOne({ [setup.textField]: "probe" }, false);
        if (r1.id) {
          const upd = await vault.update(
            setup.object,
            [{ id: r1.id, [setup.textField]: null }],
            { migrationMode: false },
          );
          const back = await readBack(r1.key, [setup.textField]);
          const cleared =
            back !== undefined &&
            (back[setup.textField] === null ||
              back[setup.textField] === undefined ||
              back[setup.textField] === "");
          await record("nullClearsField", {
            result:
              upd.data[0]?.responseStatus === "SUCCESS"
                ? cleared
                  ? "clears"
                  : "ignored"
                : "rejected",
          });
        }
      } catch (e) {
        findings.warning(
          "PROBE_FAILED",
          `probe 18 nullClearsField: ${errMessage(e)}`,
        );
      }
    }
  }

  // cleanup
  if (created.length) {
    try {
      const res = await vault.deleteRecords(setup.object, created, {
        referenceId: `${runId}:probe:cleanup`,
      });
      res.data.forEach((r, i) => {
        if (r.responseStatus !== "SUCCESS")
          findings.warning(
            "PROBE_ROW_LEFT",
            `probe row ${created[i]} on ${setup.object} could not be deleted: ${r.errors?.[0]?.message ?? "unknown"}`,
          );
      });
    } catch (e) {
      for (const id of created)
        findings.warning(
          "PROBE_ROW_LEFT",
          `probe row ${id} on ${setup.object} left behind: ${errMessage(e)}`,
        );
    }
  }
}
