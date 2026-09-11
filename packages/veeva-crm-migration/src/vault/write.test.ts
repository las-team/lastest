import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { classifySnapshot } from "../model/classify";
import { buildVaultPlan } from "./plan";
import { fixtureSnapshot } from "./test-helpers";
import {
  MDL_FILE_HEADER,
  renderManualChecklist,
  renderMdlGroup,
  renderPlanSummary,
  renderTranslationsCsv,
  renderUnmapped,
  translationFileName,
  writePlan,
} from "./write";

const NOW = () => new Date("2026-09-07T12:00:00Z");
const plan = buildVaultPlan(classifySnapshot(fixtureSnapshot()), { now: NOW });

describe("writePlan", () => {
  let dir: string;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("writes one .mdl per country/category plus the markdown files and returns sorted absolute paths", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "vault-plan-"));
    const target = path.join(dir, "vault-plan");
    const files = await writePlan(plan, target);
    const rel = files.map((f) => path.relative(target, f));
    expect(rel).toEqual([
      "DE/msl.mdl",
      "DE/sales_rep.mdl",
      "FR/msl.mdl",
      "FR/sales_rep.mdl",
      "GLOBAL/all.mdl",
      "manual-checklist.md",
      "steps.md",
      "translations/de.csv",
      "translations/en_US.csv",
      "unmapped.md",
    ]);
    expect(files.every((f) => path.isAbsolute(f))).toBe(true);
    expect([...files].sort()).toEqual(files);

    const de = await readFile(path.join(target, "DE", "sales_rep.mdl"), "utf8");
    expect(de.startsWith(MDL_FILE_HEADER)).toBe(true);
    expect(de).toContain("-- step: ps:DE.sales_rep");
    expect(de).toContain("-- REVIEW:");
    expect(de).toContain("CREATE Permissionset ps_de_sales_rep__c (");
    expect(de).toContain("CREATE Securityprofile sp_de_sales_rep__c (");
    expect(de).toContain("CREATE Pagelayout call2__v.call_layout_de__c (");
    expect(de).not.toMatch(/^RECREATE /m);
    const global = await readFile(
      path.join(target, "GLOBAL", "all.mdl"),
      "utf8",
    );
    expect(
      global.indexOf("picklist:speaker_engagement_status__c"),
    ).toBeLessThan(global.indexOf("obj:speaker_engagement__c"));
    expect(global).toContain("ALTER Object call2__v (");
    expect(global).not.toMatch(/^RECREATE /m);

    const csv = await readFile(
      path.join(target, "translations", "de.csv"),
      "utf8",
    );
    expect(csv).toBe(
      "message_name,category,language,country,text,reason\nHELLO,Common,de,DE,Hallo,country_scoped\n",
    );

    const checklist = await readFile(
      path.join(target, "manual-checklist.md"),
      "utf8",
    );
    expect(checklist).toContain("## DE — sales_rep");
    expect(checklist).toContain("- [ ] **layout-assign:DE.sales_rep**");
    expect(checklist).toContain("## Steps flagged for review");
    expect(checklist).toContain("## No Vault CRM equivalent");
    const unmapped = await readFile(path.join(target, "unmapped.md"), "utf8");
    expect(unmapped).toContain("| `Lead` |");
    const steps = await readFile(path.join(target, "steps.md"), "utf8");
    expect(steps).toContain(`- ${plan.steps.length} steps:`);
    expect(steps).toContain("| DE/sales_rep |");
    expect(steps).toContain("`obj:speaker_engagement__c`");
    expect(steps).toContain(
      "- 2 customer Veeva Messages in 2 languages (translations/<lang>.csv)",
    );
  });
});

describe("translations", () => {
  it("quotes CSV cells and names files by language", () => {
    expect(
      renderTranslationsCsv([
        {
          language: "en_US",
          name: "A",
          category: "C",
          text: 'Say "hi", then\nleave',
          country: null,
          reason: "referenced",
        },
      ]),
    ).toBe(
      'message_name,category,language,country,text,reason\nA,C,en_US,,"Say ""hi"", then\nleave",referenced\n',
    );
    expect(translationFileName("pt-BR/x")).toBe(
      path.join("translations", "pt-BR_x.csv"),
    );
  });
});

describe("renderers", () => {
  it("renderMdlGroup returns an empty string for groups without MDL", () => {
    expect(renderMdlGroup(plan.steps.filter((s) => s.kind === "manual"))).toBe(
      "",
    );
  });

  it("markdown renderers escape pipes and newlines", () => {
    const p = {
      ...plan,
      steps: [
        {
          id: "x",
          kind: "manual" as const,
          title: "a | b",
          country: "DE",
          category: "all" as const,
          source: "s",
          target: "t",
          manual: "line1\nline2",
          dependsOn: [],
        },
      ],
      unmapped: [{ source: "a|b", reason: "c\nd" }],
    };
    expect(renderPlanSummary(p)).toContain("| a \\| b |");
    expect(renderUnmapped(p)).toContain("| `a\\|b` | c d |");
    expect(renderManualChecklist(p)).toContain("  - line1\n  - line2");
  });
});
