import { describe, expect, it } from "vitest";

import { classifySnapshot } from "../model/classify";
import type { PlanStep } from "../model/types";
import {
  buildVaultPlan,
  orderSteps,
  parsePlaceholder,
  recordIdPlaceholder,
} from "./plan";
import { fixtureSnapshot } from "./test-helpers";

const NOW = () => new Date("2026-09-07T12:00:00Z");

function plan(extra = {}) {
  return buildVaultPlan(classifySnapshot(fixtureSnapshot(extra)), {
    now: NOW,
    vaultDns: "v.veevavault.com",
  });
}

function ids(p: { steps: PlanStep[] }): string[] {
  return p.steps.map((s) => s.id);
}

function step(p: { steps: PlanStep[] }, id: string): PlanStep {
  const s = p.steps.find((x) => x.id === id);
  if (!s) throw new Error(`no step ${id} in ${ids(p).join(", ")}`);
  return s;
}

describe("buildVaultPlan", () => {
  const p = plan();

  it("fills the plan header", () => {
    expect(p.schemaVersion).toBe(1);
    expect(p.createdAt).toBe("2026-09-07T12:00:00.000Z");
    expect(p.apiVersion).toBe("v26.2");
    expect(p.vaultDns).toBe("v.veevavault.com");
  });

  it("emits the data-model steps with deterministic ids", () => {
    const all = ids(p);
    expect(all).toContain("picklist:call2_visit_purpose__c");
    expect(all).toContain("picklist:speaker_engagement_status__c");
    expect(all).toContain("obj:speaker_engagement__c");
    expect(all).toContain("field:call2__v.visit_purpose__c");
    expect(all).toContain("field:call2__v.legacy_score__c");
    expect(all).toContain("field:account__v.pharmacy_id__c");
    expect(all).toContain("field:speaker_engagement__c.parent__c");
    expect(all).toContain("picklist-values:call_type__v");
    expect(all).toContain("objecttype:call2__v.hospital_visit__c");
    expect(all).toContain("objecttype:speaker_engagement__c.hospital__c");
    // Veeva record types are assumed to exist; inactive ones are dropped
    expect(all.filter((i) => i.startsWith("objecttype:"))).toHaveLength(2);
  });

  it("creates the custom object with its picklist first and defers the self-lookup", () => {
    const obj = step(p, "obj:speaker_engagement__c");
    expect(obj.kind).toBe("mdl");
    expect(obj.dependsOn).toEqual(["picklist:speaker_engagement_status__c"]);
    expect(obj.mdl).toContain("Field status__c");
    expect(obj.mdl).not.toContain("parent__c");
    const parent = step(p, "field:speaker_engagement__c.parent__c");
    expect(parent.dependsOn).toEqual(["obj:speaker_engagement__c"]);
    expect(parent.mdl).toContain("object('speaker_engagement__c')");
  });

  it("adds customer fields on Veeva objects via ALTER and links picklists", () => {
    const f = step(p, "field:call2__v.visit_purpose__c");
    expect(f.mdl).toMatch(/^ALTER Object call2__v \(/);
    expect(f.dependsOn).toEqual(["picklist:call2_visit_purpose__c"]);
    expect(f.country).toBe("GLOBAL");
    expect(f.category).toBe("all");
    expect(step(p, "field:call2__v.legacy_score__c").review).toBe(true);
  });

  it("adds customer values to Veeva picklists through the picklist API", () => {
    const s = step(p, "picklist-values:call_type__v");
    expect(s.kind).toBe("api");
    expect(s.api).toEqual({
      method: "POST",
      path: "/objects/picklists/call_type__v",
      body: { value_1: "Lunch and Learn" },
      contentType: "application/x-www-form-urlencoded",
    });
    expect(s.review).toBe(true);
    expect(ids(p)).not.toContain("picklist-values:specialty_1__v"); // only _vod values there
  });

  it("emits one persona per country × category and drops empty profiles", () => {
    const personas = ids(p).filter((i) => i.startsWith("sp:"));
    expect(personas).toEqual([
      "sp:DE.msl",
      "sp:DE.sales_rep",
      "sp:FR.msl",
      "sp:FR.sales_rep",
    ]);
    const sp = step(p, "sp:DE.sales_rep");
    expect(sp.dependsOn).toEqual(["ps:DE.sales_rep"]);
    expect(sp.mdl).toContain("RECREATE Securityprofile sp_de_sales_rep__c");
    expect(sp.mdl).toContain("permission_sets('ps_de_sales_rep__c')");
    const ps = step(p, "ps:DE.sales_rep");
    expect(ps.mdl).toContain("Objectpermission call2__v");
    expect(ps.mdl).toContain("Fieldpermission call2__v.visit_purpose__c");
    expect(ps.mdl).not.toContain("lead"); // unmapped standard object filtered out
    expect(ps.mdl).toContain("Tabpermission call2_tab__v");
    expect(ps.dependsOn).toEqual([
      "field:account__v.pharmacy_id__c",
      "field:call2__v.visit_purpose__c",
      "obj:speaker_engagement__c",
    ]);
    expect(ps.notes).toMatch(/view-all/);
    expect(p.unmapped).toContainEqual({
      source: "Profile DE Legacy Rep",
      reason: "dropped from the plan: 0 active users (country DE, sales_rep)",
    });
    expect(ids(p).some((i) => i.includes("DE Legacy"))).toBe(false);
  });

  it("keeps empty profiles when asked", () => {
    const kept = buildVaultPlan(classifySnapshot(fixtureSnapshot()), {
      now: NOW,
      keepEmptyProfiles: true,
    });
    expect(
      kept.unmapped.some((u) => u.source === "Profile DE Legacy Rep"),
    ).toBe(false);
    expect(step(kept, "ps:DE.sales_rep").title).toContain("DE Legacy Rep");
  });

  it("creates an application profile and hangs VMOCs / settings off its record id", () => {
    const app = step(p, "app:DE.sales_rep");
    expect(app.kind).toBe("api");
    expect(app.api).toMatchObject({
      method: "POST",
      path: "/vobjects/application_profile__v",
      body: { name__v: "DE sales rep" },
    });
    expect(app.captures).toEqual({ recordId: "id" });

    const vmoc = step(p, "vmoc:DE.sales_rep.call2__v.ipad");
    expect(vmoc.review).toBe(true);
    expect(vmoc.dependsOn).toEqual(["app:DE.sales_rep"]);
    expect(vmoc.api?.path).toBe("/vobjects/vmobile_object_configuration__v");
    expect(vmoc.api?.body).toEqual({
      name__v: "Call2_vod__c DE iPad",
      object_name__v: "call2__v",
      device__v: "iPad",
      active__v: true,
      where_clause__v: "WHERE country__v = 'DE' AND status__v = @@VOD_STATUS@@",
      enable_enhanced_sync__v: true,
      type__v: "Full",
      application_profile__v: "{{step:app:DE.sales_rep.recordId}}",
    });
    expect(vmoc.notes).toMatch(/@@VOD_STATUS@@/);

    const setting = step(p, "setting:DE.sales_rep.veeva_settings__v");
    expect(setting.api).toMatchObject({
      method: "POST",
      path: "/vobjects/veeva_settings__v",
      body: {
        application_profile__v: "{{step:app:DE.sales_rep.recordId}}",
        enable_sample_opt_in__v: true,
      },
    });
    expect(setting.api?.body).not.toHaveProperty("id");
    expect(setting.dependsOn).toEqual(["app:DE.sales_rep"]);
  });

  it("emits profile-less VMOCs globally without an application profile", () => {
    const v = step(p, "vmoc:GLOBAL.all.product__v.ipad");
    expect(v.api?.body).not.toHaveProperty("application_profile__v");
    expect(v.dependsOn).toEqual([]);
  });

  it("emits page layouts once (mdl when sections are known, manual otherwise) and assignment checklists", () => {
    const de = step(p, "layout:call2__v.call_layout_de__c");
    expect(de.kind).toBe("mdl");
    expect(de.review).toBe(true);
    expect(de.country).toBe("DE");
    expect(de.dependsOn).toEqual(["field:call2__v.visit_purpose__c"]);
    const msl = step(p, "layout:call2__v.call_layout_msl__c");
    expect(msl.country).toBe("DE"); // first group that referenced it
    expect(
      ids(p).filter((i) => i === "layout:call2__v.call_layout_msl__c"),
    ).toHaveLength(1);
    const se = step(
      p,
      "layout:speaker_engagement__c.speaker_engagement_layout__c",
    );
    expect(se.kind).toBe("manual");
    expect(se.dependsOn).toEqual(["obj:speaker_engagement__c"]);
    const assign = step(p, "layout-assign:DE.sales_rep");
    expect(assign.kind).toBe("manual");
    expect(assign.manual).toContain(
      "call2__v (Call2_vod__c) / object type base__v → layout call_layout_de__c",
    );
    expect(assign.manual).toContain(
      "object type hospital__c → layout speaker_engagement_layout__c",
    );
    expect(assign.dependsOn).toEqual([
      "layout:call2__v.call_layout_de__c",
      "layout:speaker_engagement__c.speaker_engagement_layout__c",
      "ps:DE.sales_rep",
    ]);
  });

  it("emits messages per country and org-level settings as manual steps", () => {
    const de = step(p, "messages:DE");
    expect(de.kind).toBe("manual");
    expect(de.manual).toContain("Common / de: 1 message");
    const global = step(p, "messages:GLOBAL");
    expect(global.title).toContain("1 Veeva Message"); // inactive dropped
    const org = step(p, "settings-org:veeva_settings__v");
    expect(org.kind).toBe("manual");
    expect(org.manual).toContain("- enable_sample_opt_in__v = false");
    expect(org.manual).toContain('- call_submit__v = "1"');
  });

  it("lists everything without a Vault equivalent", () => {
    const sources = p.unmapped.map((u) => u.source);
    expect(sources).toContain("Call2_vod__c.Geo__c");
    expect(sources).toContain("Lead");
    expect(sources).toContain("Apex trigger CallCountryTrigger (Call2_vod__c)");
    expect(sources).toContain("Flow Account_Sync (Account)");
    expect(sources).not.toContain("Apex trigger VOD_CALL (Call2_vod__c)");
    expect(sources).toContain("Validation rule Call2_vod__c.Require_Purpose");
    expect(sources).not.toContain("Validation rule Call2_vod__c.Sample_vod");
    expect(sources).toContain("Veeva_Settings_vod__c (user someone)");
    expect(p.unmapped.find((u) => u.source === "Lead")?.reason).toContain(
      "Source_Channel__c",
    );
    expect(
      p.unmapped.find((u) => u.source.includes("CallCountryTrigger"))?.reason,
    ).toMatch(/country logic/);
    const sorted = [...p.unmapped].sort(
      (a, b) =>
        a.source.localeCompare(b.source) || a.reason.localeCompare(b.reason),
    );
    expect(p.unmapped).toEqual(sorted);
  });

  it("orders steps so every dependency comes first", () => {
    const pos = new Map(p.steps.map((s, i) => [s.id, i]));
    for (const s of p.steps)
      for (const d of s.dependsOn)
        expect(pos.get(d)!, `${d} before ${s.id}`).toBeLessThan(pos.get(s.id)!);
    expect(new Set(ids(p)).size).toBe(p.steps.length);
    expect(pos.get("picklist:call2_visit_purpose__c")!).toBeLessThan(
      pos.get("field:call2__v.visit_purpose__c")!,
    );
    expect(pos.get("field:call2__v.visit_purpose__c")!).toBeLessThan(
      pos.get("ps:DE.sales_rep")!,
    );
    expect(pos.get("ps:DE.sales_rep")!).toBeLessThan(
      pos.get("sp:DE.sales_rep")!,
    );
  });

  it("is deterministic", () => {
    expect(JSON.stringify(plan())).toBe(JSON.stringify(plan()));
  });

  it("is JSON-serialisable without undefined leaks in review/notes", () => {
    for (const s of p.steps) {
      expect("review" in s ? s.review : true).toBe(true);
      if ("notes" in s) expect(typeof s.notes).toBe("string");
    }
  });
});

describe("orderSteps", () => {
  const mk = (id: string, dependsOn: string[] = []): PlanStep => ({
    id,
    kind: "manual",
    title: id,
    country: "GLOBAL",
    category: "all",
    source: id,
    target: id,
    manual: id,
    dependsOn,
  });

  it("keeps input order among independent steps", () => {
    expect(orderSteps([mk("b"), mk("a")]).map((s) => s.id)).toEqual(["b", "a"]);
    expect(
      orderSteps([mk("c", ["a"]), mk("b"), mk("a")]).map((s) => s.id),
    ).toEqual(["b", "a", "c"]);
  });

  it("rejects unknown dependencies and cycles", () => {
    expect(() => orderSteps([mk("a", ["zz"])])).toThrow(/unknown step zz/);
    expect(() => orderSteps([mk("a", ["b"]), mk("b", ["a"])])).toThrow(/cycle/);
  });
});

describe("placeholders", () => {
  it("round-trips ids containing dots and colons", () => {
    const ph = recordIdPlaceholder("app:DE.sales_rep");
    expect(ph).toBe("{{step:app:DE.sales_rep.recordId}}");
    expect(parsePlaceholder(ph)).toBe("app:DE.sales_rep");
    expect(parsePlaceholder("plain")).toBeNull();
    expect(parsePlaceholder(42)).toBeNull();
  });
});
