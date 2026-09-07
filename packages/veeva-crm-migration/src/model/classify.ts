/**
 * Classification of Salesforce profiles into rep categories and countries.
 *
 * Pure functions — no I/O — so they can be unit-tested against synthetic
 * snapshots and re-run over a stored snapshot with different rules.
 */
import {
  GLOBAL_COUNTRY,
  type ClassificationRule,
  type ClassifiedProfile,
  type ClassifiedSnapshot,
  type CountryCode,
  type CountryConfig,
  type CountryRef,
  type CountryRepConfig,
  type LayoutConfig,
  type OrgSnapshot,
  type ProfileConfig,
  type RepCategory,
  type VeevaMessage,
  type VeevaSettingRecord,
  type VmocConfig,
} from "./types";

/**
 * Default profile-name → rep category rules. First match wins, so the more
 * specific patterns come first. Callers can prepend their own rules.
 *
 * Naming follows what Veeva ships and what customers commonly clone:
 * "Sales Rep", "Specialty Rep", "Key Account Manager", "MSL", "Medical Science
 * Liaison", "Manager", "Inside Sales", "Business Admin", "System Administrator".
 */
export const DEFAULT_CLASSIFICATION_RULES: readonly ClassificationRule[] = [
  {
    pattern: "system\\s*admin|sys\\s*admin|integration|api\\s*user",
    category: "admin",
  },
  {
    pattern: "business\\s*admin|content\\s*admin|\\badmin\\b|administrator",
    category: "admin",
  },
  {
    pattern: "\\bmsl\\b|medical\\s*science|medical\\s*liaison|\\bmedical\\b",
    category: "msl",
  },
  {
    pattern: "\\bkam\\b|key\\s*account|account\\s*manager|\\bkae\\b",
    category: "kam",
  },
  {
    pattern:
      "inside\\s*sales|tele\\s*sales|remote\\s*rep|virtual\\s*rep|call\\s*cent",
    category: "inside_sales",
  },
  {
    pattern:
      "manager|\\bflm\\b|\\bslm\\b|\\brbm\\b|\\bdsm\\b|\\bnsm\\b|director|head\\s*of|leader",
    category: "manager",
  },
  {
    pattern:
      "special|hospital|oncolog|\\bspecialty\\b|\\bhsr\\b|therapy\\s*area",
    category: "specialty_rep",
  },
  {
    pattern:
      "sales|\\brep\\b|representative|field\\s*force|\\bpsr\\b|\\bmr\\b|primary\\s*care|\\bgp\\b",
    category: "sales_rep",
  },
];

/** Matches a leading or trailing 2-letter country code: "DE Sales Rep", "Sales Rep - FR", "Sales_Rep_IT". */
const COUNTRY_TOKEN = /(?:^|[\s_\-/(\[])([A-Z]{2})(?=$|[\s_\-/)\]:])/g;

export interface ClassifyOptions {
  rules?: readonly ClassificationRule[];
  /** Known country codes (from the snapshot); used to accept profile-name tokens. */
  knownCountries?: readonly CountryCode[];
  /** Explicit overrides: profile name → category. Wins over rules. */
  categoryOverrides?: Record<string, RepCategory>;
  /** Explicit overrides: profile name → countries. Wins over inference. */
  countryOverrides?: Record<string, CountryCode[]>;
}

export function classifyProfileName(
  name: string,
  rules: readonly ClassificationRule[] = DEFAULT_CLASSIFICATION_RULES,
): { category: RepCategory; rule: ClassificationRule | null } {
  for (const rule of rules) {
    if (new RegExp(rule.pattern, "i").test(name))
      return { category: rule.category, rule };
  }
  return { category: "other", rule: null };
}

/** Extracts country codes embedded in a profile name, filtered to known countries when given. */
export function countriesFromProfileName(
  name: string,
  knownCountries?: readonly CountryCode[],
): CountryCode[] {
  const found = new Set<CountryCode>();
  for (const m of name.matchAll(COUNTRY_TOKEN)) {
    const code = m[1]!;
    if (!knownCountries || knownCountries.includes(code)) found.add(code);
  }
  return [...found];
}

/** Extracts country codes from a VMOC where clause such as `Country_vod__c = 'DE'` or `IN ('DE','AT')`. */
export function countriesFromWhereClause(
  where: string | null | undefined,
): CountryCode[] {
  if (!where) return [];
  const found = new Set<CountryCode>();
  const re =
    /country[\w]*\s*(?:=|in)\s*\(?\s*((?:'[A-Za-z]{2}'\s*,?\s*)+)\)?/gi;
  for (const m of where.matchAll(re)) {
    for (const c of m[1]!.matchAll(/'([A-Za-z]{2})'/g))
      found.add(c[1]!.toUpperCase());
  }
  return [...found];
}

export function classifyProfile(
  profile: ProfileConfig,
  snapshot: Pick<OrgSnapshot, "vmocs" | "countries">,
  options: ClassifyOptions = {},
): ClassifiedProfile {
  const rationale: string[] = [];
  const rules = options.rules ?? DEFAULT_CLASSIFICATION_RULES;
  const known = options.knownCountries ?? snapshot.countries.map((c) => c.code);

  let category: RepCategory;
  const override = options.categoryOverrides?.[profile.name];
  if (override) {
    category = override;
    rationale.push(`category "${override}" set by override`);
  } else {
    const res = classifyProfileName(profile.name, rules);
    category = res.category;
    rationale.push(
      res.rule
        ? `category "${category}" from profile name matching /${res.rule.pattern}/i`
        : `category "other": no classification rule matched "${profile.name}"`,
    );
  }

  let countries: CountryCode[];
  const cOverride = options.countryOverrides?.[profile.name];
  if (cOverride) {
    countries = [...cOverride];
    rationale.push(`countries ${countries.join(", ")} set by override`);
  } else {
    const fromUsers = Object.entries(profile.activeUsersByCountry)
      .filter(([code, n]) => n > 0 && code !== GLOBAL_COUNTRY)
      .sort((a, b) => b[1] - a[1])
      .map(([code]) => code);
    const fromName = countriesFromProfileName(
      profile.name,
      known.length ? known : undefined,
    );
    const fromVmoc = snapshot.vmocs
      .filter((v) => v.profile === profile.name)
      .flatMap((v) => countriesFromWhereClause(v.whereClause));

    countries = [...new Set([...fromName, ...fromUsers, ...fromVmoc])];
    if (fromName.length)
      rationale.push(`profile name carries country ${fromName.join(", ")}`);
    if (fromUsers.length)
      rationale.push(`active users in ${fromUsers.join(", ")}`);
    if (fromVmoc.length)
      rationale.push(`VMOC where clauses filter on ${fromVmoc.join(", ")}`);
    if (!countries.length) {
      countries = [GLOBAL_COUNTRY];
      rationale.push("no country signal: treated as global");
    }
  }

  return { profile, category, countries, rationale };
}

function settingApplies(
  s: VeevaSettingRecord,
  profileNames: Set<string>,
): boolean {
  return (
    s.level === "profile" &&
    s.ownerName !== null &&
    profileNames.has(s.ownerName)
  );
}

function buildRepConfig(
  country: CountryCode,
  category: RepCategory,
  profiles: ClassifiedProfile[],
  snapshot: OrgSnapshot,
): CountryRepConfig {
  const profileNames = new Set(profiles.map((p) => p.profile.name));
  const layoutNames = new Set(
    profiles.flatMap((p) => p.profile.layoutAssignments.map((l) => l.layout)),
  );
  const layouts: LayoutConfig[] = snapshot.objects
    .flatMap((o) => o.layouts)
    .filter((l) => layoutNames.has(l.fullName));
  const vmocs: VmocConfig[] = snapshot.vmocs.filter(
    (v) => v.profile !== null && profileNames.has(v.profile),
  );
  const settings = snapshot.veevaSettings.filter((s) =>
    settingApplies(s, profileNames),
  );
  const messages: VeevaMessage[] =
    country === GLOBAL_COUNTRY
      ? snapshot.messages.filter((m) => m.country === null)
      : snapshot.messages.filter((m) => m.country === country);
  return { country, category, profiles, layouts, vmocs, settings, messages };
}

/**
 * Builds the full country × rep-category matrix. A profile serving several
 * countries appears under each of them; profiles with no country signal go to
 * the `global` bucket, together with org-level settings and VMOCs without a
 * profile.
 */
export function classifySnapshot(
  snapshot: OrgSnapshot,
  options: ClassifyOptions = {},
): ClassifiedSnapshot {
  const profiles = snapshot.profiles.map((p) =>
    classifyProfile(p, snapshot, options),
  );

  const byCountry = new Map<
    CountryCode,
    Map<RepCategory, ClassifiedProfile[]>
  >();
  for (const cp of profiles) {
    for (const country of cp.countries) {
      const cats =
        byCountry.get(country) ?? new Map<RepCategory, ClassifiedProfile[]>();
      cats.set(cp.category, [...(cats.get(cp.category) ?? []), cp]);
      byCountry.set(country, cats);
    }
  }

  const refs = new Map<CountryCode, CountryRef>(
    snapshot.countries.map((c) => [c.code, c]),
  );
  const countries: CountryConfig[] = [];
  let global: CountryRepConfig[] = [];

  for (const [code, cats] of [...byCountry.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const repConfigs = [...cats.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, ps]) => buildRepConfig(code, category, ps, snapshot));
    if (code === GLOBAL_COUNTRY) {
      global = repConfigs;
      continue;
    }
    const ref = refs.get(code) ?? { code, name: code, activeUsers: 0 };
    countries.push({ country: ref, repConfigs });
  }

  // Countries that exist in the org but have no profile mapped still get a page.
  for (const ref of snapshot.countries) {
    if (
      ref.code !== GLOBAL_COUNTRY &&
      !countries.some((c) => c.country.code === ref.code)
    ) {
      countries.push({ country: ref, repConfigs: [] });
    }
  }
  countries.sort((a, b) => a.country.code.localeCompare(b.country.code));

  return { snapshot, profiles, countries, global };
}
