import { describe, expect, it } from "vitest";
import { multichannel_activity_line } from "./multichannel_activity_line";
import { validateObjectModule } from "../types";
import { materialise, resolveCountry } from "../../config/resolve";
import { parseConfig } from "../../config/schema";
import { applyMapping } from "../../transform/apply";
import { buildScopePredicate } from "../../extract/scope";
import {
  SAMPLE_USER_ID,
  buildCountryContext,
  buildIdResolver,
  buildVaultMetadata,
  resolveMetadata,
} from "../../testkit";
import { to18 } from "../../transform/ids";
import type { SourceRow } from "../../types";

const NOW = new Date("2026-09-07T00:00:00Z");
const CUTOFF = "2024-09-07";
const LINE_ID = to18("a0L000000000001");
const ACTIVITY_ID = to18("a0N000000000001");
const KEY_MESSAGE_ID = to18("a0G000000000001");
const PRESENTATION_ID = to18("a0H000000000001");

function config(overrides: Record<string, unknown> = {}) {
  return parseConfig({
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
    objects: { multichannel_activity_line: { ...overrides } },
    countries: { US: {} },
  });
}

const METADATA = resolveMetadata(
  buildVaultMetadata("multichannel_activity_line__v", [
    {
      name: "multichannel_activity__v",
      type: "Object",
      object: { name: "multichannel_activity__v" },
      required: true,
    },
    {
      name: "key_message__v",
      type: "Object",
      object: { name: "key_message__v" },
    },
    {
      name: "clm_presentation__v",
      type: "Object",
      object: { name: "clm_presentation__v" },
    },
    { name: "display_order__v", type: "Number", scale: 0 },
    { name: "duration__v", type: "Number", scale: 0 },
    { name: "start_datetime__v", type: "DateTime" },
    { name: "vexternal_id__v", type: "String", max_length: 255, unique: true },
    { name: "mobile_id__v", type: "String", max_length: 100 },
  ]),
);

function lineRow(extra: Partial<SourceRow> = {}): SourceRow {
  return {
    Id: LINE_ID,
    Name: "MCAL-000001",
    Multichannel_Activity_vod__c: ACTIVITY_ID,
    Key_Message_vod__c: KEY_MESSAGE_ID,
    Clm_Presentation_vod__c: PRESENTATION_ID,
    Display_Order_vod__c: "3",
    Duration_vod__c: "42",
    Start_DateTime_vod__c: "2025-03-04T10:07:00.000Z",
    VExternal_Id_vod__c: "VEXT-L-1",
    Mobile_ID_vod__c: "mob-mcal-1",
    CreatedById: SAMPLE_USER_ID,
    CreatedDate: "2025-03-04T10:31:00.000Z",
    LastModifiedById: SAMPLE_USER_ID,
    LastModifiedDate: "2025-03-04T10:31:00.000Z",
    ...extra,
  };
}

function run(
  row: SourceRow,
  opts: { overrides?: Record<string, unknown>; knownParent?: boolean } = {},
) {
  const cfg = config(opts.overrides);
  const mapping = materialise(
    multichannel_activity_line,
    resolveCountry(cfg, "US"),
    cfg,
    { now: NOW },
  );
  const ids = buildIdResolver(
    {
      multichannel_activity:
        opts.knownParent === false ? {} : { [ACTIVITY_ID]: "V0N1" },
      key_message: { [KEY_MESSAGE_ID]: "V0G1" },
      clm_presentation: { [PRESENTATION_ID]: "V0H1" },
    },
    { [SAMPLE_USER_ID]: 101 },
  );
  return {
    mapping,
    result: applyMapping(row, mapping, {
      country: buildCountryContext(),
      metadata: METADATA,
      ids,
      migrationUserId: 1,
      runMode: "init",
      custom: multichannel_activity_line.custom,
    }),
  };
}

describe("multichannel_activity_line module", () => {
  it("is structurally valid", () => {
    expect(
      validateObjectModule(multichannel_activity_line).filter(
        (i) => i.severity === "blocking",
      ),
    ).toEqual([]);
    expect(multichannel_activity_line.notes).not.toContain("STUB");
  });

  it("encodes the §6.2 / §6.3.44 / §3.3 / §4.4 catalogue facts", () => {
    expect(multichannel_activity_line.source).toBe(
      "Multichannel_Activity_Line_vod__c",
    );
    expect(multichannel_activity_line.target).toBe(
      "multichannel_activity_line__v",
    );
    expect(multichannel_activity_line.targetEvidence).toBe("UNV");
    expect(multichannel_activity_line.scope).toEqual({
      kind: "via-parent",
      parentKey: "multichannel_activity",
      parentField: "Multichannel_Activity_vod__r.Start_DateTime_vod__c",
      type: "datetime",
    });
    expect(multichannel_activity_line.countryOf).toEqual([
      {
        kind: "parent",
        key: "multichannel_activity",
        field: "Multichannel_Activity_vod__c",
      },
    ]);
    expect(multichannel_activity_line.dependsOn).toEqual([
      "multichannel_activity",
      "key_message",
      "clm_presentation",
    ]);
    expect(multichannel_activity_line.selfRefs).toEqual([]);
    expect(multichannel_activity_line.deletePolicy).toBe("delete");
    expect(multichannel_activity_line.inactivate).toEqual([]);
    expect(multichannel_activity_line.createPolicy).toBe("create");
    expect(multichannel_activity_line.load).toMatchObject({
      noTriggers: true,
    });
    expect(multichannel_activity_line.objectTypes).toEqual({});
    expect(multichannel_activity_line.blockS).toMatchObject({
      name: "autoNumber",
      ownerId: false,
      objectType: false,
    });
    expect(multichannel_activity_line.match.map((m) => m.method)).toEqual([
      "legacy_id",
      "external_id",
      "mobile_id",
    ]);
    expect(multichannel_activity_line.match[1]).toMatchObject({
      keys: [{ target: "vexternal_id__v", source: "VExternal_Id_vod__c" }],
      evidence: "UNV",
    });
  });

  it("maps every §6.3.44 row with the spec's transform, requirement and evidence", () => {
    const byTarget = new Map(
      multichannel_activity_line.fields.map((f) => [f.target, f]),
    );
    expect(byTarget.get("legacy_crm_id__v")).toMatchObject({
      required: "K",
      transform: { kind: "legacyId" },
    });
    // auto-number Name, [UNVERIFIED-SOURCE], gated by preserveAutoNumberName (single row)
    expect(byTarget.get("name__v")).toMatchObject({
      source: "Name",
      evidence: "UNV",
      unverifiedSource: true,
      enabledBy: "preserveAutoNumberName",
      transform: { kind: "text", max: 128 },
    });
    expect(
      multichannel_activity_line.fields.filter((f) => f.target === "name__v"),
    ).toHaveLength(1);
    expect(byTarget.get("multichannel_activity__v")).toMatchObject({
      source: "Multichannel_Activity_vod__c",
      required: "Y",
      evidence: "UNV",
      transform: { kind: "ref", objectKey: "multichannel_activity" },
    });
    expect(byTarget.get("key_message__v")).toMatchObject({
      required: "n",
      transform: { kind: "ref", objectKey: "key_message" },
    });
    expect(byTarget.get("clm_presentation__v")).toMatchObject({
      required: "n",
      transform: { kind: "ref", objectKey: "clm_presentation" },
    });
    for (const t of ["display_order__v", "duration__v"])
      expect(byTarget.get(t)).toMatchObject({
        evidence: "UNV",
        transform: { kind: "number" },
      });
    expect(byTarget.get("start_datetime__v")).toMatchObject({
      source: "Start_DateTime_vod__c",
      unverifiedSource: true,
      optionalSource: true,
      transform: { kind: "datetime" },
    });
    expect(byTarget.get("vexternal_id__v")).toMatchObject({
      unverifiedSource: true,
      optionalSource: true,
      transform: { kind: "copy" },
    });
    // master-detail child: no owner, no object type, no status derivation
    expect(byTarget.has("ownerid__v")).toBe(false);
    expect(byTarget.has("object_type__v.api_name__v")).toBe(false);
    expect(byTarget.has("status__v")).toBe(false);
  });

  it("transforms a line row (parent FK deferred, numbers, datetime, auto-number name skipped)", () => {
    const { result } = run(lineRow());
    expect(result.status).toBe("ok");
    expect(result.payload).toMatchObject({
      legacy_crm_id__v: LINE_ID,
      multichannel_activity__v: {
        $fk: { object: "multichannel_activity", sfdcId: ACTIVITY_ID },
      },
      key_message__v: {
        $fk: { object: "key_message", sfdcId: KEY_MESSAGE_ID },
      },
      clm_presentation__v: {
        $fk: { object: "clm_presentation", sfdcId: PRESENTATION_ID },
      },
      display_order__v: 3,
      duration__v: 42,
      start_datetime__v: "2025-03-04T10:07:00.000Z",
      vexternal_id__v: "VEXT-L-1",
      mobile_id__v: "mob-mcal-1",
      created_by__v: { $user: SAMPLE_USER_ID },
      last_device__v: "data_load__v",
    });
    expect(result.payload.name__v).toBeUndefined();
    expect(result.payload.ownerid__v).toBeUndefined();
    expect(result.secondPass).toEqual({});
    expect(result.blobs).toEqual({});
    expect(result.diagnostics.some((d) => d.fatal)).toBe(false);
    expect(result.fkEdges).toContainEqual({
      field: "multichannel_activity__v",
      targetObjectKey: "multichannel_activity",
      targetSfdcId: ACTIVITY_ID,
    });
  });

  it("carries the auto-number Name only with preserveAutoNumberName", () => {
    const { result } = run(lineRow(), {
      overrides: { preserveAutoNumberName: true },
    });
    expect(result.status).toBe("ok");
    expect(result.payload.name__v).toBe("MCAL-000001");
  });

  it("reports an unknown parent activity as pending_fk", () => {
    const { result } = run(lineRow(), { knownParent: false });
    expect(result.status).toBe("pending_fk");
    expect(result.unresolvedRequiredFks).toEqual([
      {
        field: "multichannel_activity__v",
        objectKey: "multichannel_activity",
        sfdcId: ACTIVITY_ID,
      },
    ]);
  });

  it("scope: through the parent's Start_DateTime_vod__c (datetime literal)", () => {
    const { mapping } = run(lineRow());
    expect(mapping.scope.spec.kind).toBe("via-parent");
    expect(mapping.scope.cutoffDate).toBe(CUTOFF);
    const build = buildScopePredicate(mapping.scope);
    expect(build.kind).toBe("via-parent");
    expect(build.predicate).toBe(
      `Multichannel_Activity_vod__r.Start_DateTime_vod__c >= ${CUTOFF}T00:00:00Z`,
    );
  });
});
