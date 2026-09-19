import { describe, expect, it } from "vitest";
import { buildReport, preflightExitCode, summariseFindings } from "./report";
import {
  blockedUnits,
  findingBlocksUnit,
  isGlobalBlocking,
  newSinceLastRun,
  FindingCollector,
} from "./findings";
import type { PreflightResult } from "./types";
import type { Finding } from "../types";

function result(
  findings: Finding[],
  extra: Partial<PreflightResult> = {},
): PreflightResult {
  const units = [
    { objectKey: "call2" as const, country: "US" },
    { objectKey: "call2" as const, country: "DE" },
    { objectKey: "product" as const, country: "GLOBAL" },
  ];
  return {
    runId: "run-1",
    findings,
    resolvedTargets: new Map(),
    mappings: new Map(),
    blockedUnits: blockedUnits(findings, units),
    blocking: findings.some(isGlobalBlocking),
    source: {
      orgId: "00D000000000001AAA",
      apiVersion: "67.0",
      multiCurrency: false,
      personAccounts: true,
      territory2: false,
      now: "2026-09-07T12:00:00.000Z",
    },
    countries: new Map([
      [
        "acme.veevavault.com",
        [{ iso2: "US", sfdcId: "a0C", vaultId: "V0C", name: "United States" }],
      ],
    ]),
    ...extra,
  };
}

describe("findings helpers", () => {
  it("collapses identical findings and scopes blocking to units", () => {
    const fc = new FindingCollector();
    fc.warning("X", "same", { objectKey: "call2", country: "US" });
    fc.warning("X", "same", { objectKey: "call2", country: "US" });
    fc.blocking("Y", "obj-level", { objectKey: "call2" });
    fc.blocking("Z", "country-level", { country: "DE" });
    fc.blocking("G", "global");
    expect(fc.findings.length).toBe(4);
    expect(
      findingBlocksUnit(fc.findings[1], { objectKey: "call2", country: "US" }),
    ).toBe(true);
    expect(
      findingBlocksUnit(fc.findings[1], {
        objectKey: "product",
        country: "US",
      }),
    ).toBe(false);
    expect(
      findingBlocksUnit(fc.findings[2], {
        objectKey: "product",
        country: "DE",
      }),
    ).toBe(true);
    expect(
      findingBlocksUnit(fc.findings[2], {
        objectKey: "product",
        country: "US",
      }),
    ).toBe(false);
    expect(
      findingBlocksUnit(fc.findings[3], {
        objectKey: "product",
        country: "US",
      }),
    ).toBe(false);
    expect(isGlobalBlocking(fc.findings[3])).toBe(true);
    expect(fc.hasBlocking({ objectKey: "call2", country: "DE" })).toBe(true);
  });
  it("newSinceLastRun diffs by key", () => {
    const prev: Finding[] = [
      { severity: "warning", code: "A", detail: "x", objectKey: "call2" },
    ];
    const cur: Finding[] = [
      ...prev,
      { severity: "warning", code: "B", detail: "y" },
    ];
    expect(newSinceLastRun(cur, prev).map((f) => f.code)).toEqual(["B"]);
  });
});

describe("report (§5, §8.10)", () => {
  it("exit code 2 on global blocking in any mode; unit blocking only blocks preflight mode", () => {
    const unitBlocked = result([
      {
        severity: "blocking",
        code: "VT_FIELD_MISSING",
        objectKey: "call2",
        country: "US",
        field: "x__v",
        detail: "gone",
      },
    ]);
    expect(unitBlocked.blocking).toBe(false);
    expect(unitBlocked.blockedUnits).toEqual([
      { objectKey: "call2", country: "US" },
    ]);
    expect(preflightExitCode(unitBlocked, "preflight")).toBe(2);
    expect(preflightExitCode(unitBlocked, "init")).toBe(0);
    const global = result([
      { severity: "blocking", code: "SF_AUTH_FAILED", detail: "nope" },
    ]);
    expect(global.blocking).toBe(true);
    expect(preflightExitCode(global, "init")).toBe(2);
    expect(
      preflightExitCode(
        result([{ severity: "warning", code: "W", detail: "w" }]),
        "preflight",
      ),
    ).toBe(0);
  });

  it("renders markdown and JSON with summary, blocked units, MDL snippets and the diff", () => {
    const findings: Finding[] = [
      {
        severity: "info",
        code: "LEGACY_ID_FIELD_SELECTED",
        objectKey: "call2",
        field: "legacy_crm_id__v",
        detail: { step: 2 },
      },
      {
        severity: "blocking",
        code: "VT_LEGACY_ID_FIELD_MISSING",
        objectKey: "product",
        detail: { hint: "h", mdl: "ALTER Object product__v (...)" },
      },
      {
        severity: "warning",
        code: "VT_FIELD_MISSING",
        objectKey: "call2",
        country: "DE",
        field: "a__v",
        count: 1,
        detail: "pipe | in detail",
      },
      {
        severity: "info",
        code: "PROBE_RESULT",
        detail: { probe: "migrationMode", result: "accepted" },
      },
    ];
    const r = result(findings, {
      resolvedTargets: new Map([
        [
          "call2",
          {
            objectKey: "call2",
            targetObject: "call2__v",
            legacyIdField: "legacy_crm_id__v",
            metadata: {
              targetObject: "call2__v",
              legacyIdFormat: "{id18}",
              fields: {},
              allowTypes: true,
              objectTypes: {},
            },
            rawMetadata: { name: "call2__v", status: [], fields: [] },
            objectTypes: [],
            picklists: {},
            replicateable: true,
            columns: [],
          },
        ],
      ]),
    });
    const rep = buildReport(r, {
      mode: "preflight",
      previous: [findings[0]],
      now: new Date("2026-09-07T00:00:00Z"),
    });
    expect(rep.exitCode).toBe(2);
    expect(rep.json.summary).toEqual({
      blocking: 1,
      warning: 1,
      info: 2,
      byCode: {
        LEGACY_ID_FIELD_SELECTED: 1,
        VT_LEGACY_ID_FIELD_MISSING: 1,
        VT_FIELD_MISSING: 1,
        PROBE_RESULT: 1,
      },
    });
    expect(rep.json.blockedUnits).toEqual(["product:GLOBAL"]);
    expect(rep.json.newSinceLastRun).toBe(3);
    expect(rep.json.findings[0].code).toBe("VT_LEGACY_ID_FIELD_MISSING"); // blocking first
    expect(
      rep.json.findings.find((f) => f.code === "LEGACY_ID_FIELD_SELECTED")?.new,
    ).toBe(false);
    expect(rep.json.mdl).toEqual([
      {
        code: "VT_LEGACY_ID_FIELD_MISSING",
        objectKey: "product",
        field: undefined,
        mdl: "ALTER Object product__v (...)",
      },
    ]);
    expect(rep.json.probes).toEqual([
      { probe: "migrationMode", result: "accepted" },
    ]);
    expect(rep.json.legacyIds).toEqual([
      {
        objectKey: "call2",
        targetObject: "call2__v",
        legacyIdField: "legacy_crm_id__v",
        format: "{id18}",
      },
    ]);
    expect(rep.markdown).toContain("# Preflight report — run run-1");
    expect(rep.markdown).toContain("**BLOCKED** (exit code 2)");
    expect(rep.markdown).toContain("- `product:GLOBAL`");
    expect(rep.markdown).toContain(
      "| warning | `VT_FIELD_MISSING` | call2 | DE | a__v | 1 | yes | pipe \\| in detail |",
    );
    expect(rep.markdown).toContain("ALTER Object product__v (...)");
    expect(rep.markdown).toContain("## Country crosswalk");
    expect(rep.markdown).toContain("| US | a0C | V0C | United States |");
    expect(summariseFindings([]).blocking).toBe(0);
  });
});
