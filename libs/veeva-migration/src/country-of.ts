/**
 * `countryOf` grammar (§6.0.5, closed):
 *   field:<path> | account[:<field>] | user[:<field>] | parent:<key>[:<field>] | global | const:<ISO>
 * A rule list is an ordered fallback chain.
 */
import { isObjectKey, type CountryOfSpec } from "./types";

export class CountryOfError extends Error {
  readonly code = "MAP_COUNTRY_RULE_INVALID";
  constructor(rule: string, reason: string) {
    super(`Invalid countryOf rule "${rule}": ${reason}`);
  }
}

/** Parse one rule string. Throws `CountryOfError` (→ blocking `MAP_COUNTRY_RULE_INVALID`). */
export function parseCountryOfRule(rule: string): CountryOfSpec {
  const raw = rule.trim();
  if (raw === "global") return { kind: "global" };
  if (raw === "account") return { kind: "account" };
  if (raw === "user") return { kind: "user" };
  const idx = raw.indexOf(":");
  if (idx < 0) throw new CountryOfError(rule, "unknown rule");
  const head = raw.slice(0, idx);
  const rest = raw.slice(idx + 1);
  if (!rest) throw new CountryOfError(rule, "missing argument");
  switch (head) {
    case "field":
      return { kind: "field", path: rest };
    case "account":
      return { kind: "account", field: rest };
    case "user":
      return { kind: "user", field: rest };
    case "const": {
      if (!/^[A-Z]{2}$/.test(rest) && rest !== "GLOBAL")
        throw new CountryOfError(rule, "const needs an ISO-2 code");
      return { kind: "const", iso2: rest };
    }
    case "parent": {
      const [key, field] = rest.split(":");
      if (!isObjectKey(key))
        throw new CountryOfError(rule, `unknown parent object key "${key}"`);
      return field ? { kind: "parent", key, field } : { kind: "parent", key };
    }
    default:
      throw new CountryOfError(rule, `unknown rule head "${head}"`);
  }
}

/** Parse a rule or a fallback list (`string | string[]` from config/modules). */
export function parseCountryOf(
  rules: string | readonly string[] | readonly CountryOfSpec[],
): CountryOfSpec[] {
  const list = typeof rules === "string" ? [rules] : rules;
  if (list.length === 0) throw new CountryOfError("", "empty rule list");
  return list.map((r) => (typeof r === "string" ? parseCountryOfRule(r) : r));
}

/** Inverse of `parseCountryOfRule` (used for hashing and reports). */
export function formatCountryOf(spec: CountryOfSpec): string {
  switch (spec.kind) {
    case "global":
      return "global";
    case "field":
      return `field:${spec.path}`;
    case "account":
      return spec.field ? `account:${spec.field}` : "account";
    case "user":
      return spec.field ? `user:${spec.field}` : "user";
    case "parent":
      return spec.field
        ? `parent:${spec.key}:${spec.field}`
        : `parent:${spec.key}`;
    case "const":
      return `const:${spec.iso2}`;
  }
}

/**
 * `objects.territory.countryOf` is NOT a §6.0.5 rule: the territory unit is
 * global and the key selects how `country__v` is derived per row
 * (`fromUsers` | `prefixMap` | `field:<SFDC field>` | `const:<ISO-2>`, see
 * `objects/reference/territory.ts`). Config resolution keeps such a value in
 * the module options instead of parsing it as a countryOf rule.
 */
export function isTerritoryCountryRule(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  const text = raw.trim();
  return (
    text === "fromUsers" ||
    text === "prefixMap" ||
    (text.startsWith("field:") && text.length > 6) ||
    /^const:[A-Z]{2}$/.test(text)
  );
}

export function isGlobalCountryOf(specs: readonly CountryOfSpec[]): boolean {
  return specs.length === 1 && specs[0].kind === "global";
}

// ---------------------------------------------------------------------------
// SOQL predicate templates (§6.0.5)
// ---------------------------------------------------------------------------

/** `Account_vod__c → Account_vod__r`, `OwnerId → Owner`, `ParentId → Parent`. */
export function relationshipName(lookupField: string): string {
  if (/__c$/i.test(lookupField)) return lookupField.replace(/__c$/i, "__r");
  if (/Id$/.test(lookupField)) return lookupField.slice(0, -2);
  return lookupField;
}

export interface CountryPathOptions {
  /** `User.Country_vod__c` is a lookup (→ `.Country_vod__r.Alpha_2_Code_vod__c`) rather than a picklist; resolved at preflight. */
  userCountryIsLookup?: boolean;
  /** Org-specific account country path (default `Country_vod__r.Alpha_2_Code_vod__c`). */
  accountCountryPath?: string;
}

/**
 * SOQL path whose value is the ISO-2 for a rule, or `undefined` when the rule
 * is not expressible as a path (`parent:` without a relationship, `global`,
 * `const`). `parent:<key>:<field>` is expressed through the given lookup
 * field only when the parent's own rule is a field/account/user path — the
 * caller supplies `parentPath` for that.
 */
export function countryOfSoqlPath(
  spec: CountryOfSpec,
  opts: CountryPathOptions = {},
  parentPath?: string,
): string | undefined {
  const accountTail =
    opts.accountCountryPath ?? "Country_vod__r.Alpha_2_Code_vod__c";
  const userTail = opts.userCountryIsLookup
    ? "Country_vod__r.Alpha_2_Code_vod__c"
    : "Country_vod__c";
  switch (spec.kind) {
    case "field":
      return spec.path;
    case "account":
      return `${relationshipName(spec.field ?? "Account_vod__c")}.${accountTail}`;
    case "user":
      return `${relationshipName(spec.field ?? "User_vod__c")}.${userTail}`;
    case "parent":
      if (!spec.field || !parentPath) return undefined;
      return `${relationshipName(spec.field)}.${parentPath}`;
    case "global":
    case "const":
      return undefined;
  }
}

/**
 * Fallback-chain predicate (§6.0.5): `(a = 'X') OR (a = null AND b = 'X')`,
 * nested for longer chains. Returns `undefined` for global objects. Rules that
 * have no SOQL path are skipped (they must be applied by id-set).
 */
export function buildCountryPredicate(
  specs: readonly CountryOfSpec[],
  iso2: string,
  opts: CountryPathOptions = {},
  parentPaths: Record<string, string> = {},
): string | undefined {
  const paths: string[] = [];
  for (const s of specs) {
    if (s.kind === "global") return undefined;
    if (s.kind === "const") continue;
    const p = countryOfSoqlPath(
      s,
      opts,
      s.kind === "parent" ? parentPaths[s.key] : undefined,
    );
    if (p) paths.push(p);
  }
  if (!paths.length) return undefined;
  const lit = `'${iso2.replace(/'/g, "\\'")}'`;
  const terms = paths.map((p, i) => {
    const nulls = paths.slice(0, i).map((q) => `${q} = null`);
    return nulls.length
      ? `(${[...nulls, `${p} = ${lit}`].join(" AND ")})`
      : `(${p} = ${lit})`;
  });
  return terms.length === 1 ? terms[0] : terms.join(" OR ");
}
