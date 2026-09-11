/**
 * `intake-template.md` — the specification request sent to each country
 * business admin (research doc 04 §2), pre-filled from the snapshot so the
 * admin only confirms or corrects. Pre-filled cells read
 * `[value: source]`; empty cells are for the admin.
 */
import { GLOBAL_COUNTRY, type CountryConfig } from "../model/types";
import { mapPersonaName } from "../vault/mapping";
import {
  categoryLabel,
  disposition,
  dirName,
  langBase,
  languagesOf,
  profilesSorted,
  totalUsers,
  userTypesOf,
  usersIn,
  vmocCountries,
  type Ctx,
} from "./context";
import {
  check,
  code,
  esc,
  joinDoc,
  link,
  sorted,
  table,
  unique,
} from "./markdown";

/** Multichannel capability → objects whose read access means "on today". */
const FEATURES: readonly (readonly [string, readonly string[]])[] = [
  ["Approved Email", ["Sent_Email_vod__c", "Approved_Document_vod__c"]],
  ["CLM", ["CLM_Presentation_vod__c", "Key_Message_vod__c"]],
  ["Engage (meetings / connect)", ["Remote_Meeting_vod__c"]],
  ["Events Management", ["EM_Event_vod__c"]],
  ["Medical Inquiry", ["Medical_Inquiry_vod__c"]],
  ["Consent Capture", ["Multichannel_Consent_vod__c"]],
  ["Suggestions / Next-Best-Action", ["Suggestion_vod__c"]],
  [
    "Samples on call",
    ["Call2_Sample_vod__c", "Sample_Order_Transaction_vod__c"],
  ],
  ["Sample limits", ["Sample_Limit_vod__c"]],
  ["Cycle plans (MCCP)", ["MC_Cycle_vod__c", "Cycle_Plan_vod__c"]],
];

const PREFILL_NOTE =
  "Pre-filled cells read `[value: source]` and come from the snapshot; leave them if they are right, correct them if not, and fill the empty cells. Items not listed here follow the global template.";

function prefilled(value: string, source: string): string {
  return `[${value}: ${source}]`;
}

export function renderIntake(ctx: Ctx): string {
  const parts: string[] = [];
  parts.push("# Specification request — per country", ctx.header);
  parts.push(
    `One section per country; sections 3–4 repeat per rep type. ${PREFILL_NOTE} Back to ${link("README.md", "README.md")}.`,
  );
  if (!ctx.classified.countries.length)
    parts.push("_No country could be derived from the snapshot._");
  for (const country of ctx.classified.countries)
    parts.push(renderCountryIntake(country, ctx));
  return joinDoc(parts);
}

function featureStatus(
  ctx: Ctx,
  country: CountryConfig,
  objects: readonly string[],
  category?: string,
): string {
  const profiles = country.repConfigs
    .filter((r) => !category || r.category === category)
    .flatMap((r) => r.profiles);
  const known = objects.filter((o) => ctx.knownObjects.has(o));
  if (!known.length) return prefilled("unknown", "objects not extracted");
  const on = profiles.some((p) =>
    p.profile.objectPermissions.some(
      (op) => known.includes(op.object) && op.read,
    ),
  );
  const via = on
    ? unique(
        profiles
          .flatMap((p) => p.profile.objectPermissions)
          .filter((op) => known.includes(op.object) && op.read)
          .map((op) => op.object),
      )
    : known;
  return prefilled(
    on ? "on" : "off",
    `${on ? "read access on" : "no read access on"} ${via.map(code).join(", ")}`,
  );
}

function renderCountryIntake(country: CountryConfig, ctx: Ctx): string {
  const ref = country.country;
  const cc = ref.code;
  const dir = dirName(cc);
  const languages = languagesOf(ctx, cc);
  const parts: string[] = [];
  parts.push(`## ${esc(cc)} — ${esc(ref.name)}`);
  parts.push(
    `As-is detail: ${link(`${dir}/README.md`, `${dir}/README.md`)}. Deltas found so far: ${country.repConfigs.reduce((a, r) => a + (r.deltas?.length ?? 0), 0)}.`,
  );

  // Section 1 — country header
  parts.push(
    "### Section 1 — Country header",
    table(
      ["Field", "Answer"],
      [
        [
          "Country (ISO-2)",
          prefilled(
            code(cc),
            ref.sources?.length ? ref.sources.map(code).join(", ") : "snapshot",
          ),
        ],
        ["Business admin (name, e-mail) / backup", ""],
        [
          "Languages users work in",
          languages.length
            ? prefilled(
                languages.map(code).join(", "),
                "`User.LanguageLocaleKey`",
              )
            : "",
        ],
        [
          "Salesforce org (if multi-org)",
          prefilled(code(ctx.snapshot.instanceUrl), "snapshot"),
        ],
        ["Field-force data source (Align / manual / HR feed)", ""],
        [
          "Local regulations that shape CRM (cite)",
          "e.g. samples law, consent basis",
        ],
      ],
    ),
  );

  // Section 2 — rep types
  const repRows = country.repConfigs.flatMap((r) =>
    profilesSorted(r.profiles).map((cp) => [
      userTypesOf(ctx, [cp], cc).map(esc).join(", ") || "_unknown_",
      code(cp.profile.name),
      categoryLabel(r.category),
      String(usersIn(cp.profile, cc)),
      prefilled(esc(disposition(cp)), "classifier"),
      prefilled(
        code(mapPersonaName(cc, r.category).securityProfile),
        "plan naming",
      ),
      cp.shared
        ? `shared with ${cp.countries
            .filter((c) => c !== cc)
            .map(code)
            .join(", ")}`
        : "",
    ]),
  );
  parts.push(
    "### Section 2 — Rep types in this country",
    table(
      [
        "Rep type (`User_Type_vod__c`)",
        "Current profile",
        "Category",
        "Active users",
        "Keep / merge / drop",
        "Target Vault security profile",
        "Comment",
      ],
      repRows,
      "_No profile is mapped to this country — list the rep types and the profiles they use._",
    ),
  );

  // Sections 3–4 per rep type
  for (const r of country.repConfigs) {
    const label = categoryLabel(r.category);
    const profiles = r.profiles;
    const callRecordTypes = unique(
      profiles.flatMap((p) =>
        p.profile.recordTypeVisibilities
          .filter((v) => v.object === "Call2_vod__c" && v.visible)
          .map((v) => v.recordType),
      ),
    );
    const requiredCallFields = unique(
      r.layouts
        .filter((l) => l.object === "Call2_vod__c")
        .flatMap((l) => l.sections)
        .flatMap((s) => s.items ?? [])
        .filter((i) => i.behavior === "Required")
        .map((i) => i.field),
    );
    parts.push(
      `### Section 3 — ${esc(label)}: activities / call reporting`,
      table(
        ["Question", "Found in snapshot", "This rep type"],
        [
          [
            "Call record types used",
            callRecordTypes.length
              ? prefilled(
                  callRecordTypes.map(code).join(", "),
                  "record-type visibility on `Call2_vod__c`",
                )
              : prefilled("none visible", "record-type visibility"),
            "Confirm / change",
          ],
          [
            "Call report fields that are mandatory locally",
            requiredCallFields.length
              ? prefilled(
                  requiredCallFields.map(code).join(", "),
                  "layout behaviour `Required`",
                )
              : "",
            "",
          ],
          ["Call channels (F2F, phone, video / Engage, e-mail)", "", ""],
          [
            "Call objectives / key messages / detailing (CLM)",
            featureStatus(
              ctx,
              country,
              ["Key_Message_vod__c", "CLM_Presentation_vod__c"],
              r.category,
            ),
            "",
          ],
          [
            "Samples / promotional items on call",
            featureStatus(ctx, country, ["Call2_Sample_vod__c"], r.category),
            "",
          ],
          ["Signature capture and local disclaimer text", "", ""],
          ["Expenses, attendees, follow-up activities", "", ""],
        ],
      ),
      `### Section 4 — ${esc(label)}: multichannel`,
      table(
        ["Capability", "On today?", "Keep", "Local rules"],
        FEATURES.map(([name, objects]) => [
          esc(name),
          featureStatus(ctx, country, objects, r.category),
          "",
          "",
        ]),
      ),
    );
  }

  // Section 5 — samples & compliance
  const sampleSettings = sorted(
    Object.entries(ctx.orgSettings).filter(([k]) => /sample|opt_in/i.test(k)),
    ([k]) => k,
  );
  const signatureVmocs = ctx.snapshot.vmocs.filter((v) =>
    /Signature_Page_vod__c|Sample_Limit_vod__c/.test(v.objectApiName),
  );
  parts.push(
    "### Section 5 — Samples & compliance (country level)",
    table(
      ["Question", "Answer"],
      [
        [
          "Samples disbursed at all?",
          featureStatus(ctx, country, [
            "Call2_Sample_vod__c",
            "Sample_Limit_vod__c",
            "Sample_Lot_vod__c",
          ]),
        ],
        [
          "Sample limit template(s) in use and which profiles / groups (`Template_Group_vod__c`)",
          signatureVmocs.length
            ? prefilled(
                unique(signatureVmocs.map((v) => v.objectApiName))
                  .map(code)
                  .join(", "),
                "VMOCs exist for these objects",
              )
            : "",
        ],
        [
          "One-time sample opt-in signature required?",
          sampleSettings.length
            ? prefilled(
                sampleSettings
                  .map(([k, v]) => `${code(k)} = ${code(v)}`)
                  .join(", "),
                "org-level Veeva Settings",
              )
            : "yes / no",
        ],
        [
          "Country-specific disclaimers on signature page (`Signature_Page_vod__c`)",
          "",
        ],
        ["Inventory / lot / expiry / reconciliation requirements", ""],
        ["Who signs off sample compliance locally", ""],
      ],
    ),
  );

  // Section 6 — accounts, territories, alignment
  const accountRecordTypes = unique(
    country.repConfigs
      .flatMap((r) => r.profiles)
      .flatMap((p) => p.profile.recordTypeVisibilities)
      .filter((v) => v.object === "Account" && v.visible)
      .map((v) => v.recordType),
  );
  const account = ctx.snapshot.objects.find((o) => o.apiName === "Account");
  const localAccountFields = account
    ? sorted(
        account.fields.filter((f) => f.custom && !f.managed),
        (f) => f.apiName,
      ).map((f) => f.apiName)
    : [];
  parts.push(
    "### Section 6 — Accounts, territories, alignment",
    table(
      ["Question", "Answer"],
      [
        [
          "Account types / record types in use (HCP, HCO, pharmacy…)",
          accountRecordTypes.length
            ? prefilled(
                accountRecordTypes.map(code).join(", "),
                "record-type visibility on `Account`",
              )
            : "",
        ],
        ["Territory source: Align / manual; hierarchy depth", ""],
        ["Multi-country users (`Network_Additional_Countries_vod__c`)", ""],
        [
          "Local account custom fields that reps must see",
          localAccountFields.length
            ? prefilled(
                localAccountFields.map(code).join(", "),
                "non-vod custom fields on `Account`",
              )
            : account
              ? prefilled("none", "no non-vod custom fields on `Account`")
              : prefilled("unknown", "`Account` not extracted"),
        ],
        [
          "Cycle plans / MCCP used?",
          featureStatus(ctx, country, ["MC_Cycle_vod__c", "Cycle_Plan_vod__c"]),
        ],
      ],
    ),
  );

  // Section 7 — integrations
  parts.push(
    "### Section 7 — Integrations touching this country",
    table(
      ["Integration", "In use", "Direction", "Owner", "Notes"],
      [
        [
          "Veeva Network / OpenData (Network Bridge, DCR)",
          "",
          "",
          "",
          "which countries in the bridge",
        ],
        ["Veeva Align", "", "", "", ""],
        ["Nitro / data warehouse", "", "", "", ""],
        ["SAP / order management / sample logistics", "", "", "", ""],
        ["Local MI, event, expense tools", "", "", "", ""],
      ],
    ),
  );

  // Section 8 — local customisations
  const customRows: string[][] = [];
  for (const o of sorted(ctx.snapshot.objects, (o) => o.apiName)) {
    if (o.custom && !o.managed)
      customRows.push(["Custom object", code(o.apiName), esc(o.label), "", ""]);
    const local = o.fields.filter((f) => f.custom && !f.managed);
    if (local.length && (o.managed || !o.custom))
      customRows.push([
        "Custom fields",
        `${code(o.apiName)}: ${local
          .slice(0, 15)
          .map((f) => code(f.apiName))
          .join(
            ", ",
          )}${local.length > 15 ? `, … (${local.length} in total)` : ""}`,
        "",
        "",
        "",
      ]);
    for (const vr of o.validationRules.filter((v) => v.active))
      customRows.push([
        "Validation rule",
        code(`${o.apiName}.${vr.name}`),
        esc(vr.errorMessage ?? ""),
        "",
        "",
      ]);
  }
  for (const a of sorted(
    (ctx.snapshot.automation ?? []).filter((a) => a.active && !a.managed),
    (a) => a.kind,
    (a) => a.name,
  ))
    customRows.push([
      esc(a.kind),
      code(a.name),
      a.countryLogic ? "references country logic" : "",
      "",
      "",
    ]);
  const uniqueLayouts = sorted(
    [...ctx.layoutCountries.entries()].filter(
      ([, set]) => set.size === 1 && set.has(cc),
    ),
    ([n]) => n,
  ).map(([n]) => n);
  for (const l of uniqueLayouts)
    customRows.push(["Country-specific layout", code(l), "", "", ""]);
  const countryVmocs = sorted(
    ctx.snapshot.vmocs.filter((v) => vmocCountries(v).includes(cc)),
    (v) => v.name,
  );
  for (const v of countryVmocs)
    customRows.push([
      "VMOC where clause",
      code(v.name),
      code(v.whereClause ?? ""),
      "",
      "",
    ]);
  parts.push(
    "### Section 8 — Local customisations (must be listed; none migrate automatically)",
    "Org-wide customisations are listed once per country because every country must state whether it still needs them.",
    table(
      ["Type", "API name", "Purpose", "Still needed?", "Owner"],
      customRows,
      "_No customer customisations found in the snapshot — list any the extract missed._",
    ),
  );

  // Section 9 — languages & text
  const bases = new Set(languages.map(langBase));
  const countryMessages = ctx.snapshot.messages.filter((m) => m.country === cc);
  const nonEnglish = ctx.snapshot.messages.filter(
    (m) =>
      (m.country === cc ||
        (m.country === null && bases.has(langBase(m.language)))) &&
      langBase(m.language) !== "en",
  );
  const englishNames = new Set(
    ctx.snapshot.messages
      .filter((m) => langBase(m.language) === "en")
      .map((m) => `${m.name};;${m.category}`),
  );
  const missing: string[] = [];
  for (const lang of languages) {
    const base = langBase(lang);
    if (base === "en") continue;
    const have = new Set(
      ctx.snapshot.messages
        .filter((m) => langBase(m.language) === base)
        .map((m) => `${m.name};;${m.category}`),
    );
    const gap = [...englishNames].filter((n) => !have.has(n)).sort();
    if (gap.length)
      missing.push(
        `${code(lang)}: ${gap.length} of ${englishNames.size} English messages have no translation (e.g. ${gap
          .slice(0, 5)
          .map(code)
          .join(", ")})`,
      );
  }
  parts.push(
    "### Section 9 — Languages & text",
    table(
      ["Question", "Answer"],
      [
        [
          "UI languages needed",
          languages.length
            ? prefilled(
                languages.map(code).join(", "),
                "`User.LanguageLocaleKey`",
              )
            : "",
        ],
        [
          "Veeva Messages with local overrides (`Message_vod__c` where language ≠ en)",
          prefilled(
            `${nonEnglish.length} (${countryMessages.length} country-scoped)`,
            "message count",
          ),
        ],
        [
          "Missing translations found by extract (name exists in `en` only)",
          missing.length
            ? missing.join("<br>")
            : languages.length
              ? prefilled("none", "message names compared per language")
              : prefilled("unknown", "user languages not derivable"),
        ],
        ["Who translates / approves", ""],
      ],
    ),
  );

  // Section 10 — sign-off
  parts.push(
    "### Section 10 — Sign-off",
    table(["Name", "Role", "Date", "Signature"], [["", "", "", ""]]),
    "> I confirm the above reflects the required local configuration; items not listed follow the global template.",
  );

  // Helper: totals for the reviewer.
  const users = country.repConfigs.reduce(
    (a, r) => a + r.profiles.reduce((b, p) => b + usersIn(p.profile, cc), 0),
    0,
  );
  parts.push(
    `_Coverage check: ${users} of ${ref.activeUsers} active users in ${code(cc)} are on the profiles listed in section 2${users < ref.activeUsers ? " — the rest use profiles the classifier did not attach to this country (see `profiles.md`)" : ""}. Global-bucket profiles: ${
      ctx.classified.global
        .flatMap((r) => r.profiles)
        .filter((p) => totalUsers(p.profile) > 0)
        .map((p) => code(p.profile.name))
        .join(", ") || "none"
    } (${code(GLOBAL_COUNTRY)} in ${link("profiles.md", "profiles.md")}). ${check(users >= ref.activeUsers)}_`,
  );

  return joinDoc(parts);
}
