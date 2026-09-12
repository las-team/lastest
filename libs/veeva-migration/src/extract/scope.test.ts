import { describe, expect, it } from "vitest";
import { parseConfig } from "../config/schema";
import { resolveCountry, resolveScope } from "../config/resolve";
import { sample_transaction } from "../objects/sample/sample_transaction";
import type { Finding, ResolvedScope, ScopeSpec } from "../types";
import {
  buildScopePredicate,
  cutoffLiteral,
  effectiveCutoffDate,
  prefixPredicateFields,
  renderOpenPredicate,
  scopeColumns,
} from "./scope";
import { NOW } from "./test-helpers";

const CUTOFF = "2024-09-09";

const call2Scope: ScopeSpec = {
  kind: "dated",
  predicates: [{ field: "Call_Date_vod__c", type: "date" }],
  openPredicate: "Status_vod__c = 'Planned_vod'",
};

function resolved(
  spec: ScopeSpec,
  cutoffDate: string | null = CUTOFF,
): ResolvedScope {
  return cutoffDate === null
    ? { spec }
    : { spec, cutoffDate, historyMonths: 24 };
}

describe("buildScopePredicate", () => {
  it("dated scope with the open-item OR term (call2)", () => {
    const b = buildScopePredicate(resolved(call2Scope));
    expect(b.predicate).toBe(
      "(Call_Date_vod__c >= 2024-09-09) OR (Status_vod__c = 'Planned_vod')",
    );
    expect(b.cutoffDate).toBe(CUTOFF);
    expect(b.dateTerm).toBe("Call_Date_vod__c >= 2024-09-09");
  });

  it("datetime field gets a T00:00:00Z literal, no open term (em_event)", () => {
    const b = buildScopePredicate(
      resolved({
        kind: "dated",
        predicates: [{ field: "Start_Time_vod__c", type: "datetime" }],
        retentionFamily: "tov",
      }),
    );
    expect(b.predicate).toBe("Start_Time_vod__c >= 2024-09-09T00:00:00Z");
  });

  it("multi-field OR for sample_transaction (COALESCE emulation)", () => {
    const b = buildScopePredicate(resolved(sample_transaction.scope));
    expect(b.predicate).toBe(
      "Call_Date_vod__c >= 2024-09-09 OR Transferred_Date_vod__c >= 2024-09-09 OR Adjusted_Date_vod__c >= 2024-09-09 OR Submitted_Date_vod__c >= 2024-09-09 OR CreatedDate >= 2024-09-09T00:00:00Z",
    );
  });

  it("open term with parentheses and AND (medical_inquiry)", () => {
    const b = buildScopePredicate(
      resolved({
        kind: "dated",
        predicates: [{ field: "CreatedDate", type: "datetime" }],
        openPredicate:
          "(Status_vod__c != 'Closed' AND Fulfillment_Status_vod__c != 'Completed_vod')",
      }),
    );
    expect(b.predicate).toBe(
      "(CreatedDate >= 2024-09-09T00:00:00Z) OR ((Status_vod__c != 'Closed' AND Fulfillment_Status_vod__c != 'Completed_vod'))",
    );
  });

  it("via-parent relationship path with the parent's open term re-prefixed (call2_detail)", () => {
    const b = buildScopePredicate(
      resolved({
        kind: "via-parent",
        parentKey: "call2",
        parentField: "Call2_vod__r.Call_Date_vod__c",
        type: "date",
      }),
      { parentOpenPredicate: "Status_vod__c = 'Planned_vod'" },
    );
    expect(b.predicate).toBe(
      "(Call2_vod__r.Call_Date_vod__c >= 2024-09-09) OR (Call2_vod__r.Status_vod__c = 'Planned_vod')",
    );
  });

  it("via-parent datetime without a parent open term (em_attendee)", () => {
    const b = buildScopePredicate(
      resolved({
        kind: "via-parent",
        parentKey: "em_event",
        parentField: "Event_vod__r.Start_Time_vod__c",
        type: "datetime",
      }),
    );
    expect(b.predicate).toBe(
      "Event_vod__r.Start_Time_vod__c >= 2024-09-09T00:00:00Z",
    );
  });

  it("full scope and unscoped objects have no predicate", () => {
    expect(
      buildScopePredicate({ spec: { kind: "full" } }).predicate,
    ).toBeUndefined();
    // scope.objects.<key>.historyMonths: null → no cutoff, no historyMonths
    expect(
      buildScopePredicate(resolved(call2Scope, null)).predicate,
    ).toBeUndefined();
  });

  it("an unscoped object stays unscoped when the plan carries a country cutoff", () => {
    // the engine passes the country's cutoff as ExtractPlan.cutoffDate for
    // every unit; `historyMonths: null` (§7.2.1) must not be re-scoped by it
    const b = buildScopePredicate(resolved(call2Scope, null), {
      cutoffDate: "2024-09-09",
    });
    expect(b.predicate).toBeUndefined();
    expect(b.cutoffDate).toBeUndefined();
    expect(
      effectiveCutoffDate(resolved(call2Scope, null), {
        cutoffDate: "2024-09-09",
      }),
    ).toBeUndefined();
    expect(
      buildScopePredicate(
        {
          spec: {
            kind: "via-parent",
            parentKey: "call2",
            parentField: "Call2_vod__r.Call_Date_vod__c",
          },
        },
        { cutoffDate: "2024-09-09" },
      ).predicate,
    ).toBeUndefined();
    // a scoped object still honours the plan override
    expect(
      buildScopePredicate(resolved(call2Scope), { cutoffDate: "2023-01-01" })
        .cutoffDate,
    ).toBe("2023-01-01");
  });

  it("substitutes {cutoffDate}/{cutoffDateTime} tokens in the open term (sent_email)", () => {
    const b = buildScopePredicate(
      resolved({
        kind: "dated",
        predicates: [{ field: "Email_Sent_Date_vod__c", type: "datetime" }],
        openPredicate:
          "Status_vod__c IN ('Scheduled_vod', 'Saved_vod') OR (Email_Sent_Date_vod__c = null AND CreatedDate >= {cutoffDateTime})",
      }),
    );
    expect(b.predicate).toBe(
      "(Email_Sent_Date_vod__c >= 2024-09-09T00:00:00Z) OR (Status_vod__c IN ('Scheduled_vod', 'Saved_vod') OR (Email_Sent_Date_vod__c = null AND CreatedDate >= 2024-09-09T00:00:00Z))",
    );
  });

  it("never emits relative literals", () => {
    const b = buildScopePredicate(resolved(call2Scope));
    expect(b.predicate).not.toMatch(/LAST_N_|TODAY|YESTERDAY/);
  });

  it("rejects a malformed cutoff", () => {
    expect(() =>
      buildScopePredicate(resolved(call2Scope, "2024/09/09")),
    ).toThrow(/YYYY-MM-DD/);
  });
});

describe("effectiveCutoffDate", () => {
  it("plan override → mapping literal → today − historyMonths", () => {
    const s: ResolvedScope = {
      spec: call2Scope,
      cutoffDate: "2024-01-01",
      historyMonths: 24,
    };
    expect(effectiveCutoffDate(s, { cutoffDate: "2023-06-01" })).toBe(
      "2023-06-01",
    );
    expect(effectiveCutoffDate(s)).toBe("2024-01-01");
    expect(
      effectiveCutoffDate(
        { spec: call2Scope, historyMonths: 24 },
        { now: NOW },
      ),
    ).toBe("2024-09-09");
    expect(
      effectiveCutoffDate(
        { spec: call2Scope, historyMonths: 36 },
        { now: NOW },
      ),
    ).toBe("2023-09-09");
    expect(
      effectiveCutoffDate({ spec: { kind: "full" }, cutoffDate: "2024-01-01" }),
    ).toBeUndefined();
  });

  it("cutoffLiteral renders date and datetime forms", () => {
    expect(cutoffLiteral(CUTOFF, "date")).toBe("2024-09-09");
    expect(cutoffLiteral(CUTOFF, "datetime")).toBe("2024-09-09T00:00:00Z");
  });
});

describe("retention-family widening (config → resolveScope → predicate)", () => {
  const config = parseConfig({
    version: 1,
    source: {
      loginUrl: "https://x.my.salesforce.com",
      auth: { kind: "jwt", clientId: "c", username: "u", privateKeyPath: "k" },
    },
    target: {
      vaultDns: "x.veevavault.com",
      auth: { kind: "password", username: "u", password: "p" },
      migrationUserId: 1,
    },
    scope: { historyMonths: 24 },
    countries: { US: { scope: { sampleRetentionMonths: 36 } }, DE: {} },
  });

  it("US sampleRetentionMonths 36 widens the samples family; DE keeps 24 months", () => {
    const findings: Finding[] = [];
    const us = resolveScope(
      sample_transaction,
      resolveCountry(config, "US"),
      findings,
      NOW,
    );
    const de = resolveScope(
      sample_transaction,
      resolveCountry(config, "DE"),
      findings,
      NOW,
    );
    expect(us.cutoffDate).toBe("2023-09-09");
    expect(de.cutoffDate).toBe("2024-09-09");
    expect(buildScopePredicate(us).predicate).toContain(
      "Call_Date_vod__c >= 2023-09-09",
    );
    expect(buildScopePredicate(de).predicate).toContain(
      "Call_Date_vod__c >= 2024-09-09",
    );
  });
});

describe("prefixPredicateFields / renderOpenPredicate", () => {
  it("prefixes bare fields but not keywords, literals, strings or function names", () => {
    expect(
      prefixPredicateFields(
        "Status_vod__c IN ('Planned_vod','x AND y') AND NOT Type_vod__c = 'a' OR DAY_ONLY(CreatedDate) >= 2024-01-01 OR Flag__c = true OR Count__c > 10",
        "Call2_vod__r",
      ),
    ).toBe(
      "Call2_vod__r.Status_vod__c IN ('Planned_vod','x AND y') AND NOT Call2_vod__r.Type_vod__c = 'a' OR DAY_ONLY(Call2_vod__r.CreatedDate) >= 2024-01-01 OR Call2_vod__r.Flag__c = true OR Call2_vod__r.Count__c > 10",
    );
  });

  it("renderOpenPredicate leaves token-free text alone and rejects tokens without a cutoff", () => {
    expect(renderOpenPredicate("  A = 1 ", CUTOFF)).toBe("A = 1");
    expect(() => renderOpenPredicate("A >= {cutoffDate}", undefined)).toThrow(
      /no cutoff/,
    );
  });

  it("scopeColumns lists the fields a scope reads", () => {
    expect(scopeColumns(sample_transaction.scope)).toEqual([
      "Call_Date_vod__c",
      "Transferred_Date_vod__c",
      "Adjusted_Date_vod__c",
      "Submitted_Date_vod__c",
      "CreatedDate",
    ]);
    expect(
      scopeColumns({
        kind: "via-parent",
        parentKey: "call2",
        parentField: "Call2_vod__r.Call_Date_vod__c",
      }),
    ).toEqual(["Call2_vod__r.Call_Date_vod__c"]);
    expect(scopeColumns({ kind: "full" })).toEqual([]);
  });
});
