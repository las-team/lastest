/**
 * Classification of Salesforce profiles into rep categories and countries.
 *
 * Pure functions — no I/O — so they can be unit-tested against synthetic
 * snapshots and re-run over a stored snapshot with different rules.
 */
import {
  cmp,
  computeBaseline,
  computeDeltas,
  type BaselineConfig,
} from "./baseline";
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
  type UserSummary,
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
  /**
   * Keep profiles with 0 active users in the Vault plan (DESIGN §2.2). They
   * are always classified and documented; this flag is read by the planner.
   */
  keepEmptyProfiles?: boolean;
}

/** Share of a profile's users a single country must hold for the profile NOT to count as shared. */
export const SHARED_DOMINANCE_THRESHOLD = 0.8;

/** Permission sets whose name marks a medical / MSL persona (DESIGN §2.1 step 4). */
const MEDICAL_PERMISSION_SET = /medical|\bmsl\b/i;

/** Licences that never carry a field user (DESIGN §2.1 step 4). */
const ADMIN_LICENSES = new Set([
  "salesforce platform",
  "salesforce integration",
  "identity",
]);

/** `User_Type_vod__c` value → active users, from the profile aggregate or the snapshot's user summary. */
export function repTypeCountsFor(
  profile: Pick<ProfileConfig, "id" | "name" | "repTypeCounts">,
  users: readonly UserSummary[] | undefined,
): Record<string, number> {
  if (profile.repTypeCounts && Object.keys(profile.repTypeCounts).length)
    return profile.repTypeCounts;
  const counts: Record<string, number> = {};
  for (const u of users ?? []) {
    if (u.profileId !== profile.id && u.profileName !== profile.name) continue;
    if (!u.userType) continue;
    counts[u.userType] = (counts[u.userType] ?? 0) + u.activeUsers;
  }
  return counts;
}

/** The most common non-empty `User_Type_vod__c` value, ties → alphabetical; `null` when there is none. */
export function majorityRepType(
  counts: Record<string, number>,
): { value: string; count: number } | null {
  const sorted = Object.entries(counts)
    .filter(([v, n]) => v.trim() && n > 0)
    .sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]));
  const top = sorted[0];
  return top ? { value: top[0], count: top[1] } : null;
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
  snapshot: Pick<OrgSnapshot, "vmocs" | "countries"> &
    Partial<Pick<OrgSnapshot, "users">>,
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
    // Step 3: User_Type_vod__c majority among the profile's active users.
    if (category === "other") {
      const top = majorityRepType(repTypeCountsFor(profile, snapshot.users));
      if (top) {
        const byType = classifyProfileName(top.value, rules);
        if (byType.category !== "other") {
          category = byType.category;
          rationale.push(
            `category "${category}" from majority User_Type_vod__c "${top.value}" (${top.count} active users) matching /${byType.rule!.pattern}/i`,
          );
        } else {
          rationale.push(
            `majority User_Type_vod__c "${top.value}" matched no classification rule`,
          );
        }
      }
    }
    // Step 4: permission-set / licence hints.
    if (category === "other") {
      const medical = profile.permissionSetNames.filter((n) =>
        MEDICAL_PERMISSION_SET.test(n),
      );
      const licence = profile.userLicense.trim().toLowerCase();
      const mobileVmocs = snapshot.vmocs.filter(
        (v) => v.active && v.profile === profile.name,
      ).length;
      if (medical.length) {
        category = "msl";
        rationale.push(
          `category "msl": users hold medical permission set ${medical.join(", ")}`,
        );
      } else if (ADMIN_LICENSES.has(licence)) {
        category = "admin";
        rationale.push(
          `category "admin": user licence "${profile.userLicense}" carries no field users`,
        );
      } else if (
        profile.userPermissions?.includes("PermissionsModifyAllData") &&
        mobileVmocs === 0
      ) {
        category = "admin";
        rationale.push(
          'category "admin": PermissionsModifyAllData with no active VMOC (0 mobile users)',
        );
      }
    }
  }

  let countries: CountryCode[];
  let shared = false;
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
    const userCounts = Object.entries(profile.activeUsersByCountry).filter(
      ([code, n]) => n > 0 && code !== GLOBAL_COUNTRY,
    );
    const total = userCounts.reduce((a, [, n]) => a + n, 0);
    const top = Math.max(0, ...userCounts.map(([, n]) => n));
    if (
      !fromName.length &&
      userCounts.length >= 2 &&
      top < SHARED_DOMINANCE_THRESHOLD * total
    ) {
      shared = true;
      rationale.push(
        `shared: users in ${userCounts.length} countries, largest share ${Math.round((100 * top) / total)}% < ${Math.round(SHARED_DOMINANCE_THRESHOLD * 100)}%, no country token in the name`,
      );
    }
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

  const result: ClassifiedProfile = { profile, category, countries, rationale };
  if (shared) result.shared = true;
  return result;
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

  const baselines = new Map<RepCategory, BaselineConfig>();
  const baselineFor = (category: RepCategory): BaselineConfig => {
    let b = baselines.get(category);
    if (!b) {
      b = computeBaseline(category, profiles, snapshot);
      baselines.set(category, b);
    }
    return b;
  };

  for (const [code, cats] of [...byCountry.entries()].sort(([a], [b]) =>
    cmp(a, b),
  )) {
    const repConfigs = [...cats.entries()]
      .sort(([a], [b]) => cmp(a, b))
      .map(([category, ps]) => {
        const rep = buildRepConfig(code, category, ps, snapshot);
        const baseline = baselineFor(category);
        rep.baselineProfile = baseline.profile;
        rep.deltas =
          code === GLOBAL_COUNTRY ? [] : computeDeltas(code, rep, baseline);
        return rep;
      });
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
  countries.sort((a, b) => cmp(a.country.code, b.country.code));

  return { snapshot, profiles, countries, global };
}
