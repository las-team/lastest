/**
 * Config loader: YAML → `${ENV}` interpolation → zod (`MigrationConfigSchema`)
 * → shipped region/country overlays merged beneath the user's blocks
 * (`mergeOverlays`, §7.1 — so `countries.DE: {}` carries the §7.4.2 overlay).
 * Exit code 5 (`ConfigError`) on any failure (§8.10).
 */
import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { hashObject } from "../hash";
import {
  loadBuiltinCountryOverlays,
  mergeOverlays,
  type BuiltinOverlays,
} from "./countries";
import { ConfigError, formatZodError } from "./errors";
import { makeMigrationConfigSchema, type MigrationConfig } from "./schema";

export { ConfigError, formatZodError } from "./errors";

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

export interface LoadConfigOptions {
  /**
   * Shipped overlays merged beneath the user's `regions` / `countries` blocks
   * (default: `loadBuiltinCountryOverlays()` from `<package>/config/`).
   * Pass `EMPTY_OVERLAYS` to opt out.
   */
  overlays?: BuiltinOverlays;
}

/**
 * Parse YAML text through interpolation, the schema and the shipped overlays.
 * A `countries.<ISO>.region` naming a region that only ships as an overlay
 * (`AT: { region: EU }`) is accepted: the region is added by the merge and
 * the merged result is re-validated against the full schema.
 */
export function loadConfigFromText(
  text: string,
  env?: NodeJS.ProcessEnv,
  opts: LoadConfigOptions = {},
): MigrationConfig {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (e) {
    throw new ConfigError(`CONFIG_YAML_INVALID: ${(e as Error).message}`);
  }
  const interpolated = interpolateEnv(raw, env);
  const overlays = opts.overlays ?? loadBuiltinCountryOverlays();
  const parsed = makeMigrationConfigSchema({
    knownRegions: Object.keys(overlays.regions),
  }).safeParse(interpolated);
  if (!parsed.success) {
    const issues = formatZodError(parsed.error);
    throw new ConfigError(`CONFIG_INVALID:\n  ${issues.join("\n  ")}`, issues);
  }
  return mergeOverlays(parsed.data, { overlays, env });
}

export function loadConfig(
  path: string,
  env?: NodeJS.ProcessEnv,
  opts: LoadConfigOptions = {},
): MigrationConfig {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    throw new ConfigError(
      `CONFIG_FILE_UNREADABLE: ${path}: ${(e as Error).message}`,
    );
  }
  return loadConfigFromText(text, env, opts);
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
