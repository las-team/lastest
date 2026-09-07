import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { classifySnapshot } from "../model/classify";
import type { ClassifiedSnapshot } from "../model/types";
import { code, esc, table } from "./markdown";
import { renderDocs, type RenderedDoc } from "./render";
import { fixture } from "./test-fixture";
import { writeDocs } from "./write";

function classified(): ClassifiedSnapshot {
  return classifySnapshot(fixture());
}

function doc(docs: RenderedDoc[], p: string): string {
  const d = docs.find((x) => x.path === p);
  if (!d)
    throw new Error(
      `missing doc ${p}; have ${docs.map((x) => x.path).join(", ")}`,
    );
  return d.content;
}

const FIXED_NOW = () => new Date("2026-09-07T12:00:00.000Z");

describe("markdown helpers", () => {
  it("escapes pipes and newlines in cells and code spans", () => {
    expect(esc("a | b\nc")).toBe("a \\| b<br>c");
    expect(code("x | y\n z")).toBe("`x \\| y z`");
    expect(code("has ` tick")).toBe("`` has ` tick ``");
    expect(code("")).toBe("");
  });

  it("never emits an empty table", () => {
    expect(table(["A", "B"], [])).toBe("_None._\n");
    expect(table(["A", "B"], [], "_nothing_")).toBe("_nothing_\n");
    expect(table(["A", "B"], [["1", ""]])).toBe(
      "| A | B |\n|---|---|\n| 1 |   |\n",
    );
  });
});

describe("renderDocs", () => {
  it("produces the expected file list, sorted", () => {
    const docs = renderDocs(classified(), { now: FIXED_NOW });
    expect(docs.map((d) => d.path)).toEqual([
      "DE/README.md",
      "DE/msl.md",
      "DE/sales_rep.md",
      "FR/README.md",
      "FR/msl.md",
      "FR/sales_rep.md",
      "README.md",
      "global/README.md",
      "global/msl.md",
      "intake-template.md",
      "profiles.md",
    ]);
    for (const d of docs) {
      expect(d.content.endsWith("\n")).toBe(true);
      expect(d.content).toContain("generated `2026-09-07T12:00:00.000Z`");
      expect(d.content).toContain("extracted `2026-09-07T10:00:00.000Z`");
    }
  });

  it("is deterministic and uses no clock unless injected", () => {
    const a = renderDocs(classified());
    const b = renderDocs(classified());
    expect(a).toEqual(b);
    expect(a.every((d) => !d.content.includes("generated `"))).toBe(true);
    const realNow = Date.now;
    let called = 0;
    Date.now = () => {
      called++;
      return realNow();
    };
    try {
      renderDocs(classified());
    } finally {
      Date.now = realNow;
    }
    expect(called).toBe(0);
  });

  it("README.md indexes org, countries, global bucket, warnings and rules", () => {
    const docs = renderDocs(classified(), { now: FIXED_NOW });
    const readme = doc(docs, "README.md");
    expect(readme).toMatch(/^# Veeva CRM configuration — Pharma EU\n/);
    expect(readme).toContain("## How to read this");
    expect(readme).toContain(
      "| Instance URL | `https://example.my.salesforce.com` |",
    );
    expect(readme).toContain(
      "| API requests used | 42 (99000 of 100000 daily remaining) |",
    );
    // Countries table: code, name, users, categories, profile count, deltas, link
    expect(readme).toMatch(
      /\| `DE` \| Germany \| 12 \| MSL, Sales rep \| 3 \| \d+ \| \[DE\/README\.md\]\(DE\/README\.md\) \|/,
    );
    expect(readme).toMatch(
      /\| `FR` \| France \| 8 \| MSL, Sales rep \| 2 \| \d+ \| /,
    );
    // Global bucket: Global MSL is the msl baseline
    expect(readme).toContain(
      "| MSL | 1 | 0 | `Global MSL` | [global/msl.md](global/msl.md) |",
    );
    expect(readme).toContain(
      "Org-level Veeva Settings: **2** fields across **1** setting objects",
    );
    expect(readme).toContain(
      "VMOCs without a profile (apply to everyone): **1** (1 active)",
    );
    // Warning with a pipe is escaped
    expect(readme).toContain(
      "| `profiles` | Profile.Metadata not available \\| fallback |",
    );
    expect(readme).toContain("1 warning was recorded");
    // Classification rules table
    expect(readme).toContain("## Classification rules");
    expect(readme).toContain(
      "| 1 | `system\\s*admin\\|sys\\s*admin\\|integration\\|api\\s*user` | Admin |",
    );
    expect(readme).toContain(
      "[DE/sales_rep.md](DE/sales_rep.md) — Germany · Sales rep",
    );
  });

  it("uses a custom title when given", () => {
    const docs = renderDocs(classified(), { title: "My org" });
    expect(doc(docs, "README.md").startsWith("# My org\n")).toBe(true);
  });

  it("profiles.md lists every profile with category, countries, disposition and rationale", () => {
    const md = doc(renderDocs(classified()), "profiles.md");
    expect(md).toMatch(
      /\| `DE Sales Rep` \| Sales rep \| `DE` \| 10 \| DE 10 \| Salesforce \| ✓ \| keep \| category "sales_rep" from profile name matching .*; profile name carries country DE; active users in DE; VMOC where clauses filter on DE \|/,
    );
    expect(md).toContain(
      "| `DE Sales Rep Legacy` | Sales rep | `DE` | 0 | _none_ | Salesforce | ✓ | drop (0 active users) |",
    );
    expect(md).toContain("| `Global MSL` | MSL | `GLOBAL` | 0 | _none_ |");
    for (const p of fixture().profiles) {
      const occurrences = md.split(`| \`${p.name}\` |`).length - 1;
      expect(occurrences, p.name).toBe(1);
    }
  });

  it("global/README.md documents org settings, profile-less VMOCs, messages and objects", () => {
    const md = doc(renderDocs(classified()), "global/README.md");
    expect(md).toContain("### `Veeva_Settings_vod__c`");
    expect(md).toContain('| `CALL_SUBMIT_vod__c` | `"1"` |   |');
    expect(md).toContain(
      "| `ENABLE_SAMPLE_OPT_IN_vod__c` | `false` | `DE Sales Rep` |",
    );
    expect(md).toContain("1 **user-level** setting record exist");
    // VMOC without profile, where clause with pipe + newline escaped inside a code span
    expect(md).toContain(
      "| `Product all` | `Product_vod__c` | `iPad_vod` | _all_ | ✓ | · | · | `Pipe \\| in text and a newline` |",
    );
    // message summary
    expect(md).toContain("| `Common` | `de` | 1 | 0 |");
    expect(md).toContain("| `Common` | `en_US` | 2 | 0 |");
    expect(md).toContain("1 message is country-scoped");
    // object catalogue
    expect(md).toContain(
      "| `Call2_vod__c` | Call | ✓ | ✓ | 1 | 1 | 2 | 1 | 2 | 1 |",
    );
    expect(md).toContain(
      "| `apex_trigger` | `DECallTrigger` | `Call2_vod__c` | ✓ | · | ✓ |",
    );
  });

  it("global/<category>.md is the baseline and says so", () => {
    const md = doc(renderDocs(classified()), "global/msl.md");
    expect(md).toMatch(/^# Global · MSL\n/);
    expect(md).toContain(
      "This is the **baseline** of the MSL category (profile `Global MSL`)",
    );
    expect(md).not.toContain("| Delta ID |");
    expect(md).toContain(
      "Profile `Global MSL` has no active users — keep, merge into another profile, or drop?",
    );
    expect(md).toContain(
      "Application profile: `app_msl__c` — no country suffix",
    );
  });

  it("<CC>/README.md summarises the country and its delta vs global", () => {
    const md = doc(renderDocs(classified()), "DE/README.md");
    expect(md).toMatch(/^# DE — Germany\n/);
    expect(md).toContain("| Active users | 12 |");
    expect(md).toContain("| Languages in use | `de_DE` (11), `en_US` (1) |");
    expect(md).toContain("| Country sources | `user_country_code_vod` |");
    // rep categories table
    expect(md).toMatch(
      /\| Sales rep \| `DE Sales Rep`, `DE Sales Rep Legacy` \(0 users\) \| 10 \| Primary Care Rep \(10\) \| \d+ \| \[sales_rep\.md\]\(sales_rep\.md\) \|/,
    );
    expect(md).toMatch(
      /\| MSL \| `DE MSL` \| 2 \| MSL \(2\) \| \d+ \| \[msl\.md\]\(msl\.md\) \|/,
    );
    // delta matrix and country-level delta detail
    expect(md).toContain("### Delta matrix");
    expect(md).toContain(
      "| `setting` | `Veeva_Settings_vod__c.ENABLE_SAMPLE_OPT_IN_vod__c` |",
    );
    expect(md).toContain(
      "| `Veeva_Settings_vod__c` | `ENABLE_SAMPLE_OPT_IN_vod__c` | `false` | `DE Sales Rep` | `true` | Sales rep |",
    );
    expect(md).toContain(
      '| `Veeva_Settings_vod__c` | `NO_ORG_DEFAULT_vod__c` | `(unset)` | `DE Sales Rep` | `"x"` | Sales rep |',
    );
    expect(md).toContain("### VMOC where clauses filtering on DE");
    expect(md).toContain(
      "| `Account DE` | `Account` | `iPad_vod` | `DE Sales Rep` | ✓ | · | · | `Country_vod__c = 'DE'` | `DE` |",
    );
    expect(md).toContain("### Page layouts unique to this country");
    expect(md).toContain(
      "| `Call2_vod__c-Call Layout DE` | `Call2_vod__c` | ✓ | 1 | 2 |",
    );
    // country message
    expect(md).toContain("| `Signature` | `de` | 1 | 1 |");
    expect(md).toContain("- [sales_rep.md](sales_rep.md) — Sales rep (");
  });

  it("<CC>/README.md for FR has no unique layouts and inherits the shared layout", () => {
    const md = doc(renderDocs(classified()), "FR/README.md");
    expect(md).toContain("_No layout is unique to this country._");
    expect(md).toContain(
      "_No profile-level setting overrides for this country's profiles._",
    );
    expect(md).toContain("| Languages in use | `fr_FR` (6) |");
  });

  it("<CC>/<category>.md renders every section with merged tables and deltas", () => {
    const md = doc(renderDocs(classified()), "DE/sales_rep.md");
    expect(md).toMatch(/^# DE — Germany · Sales rep\n/);
    for (const h of [
      "## 1. Profiles",
      "## 2. Object access",
      "## 3. Page layouts",
      "### Layout detail",
      "## 4. Record-type visibility",
      "## 5. Field-level security",
      "## 6. VMOCs (mobile sync)",
      "## 7. Veeva Settings (profile-level overrides)",
      "## 8. Veeva Messages",
      "## 9. Tabs and apps",
      "## 10. Delta vs global",
      "## 11. Vault CRM target (proposed names)",
      "## 12. Open questions for the country business admin",
    ])
      expect(md, h).toContain(h);

    // Profiles table: users in DE vs total, disposition
    expect(md).toContain(
      "| `DE Sales Rep` | Salesforce | ✓ | 10 | 10 | `DE` | keep |",
    );
    expect(md).toContain(
      "| `DE Sales Rep Legacy` | Salesforce | ✓ | 0 | 0 | `DE` | drop (0 active users) |",
    );
    expect(md).toContain("synthetic baseline (majority vote");

    // Object access merged: Account create differs between the two DE profiles
    expect(md).toContain(
      "| `Account` | ◐ | ✓ | ✓ | · | · | · | Create: `DE Sales Rep Legacy` |",
    );
    expect(md).toContain("| `Call2_vod__c` | ✓ | ✓ | ✓ | · | · | · |   |");

    // Layouts: DE layout, inactive record type, in snapshot flag, profiles column
    expect(md).toContain(
      "| `Call2_vod__c` | `Old_Call_vod` | `Call2_vod__c-Call Layout DE` | ✓ | `DE Sales Rep` |",
    );
    expect(md).toContain(
      "| `Call2_vod__c` | _Master_ | `Call2_vod__c-Call Layout` | ✓ | `DE Sales Rep Legacy` |",
    );
    // Layout detail with escaped section heading (pipe + newline)
    expect(md).toContain(
      "<summary>`Call2_vod__c-Call Layout DE` — 1 section, 2 fields</summary>",
    );
    expect(md).toContain(
      "| Pipe \\| in text<br>and a newline | `DE_Pharmacy_Id__c` |   |",
    );
    expect(md).toContain("| Information | `Call_Type_vod__c` | Required |");
    expect(md).toContain("Related lists: `Call2_Key_Message_vod__c`");

    // Record types: inactive Old_Call_vod visible
    expect(md).toContain(
      "| `Call2_vod__c` | `Old_Call_vod` | · | visible | hidden |",
    );

    // FLS: most permissive is DE Sales Rep (3 fields); Notes and DE_Pharmacy differ
    expect(md).toContain("`DE Sales Rep` (most permissive)");
    expect(md).toContain("| `Call2_vod__c` | `DE_Pharmacy_Id__c` | R/E | - |");
    expect(md).toContain("| `Call2_vod__c` | `Notes_vod__c` | R | R/E |");
    expect(md).toContain(
      "<summary>Appendix — full field-level security (3 fields)</summary>",
    );

    // VMOC
    expect(md).toContain(
      "| `Account DE` | `Account` | `iPad_vod` | `DE Sales Rep` | ✓ | · | · | `Country_vod__c = 'DE'` | `DE` |",
    );

    // Settings with org default next to it
    expect(md).toContain(
      "| `Veeva_Settings_vod__c` | `ENABLE_SAMPLE_OPT_IN_vod__c` | `false` | `DE Sales Rep` | `true` |   | Δ |",
    );
    expect(md).toContain(
      '| `Veeva_Settings_vod__c` | `NO_ORG_DEFAULT_vod__c` | `(unset)` | `DE Sales Rep` | `"x"` |   | Δ |',
    );

    // Messages: country-scoped listed + global messages in de/en
    expect(md).toContain(
      "| `DE_DISCLAIMER` | `Signature` | `de` | · | Pipe \\| in text and a newline |",
    );
    expect(md).toContain(
      "Global messages in the languages used in `DE` (`de_DE`, `en_US`):",
    );
    expect(md).toContain("| `Common` | `de` | 1 | 0 |");

    // Tabs
    expect(md).toContain("| `Call2_vod__c` | DefaultOn | DefaultOn |");

    // Delta table
    expect(md).toContain(
      "| Delta ID | Kind | Item | Global | Local | Reason | Evidence | Status |",
    );
    expect(md).toMatch(
      /\| `DE-\d\d` \| `setting` \| `Veeva_Settings_vod__c\.ENABLE_SAMPLE_OPT_IN_vod__c` \| `false` \| `true` \|   \| snapshot 2026-09-07, profile DE Sales Rep \| proposed \|/,
    );
    expect(md).toContain(
      "Application profile: `app_sales_rep_de__c` — country suffix",
    );

    // Open questions
    expect(md).toContain(
      "- [ ] Profile `DE Sales Rep Legacy` has no active users in `DE` — keep, merge into another profile, or drop?",
    );
    expect(md).toContain(
      "- [ ] Profiles of this category differ on `Account` access (Create: `DE Sales Rep Legacy`)",
    );
    expect(md).toContain(
      "- [ ] Layout `Call2_vod__c-Call Layout DE` is assigned for the **inactive** record type `Old_Call_vod`",
    );
    expect(md).toContain(
      "- [ ] Record type `Old_Call_vod` on `Call2_vod__c` is inactive but still visible to `DE Sales Rep`",
    );
    expect(md).toContain(
      '- [ ] Setting `Veeva_Settings_vod__c.NO_ORG_DEFAULT_vod__c` is set on profile `DE Sales Rep` (`"x"`) but has no org default',
    );
    expect(md).toContain(
      "- [ ] Country-scoped message `DE_DISCLAIMER;;Signature` (`de`) is inactive",
    );
    expect(md).toMatch(/- \[ \] \d+ deltas? in section 10 need a reason code/);
  });

  it("flags VMOCs without where clause / inactive and fences long where clauses", () => {
    const docs = renderDocs(classified());
    const msl = doc(docs, "DE/msl.md");
    expect(msl).toContain(
      "- [ ] VMOC `Account MSL` (`Account`, `iPad_vod`, `DE MSL`) syncs without a where clause",
    );
    const fr = doc(docs, "FR/sales_rep.md");
    expect(fr).toContain(
      "- [ ] VMOC `Long where` (`Product_vod__c`, `iPad_vod`) is inactive",
    );
    expect(fr).toContain(
      "<summary>Full where clauses (1 clipped in the table)</summary>",
    );
    expect(fr).toContain("```sql\nCountry_vod__c = 'FR' AND Name != 'x'");
    expect(fr).toMatch(
      /\| `Long where` \| `Product_vod__c` \| `iPad_vod` \| `FR Sales Rep` \| · \| · \| · \| `Country_vod__c = 'FR' AND [^|]*…` \| `FR` \|/,
    );
  });

  it("omits the messages section when no language is derivable and no country message exists", () => {
    const c = classified();
    c.snapshot.users = undefined;
    c.snapshot.messages = c.snapshot.messages.filter((m) => m.country === null);
    for (const country of c.countries)
      for (const r of country.repConfigs) r.messages = [];
    const md = doc(renderDocs(c), "DE/sales_rep.md");
    expect(md).not.toContain("## 8. Veeva Messages");
    expect(md).toContain("## 9. Tabs and apps");
    expect(doc(renderDocs(c), "DE/README.md")).toContain(
      "| Languages in use | _not derivable (no user summary)_ |",
    );
    expect(doc(renderDocs(c), "DE/README.md")).toContain(
      "- [ ] Languages in use could not be derived from the snapshot",
    );
  });

  it("intake-template.md is pre-filled per country", () => {
    const md = doc(renderDocs(classified()), "intake-template.md");
    expect(md).toMatch(/^# Specification request — per country\n/);
    expect(md).toContain("## DE — Germany");
    expect(md).toContain("## FR — France");
    expect(md).toContain(
      "| Country (ISO-2) | [`DE`: `user_country_code_vod`] |",
    );
    expect(md).toContain(
      "| Languages users work in | [`de_DE`, `en_US`: `User.LanguageLocaleKey`] |",
    );
    expect(md).toContain(
      "| Primary Care Rep (10) | `DE Sales Rep` | Sales rep | 10 | [keep: classifier] | [`sales_rep__c`: naming convention] |",
    );
    expect(md).toContain(
      "### Section 3 — Sales rep: activities / call reporting",
    );
    expect(md).toContain(
      "[`Call_vod`, `Old_Call_vod`: record-type visibility on `Call2_vod__c`]",
    );
    expect(md).toContain(
      "| Call report fields that are mandatory locally | [`Call_Type_vod__c`: layout behaviour `Required`] |",
    );
    expect(md).toContain("### Section 4 — Sales rep: multichannel");
    expect(md).toContain(
      "| Approved Email | [unknown: objects not extracted] |",
    );
    expect(md).toContain(
      "| Samples on call | [unknown: objects not extracted] |",
    );
    expect(md).toContain(
      "| Local account custom fields that reps must see | [`Local_Segment__c`: non-vod custom fields on `Account`] |",
    );
    expect(md).toContain(
      "| Custom fields | `Call2_vod__c`: `DE_Pharmacy_Id__c` |",
    );
    expect(md).toContain(
      "| Validation rule | `Call2_vod__c.DE_Pharmacy_Required` | Pipe \\| in text<br>and a newline |",
    );
    expect(md).toContain(
      "| apex_trigger | `DECallTrigger` | references country logic |",
    );
    expect(md).toContain(
      "| Country-specific layout | `Call2_vod__c-Call Layout DE` |",
    );
    expect(md).toContain(
      "| VMOC where clause | `Account DE` | `Country_vod__c = 'DE'` |",
    );
    // Missing translations: de has CALL_SUBMIT only, so CALL_CANCEL is missing
    expect(md).toContain(
      "`de_DE`: 1 of 2 English messages have no translation (e.g. `CALL_CANCEL;;Common`)",
    );
    expect(md).toContain("### Section 10 — Sign-off");
    // FR: no DE-specific pre-fills
    const fr = md.slice(md.indexOf("## FR — France"));
    expect(fr).toContain(
      "| Rep (6) | `FR Sales Rep` | Sales rep | 6 | [keep: classifier] |",
    );
    expect(fr).toContain(
      "`fr_FR`: 2 of 2 English messages have no translation",
    );
  });

  it("renders a country with no profiles and an empty global bucket without empty tables", () => {
    const c = classified();
    c.countries.push({
      country: { code: "IT", name: "Italy", activeUsers: 0 },
      repConfigs: [],
    });
    c.global = [];
    const docs = renderDocs(c);
    const it = doc(docs, "IT/README.md");
    expect(it).toContain("_No profile serves this country.");
    expect(it).toContain("- [ ] No profile is mapped to `IT`");
    expect(it).toContain("_No category documents for this country._");
    expect(docs.map((d) => d.path)).not.toContain("global/msl.md");
    expect(doc(docs, "README.md")).toContain(
      "_No profile landed in the global bucket",
    );
    for (const d of docs) {
      // a table header immediately followed by nothing = empty table
      expect(d.content, d.path).not.toMatch(/\|---\|[^\n]*\n\n/);
      expect(d.content, d.path).not.toMatch(/\|---\|[^\n]*\n$/);
    }
  });
});

describe("writeDocs", () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("creates directories, writes every file and returns sorted absolute paths", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "veeva-docs-"));
    const docs = renderDocs(classified());
    const out = path.join(dir, "nested", "docs");
    const written = await writeDocs(docs, out);
    expect(written).toEqual([...written].sort());
    expect(written.every((p) => path.isAbsolute(p))).toBe(true);
    expect(written).toHaveLength(docs.length);
    expect(written).toContain(path.join(out, "DE", "sales_rep.md"));
    expect((await stat(path.join(out, "global"))).isDirectory()).toBe(true);
    expect(await readFile(path.join(out, "README.md"), "utf8")).toBe(
      doc(docs, "README.md"),
    );
  });

  it("refuses paths that escape the target directory", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "veeva-docs-"));
    await expect(
      writeDocs([{ path: "../evil.md", content: "x" }], dir),
    ).rejects.toThrow(/outside/);
  });
});
