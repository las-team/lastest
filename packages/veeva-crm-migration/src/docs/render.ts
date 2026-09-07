/**
 * Documentation renderer (DESIGN §5): turns a {@link ClassifiedSnapshot}
 * into Markdown files organised as "global core + local delta".
 *
 *   README.md              index: org facts, countries, global bucket, warnings, rules, links
 *   profiles.md            every profile → category, countries, rationale
 *   intake-template.md     pre-filled specification request per country (research doc 04 §2)
 *   global/README.md       non-country-specific configuration
 *   global/<category>.md   baseline per rep category
 *   <CC>/README.md         country overview + delta summary vs global
 *   <CC>/<category>.md     country × rep category detail + delta table + open questions
 *
 * Pure and deterministic: output is sorted everywhere and the clock is
 * injectable (no `Date.now()` unless `options.now` is given).
 */
import {
  ABSENT,
  UNSET,
  fieldKey,
  layoutKey,
  recordTypeKey,
  renderFieldPermission,
  renderRecordTypeVisibility,
  renderSettingValue,
  settingKey,
  vmocKey,
} from "../model/baseline";
import {
  GLOBAL_COUNTRY,
  type ApplicationVisibility,
  type ClassifiedSnapshot,
  type CountryConfig,
  type CountryRepConfig,
  type DeltaItem,
  type FieldPermission,
  type LayoutConfig,
  type ObjectPermission,
  type RecordTypeVisibility,
  type TabVisibility,
  type VeevaMessage,
  type VmocConfig,
} from "../model/types";
import {
  buildContext,
  categoryLabel,
  dirName,
  disposition,
  langBase,
  languagesOf,
  profilesSorted,
  totalUsers,
  userTypesOf,
  usersByCountry,
  usersIn,
  vmocCountries,
  type Ctx,
  type RenderOptions,
} from "./context";
import { renderIntake } from "./intake";
import {
  bullets,
  check,
  checklist,
  clip,
  cmp,
  code,
  details,
  esc,
  fence,
  joinDoc,
  link,
  sorted,
  table,
  unique,
} from "./markdown";

export type { RenderOptions } from "./context";

export interface RenderedDoc {
  /** Path relative to the docs directory, forward slashes (e.g. `DE/sales_rep.md`). */
  path: string;
  content: string;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function renderDocs(
  classified: ClassifiedSnapshot,
  options: RenderOptions = {},
): RenderedDoc[] {
  const ctx = buildContext(classified, options);
  const docs: RenderedDoc[] = [
    { path: "README.md", content: renderIndex(ctx) },
    { path: "profiles.md", content: renderProfiles(ctx) },
    { path: "intake-template.md", content: renderIntake(ctx) },
    { path: "global/README.md", content: renderGlobalIndex(ctx) },
  ];
  for (const rep of classified.global) {
    docs.push({
      path: `global/${rep.category}.md`,
      content: renderRepCategory(rep, ctx),
    });
  }
  for (const country of classified.countries) {
    const dir = dirName(country.country.code);
    docs.push({
      path: `${dir}/README.md`,
      content: renderCountryIndex(country, ctx),
    });
    for (const rep of country.repConfigs) {
      docs.push({
        path: `${dir}/${rep.category}.md`,
        content: renderRepCategory(rep, ctx),
      });
    }
  }
  return docs.sort((a, b) => cmp(a.path, b.path));
}

// ---------------------------------------------------------------------------
// README.md
// ---------------------------------------------------------------------------

export function renderIndex(ctx: Ctx): string {
  const { snapshot, classified } = ctx;
  const parts: string[] = [];
  parts.push(`# ${ctx.title}`, ctx.header);

  parts.push(
    "## How to read this",
    [
      "This is the **as-is** functional configuration of the Veeva CRM org, taken from the snapshot named above — nothing here is a to-be decision.",
      "It is organised as a **global core plus local deltas**: `global/<category>.md` is what every country inherits for a rep category (the *baseline*), and `<CC>/<category>.md` documents the same sections for the country's own profiles and ends with a *Delta vs global* table.",
      'Only differences are listed in a delta; **absence means inheritance** — "same as global" is never written down.',
      "Each country × category page closes with an *Open questions* checklist generated from gaps in the snapshot, and `intake-template.md` is the pre-filled specification request: the country business admin only confirms or corrects the deltas.",
      "Legend: `✓` granted / on, `·` not granted / off, `◐` differs between the profiles of a category, `Δ` differs from the global baseline, `(unset)` no value at any level, `(none)` item absent.",
    ].join(" "),
  );

  const activeUsers = snapshot.countries.reduce((a, c) => a + c.activeUsers, 0);
  const orgRows: string[][] = [
    ["Instance URL", code(snapshot.instanceUrl)],
    ["Org id", snapshot.orgId ? code(snapshot.orgId) : "_unknown_"],
    ["Org name", snapshot.orgName ? esc(snapshot.orgName) : "_unknown_"],
    ["API version", code(snapshot.apiVersion)],
    ["Extracted at", code(snapshot.extractedAt)],
    ["Profiles", String(snapshot.profiles.length)],
    ["Permission sets", String(snapshot.permissionSets.length)],
    ["Objects extracted", String(snapshot.objects.length)],
    ["Countries", String(snapshot.countries.length)],
    ["Active users (all countries)", String(activeUsers)],
    ["VMOCs", String(snapshot.vmocs.length)],
    ["Veeva Setting records", String(snapshot.veevaSettings.length)],
    ["Veeva Messages", String(snapshot.messages.length)],
    ["Extraction warnings", String(snapshot.warnings.length)],
  ];
  if (snapshot.limits)
    orgRows.push([
      "API requests used",
      `${snapshot.limits.requestsUsed} (${snapshot.limits.dailyApiRequestsRemaining} of ${snapshot.limits.dailyApiRequestsMax} daily remaining)`,
    ]);
  if (snapshot.extract)
    orgRows.push(
      [
        "Profile metadata available",
        check(snapshot.extract.profileMetadataAvailable),
      ],
      ["Objects requested", String(snapshot.extract.objectsRequested.length)],
    );
  parts.push("## Org", table(["Property", "Value"], orgRows));

  const countryRows = classified.countries.map((c) => {
    const cats = unique(c.repConfigs.map((r) => r.category));
    const profiles = unique(
      c.repConfigs.flatMap((r) => r.profiles.map((p) => p.profile.name)),
    );
    const deltas = c.repConfigs.reduce(
      (a, r) => a + (r.deltas?.length ?? 0),
      0,
    );
    const dir = dirName(c.country.code);
    return [
      code(c.country.code),
      esc(c.country.name),
      String(c.country.activeUsers),
      cats.map(categoryLabel).join(", ") || "_none_",
      String(profiles.length),
      String(deltas),
      link(`${dir}/README.md`, `${dir}/README.md`),
    ];
  });
  parts.push(
    "## Countries",
    table(
      [
        "Code",
        "Name",
        "Active users",
        "Rep categories",
        "Profiles",
        "Deltas",
        "Doc",
      ],
      countryRows,
      "_No country could be derived from the snapshot._",
    ),
  );

  const globalRows = classified.global.map((r) => [
    categoryLabel(r.category),
    String(r.profiles.length),
    String(r.profiles.reduce((a, p) => a + totalUsers(p.profile), 0)),
    r.baselineProfile ? code(r.baselineProfile) : "_synthetic (majority vote)_",
    link(`global/${r.category}.md`, `global/${r.category}.md`),
  ]);
  const orgSettingFields = Object.keys(ctx.orgSettings).length;
  const orgSettingObjects = unique(
    snapshot.veevaSettings
      .filter((s) => s.level === "org")
      .map((s) => s.settingObject),
  ).length;
  const vmocsNoProfile = snapshot.vmocs.filter((v) => v.profile === null);
  const globalMessages = snapshot.messages.filter((m) => m.country === null);
  parts.push(
    "## Global bucket",
    "Profiles with no country signal, plus everything that is not country specific. Details in " +
      link("global/README.md", "global/README.md") +
      ".",
    table(
      ["Category", "Profiles", "Active users", "Baseline profile", "Doc"],
      globalRows,
      "_No profile landed in the global bucket; every category baseline is a synthetic majority vote._",
    ),
    bullets([
      `Org-level Veeva Settings: **${orgSettingFields}** fields across **${orgSettingObjects}** setting objects`,
      `VMOCs without a profile (apply to everyone): **${vmocsNoProfile.length}** (${vmocsNoProfile.filter((v) => v.active).length} active)`,
      `Global Veeva Messages (no country): **${globalMessages.length}** in ${unique(globalMessages.map((m) => m.language)).length} languages`,
      `Automation items inventoried: **${snapshot.automation?.length ?? 0}**` +
        (snapshot.automation?.some((a) => a.countryLogic)
          ? ` (${snapshot.automation.filter((a) => a.countryLogic).length} with country logic)`
          : ""),
    ]),
  );

  const warnings = sorted(
    snapshot.warnings,
    (w) => w.stage,
    (w) => w.message,
  );
  parts.push(
    "## Extraction warnings",
    `${warnings.length} warning${warnings.length === 1 ? " was" : "s were"} recorded during extraction. They mark places where the snapshot is incomplete, so the documents derived from those areas need extra scrutiny.`,
    table(
      ["Stage", "Message"],
      warnings.map((w) => [code(w.stage), esc(w.message)]),
      "_No extraction warnings._",
    ),
  );

  parts.push(
    "## Classification rules",
    [
      "Profiles are classified into rep categories and countries by `model/classify.ts`:",
      "1. an explicit override wins;",
      "2. otherwise the first rule below whose pattern (case-insensitive regex) matches the profile name;",
      "3. no match → the majority `User_Type_vod__c` value of the profile's active users is tested against the same rules;",
      "4. still no match → medical permission sets mark `msl`, a platform / integration licence or `ModifyAllData` without any VMOC marks `admin`; everything else is `other`.",
      "Countries come from the profile's active users (`User.Country_Code_vod__c` etc.), a country token in the profile name, and VMOC where clauses; a profile with users in ≥ 2 countries where no country holds ≥ 80 % and no name token exists is **shared** and appears under every country it serves. Profiles with no country signal go to the global bucket.",
      `The rule that fired for each profile is recorded in ${link("profiles.md", "profiles.md")}.`,
    ].join("\n"),
    table(
      ["#", "Pattern", "Category"],
      ctx.rules.map((r, i) => [
        String(i + 1),
        code(r.pattern),
        categoryLabel(r.category),
      ]),
    ),
  );

  const links: string[] = [
    link("profiles.md", "profiles.md") + " — profile classification",
    link("intake-template.md", "intake-template.md") +
      " — pre-filled specification request per country",
    link("global/README.md", "global/README.md") + " — global core",
    ...classified.global.map(
      (r) =>
        link(`global/${r.category}.md`, `global/${r.category}.md`) +
        ` — ${categoryLabel(r.category)} baseline`,
    ),
  ];
  for (const c of classified.countries) {
    const dir = dirName(c.country.code);
    links.push(
      link(`${dir}/README.md`, `${dir}/README.md`) +
        ` — ${esc(c.country.name)} overview`,
    );
    for (const r of c.repConfigs)
      links.push(
        link(`${dir}/${r.category}.md`, `${dir}/${r.category}.md`) +
          ` — ${esc(c.country.name)} · ${categoryLabel(r.category)}`,
      );
  }
  parts.push("## Documents", bullets(links));
  return joinDoc(parts);
}

// ---------------------------------------------------------------------------
// profiles.md
// ---------------------------------------------------------------------------

export function renderProfiles(ctx: Ctx): string {
  const rows = profilesSorted(ctx.classified.profiles).map((cp) => [
    code(cp.profile.name),
    categoryLabel(cp.category),
    cp.countries.map((c) => code(c)).join(", "),
    String(totalUsers(cp.profile)),
    esc(usersByCountry(cp.profile)) || "_none_",
    esc(cp.profile.userLicense),
    check(cp.profile.custom),
    esc(disposition(cp)),
    esc(cp.rationale.join("; ")),
  ]);
  return joinDoc([
    "# Profile classification",
    ctx.header,
    `Every profile of the org with the rep category and countries the classifier derived. **Disposition** follows DESIGN §2.2: \`keep\`, \`shared\` (serves several countries without a dominant one) or \`drop (0 active users)\` — profiles without users are documented but left out of the Vault plan. A wrong guess is corrected with a classification override, not by editing this file. Back to ${link("README.md", "README.md")}.`,
    table(
      [
        "Profile",
        "Category",
        "Countries",
        "Active users",
        "By country",
        "Licence",
        "Custom",
        "Disposition",
        "Rationale",
      ],
      rows,
      "_The snapshot contains no profiles._",
    ),
  ]);
}

// ---------------------------------------------------------------------------
// global/README.md
// ---------------------------------------------------------------------------

export function renderGlobalIndex(ctx: Ctx): string {
  const { snapshot, classified } = ctx;
  const parts: string[] = [];
  parts.push("# Global core", ctx.header);
  parts.push(
    "Configuration that is not country specific: the org-level Veeva Settings every profile inherits, VMOCs with no profile, messages without a country, and the profiles the classifier could not attach to a country. Each rep category below is the **baseline** its countries are compared against. Back to " +
      link("README.md", "../README.md") +
      ".",
  );

  parts.push(
    "## Rep categories in the global bucket",
    table(
      ["Category", "Profiles", "Active users", "Baseline", "Doc"],
      classified.global.map((r) => [
        categoryLabel(r.category),
        r.profiles.map((p) => code(p.profile.name)).join(", "),
        String(r.profiles.reduce((a, p) => a + totalUsers(p.profile), 0)),
        r.baselineProfile ? code(r.baselineProfile) : "_synthetic_",
        link(`${r.category}.md`, `${r.category}.md`),
      ]),
      "_No profile is global; every baseline is a synthetic majority vote across the country profiles of its category._",
    ),
  );

  // Org-level settings, one table per setting object.
  const orgRecords = sorted(
    snapshot.veevaSettings.filter((s) => s.level === "org"),
    (s) => s.settingObject,
  );
  const profileOverrides = new Map<string, Map<string, Set<string>>>();
  for (const s of snapshot.veevaSettings) {
    if (s.level !== "profile" || !s.ownerName) continue;
    const byField =
      profileOverrides.get(s.settingObject) ?? new Map<string, Set<string>>();
    for (const f of Object.keys(s.values)) {
      const set = byField.get(f) ?? new Set<string>();
      set.add(s.ownerName);
      byField.set(f, set);
    }
    profileOverrides.set(s.settingObject, byField);
  }
  const settingSections: string[] = [];
  for (const rec of orgRecords) {
    const overrides = profileOverrides.get(rec.settingObject);
    const rows = sorted(Object.entries(rec.values), ([f]) => f).map(
      ([field, value]) => {
        const who = overrides?.get(field);
        return [
          code(field),
          code(renderSettingValue(value)),
          who
            ? sorted([...who], (n) => n)
                .map(code)
                .join(", ")
            : "",
        ];
      },
    );
    settingSections.push(
      `### ${code(rec.settingObject)}`,
      table(["Field", "Org default", "Overridden at profile level by"], rows),
    );
  }
  const userLevel = snapshot.veevaSettings.filter((s) => s.level === "user");
  parts.push(
    "## Org-level Veeva Settings",
    settingSections.length
      ? "Values at the org level of each hierarchy custom setting. Profile-level overrides are listed per country × category; the last column shows which profiles override a field at all."
      : "_No org-level setting records in the snapshot._",
    ...settingSections,
  );
  if (userLevel.length)
    parts.push(
      `> ${userLevel.length} **user-level** setting record${userLevel.length === 1 ? "" : "s"} exist (${unique(
        userLevel.map((s) => s.settingObject),
      )
        .map(code)
        .join(
          ", ",
        )}). User-level overrides are anomalies in a profile-driven model and are not documented individually.`,
    );

  const vmocsNoProfile = sorted(
    snapshot.vmocs.filter((v) => v.profile === null),
    (v) => v.objectApiName,
    (v) => v.device,
    (v) => v.name,
  );
  parts.push(
    "## VMOCs without a profile",
    "Mobile object configurations with no `Profile_ID_vod__c` apply to every profile.",
    vmocTable(vmocsNoProfile, new Set(), false),
  );

  const globalMessages = snapshot.messages.filter((m) => m.country === null);
  parts.push(
    "## Global Veeva Messages",
    "Messages with no country. Counts per category × language; inactive messages are usually customer overrides that were switched off.",
    messageSummaryTable(globalMessages),
  );

  const countryMessages = snapshot.messages.filter((m) => m.country !== null);
  if (countryMessages.length)
    parts.push(
      `${countryMessages.length} message${countryMessages.length === 1 ? " is" : "s are"} country-scoped and documented under the respective country.`,
    );

  parts.push(
    "## Object catalogue",
    "Every extracted object. *Local fields* are customer fields outside the Veeva managed package — none of them migrate automatically.",
    table(
      [
        "Object",
        "Label",
        "Custom",
        "Managed",
        "Fields",
        "Local fields",
        "Record types",
        "Inactive record types",
        "Layouts",
        "Validation rules",
      ],
      sorted(snapshot.objects, (o) => o.apiName).map((o) => [
        code(o.apiName),
        esc(o.label),
        check(o.custom),
        check(o.managed),
        String(o.fields.length),
        String(o.fields.filter((f) => f.custom && !f.managed).length),
        String(o.recordTypes.length),
        String(o.recordTypes.filter((rt) => !rt.active).length),
        String(o.layouts.length),
        String(o.validationRules.length),
      ]),
      "_No objects in the snapshot._",
    ),
  );

  if (snapshot.automation)
    parts.push(
      "## Automation inventory",
      "Apex triggers, flows and workflow rules have no Vault CRM equivalent; each active customer item is a manual decision. *Country logic* marks bodies that reference country fields or literals.",
      table(
        ["Kind", "Name", "Object", "Active", "Managed", "Country logic"],
        sorted(
          snapshot.automation,
          (a) => a.kind,
          (a) => a.name,
        ).map((a) => [
          code(a.kind),
          code(a.name),
          a.object ? code(a.object) : "",
          check(a.active),
          check(a.managed),
          check(a.countryLogic),
        ]),
        "_No automation found._",
      ),
    );

  return joinDoc(parts);
}

// ---------------------------------------------------------------------------
// <CC>/README.md
// ---------------------------------------------------------------------------

export function renderCountryIndex(country: CountryConfig, ctx: Ctx): string {
  const ref = country.country;
  const codeCC = ref.code;
  const parts: string[] = [];
  parts.push(`# ${esc(codeCC)} — ${esc(ref.name)}`, ctx.header);
  parts.push(
    `Country overview. Each rep category has its own page with the full configuration and the *Delta vs global* table. Back to ${link("README.md", "../README.md")} · baseline in ${link("global/README.md", "../global/README.md")}.`,
  );

  const languages = languagesOf(ctx, codeCC);
  const sharedProfiles = unique(
    country.repConfigs.flatMap((r) =>
      r.profiles.filter((p) => p.shared).map((p) => p.profile.name),
    ),
  );
  const allProfiles = unique(
    country.repConfigs.flatMap((r) => r.profiles.map((p) => p.profile.name)),
  );
  parts.push(
    "## Summary",
    table(
      ["Property", "Value"],
      [
        ["Country", `${code(codeCC)} ${esc(ref.name)}`],
        ["Active users", String(ref.activeUsers)],
        [
          "Country sources",
          ref.sources?.length ? ref.sources.map(code).join(", ") : "_unknown_",
        ],
        [
          "Languages in use",
          languages.length
            ? languages
                .map(
                  (l) =>
                    `${code(l)} (${ctx.languagesByCountry.get(codeCC)?.get(l) ?? 0})`,
                )
                .join(", ")
            : "_not derivable (no user summary)_",
        ],
        [
          "Rep categories",
          country.repConfigs.map((r) => categoryLabel(r.category)).join(", ") ||
            "_none_",
        ],
        ["Profiles", String(allProfiles.length)],
        [
          "Shared profiles",
          sharedProfiles.length
            ? sharedProfiles.map(code).join(", ")
            : "_none_",
        ],
      ],
    ),
  );

  parts.push(
    "## Rep categories",
    table(
      [
        "Category",
        "Profiles",
        `Active users in ${esc(codeCC)}`,
        "User_Type_vod values",
        "Deltas",
        "Doc",
      ],
      country.repConfigs.map((r) => [
        categoryLabel(r.category),
        profilesSorted(r.profiles)
          .map(
            (p) =>
              code(p.profile.name) +
              (p.shared ? " (shared)" : "") +
              (totalUsers(p.profile) === 0 ? " (0 users)" : ""),
          )
          .join(", "),
        String(r.profiles.reduce((a, p) => a + usersIn(p.profile, codeCC), 0)),
        userTypesOf(ctx, r.profiles, codeCC).map(esc).join(", ") || "_unknown_",
        String(r.deltas?.length ?? 0),
        link(`${r.category}.md`, `${r.category}.md`),
      ]),
      "_No profile serves this country. Its users either sit on a shared / global profile or the country came from data (picklists, VMOC where clauses) rather than from users._",
    ),
  );

  // Delta summary + matrix.
  const allDeltas = country.repConfigs.flatMap((r) =>
    (r.deltas ?? []).map((d) => ({ d, category: r.category })),
  );
  const byKind = new Map<string, number>();
  for (const { d } of allDeltas)
    byKind.set(d.kind, (byKind.get(d.kind) ?? 0) + 1);
  parts.push(
    "## Delta vs global",
    allDeltas.length
      ? `${allDeltas.length} difference${allDeltas.length === 1 ? "" : "s"} from the global baselines across ${country.repConfigs.filter((r) => r.deltas?.length).length} categor${country.repConfigs.filter((r) => r.deltas?.length).length === 1 ? "y" : "ies"}: ` +
          sorted([...byKind.entries()], ([k]) => k)
            .map(([k, n]) => `${code(k)} ${n}`)
            .join(", ") +
          ". Every delta needs a reason code (`REG` regulatory, `LANG` language, `INTEG` integration, `PROC` process, `LEGACY` historical) from the country business admin before it is built."
      : "_No differences from the global baselines: this country inherits everything._",
  );
  if (allDeltas.length) {
    const categories = country.repConfigs
      .filter((r) => r.deltas?.length)
      .map((r) => r.category);
    const items = new Map<string, Map<string, DeltaItem>>();
    for (const { d, category } of allDeltas) {
      const key = `${d.kind}${SEP}${d.item}`;
      const m = items.get(key) ?? new Map<string, DeltaItem>();
      m.set(category, d);
      items.set(key, m);
    }
    const rows = sorted([...items.entries()], ([k]) => k).map(([key, m]) => {
      const [kind, item] = key.split(SEP) as [string, string];
      return [
        code(kind),
        code(item),
        ...categories.map((c) => {
          const d = m.get(c);
          if (!d) return "=";
          return d.localValue === ABSENT ||
            d.localValue === "hidden" ||
            d.localValue === "-" ||
            d.localValue === "inactive"
            ? "✗"
            : "Δ";
        }),
      ];
    });
    parts.push(
      "### Delta matrix",
      "`=` inherits the baseline, `Δ` differs, `✗` the item is absent / off locally.",
      table(["Kind", "Item", ...categories.map(categoryLabel)], rows),
    );
  }

  // Country-level delta detail.
  const settingRows: string[][] = [];
  const seenSettings = new Set<string>();
  for (const r of country.repConfigs) {
    for (const s of sorted(
      r.settings,
      (s) => s.settingObject,
      (s) => s.ownerName ?? "",
    )) {
      for (const [field, value] of sorted(
        Object.entries(s.values),
        ([f]) => f,
      )) {
        const k = `${s.settingObject}|${field}|${s.ownerName}`;
        if (seenSettings.has(k)) continue;
        seenSettings.add(k);
        settingRows.push([
          code(s.settingObject),
          code(field),
          code(ctx.orgSettings[settingKey(s.settingObject, field)] ?? UNSET),
          code(s.ownerName ?? ""),
          code(renderSettingValue(value)),
          categoryLabel(r.category),
        ]);
      }
    }
  }
  parts.push(
    "### Veeva Settings overridden for this country's profiles",
    table(
      [
        "Setting object",
        "Field",
        "Org default",
        "Profile",
        "Value",
        "Category",
      ],
      sorted(
        settingRows,
        (r) => r[0] ?? "",
        (r) => r[1] ?? "",
        (r) => r[3] ?? "",
      ),
      "_No profile-level setting overrides for this country's profiles._",
    ),
  );

  const filteringVmocs = sorted(
    ctx.snapshot.vmocs.filter((v) => vmocCountries(v).includes(codeCC)),
    (v) => v.objectApiName,
    (v) => v.device,
    (v) => v.profile ?? "",
  );
  parts.push(
    `### VMOC where clauses filtering on ${esc(codeCC)}`,
    "Every VMOC in the org (any profile) whose where clause names this country.",
    vmocTable(filteringVmocs, new Set(), true),
  );

  const uniqueLayouts = sorted(
    [...ctx.layoutCountries.entries()].filter(
      ([, set]) => set.size === 1 && set.has(codeCC),
    ),
    ([name]) => name,
  ).map(([name]) => name);
  parts.push(
    "### Page layouts unique to this country",
    "Layouts assigned only by profiles that serve this country and no other.",
    table(
      ["Layout", "Object", "In snapshot", "Sections", "Fields"],
      uniqueLayouts.map((name) => {
        const l = ctx.layoutsByName.get(name);
        return [
          code(name),
          l ? code(l.object) : code(name.split("-")[0] ?? ""),
          check(!!l),
          l ? String(l.sections.length) : "",
          l ? String(l.sections.reduce((a, s) => a + s.fields.length, 0)) : "",
        ];
      }),
      "_No layout is unique to this country._",
    ),
  );

  const countryMessages = ctx.snapshot.messages.filter(
    (m) => m.country === codeCC,
  );
  parts.push(
    "## Veeva Messages scoped to this country",
    messageSummaryTable(countryMessages),
  );

  const questions: string[] = [];
  if (!country.repConfigs.length)
    questions.push(
      `No profile is mapped to ${code(codeCC)} — which profile do its users work with, and does it need a country-specific application profile in Vault CRM?`,
    );
  if (!languages.length)
    questions.push(
      "Languages in use could not be derived from the snapshot — confirm the UI languages needed.",
    );
  for (const p of sharedProfiles)
    questions.push(
      `Profile ${code(p)} is shared with other countries — confirm whether ${code(codeCC)} needs its own application profile or keeps the shared one.`,
    );
  parts.push(
    "## Open questions for the country business admin",
    "Country-level items; each category page ends with its own checklist.",
    checklist(questions, "_No country-level questions generated._"),
  );

  parts.push(
    "## Documents",
    bullets(
      country.repConfigs.map(
        (r) =>
          link(`${r.category}.md`, `${r.category}.md`) +
          ` — ${categoryLabel(r.category)} (${r.deltas?.length ?? 0} deltas)`,
      ),
      "_No category documents for this country._",
    ),
  );
  return joinDoc(parts);
}

// ---------------------------------------------------------------------------
// <CC>/<category>.md and global/<category>.md
// ---------------------------------------------------------------------------

export function renderRepCategory(rep: CountryRepConfig, ctx: Ctx): string {
  const isGlobal = rep.country === GLOBAL_COUNTRY;
  const cc = rep.country;
  const ref = isGlobal ? undefined : ctx.countryRef(cc);
  const label = categoryLabel(rep.category);
  const profiles = profilesSorted(rep.profiles);
  const names = profiles.map((p) => p.profile.name);
  const deltas = rep.deltas ?? [];
  const deltaItems = (kind: DeltaItem["kind"]): Set<string> =>
    new Set(deltas.filter((d) => d.kind === kind).map((d) => d.item));
  const mark = (kind: DeltaItem["kind"], item: string): string =>
    deltaItems(kind).has(item) ? "Δ" : "";
  const questions: string[] = [];
  const parts: string[] = [];

  parts.push(
    `# ${isGlobal ? "Global" : `${esc(cc)} — ${esc(ref?.name ?? cc)}`} · ${label}`,
    ctx.header,
  );
  parts.push(
    (isGlobal
      ? `Baseline configuration of the **${label}** category — what every country inherits. `
      : `Configuration of the **${label}** category in **${esc(ref?.name ?? cc)}**, expressed as the global baseline plus the deltas at the end. `) +
      `Back to ${link("README.md", "README.md")} · ${link("index", "../README.md")}` +
      (isGlobal
        ? ""
        : ` · baseline ${link(`global/${rep.category}.md`, `../global/${rep.category}.md`)}`) +
      ".",
  );

  // 1 Summary ---------------------------------------------------------------
  parts.push(
    "## 1. Profiles",
    table(
      [
        "Profile",
        "Licence",
        "Custom",
        isGlobal ? "Active users" : `Active users in ${esc(cc)}`,
        "Active users total",
        "Countries",
        "Disposition",
        "Rationale",
      ],
      profiles.map((cp) => [
        code(cp.profile.name),
        esc(cp.profile.userLicense),
        check(cp.profile.custom),
        String(usersIn(cp.profile, cc)),
        String(totalUsers(cp.profile)),
        cp.countries.map(code).join(", "),
        esc(disposition(cp)),
        esc(cp.rationale.join("; ")),
      ]),
      "_No profiles._",
    ),
    isGlobal
      ? `Baseline for deltas: ${rep.baselineProfile ? `profile ${code(rep.baselineProfile)}` : "synthetic majority vote across every profile of the category"}.`
      : `Deltas in section 10 are computed against ${rep.baselineProfile ? `the global profile ${code(rep.baselineProfile)}` : "a synthetic baseline (majority vote across every profile of this category, because no global profile exists)"}.`,
  );
  for (const cp of profiles) {
    if (usersIn(cp.profile, cc) === 0)
      questions.push(
        `Profile ${code(cp.profile.name)} has no active users${isGlobal ? "" : ` in ${code(cc)}`} — keep, merge into another profile, or drop?`,
      );
    if (cp.shared && !isGlobal)
      questions.push(
        `Profile ${code(cp.profile.name)} is shared with ${cp.countries
          .filter((c) => c !== cc)
          .map(code)
          .join(", ")} — does ${code(cc)} need its own application profile?`,
      );
    if (cp.profile.permissionSetNames.length)
      parts.push(
        `Permission sets seen on ${code(cp.profile.name)} users: ${sorted(
          cp.profile.permissionSetNames,
          (n) => n,
        )
          .map(code)
          .join(", ")}.`,
      );
  }

  // 2 Object access ---------------------------------------------------------
  const objPerms = new Map<string, Map<string, ObjectPermission>>();
  for (const cp of profiles)
    for (const op of cp.profile.objectPermissions) {
      const m = objPerms.get(op.object) ?? new Map<string, ObjectPermission>();
      m.set(cp.profile.name, op);
      objPerms.set(op.object, m);
    }
  const flags: (keyof Omit<ObjectPermission, "object">)[] = [
    "create",
    "read",
    "edit",
    "delete",
    "viewAll",
    "modifyAll",
  ];
  const objRows = sorted([...objPerms.keys()], (o) => o).map((object) => {
    const m = objPerms.get(object)!;
    const differences: string[] = [];
    const cells = flags.map((flag) => {
      const has = names.filter((n) => m.get(n)?.[flag]);
      if (has.length === names.length) return "✓";
      if (has.length === 0) return "·";
      differences.push(`${FLAG_LABEL[flag]}: ${has.map(code).join(", ")}`);
      return "◐";
    });
    if (differences.length)
      questions.push(
        `Profiles of this category differ on ${code(object)} access (${differences.join("; ")}) — which is the ${isGlobal ? "global" : code(cc)} standard?`,
      );
    return [
      code(object),
      ...cells,
      differences.join("<br>"),
      mark("object_perm", object),
    ];
  });
  parts.push(
    "## 2. Object access",
    names.length > 1
      ? "Merged across the category's profiles: `✓` every profile has it, `·` none has it, `◐` only the profiles listed under *Differs*. `Δ` marks a difference from the global baseline."
      : "`Δ` marks a difference from the global baseline.",
    table(
      [
        "Object",
        "Create",
        "Read",
        "Edit",
        "Delete",
        "View all",
        "Modify all",
        "Differs",
        "Δ",
      ],
      objRows,
      "_No object permissions recorded for these profiles._",
    ),
  );

  // 3 Page layouts ----------------------------------------------------------
  const assignments = new Map<string, string[]>();
  for (const cp of profiles)
    for (const la of cp.profile.layoutAssignments) {
      const k = `${la.object}${SEP}${la.recordType ?? ""}${SEP}${la.layout}`;
      assignments.set(k, [...(assignments.get(k) ?? []), cp.profile.name]);
    }
  const assignmentRows = sorted([...assignments.entries()], ([k]) => k).map(
    ([k, who]) => {
      const [object, rt, layout] = k.split(SEP) as [string, string, string];
      const known = ctx.layoutsByName.has(layout);
      if (!known)
        questions.push(
          `Layout ${code(layout)} is assigned to ${who.map(code).join(", ")} but was not found in the snapshot — was the object extracted?`,
        );
      if (rt && ctx.recordTypeActive.get(recordTypeKey(object, rt)) === false)
        questions.push(
          `Layout ${code(layout)} is assigned for the **inactive** record type ${code(rt)} on ${code(object)} — drop the record type or reactivate it?`,
        );
      return [
        code(object),
        rt ? code(rt) : "_Master_",
        code(layout),
        check(known),
        names.length > 1 ? who.map(code).join(", ") : "",
        mark("layout", layoutKey(object, rt || null)),
      ];
    },
  );
  parts.push(
    "## 3. Page layouts",
    "Layout assigned per object and record type. *Master* is the default record type.",
    table(
      ["Object", "Record type", "Layout", "In snapshot", "Profiles", "Δ"],
      assignmentRows,
      "_No layout assignments recorded (profile metadata may be unavailable)._",
    ),
  );
  const layoutBlocks = sorted(rep.layouts, (l) => l.fullName).map((l) =>
    layoutDetails(l),
  );
  if (layoutBlocks.length)
    parts.push(
      "### Layout detail",
      "Sections and fields of every layout above that exists in the snapshot.",
      ...layoutBlocks,
    );

  // 4 Record-type visibility ------------------------------------------------
  const rtv = new Map<string, Map<string, RecordTypeVisibility>>();
  for (const cp of profiles)
    for (const v of cp.profile.recordTypeVisibilities) {
      const k = recordTypeKey(v.object, v.recordType);
      const m = rtv.get(k) ?? new Map<string, RecordTypeVisibility>();
      m.set(cp.profile.name, v);
      rtv.set(k, m);
    }
  const rtRows = sorted([...rtv.entries()], ([k]) => k).map(([k, m]) => {
    const first = [...m.values()][0]!;
    const active = ctx.recordTypeActive.get(k);
    const renders = names.map((n) => renderRecordTypeVisibility(m.get(n)));
    if (active === false && renders.some((r) => r !== "hidden"))
      questions.push(
        `Record type ${code(first.recordType)} on ${code(first.object)} is inactive but still visible to ${names
          .filter((_, i) => renders[i] !== "hidden")
          .map(code)
          .join(", ")} — remove the visibility?`,
      );
    return [
      code(first.object),
      code(first.recordType),
      active === undefined ? "?" : check(active),
      ...renders.map(esc),
      mark("record_type", k),
    ];
  });
  parts.push(
    "## 4. Record-type visibility",
    "`?` in *Active* means the record type is not in the object catalogue of the snapshot.",
    table(
      [
        "Object",
        "Record type",
        "Active",
        ...(names.length > 1 ? names.map(code) : ["Visibility"]),
        "Δ",
      ],
      rtRows,
      "_No record-type visibilities recorded._",
    ),
  );

  // 5 Field-level security --------------------------------------------------
  const fls = new Map<string, Map<string, FieldPermission>>();
  for (const cp of profiles)
    for (const fp of cp.profile.fieldPermissions) {
      const k = fieldKey(fp.object, fp.field);
      const m = fls.get(k) ?? new Map<string, FieldPermission>();
      m.set(cp.profile.name, fp);
      fls.set(k, m);
    }
  const score = (name: string): number => {
    let s = 0;
    for (const m of fls.values()) {
      const fp = m.get(name);
      if (fp?.readable) s++;
      if (fp?.editable) s++;
    }
    return s;
  };
  const mostPermissive = sorted(
    names,
    (n) => -score(n),
    (n) => n,
  )[0];
  const flsKeys = sorted([...fls.keys()], (k) => k);
  const flsRow = (k: string): string[] => {
    const m = fls.get(k)!;
    const first = [...m.values()][0]!;
    return [
      code(first.object),
      code(first.field),
      ...names.map((n) => esc(renderFieldPermission(m.get(n)))),
      mark("field_perm", k),
    ];
  };
  const flsHeaders = [
    "Object",
    "Field",
    ...(names.length > 1
      ? names.map((n) =>
          n === mostPermissive ? `${code(n)} (most permissive)` : code(n),
        )
      : ["Access"]),
    "Δ",
  ];
  const differing = flsKeys.filter((k) => {
    const m = fls.get(k)!;
    const base = renderFieldPermission(
      mostPermissive ? m.get(mostPermissive) : undefined,
    );
    return names.some((n) => renderFieldPermission(m.get(n)) !== base);
  });
  parts.push(
    "## 5. Field-level security",
    "`R/E` readable and editable, `R` read only, `-` no access.",
    names.length > 1
      ? `Fields where a profile differs from the category's most permissive profile ${code(mostPermissive ?? "")} (${differing.length} of ${flsKeys.length}); the full matrix is in the appendix.`
      : "Only one profile in this category, so there is nothing to compare; the full matrix is in the appendix.",
  );
  if (names.length > 1)
    parts.push(
      table(
        flsHeaders,
        differing.map(flsRow),
        "_No profile deviates from the most permissive profile._",
      ),
    );
  const flsDeltas = deltaItems("field_perm");
  if (flsDeltas.size)
    parts.push(
      `${flsDeltas.size} field${flsDeltas.size === 1 ? "" : "s"} differ from the global baseline (see section 10).`,
    );
  parts.push(
    details(
      `Appendix — full field-level security (${flsKeys.length} fields)`,
      table(
        flsHeaders,
        flsKeys.map(flsRow),
        "_No field permissions recorded._",
      ),
    ),
  );

  // 6 VMOCs -----------------------------------------------------------------
  const vmocs = sorted(
    rep.vmocs,
    (v) => v.objectApiName,
    (v) => v.device,
    (v) => v.profile ?? "",
    (v) => v.name,
  );
  for (const v of vmocs) {
    if (v.active && !(v.whereClause && v.whereClause.trim()) && !v.metaDataOnly)
      questions.push(
        `VMOC ${code(v.name)} (${code(v.objectApiName)}, ${code(v.device)}, ${code(v.profile ?? "all profiles")}) syncs without a where clause — confirm a full sync is intended.`,
      );
    if (!v.active)
      questions.push(
        `VMOC ${code(v.name)} (${code(v.objectApiName)}, ${code(v.device)}) is inactive — drop it, or is the object needed offline?`,
      );
    if (v.profileId && v.profileId.length === 15)
      questions.push(
        `VMOC ${code(v.name)} carries a 15-character profile id — Vault CRM needs the 18-character form; it is fixed during planning but should be corrected at the source.`,
      );
  }
  parts.push(
    "## 6. VMOCs (mobile sync)",
    "One row per object × device × profile. *Country filter* lists the ISO codes found in the where clause.",
    vmocTable(vmocs, deltaItems("vmoc"), names.length > 1),
  );

  // 7 Veeva Settings --------------------------------------------------------
  const settingRows: string[][] = [];
  for (const s of sorted(
    rep.settings,
    (s) => s.settingObject,
    (s) => s.ownerName ?? "",
  )) {
    for (const [field, value] of sorted(Object.entries(s.values), ([f]) => f)) {
      const key = settingKey(s.settingObject, field);
      const org = ctx.orgSettings[key];
      if (org === undefined)
        questions.push(
          `Setting ${code(key)} is set on profile ${code(s.ownerName ?? "")} (${code(renderSettingValue(value))}) but has no org default — should it become the global value?`,
        );
      settingRows.push([
        code(s.settingObject),
        code(field),
        code(org ?? UNSET),
        code(s.ownerName ?? ""),
        code(renderSettingValue(value)),
        org !== undefined && org === renderSettingValue(value) ? "same" : "",
        mark("setting", key),
      ]);
    }
  }
  parts.push(
    "## 7. Veeva Settings (profile-level overrides)",
    "Hierarchy custom-setting fields set at profile level for these profiles, next to the org default they override. *same* marks an override that repeats the org default (harmless, but noise).",
    table(
      [
        "Setting object",
        "Field",
        "Org default",
        "Profile",
        "Profile value",
        "Note",
        "Δ",
      ],
      settingRows,
      "_No profile-level overrides: these profiles use the org-level values documented in the global core._",
    ),
  );

  // 8 Messages --------------------------------------------------------------
  const messagesSection = renderMessages(rep, ctx);
  if (messagesSection.length)
    parts.push("## 8. Veeva Messages", ...messagesSection);
  for (const m of rep.messages)
    if (!m.active)
      questions.push(
        `Country-scoped message ${code(`${m.name};;${m.category}`)} (${code(m.language)}) is inactive — drop it?`,
      );

  // 9 Tabs & apps -----------------------------------------------------------
  const tabs = new Map<string, Map<string, TabVisibility["visibility"]>>();
  for (const cp of profiles)
    for (const t of cp.profile.tabVisibilities) {
      const m = tabs.get(t.tab) ?? new Map();
      m.set(cp.profile.name, t.visibility);
      tabs.set(t.tab, m);
    }
  const apps = new Map<string, Map<string, ApplicationVisibility>>();
  for (const cp of profiles)
    for (const a of cp.profile.applicationVisibilities) {
      const m = apps.get(a.application) ?? new Map();
      m.set(cp.profile.name, a);
      apps.set(a.application, m);
    }
  parts.push(
    "## 9. Tabs and apps",
    table(
      ["Tab", ...(names.length > 1 ? names.map(code) : ["Visibility"]), "Δ"],
      sorted([...tabs.entries()], ([t]) => t).map(([tab, m]) => [
        code(tab),
        ...names.map((n) => esc(m.get(n) ?? "Hidden")),
        mark("tab", tab),
      ]),
      "_No tab visibilities recorded._",
    ),
    table(
      ["App", ...(names.length > 1 ? names.map(code) : ["Visible / default"])],
      sorted([...apps.entries()], ([a]) => a).map(([app, m]) => [
        code(app),
        ...names.map((n) => {
          const a = m.get(n);
          return a ? `${check(a.visible)} / ${check(a.default)}` : "· / ·";
        }),
      ]),
      "_No app visibilities recorded._",
    ),
  );

  // 10 Delta vs global ------------------------------------------------------
  parts.push("## 10. Delta vs global");
  if (isGlobal) {
    parts.push(
      `This is the **baseline** of the ${label} category${rep.baselineProfile ? ` (profile ${code(rep.baselineProfile)})` : " (synthetic majority vote)"}; country pages list their differences against it.`,
    );
  } else {
    parts.push(
      deltas.length
        ? `${deltas.length} difference${deltas.length === 1 ? "" : "s"} from the baseline. *Reason* is filled in by the country business admin (\`REG\` regulatory, \`LANG\` language, \`INTEG\` integration, \`PROC\` process, \`LEGACY\` historical); a delta that needs custom code is not a delta but a fit-gap item.`
        : "_No differences from the global baseline: this configuration inherits everything._",
      table(
        [
          "Delta ID",
          "Kind",
          "Item",
          "Global",
          "Local",
          "Reason",
          "Evidence",
          "Status",
        ],
        deltas.map((d) => [
          code(d.id),
          code(d.kind),
          code(d.item),
          code(d.globalValue),
          code(d.localValue),
          d.reasonCode ? code(d.reasonCode) : "",
          esc(d.evidence),
          esc(d.status),
        ]),
        "_(no delta rows)_",
      ),
    );
    if (deltas.some((d) => !d.reasonCode))
      questions.push(
        `${deltas.filter((d) => !d.reasonCode).length} delta${deltas.filter((d) => !d.reasonCode).length === 1 ? "" : "s"} in section 10 need a reason code (REG / LANG / INTEG / PROC / LEGACY).`,
      );
  }

  // 11 Vault target (naming convention only; the plan module owns the steps)
  const suffix = !isGlobal && deltas.length ? `_${cc.toLowerCase()}` : "";
  parts.push(
    "## 11. Vault CRM target (proposed names)",
    bullets([
      `Security profile: ${code(`${rep.category}__c`)} (access — shared by every country of the category)`,
      `Application profile: ${code(`app_${rep.category}${suffix}__c`)}${suffix ? " — country suffix because settings / VMOC deltas exist" : " — no country suffix: no local delta"}`,
      "Step ids and manual items are in `vault-plan/` once the plan stage has run.",
    ]),
  );

  // 12 Open questions -------------------------------------------------------
  parts.push(
    `## 12. Open questions for the ${isGlobal ? "global configuration owner" : "country business admin"}`,
    "Generated from gaps in the snapshot; answer them in `intake-template.md`.",
    checklist(
      unique(questions),
      "_No open questions generated from the snapshot._",
    ),
  );

  return joinDoc(parts);
}

/** Key separator that cannot occur in API names, layout names or setting keys. */
const SEP = "\u0000";

const FLAG_LABEL: Record<string, string> = {
  create: "Create",
  read: "Read",
  edit: "Edit",
  delete: "Delete",
  viewAll: "View all",
  modifyAll: "Modify all",
};

// ---------------------------------------------------------------------------
// Shared table builders
// ---------------------------------------------------------------------------

const WHERE_CLIP = 120;

function vmocTable(
  vmocs: readonly VmocConfig[],
  deltaItems: Set<string>,
  showProfile: boolean,
): string {
  const long = vmocs.filter(
    (v) =>
      v.whereClause &&
      v.whereClause.replace(/\s+/g, " ").trim().length > WHERE_CLIP,
  );
  const full = long.length
    ? details(
        `Full where clauses (${long.length} clipped in the table)`,
        long
          .map(
            (v) =>
              `${code(v.name)} — ${code(v.objectApiName)} / ${code(v.device)}\n\n${fence(v.whereClause!.trim(), "sql")}`,
          )
          .join("\n"),
      )
    : "";
  const main = table(
    [
      "VMOC",
      "Object",
      "Device",
      "Profile",
      "Active",
      "Enhanced sync",
      "Metadata only",
      "Where clause",
      "Country filter",
      "Δ",
    ],
    vmocs.map((v) => [
      code(v.name),
      code(v.objectApiName),
      code(v.device),
      v.profile === null
        ? "_all_"
        : showProfile
          ? code(v.profile)
          : code(v.profile),
      check(v.active),
      check(v.enhancedSync),
      check(v.metaDataOnly),
      v.whereClause && v.whereClause.trim()
        ? code(clip(v.whereClause, WHERE_CLIP))
        : "",
      vmocCountries(v).map(code).join(", "),
      deltaItems.has(vmocKey(v.objectApiName, v.device)) ? "Δ" : "",
    ]),
    "_No VMOCs._",
  );
  return full ? `${main}\n${full}` : main;
}

function messageSummaryTable(messages: readonly VeevaMessage[]): string {
  const counts = new Map<string, { total: number; inactive: number }>();
  for (const m of messages) {
    const k = `${m.category}${SEP}${m.language}`;
    const c = counts.get(k) ?? { total: 0, inactive: 0 };
    c.total++;
    if (!m.active) c.inactive++;
    counts.set(k, c);
  }
  return table(
    ["Category", "Language", "Messages", "Inactive"],
    sorted([...counts.entries()], ([k]) => k).map(([k, c]) => {
      const [category, language] = k.split(SEP) as [string, string];
      return [
        code(category),
        code(language),
        String(c.total),
        String(c.inactive),
      ];
    }),
    "_No messages._",
  );
}

/** Section 8: country-scoped messages + global messages in the country's languages; empty when neither is derivable. */
function renderMessages(rep: CountryRepConfig, ctx: Ctx): string[] {
  const out: string[] = [];
  if (rep.country === GLOBAL_COUNTRY) {
    if (!rep.messages.length) return out;
    out.push(
      "Messages without a country, per category × language.",
      messageSummaryTable(rep.messages),
    );
    return out;
  }
  const languages = languagesOf(ctx, rep.country);
  const bases = new Set(languages.map(langBase));
  if (rep.messages.length) {
    out.push(
      `${rep.messages.length} message${rep.messages.length === 1 ? "" : "s"} scoped to ${code(rep.country)}.`,
      table(
        ["Name", "Category", "Language", "Active", "Text"],
        sorted(
          rep.messages,
          (m) => m.category,
          (m) => m.name,
          (m) => m.language,
        ).map((m) => [
          code(m.name),
          code(m.category),
          code(m.language),
          check(m.active),
          esc(clip(m.text)),
        ]),
      ),
    );
  }
  if (languages.length) {
    const relevant = ctx.snapshot.messages.filter(
      (m) => m.country === null && bases.has(langBase(m.language)),
    );
    out.push(
      `Global messages in the languages used in ${code(rep.country)} (${languages.map(code).join(", ")}):`,
      messageSummaryTable(relevant),
    );
  } else if (rep.messages.length) {
    out.push(
      "_User languages are not derivable from the snapshot, so global messages are not filtered for this country._",
    );
  }
  return out;
}

function layoutDetails(l: LayoutConfig): string {
  const rows: string[][] = [];
  for (const s of l.sections) {
    const behaviours = new Map(
      (s.items ?? []).map((i) => [i.field, i.behavior] as const),
    );
    if (!s.fields.length) rows.push([esc(s.heading), "_(no fields)_", ""]);
    for (const f of s.fields)
      rows.push([esc(s.heading), code(f), esc(behaviours.get(f) ?? "")]);
  }
  const fieldCount = l.sections.reduce((a, s) => a + s.fields.length, 0);
  const body: string[] = [
    table(["Section", "Field", "Behaviour"], rows, "_No sections._"),
  ];
  if (l.recordTypes.length)
    body.push(`Record types: ${l.recordTypes.map(code).join(", ")}`);
  if (l.relatedLists.length)
    body.push(`Related lists: ${l.relatedLists.map(code).join(", ")}`);
  if (l.buttons?.length)
    body.push(`Buttons: ${l.buttons.map(code).join(", ")}`);
  if (l.actions?.length)
    body.push(`Actions: ${l.actions.map(code).join(", ")}`);
  return details(
    `${code(l.fullName)} — ${l.sections.length} section${l.sections.length === 1 ? "" : "s"}, ${fieldCount} field${fieldCount === 1 ? "" : "s"}${l.managed ? ", managed" : ""}`,
    body.map((b) => b.trimEnd()).join("\n\n"),
  );
}
