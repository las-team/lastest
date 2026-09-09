/**
 * Config loader: YAML → `${ENV}` interpolation → zod (`MigrationConfigSchema`).
 * Exit code 5 (`ConfigError`) on any failure (§8.10).
 */
import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { ZodError } from "zod";
import { hashObject } from "../hash";
import { MigrationConfigSchema, type MigrationConfig } from "./schema";

export class ConfigError extends Error {
  readonly exitCode = 5;
  constructor(
    message: string,
    public readonly issues: string[] = [],
  ) {
    super(message);
  }
}

const ENV_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

/**
 * Replace `${VAR}` / `${VAR:-default}` in every string value (after YAML
 * parsing, so quoting never breaks). Missing variables are collected and
 * reported together.
 */
export function interpolateEnv(
  value: unknown,
  env: NodeJS.ProcessEnv = process.env,
): unknown {
  const missing = new Set<string>();
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      return v.replace(ENV_RE, (_m, name: string, def?: string) => {
        const found = env[name];
        if (found !== undefined) return found;
        if (def !== undefined) return def;
        missing.add(name);
        return "";
      });
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>))
        out[k] = walk(x);
      return out;
    }
    return v;
  };
  const result = walk(value);
  if (missing.size)
    throw new ConfigError(
      `CONFIG_ENV_MISSING: undefined environment variable(s): ${[...missing].sort().join(", ")}`,
      [...missing],
    );
  return result;
}

export function formatZodError(err: ZodError): string[] {
  return err.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`);
}

/** Parse YAML text through interpolation and the schema. */
export function loadConfigFromText(
  text: string,
  env?: NodeJS.ProcessEnv,
): MigrationConfig {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (e) {
    throw new ConfigError(`CONFIG_YAML_INVALID: ${(e as Error).message}`);
  }
  const interpolated = interpolateEnv(raw, env);
  const parsed = MigrationConfigSchema.safeParse(interpolated);
  if (!parsed.success) {
    const issues = formatZodError(parsed.error);
    throw new ConfigError(`CONFIG_INVALID:\n  ${issues.join("\n  ")}`, issues);
  }
  return parsed.data;
}

export function loadConfig(
  path: string,
  env?: NodeJS.ProcessEnv,
): MigrationConfig {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    throw new ConfigError(
      `CONFIG_FILE_UNREADABLE: ${path}: ${(e as Error).message}`,
    );
  }
  return loadConfigFromText(text, env);
}

/** `runs.config_hash` — secrets are redacted before hashing so a rotated password does not change the hash. */
export function configHash(config: MigrationConfig): string {
  const redacted = JSON.parse(JSON.stringify(config)) as Record<
    string,
    unknown
  >;
  const scrub = (auth: unknown) => {
    if (auth && typeof auth === "object") {
      for (const k of [
        "password",
        "token",
        "clientSecret",
        "privateKey",
        "idpToken",
      ])
        if (k in (auth as Record<string, unknown>))
          (auth as Record<string, unknown>)[k] = "[redacted]";
    }
  };
  scrub((redacted.source as Record<string, unknown> | undefined)?.auth);
  scrub((redacted.target as Record<string, unknown> | undefined)?.auth);
  for (const c of Object.values(
    (redacted.countries as Record<string, Record<string, unknown>>) ?? {},
  ))
    scrub((c.target as Record<string, unknown> | undefined)?.auth);
  for (const r of Object.values(
    (redacted.regions as Record<string, Record<string, unknown>>) ?? {},
  ))
    scrub((r.target as Record<string, unknown> | undefined)?.auth);
  return hashObject(redacted);
}
