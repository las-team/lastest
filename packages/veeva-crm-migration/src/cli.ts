#!/usr/bin/env node
/**
 * CLI for @lastest/veeva-crm-migration.
 *
 *   veeva-crm-migration extract  --out ./out [--objects Account,Call2_vod__c]
 *   veeva-crm-migration document --out ./out [--countries DE,FR] [--rep-categories sales_rep,msl]
 *   veeva-crm-migration plan     --out ./out [--countries ...]
 *   veeva-crm-migration apply    --out ./out [--execute] [--allow-review] [--continue-on-error]
 *                                                             (dry-run unless --execute)
 *   veeva-crm-migration all      --out ./out                  (extract + document + plan)
 *
 * `--classification ./rules.json` overrides the profile classifier for
 * document/plan: `{ rules?, categoryOverrides?, countryOverrides?, keepEmptyProfiles? }`
 * (the `ClassifyOptions` shape, minus `knownCountries` which comes from the snapshot).
 *
 * Credentials come from the environment, never from flags:
 *   SFDC_INSTANCE_URL, SFDC_LOGIN_URL, SFDC_API_VERSION
 *   SFDC_ACCESS_TOKEN                                   (pre-issued token), or
 *   SFDC_CLIENT_ID + SFDC_CLIENT_SECRET                 (OAuth client-credentials flow), or
 *   SFDC_CLIENT_ID + SFDC_USERNAME + SFDC_JWT_PRIVATE_KEY (JWT bearer flow)
 *   VAULT_DNS, VAULT_API_VERSION
 *   VAULT_SESSION_ID                                    (pre-issued session), or
 *   VAULT_USERNAME + VAULT_PASSWORD
 */
import { readFile } from "node:fs/promises";

import {
  migrateVeevaCrmConfig,
  type MigrateOptions,
  type MigrationStage,
} from "./index";
import type { ClassifyOptions } from "./model/classify";
import { REP_CATEGORIES } from "./model/types";
import type { SfdcAuth } from "./sfdc";
import type { VaultAuth } from "./vault";

function parseArgs(argv: string[]): {
  command: string;
  flags: Record<string, string | boolean>;
} {
  // A leading flag (`--help`) means no command was given.
  const [command = "help", ...rest] =
    argv[0] === undefined || argv[0].startsWith("-") ? ["help", ...argv] : argv;
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === "-h") {
      flags.help = true;
      continue;
    }
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = rest[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  }
  return { command, flags };
}

function list(value: string | boolean | undefined): string[] | undefined {
  return typeof value === "string"
    ? value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;
}

function sfdcAuthFromEnv(env: NodeJS.ProcessEnv): SfdcAuth | undefined {
  const instanceUrl = env.SFDC_INSTANCE_URL;
  const loginUrl = env.SFDC_LOGIN_URL;
  if (env.SFDC_ACCESS_TOKEN && instanceUrl) {
    return { kind: "token", instanceUrl, accessToken: env.SFDC_ACCESS_TOKEN };
  }
  if (env.SFDC_CLIENT_ID && env.SFDC_CLIENT_SECRET) {
    return {
      kind: "client_credentials",
      loginUrl: loginUrl ?? instanceUrl ?? "https://login.salesforce.com",
      instanceUrl,
      clientId: env.SFDC_CLIENT_ID,
      clientSecret: env.SFDC_CLIENT_SECRET,
    };
  }
  if (env.SFDC_CLIENT_ID && env.SFDC_USERNAME && env.SFDC_JWT_PRIVATE_KEY) {
    return {
      kind: "jwt",
      loginUrl: loginUrl ?? "https://login.salesforce.com",
      instanceUrl,
      clientId: env.SFDC_CLIENT_ID,
      username: env.SFDC_USERNAME,
      privateKey: env.SFDC_JWT_PRIVATE_KEY,
    };
  }
  return undefined;
}

function vaultAuthFromEnv(env: NodeJS.ProcessEnv): VaultAuth | undefined {
  const vaultDns = env.VAULT_DNS;
  if (!vaultDns) return undefined;
  if (env.VAULT_SESSION_ID)
    return { kind: "session", vaultDns, sessionId: env.VAULT_SESSION_ID };
  if (env.VAULT_USERNAME && env.VAULT_PASSWORD) {
    return {
      kind: "password",
      vaultDns,
      username: env.VAULT_USERNAME,
      password: env.VAULT_PASSWORD,
    };
  }
  return undefined;
}

const CLASSIFICATION_KEYS = new Set([
  "rules",
  "categoryOverrides",
  "countryOverrides",
  "keepEmptyProfiles",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRepCategory(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (REP_CATEGORIES as readonly string[]).includes(value)
  );
}

/**
 * Parses a `--classification` file. Validates the shape strictly: a typo in
 * an override key would otherwise be silently ignored and the "wrong guess"
 * it was meant to correct would survive into the plan.
 */
export function parseClassificationFile(
  text: string,
  file: string,
): Pick<
  ClassifyOptions,
  "rules" | "categoryOverrides" | "countryOverrides" | "keepEmptyProfiles"
> {
  const bad = (what: string): Error =>
    new Error(`--classification ${file}: ${what}`);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw bad(`not valid JSON (${err instanceof Error ? err.message : err})`);
  }
  if (!isRecord(raw)) throw bad("expected a JSON object");
  for (const key of Object.keys(raw))
    if (!CLASSIFICATION_KEYS.has(key))
      throw bad(
        `unknown key "${key}" (expected ${[...CLASSIFICATION_KEYS].join(", ")})`,
      );
  const out: ReturnType<typeof parseClassificationFile> = {};
  if (raw.rules !== undefined) {
    if (!Array.isArray(raw.rules)) throw bad("rules must be an array");
    out.rules = raw.rules.map((r, i) => {
      if (
        !isRecord(r) ||
        typeof r.pattern !== "string" ||
        !isRepCategory(r.category)
      )
        throw bad(
          `rules[${i}] must be { pattern: string, category: ${REP_CATEGORIES.join("|")} }`,
        );
      try {
        new RegExp(r.pattern, "i");
      } catch {
        throw bad(`rules[${i}].pattern is not a valid regex: ${r.pattern}`);
      }
      return { pattern: r.pattern, category: r.category };
    }) as ClassifyOptions["rules"];
  }
  if (raw.categoryOverrides !== undefined) {
    if (!isRecord(raw.categoryOverrides))
      throw bad(
        "categoryOverrides must be an object of profile name → category",
      );
    for (const [name, cat] of Object.entries(raw.categoryOverrides))
      if (!isRepCategory(cat))
        throw bad(
          `categoryOverrides["${name}"] must be one of ${REP_CATEGORIES.join(", ")}`,
        );
    out.categoryOverrides =
      raw.categoryOverrides as ClassifyOptions["categoryOverrides"];
  }
  if (raw.countryOverrides !== undefined) {
    if (!isRecord(raw.countryOverrides))
      throw bad(
        "countryOverrides must be an object of profile name → country codes",
      );
    const overrides: Record<string, string[]> = {};
    for (const [name, codes] of Object.entries(raw.countryOverrides)) {
      if (
        !Array.isArray(codes) ||
        !codes.every((c) => typeof c === "string" && /^[A-Za-z]{2}$/.test(c))
      )
        throw bad(
          `countryOverrides["${name}"] must be an array of 2-letter country codes`,
        );
      overrides[name] = codes.map((c: string) => c.toUpperCase());
    }
    out.countryOverrides = overrides;
  }
  if (raw.keepEmptyProfiles !== undefined) {
    if (typeof raw.keepEmptyProfiles !== "boolean")
      throw bad("keepEmptyProfiles must be a boolean");
    out.keepEmptyProfiles = raw.keepEmptyProfiles;
  }
  return out;
}

const STAGES: Record<string, MigrationStage[]> = {
  extract: ["extract"],
  document: ["document"],
  plan: ["plan"],
  apply: ["apply"],
  all: ["extract", "document", "plan"],
};

/** Test seams: an injectable `fetch` / clock / log sink. Production uses the globals. */
export type MainOverrides = Pick<MigrateOptions, "fetch" | "now" | "log">;

export async function main(
  argv = process.argv.slice(2),
  env = process.env,
  overrides: MainOverrides = {},
): Promise<number> {
  const { command, flags } = parseArgs(argv);
  const stages = STAGES[command];
  const wantsHelp = flags.help === true || command === "help";
  if (!stages || wantsHelp) {
    console.error(
      [
        "usage: veeva-crm-migration <extract|document|plan|apply|all> --out <dir> [options]",
        "  --countries DE,FR          restrict document/plan to these countries",
        "  --rep-categories a,b       restrict to rep categories (sales_rep, specialty_rep, kam, msl, manager, inside_sales, admin, other)",
        "  --objects A,B              extract only these objects (default: Veeva CRM core set)",
        "  --include-managed          extract every vod__ managed object, not only the core set",
        "  --api-version v64.0        Salesforce API version",
        "  --classification f.json    classifier overrides for document/plan:",
        "                             { rules?, categoryOverrides?, countryOverrides?, keepEmptyProfiles? }",
        "  --keep-empty-profiles      plan profiles that have no active users (default: drop them)",
        "  --execute                  apply for real (default is dry-run)",
        "  --allow-review             apply: also run steps flagged `review` (personas, VMOCs, settings,",
        "                             layouts, object types, picklist values); default skips them",
        "  --continue-on-error        apply: keep going after a failed step",
        "  --async-mdl                apply: run MDL through /mdl/execute_async (high-volume objects)",
      ].join("\n"),
    );
    return wantsHelp ? 0 : 2;
  }
  const outDir =
    typeof flags.out === "string" ? flags.out : "./veeva-migration-out";
  const sfdcAuth = sfdcAuthFromEnv(env);
  const vaultAuth = vaultAuthFromEnv(env);
  let classify: ClassifyOptions | undefined;
  try {
    if (typeof flags.classification === "string") {
      classify = parseClassificationFile(
        await readFile(flags.classification, "utf8"),
        flags.classification,
      );
    } else if (flags.classification === true) {
      throw new Error("--classification needs a file path");
    }
    if (flags["keep-empty-profiles"] === true)
      classify = { ...classify, keepEmptyProfiles: true };
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 2;
  }
  const options: MigrateOptions = {
    ...overrides,
    stages,
    outDir,
    countries: list(flags.countries),
    repCategories: list(flags["rep-categories"]),
    classify,
    dryRun: !flags.execute,
    allowReview: flags["allow-review"] === true,
    continueOnError: flags["continue-on-error"] === true,
    asyncMdl: flags["async-mdl"] === true,
    sfdc: sfdcAuth
      ? {
          ...sfdcAuth,
          apiVersion:
            typeof flags["api-version"] === "string"
              ? flags["api-version"]
              : env.SFDC_API_VERSION,
          objects: list(flags.objects),
          includeManagedObjects: flags["include-managed"] === true,
        }
      : undefined,
    vault: vaultAuth
      ? { ...vaultAuth, apiVersion: env.VAULT_API_VERSION }
      : undefined,
  };
  try {
    const result = await migrateVeevaCrmConfig(options);
    if (result.applyReport && !result.applyReport.ok) return 1;
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

if (process.argv[1] && /cli\.(ts|js|mjs)$/.test(process.argv[1])) {
  main().then((code) => process.exit(code));
}
