/**
 * Built-in region / country overlays shipped under `<package>/config/`
 * (§7.3 regions, §7.4 worked overlays).
 *
 *   config/regions/<R>.yaml     — body of `regions.<R>`
 *   config/countries/<ISO>.yaml — body of `countries.<ISO>` (may carry `region`)
 *
 * `loadBuiltinCountryOverlays()` reads and schema-validates them (raw, not yet
 * env-interpolated). `mergeOverlays(config)` puts them BENEATH the user's
 * config so that a one-line `countries.DE: {}` already carries the §7.4.2
 * overlay — the user's values always win. After merging, `resolveCountry`
 * layers defaults ← global ← region ← country exactly as before (§7.1).
 *
 * Merge rules (builtin ← user):
 *   - objects merge recursively; scalars from the user replace;
 *   - `objects.<key>.fields`: `add` / `override` rows merge BY TARGET (a user
 *     row with the same target replaces the shipped one, new targets append),
 *     `remove` lists are unioned, `required` maps merge;
 *   - every other array (inactivateBy, orderBy, countryOf lists, …) is
 *     replaced wholesale by the user's;
 *   - `auth` blocks are atomic (discriminated unions): a user `target.auth`
 *     replaces the shipped one instead of merging into it.
 *
 * `${ENV}` references inside a shipped overlay (CN vault credentials) are
 * resolved only when the user's config references that country and does not
 * override the key itself; otherwise they raise `CONFIG_ENV_MISSING`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { getLogger } from "../logger";
import { ConfigError, formatZodError } from "./errors";
import {
  CountryEntrySchema,
  CountryLayerSchema,
  MigrationConfigSchema,
  type MigrationConfig,
} from "./schema";

const log = getLogger("Config");

type Dict = Record<string, unknown>;

function isDict(v: unknown): v is Dict {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** `<package>/config/` resolved relative to this module (works from source and from a checkout). */
export const BUILTIN_CONFIG_DIR = fileURLToPath(
  new URL("../../config/", import.meta.url),
);

export interface BuiltinOverlays {
  /** Directory the overlays were read from. */
  dir: string;
  /** `regions.<R>` bodies, raw (not env-interpolated), keyed by file stem. */
  regions: Record<string, Dict>;
  /** `countries.<ISO>` bodies, raw (not env-interpolated), keyed by file stem. */
  countries: Record<string, Dict>;
}

/** Use as `overlays` to merge nothing (opt out of the shipped overlays). */
export const EMPTY_OVERLAYS: BuiltinOverlays = Object.freeze({
  dir: "",
  regions: {},
  countries: {},
}) as BuiltinOverlays;

const REGION_FILE_RE = /^([A-Z][A-Z0-9_]*)\.ya?ml$/;
const COUNTRY_FILE_RE = /^([A-Z]{2})\.ya?ml$/;

function readOverlayDir(
  dir: string,
  fileRe: RegExp,
  kind: "region" | "country",
): Record<string, Dict> {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (e) {
    throw new ConfigError(
      `CONFIG_OVERLAY_DIR_UNREADABLE: ${dir}: ${(e as Error).message}`,
    );
  }
  const out: Record<string, Dict> = {};
  const schema = kind === "region" ? CountryLayerSchema : CountryEntrySchema;
  for (const name of names.sort()) {
    const m = fileRe.exec(name);
    if (!m) {
      if (/\.ya?ml$/.test(name))
        throw new ConfigError(
          `CONFIG_OVERLAY_NAME_INVALID: ${join(dir, name)}: ${kind} overlay files must be named <${kind === "region" ? "REGION" : "ISO2"}>.yaml`,
        );
      continue;
    }
    const path = join(dir, name);
    let raw: unknown;
    try {
      raw = parseYaml(readFileSync(path, "utf8"));
    } catch (e) {
      throw new ConfigError(
        `CONFIG_OVERLAY_INVALID: ${path}: ${(e as Error).message}`,
      );
    }
    if (raw === null || raw === undefined) raw = {};
    if (!isDict(raw))
      throw new ConfigError(
        `CONFIG_OVERLAY_INVALID: ${path}: top level must be a mapping`,
      );
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const issues = formatZodError(parsed.error);
      throw new ConfigError(
        `CONFIG_OVERLAY_INVALID: ${path}:\n  ${issues.join("\n  ")}`,
        issues,
      );
    }
    out[m[1]] = raw;
  }
  return out;
}

/**
 * Read `regions/*.yaml` and `countries/*.yaml` under `dir` (default: the
 * package's `config/`). Every file is validated against the zod layer schema;
 * a malformed file is a `ConfigError` (exit 5). Values are returned raw —
 * `${ENV}` references are resolved by `mergeOverlays`.
 */
export function loadBuiltinCountryOverlays(
  dir: string = BUILTIN_CONFIG_DIR,
): BuiltinOverlays {
  const regions = readOverlayDir(
    join(dir, "regions"),
    REGION_FILE_RE,
    "region",
  );
  const countries = readOverlayDir(
    join(dir, "countries"),
    COUNTRY_FILE_RE,
    "country",
  );
  log.debug(
    {
      dir,
      regions: Object.keys(regions),
      countries: Object.keys(countries),
    },
    "loaded builtin overlays",
  );
  return { dir, regions, countries };
}

// ---------------------------------------------------------------------------
// Lenient env interpolation (missing variables become sentinels that only
// count when they survive the merge)
// ---------------------------------------------------------------------------

const ENV_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;
const SENTINEL_PREFIX = "\u0000CONFIG_ENV_MISSING:";

interface MissingRef {
  path: string[];
  names: string[];
  sentinel: string;
}

function interpolateLenient(
  value: unknown,
  env: NodeJS.ProcessEnv,
  path: string[],
  missing: MissingRef[],
): unknown {
  if (typeof value === "string") {
    const names: string[] = [];
    const replaced = value.replace(ENV_RE, (_m, name: string, def?: string) => {
      const found = env[name];
      if (found !== undefined) return found;
      if (def !== undefined) return def;
      names.push(name);
      return "";
    });
    if (names.length === 0) return replaced;
    const sentinel = `${SENTINEL_PREFIX}${names.join(",")}@${path.join(".")}`;
    missing.push({ path, names, sentinel });
    return sentinel;
  }
  if (Array.isArray(value))
    return value.map((v, i) =>
      interpolateLenient(v, env, [...path, String(i)], missing),
    );
  if (isDict(value)) {
    const out: Dict = {};
    for (const [k, v] of Object.entries(value))
      out[k] = interpolateLenient(v, env, [...path, k], missing);
    return out;
  }
  return value;
}

function getAtPath(root: unknown, path: string[]): unknown {
  let cur: unknown = root;
  for (const seg of path) {
    if (Array.isArray(cur)) cur = cur[Number(seg)];
    else if (isDict(cur)) cur = cur[seg];
    else return undefined;
  }
  return cur;
}

// ---------------------------------------------------------------------------
// Deep merge (builtin ← user, user wins)
// ---------------------------------------------------------------------------

type FieldRow = { target?: unknown };

/** Keys whose object value is replaced wholesale (discriminated unions). */
const ATOMIC_KEYS = new Set(["auth"]);

function mergeRowsByTarget(base: unknown, over: unknown): unknown[] {
  const rows: FieldRow[] = Array.isArray(base)
    ? base.map((r) => (isDict(r) ? { ...r } : r))
    : [];
  for (const row of Array.isArray(over) ? over : []) {
    const target = isDict(row) ? row.target : undefined;
    const idx =
      target === undefined
        ? -1
        : rows.findIndex((r) => isDict(r) && r.target === target);
    if (idx >= 0) rows[idx] = row as FieldRow;
    else rows.push(row as FieldRow);
  }
  return rows;
}

function unionList(base: unknown, over: unknown): unknown[] {
  const out: unknown[] = Array.isArray(base) ? [...base] : [];
  for (const v of Array.isArray(over) ? over : [])
    if (!out.includes(v)) out.push(v);
  return out;
}

/** `objects.<key>.fields` block: rows by target, `remove` unioned, `required` merged. */
function mergeFieldsBlock(base: Dict, over: Dict): Dict {
  const out: Dict = { ...base };
  if ("add" in over) out.add = mergeRowsByTarget(base.add, over.add);
  if ("override" in over)
    out.override = mergeRowsByTarget(base.override, over.override);
  if ("remove" in over) out.remove = unionList(base.remove, over.remove);
  if ("required" in over && isDict(over.required))
    out.required = {
      ...(isDict(base.required) ? base.required : {}),
      ...over.required,
    };
  for (const [k, v] of Object.entries(over))
    if (!["add", "override", "remove", "required"].includes(k)) out[k] = v;
  return out;
}

/**
 * Deep merge `over` onto `base` (both copied). Objects merge recursively,
 * `fields` blocks by target; `auth` blocks, other arrays and scalars are
 * replaced.
 */
export function deepMergeOverlay(base: Dict, over: Dict | undefined): Dict {
  const out: Dict = {};
  for (const [k, v] of Object.entries(base))
    out[k] = isDict(v) ? deepMergeOverlay(v, undefined) : v;
  if (!over) return out;
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) continue;
    const cur = out[k];
    if (isDict(v) && isDict(cur) && !ATOMIC_KEYS.has(k)) {
      out[k] =
        k === "fields" && isFieldsBlock(v) && isFieldsBlock(cur)
          ? mergeFieldsBlock(cur, v)
          : deepMergeOverlay(cur, v);
    } else if (isDict(v)) {
      out[k] = deepMergeOverlay(v, undefined);
    } else {
      out[k] = Array.isArray(v) ? [...v] : v;
    }
  }
  return out;
}

function isFieldsBlock(v: Dict): boolean {
  const keys = Object.keys(v);
  return (
    keys.length === 0 ||
    keys.every((k) => ["add", "override", "remove", "required"].includes(k))
  );
}

// ---------------------------------------------------------------------------
// mergeOverlays
// ---------------------------------------------------------------------------

export interface MergeOverlaysOptions {
  /** Overlays to merge (default: `loadBuiltinCountryOverlays()`); `EMPTY_OVERLAYS` opts out. */
  overlays?: BuiltinOverlays;
  /** Environment for `${ENV}` references inside the shipped overlays (default `process.env`). */
  env?: NodeJS.ProcessEnv;
  /**
   * Merge every shipped country, not only those the user's `countries` block
   * references. Default `false`: an unreferenced overlay is never loaded, so
   * its env references are never required.
   */
  includeAll?: boolean;
}

/**
 * Put the shipped overlays beneath `config` and re-validate. Only countries
 * present in `config.countries` (or all of them with `includeAll`) are merged;
 * a region is added when a merged country (or the user) references it. The
 * result is a fresh, schema-parsed `MigrationConfig`; `config` is untouched.
 */
export function mergeOverlays(
  config: MigrationConfig,
  opts: MergeOverlaysOptions = {},
): MigrationConfig {
  const overlays = opts.overlays ?? loadBuiltinCountryOverlays();
  const env = opts.env ?? process.env;

  const userCountries = config.countries as Record<string, Dict>;
  const selected = opts.includeAll
    ? Object.keys(overlays.countries)
    : Object.keys(userCountries).filter((iso) => iso in overlays.countries);

  const missing: MissingRef[] = [];
  const countries: Record<string, Dict> = {};
  for (const [iso, entry] of Object.entries(userCountries))
    countries[iso] = deepMergeOverlay(entry, undefined);
  for (const iso of selected) {
    const builtin = interpolateLenient(
      overlays.countries[iso],
      env,
      ["countries", iso],
      missing,
    ) as Dict;
    countries[iso] = deepMergeOverlay(builtin, userCountries[iso]);
  }

  const userRegions = config.regions as Record<string, Dict>;
  const referencedRegions = new Set<string>(Object.keys(userRegions));
  for (const entry of Object.values(countries))
    if (typeof entry.region === "string") referencedRegions.add(entry.region);
  const regions: Record<string, Dict> = {};
  for (const [name, layer] of Object.entries(userRegions))
    regions[name] = deepMergeOverlay(layer, undefined);
  for (const [name, builtin] of Object.entries(overlays.regions)) {
    if (!referencedRegions.has(name)) continue;
    const interpolated = interpolateLenient(
      builtin,
      env,
      ["regions", name],
      missing,
    ) as Dict;
    regions[name] = deepMergeOverlay(interpolated, userRegions[name]);
  }

  const merged: Dict = { ...config, regions, countries };

  // A missing variable only matters when the user did not override the key.
  const unresolved = missing.filter(
    (m) => getAtPath(merged, m.path) === m.sentinel,
  );
  if (unresolved.length) {
    const names = [...new Set(unresolved.flatMap((m) => m.names))].sort();
    const where = unresolved
      .map((m) => `${m.path.join(".")} needs ${m.names.join(", ")}`)
      .join("; ");
    throw new ConfigError(
      `CONFIG_ENV_MISSING: undefined environment variable(s) required by builtin overlays: ${names.join(", ")} (${where})`,
      names,
    );
  }

  const parsed = MigrationConfigSchema.safeParse(merged);
  if (!parsed.success) {
    const issues = formatZodError(parsed.error);
    throw new ConfigError(
      `CONFIG_INVALID (after merging builtin overlays):\n  ${issues.join("\n  ")}`,
      issues,
    );
  }
  log.debug(
    {
      countries: selected,
      regions: Object.keys(regions).filter((r) => r in overlays.regions),
    },
    "merged builtin overlays",
  );
  return parsed.data;
}
