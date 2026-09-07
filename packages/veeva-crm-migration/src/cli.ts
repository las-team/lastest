#!/usr/bin/env node
/**
 * CLI for @lastest/veeva-crm-migration.
 *
 *   veeva-crm-migration extract  --out ./out [--objects Account,Call2_vod__c]
 *   veeva-crm-migration document --out ./out [--countries DE,FR] [--rep-categories sales_rep,msl]
 *   veeva-crm-migration plan     --out ./out [--countries ...]
 *   veeva-crm-migration apply    --out ./out [--execute]      (dry-run unless --execute)
 *   veeva-crm-migration all      --out ./out                  (extract + document + plan)
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
import {
  migrateVeevaCrmConfig,
  type MigrateOptions,
  type MigrationStage,
} from "./index";
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

const STAGES: Record<string, MigrationStage[]> = {
  extract: ["extract"],
  document: ["document"],
  plan: ["plan"],
  apply: ["apply"],
  all: ["extract", "document", "plan"],
};

export async function main(
  argv = process.argv.slice(2),
  env = process.env,
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
        "  --execute                  apply for real (default is dry-run)",
      ].join("\n"),
    );
    return wantsHelp ? 0 : 2;
  }
  const outDir =
    typeof flags.out === "string" ? flags.out : "./veeva-migration-out";
  const sfdcAuth = sfdcAuthFromEnv(env);
  const vaultAuth = vaultAuthFromEnv(env);
  const options: MigrateOptions = {
    stages,
    outDir,
    countries: list(flags.countries),
    repCategories: list(flags["rep-categories"]),
    dryRun: !flags.execute,
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
