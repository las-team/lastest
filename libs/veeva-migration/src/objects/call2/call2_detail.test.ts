import { describe, expect, it } from "vitest";
import { CALL2_DETAIL_TYPES, call2_detail } from "./call2_detail";
import { CALL2_OPEN_PREDICATE } from "./call2";
import { validateObjectModule } from "../types";
import { materialise, resolveCountry } from "../../config/resolve";
import { parseConfig } from "../../config/schema";
import { applyMapping } from "../../transform/apply";
import { buildScopePredicate } from "../../extract/scope";
import {
  IDS,
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
const DETAIL_ID = to18("a0D000000000001");
const PRODUCT_ID = to18("a0P000000000001");
const GROUP_ID = to18("a0P000000000002");

function makeConfig(call2_detail: Record<string, unknown> = {}) {
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
    objects: { call2_detail },
    countries: { US: {} },
  });
}

const metadata = resolveMetadata(
  buildVaultMetadata("call2_detail__v", [
    {
      name: "call2__v",
      type: "Object",
      object: { name: "call2__v" },
      required: true,
    },
    {
      name: "attendee_type__v",
      type: "Picklist",
      picklist: "attendee_type__v",
    },
    { name: "entity_reference_id__v", type: "String", max_length: 255 },
    { name: "call2_mobile_id__v", type: "String", max_length: 255 },
    {
      name: "product__v",
      type: "Object",
      object: { name: "product__v" },
      required: true,
    },
    { name: "detail_group__v", type: "Object", object: { name: "product__v" } },
    { name: "type__v", type: "Picklist", picklist: "type__v" },
    { name: "detail_priority__v", type: "Number", scale: 0 },
    { name: "detail_priority_text__v", type: "String", max_length: 255 },
    { name: "mobile_id__v", type: "String", max_length: 100 },
    { name: "override_lock__v", type: "Boolean" },
  ]),
  {
    picklists: {
      type__v: Object.values(CALL2_DETAIL_TYPES),
      attendee_type__v: ["person_account__v", "group_account__v", "user__v"],
    },
  },
);

function detailRow(extra: Partial<SourceRow> = {}): SourceRow {
  return {
    Id: DETAIL_ID,
    Name: "CD-000001",
    Call2_vod__c: IDS.call1,
    Product_vod__c: PRODUCT_ID,
    Detail_Group_vod__c: GROUP_ID,
    Type_vod__c: "EDetail_vod",
    Detail_Priority_vod__c: "1",
    Detail_Priority_Text_vod__c: "Primary",
    Attendee_Type_vod__c: "Person_Account_vod",
    Entity_Reference_Id_vod__c: "ref-1",
    Call2_Mobile_ID_vod__c: "7d2c5f4e-call-0001",
    Is_Parent_Call_vod__c: true,
    Mobile_ID_vod__c: "mob-detail-1",
    Override_Lock_vod__c: "false",
    CreatedById: SAMPLE_USER_ID,
    CreatedDate: "2025-03-04T10:31:00.000Z",
    LastModifiedById: SAMPLE_USER_ID,
    LastModifiedDate: "2025-03-04T10:31:00.000Z",
    ...extra,
  };
}

function run(
  row: SourceRow,
  opts: { config?: Record<string, unknown>; knownCall?: boolean } = {},
) {
  const config = makeConfig(opts.config);
  const mapping = materialise(
    call2_detail,
    resolveCountry(config, "US"),
    config,
    { now: NOW },
  );
  const ids = buildIdResolver(
    {
      call2: opts.knownCall === false ? {} : { [IDS.call1]: "V0K1" },
      product: { [PRODUCT_ID]: "V0P1", [GROUP_ID]: "V0P2" },
    },
    { [SAMPLE_USER_ID]: 101 },
  );
  return {
    mapping,
    result: applyMapping(row, mapping, {
      country: buildCountryContext(),
      metadata,
      ids,
      migrationUserId: 1,
      runMode: "init",
      custom: call2_detail.custom,
    }),
  };
}

describe("call2_detail module", () => {
  it("is structurally valid", () => {
    expect(
      validateObjectModule(call2_detail).filter(
        (i) => i.severity === "blocking",
      ),
    ).toEqual([]);
    expect(call2_detail.notes).not.toContain("STUB");
  });

  it("encodes the §6.2 / §4.4 / §3.3 catalogue facts", () => {
    expect(call2_detail.source).toBe("Call2_Detail_vod__c");
    expect(call2_detail.target).toBe("call2_detail__v");
    expect(call2_detail.targetEvidence).toBe("DOC");
    expect(call2_detail.scope).toEqual({
      kind: "via-parent",
      parentKey: "call2",
      parentField: "Call2_vod__r.Call_Date_vod__c",
      type: "date",
    });
    expect(call2_detail.countryOf).toEqual([
      { kind: "parent", key: "call2", field: "Call2_vod__c" },
    ]);
    expect(call2_detail.dependsOn).toEqual(["call2", "product"]);
    expect(call2_detail.selfRefs).toEqual([]);
    expect(call2_detail.deletePolicy).toBe("delete");
    expect(call2_detail.inactivate).toEqual([]);
    expect(call2_detail.createPolicy).toBe("create");
    expect(call2_detail.load).toMatchObject({ noTriggers: true });
    expect(call2_detail.objectTypes).toEqual({});
    expect(call2_detail.blockS).toMatchObject({
      name: "autoNumber",
      ownerId: false,
      currency: false,
      objectType: false,
    });
    expect(call2_detail.match.map((m) => m.method)).toEqual([
      "legacy_id",
      "mobile_id",
    ]);
    expect(call2_detail.picklists["call2_detail.type"]).toEqual(
      CALL2_DETAIL_TYPES,
    );
    expect(call2_detail.picklists["call2_detail.attendeeType"]).toMatchObject({
      Person_Account_vod: "person_account__v",
      Contact_vod: null,
    });
  });

  it("maps every §6.3.31 row with the spec's transform, requirement and evidence", () => {
    const byTarget = new Map(call2_detail.fields.map((f) => [f.target, f]));
    expect(byTarget.get("legacy_crm_id__v")).toMatchObject({
      required: "K",
      transform: { kind: "legacyId" },
    });
    expect(byTarget.get("name__v")).toMatchObject({
      enabledBy: "preserveAutoNumberName",
      transform: { kind: "text", max: 128 },
    });
    expect(byTarget.has("ownerid__v")).toBe(false);
    expect(byTarget.get("call2__v")).toMatchObject({
      source: "Call2_vod__c",
      required: "Y",
      evidence: "DOC",
      transform: { kind: "ref", objectKey: "call2" },
    });
    expect(byTarget.get("attendee_type__v")).toMatchObject({
      transform: { kind: "picklist", mapKey: "call2_detail.attendeeType" },
    });
    expect(byTarget.get("entity_reference_id__v")).toMatchObject({
      transform: { kind: "text" },
    });
    expect(byTarget.get("call2_mobile_id__v")).toMatchObject({
      transform: { kind: "copy" },
    });
    expect(byTarget.get("override_lock__v")).toMatchObject({
      transform: { kind: "bool" },
    });
    expect(byTarget.get("is_parent_call__v")).toMatchObject({
      required: "-",
      transform: { kind: "skip" },
    });
    expect(byTarget.get("product__v")).toMatchObject({
      required: "Y",
      evidence: "DOC",
      transform: { kind: "ref", objectKey: "product" },
    });
    expect(byTarget.get("detail_group__v")).toMatchObject({
      required: "n",
      evidence: "DOC",
      transform: { kind: "ref", objectKey: "product" },
    });
    expect(byTarget.get("type__v")).toMatchObject({
      evidence: "DOC",
      transform: { kind: "picklist", mapKey: "call2_detail.type" },
    });
    expect(byTarget.get("detail_priority__v")).toMatchObject({
      evidence: "DOC",
      transform: { kind: "number" },
    });
    expect(byTarget.get("detail_priority_text__v")).toMatchObject({
      evidence: "UNV",
      transform: { kind: "text" },
    });
  });

  it("transforms a detail row", () => {
    const { result } = run(detailRow());
    expect(result.status).toBe("ok");
    expect(result.payload).toEqual({
      legacy_crm_id__v: DETAIL_ID,
      created_date__v: "2025-03-04T10:31:00.000Z",
      created_by__v: { $user: SAMPLE_USER_ID },
      modified_date__v: "2025-03-04T10:31:00.000Z",
      modified_by__v: { $user: SAMPLE_USER_ID },
      mobile_id__v: "mob-detail-1",
      last_device__v: "data_load__v",
      override_lock__v: false,
      call2__v: { $fk: { object: "call2", sfdcId: IDS.call1 } },
      attendee_type__v: "person_account__v",
      entity_reference_id__v: "ref-1",
      call2_mobile_id__v: "7d2c5f4e-call-0001",
      product__v: { $fk: { object: "product", sfdcId: PRODUCT_ID } },
      detail_group__v: { $fk: { object: "product", sfdcId: GROUP_ID } },
      type__v: "edetail__v",
      detail_priority__v: 1,
      detail_priority_text__v: "Primary",
    });
    expect(result.payload.name__v).toBeUndefined(); // auto-number skipped by default
    expect(result.secondPass).toEqual({});
    expect(result.fkEdges).toContainEqual({
      field: "call2__v",
      targetObjectKey: "call2",
      targetSfdcId: IDS.call1,
    });
    // preserveAutoNumberName carries the SFDC number
    const kept = run(detailRow(), {
      config: { preserveAutoNumberName: true },
    }).result;
    expect(kept.payload.name__v).toBe("CD-000001");
  });

  it("reports an unresolved parent call as pending_fk (master-detail)", () => {
    const { result } = run(detailRow(), { knownCall: false });
    expect(result.status).toBe("pending_fk");
    expect(result.unresolvedRequiredFks).toEqual([
      { field: "call2__v", objectKey: "call2", sfdcId: IDS.call1 },
    ]);
    expect(result.payload.call2__v).toEqual({
      $fk: { object: "call2", sfdcId: IDS.call1 },
    });
    // a missing required product is a failure, not pending
    const noProduct = run(detailRow({ Product_vod__c: "" })).result;
    expect(noProduct.status).toBe("failed");
    expect(noProduct.failure?.code).toBe("REQUIRED_MISSING");
  });

  it("scope: through the parent's call date, with the parent's planned-call term re-prefixed", () => {
    const { mapping } = run(detailRow());
    expect(mapping.scope.cutoffDate).toBe(CUTOFF);
    expect(mapping.scope.historyMonths).toBe(24);
    expect(mapping.scope.retentionFamily).toBeUndefined();
    expect(buildScopePredicate(mapping.scope).predicate).toBe(
      `Call2_vod__r.Call_Date_vod__c >= ${CUTOFF}`,
    );
    expect(
      buildScopePredicate(mapping.scope, {
        parentOpenPredicate: CALL2_OPEN_PREDICATE,
      }).predicate,
    ).toBe(
      `(Call2_vod__r.Call_Date_vod__c >= ${CUTOFF}) OR (Call2_vod__r.Status_vod__c = 'Planned_vod')`,
    );
  });
});
