/**
 * Country predicates and per-row attribution (§1.2, §6.0.5, §7.2).
 *
 * A module's `countryOf` is an ordered fallback chain. This module turns it
 * into one of three strategies:
 *  - `predicate`: every rule is expressible as a SOQL relationship path (≤ 5
 *    hops) → `(a = 'US') OR (a = null AND b = 'US')` (nested for longer
 *    chains, §6.0.5);
 *  - `idSet`: a `parent:<key>` rule whose parent country is not reachable by
 *    path → `ParentField IN (ids of parent rows attributed to the country)`;
 *  - `global` / `all` / `none`: no term (global objects, matching `const`),
 *    or an empty unit (`const` for another country).
 *
 * `parent:` rules are expanded by recursing into the parent module's own
 * chain (`Call2_vod__r.Account_vod__r.Country_vod__r.Alpha_2_Code_vod__c`),
 * taken from the registry unless the caller overrides `parentCountryOf`.
 *
 * `attributeCountry()` evaluates the same chain against an extracted row —
 * used for `country_unresolved` diagnostics and for closure/parent id-set
 * attribution.
 */
import {
  countryOfSoqlPath,
  relationshipName,
  type CountryPathOptions,
} from "../country-of";
import { getModule } from "../objects/registry";
import { readSource } from "../transform/apply";
import { to18 } from "../transform/ids";
import {
  GLOBAL_COUNTRY,
  type CountryOfSpec,
  type MaterialisedMapping,
  type ObjectKey,
  type SourceRow,
} from "../types";

/** §2.1.5: child→parent dot notation allowed up to 5 levels. */
export const MAX_RELATIONSHIP_HOPS = 5;

export interface CountryStrategyOptions extends CountryPathOptions {
  /** Parent module chain lookup (default: the object registry). */
  parentCountryOf?: (key: ObjectKey) => readonly CountryOfSpec[] | undefined;
  /**
   * Lookup field for a `parent:<key>` rule that names no field: the first
   * mapping row transformed with `ref(<key>)`. Defaults to scanning
   * `mapping.fields` when a mapping is given.
   */
  parentFieldFor?: (key: ObjectKey) => string | undefined;
  /** Maximum relationship hops (default 5). */
  maxHops?: number;
}

/** One rule after expansion. */
export interface ExpandedCountryRule {
  spec: CountryOfSpec;
  /** SOQL paths (a parent rule may expand to several). Empty when not expressible. */
  paths: string[];
  /** `parent:` rule that must be applied by id-set. */
  idSet?: { parentKey: ObjectKey; field: string };
  reason?: string;
}

export type CountryStrategy =
  | { kind: "global" }
  /** `const:<ISO>` matching the unit (alone or as the chain's tail) → every row not claimed by an earlier path. */
  | { kind: "all"; predicate?: string; paths: string[] }
  /** `const:<other ISO>` alone → nothing belongs to this unit. */
  | { kind: "none" }
  | { kind: "predicate"; predicate: string; paths: string[] }
  | {
      kind: "idSet";
      parentKey: ObjectKey;
      field: string;
      /** Paths of the rules that *are* expressible (evaluated per row as a first chance). */
      paths: string[];
      /** Predicate over the expressible rules only (`undefined` when none). */
      partialPredicate?: string;
    };

function hops(path: string): number {
  return path.split(".").length - 1;
}

/** Default `parentFieldFor`: first `ref(<key>)` row of the mapping (unwrapping `secondPass`). */
export function parentFieldFromMapping(
  mapping: Pick<MaterialisedMapping, "fields"> | undefined,
): (key: ObjectKey) => string | undefined {
  return (key) => {
    if (!mapping) return undefined;
    for (const f of mapping.fields) {
      const t =
        f.transform.kind === "secondPass" ? f.transform.inner : f.transform;
      if (t.kind === "ref" && t.objectKey === key && f.source) return f.source;
    }
    return undefined;
  };
}

function registryCountryOf(
  key: ObjectKey,
): readonly CountryOfSpec[] | undefined {
  try {
    return getModule(key).countryOf;
  } catch {
    return undefined;
  }
}

/**
 * Expand a chain into SOQL paths, recursing through `parent:` rules
 * (`parent:call2:Call2_vod__c` → the call's own chain prefixed with
 * `Call2_vod__r.`). Rules deeper than `maxHops` or without a reachable path
 * are reported with `idSet`/`reason` and no paths.
 */
export function expandCountryRules(
  specs: readonly CountryOfSpec[],
  opts: CountryStrategyOptions = {},
  depth = 0,
  visited: ReadonlySet<ObjectKey> = new Set(),
): ExpandedCountryRule[] {
  const maxHops = opts.maxHops ?? MAX_RELATIONSHIP_HOPS;
  const parentCountryOf = opts.parentCountryOf ?? registryCountryOf;
  const out: ExpandedCountryRule[] = [];
  for (const spec of specs) {
    if (spec.kind === "global" || spec.kind === "const") {
      out.push({ spec, paths: [] });
      continue;
    }
    if (spec.kind !== "parent") {
      const p = countryOfSoqlPath(spec, opts);
      out.push({ spec, paths: p ? [p] : [] });
      continue;
    }
    const field = spec.field ?? opts.parentFieldFor?.(spec.key);
    if (!field) {
      out.push({
        spec,
        paths: [],
        reason: `parent:${spec.key} names no lookup field and the mapping has no ref(${spec.key}) row`,
      });
      continue;
    }
    const parentSpecs = parentCountryOf(spec.key);
    if (!parentSpecs || visited.has(spec.key)) {
      out.push({
        spec,
        paths: [],
        idSet: { parentKey: spec.key, field },
        reason: visited.has(spec.key)
          ? `parent chain through ${spec.key} is cyclic`
          : `no countryOf chain known for parent ${spec.key}`,
      });
      continue;
    }
    const rel = relationshipName(field);
    const inner = expandCountryRules(
      parentSpecs,
      opts,
      depth + 1,
      new Set([...visited, spec.key]),
    );
    const paths: string[] = [];
    let unexpressible: string | undefined;
    for (const r of inner) {
      if (r.spec.kind === "global") continue; // a global parent carries no country
      if (r.spec.kind === "const") continue;
      if (!r.paths.length) {
        unexpressible =
          r.reason ?? `parent rule ${r.spec.kind} not expressible`;
        continue;
      }
      for (const p of r.paths) {
        const full = `${rel}.${p}`;
        if (hops(full) > maxHops) {
          unexpressible = `path ${full} exceeds ${maxHops} relationship hops`;
          continue;
        }
        paths.push(full);
      }
    }
    if (unexpressible || !paths.length) {
      out.push({
        spec,
        paths,
        idSet: { parentKey: spec.key, field },
        reason: unexpressible ?? `parent ${spec.key} has no country path`,
      });
    } else {
      out.push({ spec, paths });
    }
  }
  return out;
}

function lit(iso2: string): string {
  return `'${iso2.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/**
 * Nested fallback predicate (§6.0.5): `(a = 'US') OR (a = null AND b = 'US')`.
 * `constTail` = the chain ends in `const:<this ISO>` → every row whose paths
 * are all null is claimed too (`… OR (a = null AND b = null)`).
 */
export function chainPredicate(
  paths: readonly string[],
  iso2: string,
  constTail = false,
): string | undefined {
  const value = lit(iso2);
  const terms = paths.map((p, i) => {
    const nulls = paths.slice(0, i).map((q) => `${q} = null`);
    return `(${[...nulls, `${p} = ${value}`].join(" AND ")})`;
  });
  if (constTail && paths.length)
    terms.push(`(${paths.map((q) => `${q} = null`).join(" AND ")})`);
  if (!terms.length) return undefined;
  return terms.join(" OR ");
}

/** Choose how a unit's rows are selected by country. */
export function buildCountryStrategy(
  specs: readonly CountryOfSpec[],
  iso2: string,
  opts: CountryStrategyOptions = {},
): CountryStrategy {
  if (specs.some((s) => s.kind === "global")) return { kind: "global" };
  if (iso2 === GLOBAL_COUNTRY) return { kind: "global" };
  const rules = expandCountryRules(specs, opts);
  const paths: string[] = [];
  let idSet: { parentKey: ObjectKey; field: string } | undefined;
  let constMatch = false;
  let constOther = false;
  for (const r of rules) {
    if (r.spec.kind === "const") {
      if (r.spec.iso2 === iso2) {
        constMatch = true;
        break; // the chain is decided here for every remaining row
      }
      constOther = true;
      continue;
    }
    if (r.idSet && !idSet) {
      // expressible paths collected so far still narrow the query; the
      // parent id-set decides the rest (applied client-side or by IN lists)
      idSet = r.idSet;
      paths.push(...r.paths);
      continue;
    }
    paths.push(...r.paths);
  }
  if (idSet) {
    return {
      kind: "idSet",
      parentKey: idSet.parentKey,
      field: idSet.field,
      paths,
      partialPredicate: chainPredicate(paths, iso2),
    };
  }
  if (constMatch) {
    return { kind: "all", predicate: chainPredicate(paths, iso2, true), paths };
  }
  if (!paths.length) {
    if (constOther) return { kind: "none" };
    // nothing expressible and no parent rule (e.g. a module whose chain only
    // holds unexpressible rules) — behave as global rather than dropping rows
    return { kind: "global" };
  }
  return { kind: "predicate", predicate: chainPredicate(paths, iso2)!, paths };
}

export interface AttributeOptions extends CountryStrategyOptions {
  /** Parent country by (parentKey, parent 18-char id) for `parent:` rules that have no path (id map / this run). */
  parentCountry?: (
    parentKey: ObjectKey,
    parentId: string,
  ) => string | undefined;
}

function nonEmpty(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s ? s : undefined;
}

/**
 * Attribute one row to a country by evaluating the chain in order (§6.0.5:
 * the first rule whose path is non-null decides). Returns `GLOBAL` for
 * global chains, the ISO-2 (upper-cased) otherwise, or `undefined` when no
 * rule yields a value (→ `skipped(country_unresolved)`).
 */
export function attributeCountry(
  row: SourceRow,
  specs: readonly CountryOfSpec[],
  opts: AttributeOptions = {},
): string | undefined {
  const rules = expandCountryRules(specs, opts);
  for (const r of rules) {
    if (r.spec.kind === "global") return GLOBAL_COUNTRY;
    if (r.spec.kind === "const") return r.spec.iso2;
    for (const p of r.paths) {
      const v = nonEmpty(readSource(row, p));
      if (v) return v.toUpperCase();
    }
    if (r.spec.kind === "parent") {
      const field =
        r.idSet?.field ?? r.spec.field ?? opts.parentFieldFor?.(r.spec.key);
      const parentId = field ? nonEmpty(readSource(row, field)) : undefined;
      if (parentId && opts.parentCountry) {
        const c = opts.parentCountry(r.spec.key, to18(parentId));
        if (c) return c;
      }
    }
  }
  return undefined;
}

/** Relationship columns the country strategy reads (selected for attribution/reporting). */
export function countryColumns(strategy: CountryStrategy): string[] {
  switch (strategy.kind) {
    case "global":
    case "none":
      return [];
    case "idSet":
      return [...strategy.paths, strategy.field];
    default:
      return [...strategy.paths];
  }
}
