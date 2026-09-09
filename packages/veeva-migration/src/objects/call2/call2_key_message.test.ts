import { describe, expect, it } from "vitest";
import {
  CALL2_KEY_MESSAGE_CATEGORIES,
  CALL2_KEY_MESSAGE_REACTIONS,
  CALL2_KM_CLM_PRESENTATION_NOT_OBJECT_CODE,
  call2_key_message,
  clmPresentationRef,
} from "./call2_key_message";
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
  buildTransformContext,
  buildVaultMetadata,
  resolveMetadata,
  type VaultFieldSpec,
} from "../../testkit";
import { to18 } from "../../transform/ids";
import type { SourceRow } from "../../types";

const NOW = new Date("2026-09-07T00:00:00Z");
const CUTOFF = "2024-09-07";
const KM_ROW_ID = to18("a0F000000000001");
const KEY_MESSAGE_ID = to18("a0G000000000001");
const PRESENTATION_ID = to18("a0H000000000001");
const PRODUCT_ID = to18("a0P000000000001");

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
  countries: { US: {} },
});

function metadata(clmPresentation: VaultFieldSpec) {
  return resolveMetadata(
    buildVaultMetadata("call2_key_message__v", [
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
        name: "key_message__v",
        type: "Object",
        object: { name: "key_message__v" },
      },
      clmPresentation,
      { name: "product__v", type: "Object", object: { name: "product__v" } },
      {
        name: "detail_group__v",
        type: "Object",
        object: { name: "product__v" },
      },
      { name: "account__v", type: "Object", object: { name: "account__v" } },
      { name: "user__v", type: "Object", object: { name: "user__sys" } },
      { name: "call_date__v", type: "Date" },
      { name: "start_time__v", type: "DateTime" },
      { name: "duration__v", type: "Number", scale: 0 },
      { name: "display_order__v", type: "Number", scale: 0 },
      { name: "reaction__v", type: "Picklist", picklist: "reaction__v" },
      { name: "vehicle__v", type: "Picklist", picklist: "vehicle__v" },
      { name: "category__v", type: "Picklist", picklist: "category__v" },
      { name: "key_message_name__v", type: "String", max_length: 255 },
      { name: "clm_presentation_name__v", type: "String", max_length: 255 },
      { name: "clm_presentation_version__v", type: "String", max_length: 50 },
      { name: "slide_version__v", type: "String", max_length: 50 },
      { name: "presentation_id__v", type: "String", max_length: 255 },
      { name: "clm_id__v", type: "String", max_length: 255 },
      { name: "segment__v", type: "String", max_length: 255 },
      { name: "entity_reference_km_id__v", type: "String", max_length: 255 },
      { name: "mobile_id__v", type: "String", max_length: 100 },
    ]),
    {
      picklists: {
        attendee_type__v: ["person_account__v"],
        reaction__v: Object.values(CALL2_KEY_MESSAGE_REACTIONS),
        category__v: Object.values(CALL2_KEY_MESSAGE_CATEGORIES),
      },
    },
  );
}

const OBJECT_MODEL = metadata({
  name: "clm_presentation__v",
  type: "Object",
  object: { name: "clm_presentation__v" },
});
const DOCUMENT_MODEL = metadata({
  name: "clm_presentation__v",
  type: "String",
  max_length: 255,
});

function kmRow(extra: Partial<SourceRow> = {}): SourceRow {
  return {
    Id: KM_ROW_ID,
    Name: "CKM-000001",
    Call2_vod__c: IDS.call1,
    Key_Message_vod__c: KEY_MESSAGE_ID,
    Clm_Presentation_vod__c: PRESENTATION_ID,
    Product_vod__c: PRODUCT_ID,
    Account_vod__c: IDS.account1,
    User_vod__c: SAMPLE_USER_ID,
    Call_Date_vod__c: "2025-03-04",
    Start_Time_vod__c: "2025-03-04T10:05:00.000+0000",
    Duration_vod__c: "45",
    Display_Order_vod__c: "2",
    Reaction_vod__c: "Positive",
    Category_vod__c: "Efficacy",
    Key_Message_Name_vod__c: "Cholecap efficacy",
    Clm_Presentation_Name_vod__c: "Cholecap 2025",
    Clm_Presentation_Version_vod__c: "3",
    Slide_Version_vod__c: "1.2",
    Presentation_ID_vod__c: "PRES-1",
    CLM_ID_vod__c: "CLM-1",
    Segment_vod__c: "Cardio",
    Attendee_Type_vod__c: "Person_Account_vod",
    Mobile_ID_vod__c: "mob-km-1",
    CreatedById: SAMPLE_USER_ID,
    CreatedDate: "2025-03-04T10:31:00.000Z",
    LastModifiedById: SAMPLE_USER_ID,
    LastModifiedDate: "2025-03-04T10:31:00.000Z",
    ...extra,
  };
}

function run(
  row: SourceRow,
  opts: { metadata?: ReturnType<typeof metadata>; knownCall?: boolean } = {},
) {
  const mapping = materialise(
    call2_key_message,
    resolveCountry(config, "US"),
    config,
    { now: NOW },
  );
  const ids = buildIdResolver(
    {
      call2: opts.knownCall === false ? {} : { [IDS.call1]: "V0K1" },
      key_message: { [KEY_MESSAGE_ID]: "V0G1" },
      clm_presentation: { [PRESENTATION_ID]: "V0H1" },
      product: { [PRODUCT_ID]: "V0P1" },
      account: { [IDS.account1]: "V0A1" },
    },
    { [SAMPLE_USER_ID]: 101 },
  );
  return {
    mapping,
    result: applyMapping(row, mapping, {
      country: buildCountryContext(),
      metadata: opts.metadata ?? OBJECT_MODEL,
      ids,
      migrationUserId: 1,
      runMode: "init",
      custom: call2_key_message.custom,
    }),
  };
}

describe("call2_key_message module", () => {
  it("is structurally valid", () => {
    expect(
      validateObjectModule(call2_key_message).filter(
        (i) => i.severity === "blocking",
      ),
    ).toEqual([]);
    expect(call2_key_message.notes).not.toContain("STUB");
  });

  it("encodes the §6.2 / §6.3.33 / §4.4 catalogue facts", () => {
    expect(call2_key_message.source).toBe("Call2_Key_Message_vod__c");
    expect(call2_key_message.target).toBe("call2_key_message__v");
    expect(call2_key_message.targetEvidence).toBe("DOC");
    expect(call2_key_message.scope).toEqual({
      kind: "via-parent",
      parentKey: "call2",
      parentField: "Call2_vod__r.Call_Date_vod__c",
      type: "date",
    });
    expect(call2_key_message.countryOf).toEqual([
      { kind: "parent", key: "call2", field: "Call2_vod__c" },
    ]);
    expect(call2_key_message.dependsOn).toEqual([
      "call2",
      "key_message",
      "clm_presentation",
      "product",
      "account",
      "user",
    ]);
    expect(call2_key_message.deletePolicy).toBe("delete");
    expect(call2_key_message.createPolicy).toBe("create");
    expect(call2_key_message.load).toMatchObject({ noTriggers: true });
    expect(call2_key_message.objectTypes).toEqual({});
    expect(call2_key_message.blockS).toMatchObject({
      name: "autoNumber",
      ownerId: false,
    });
    expect(call2_key_message.match.map((m) => m.method)).toEqual([
      "legacy_id",
      "mobile_id",
    ]);
    expect(call2_key_message.picklists["call2_key_message.reaction"]).toEqual(
      CALL2_KEY_MESSAGE_REACTIONS,
    );
  });

  it("maps every §6.3.33 row with the spec's transform, requirement and evidence", () => {
    const byTarget = new Map(
      call2_key_message.fields.map((f) => [f.target, f]),
    );
    expect(byTarget.get("call2__v")).toMatchObject({
      required: "Y",
      transform: { kind: "ref", objectKey: "call2" },
    });
    expect(byTarget.get("key_message__v")).toMatchObject({
      required: "y?",
      evidence: "DOC",
      transform: { kind: "ref", objectKey: "key_message" },
    });
    expect(byTarget.get("clm_presentation__v")).toMatchObject({
      required: "n",
      evidence: "DOC",
      transform: { kind: "custom", fnName: "clmPresentationRef" },
    });
    for (const t of ["product__v", "detail_group__v"])
      expect(byTarget.get(t)).toMatchObject({
        transform: { kind: "ref", objectKey: "product" },
      });
    expect(byTarget.get("account__v")).toMatchObject({
      transform: { kind: "ref", objectKey: "account" },
    });
    expect(byTarget.get("user__v")).toMatchObject({
      transform: { kind: "refUser" },
    });
    expect(byTarget.get("call_date__v")).toMatchObject({
      transform: { kind: "date" },
    });
    expect(byTarget.get("start_time__v")).toMatchObject({
      transform: { kind: "datetime" },
    });
    expect(byTarget.get("duration__v")).toMatchObject({
      transform: { kind: "number" },
    });
    expect(byTarget.get("display_order__v")).toMatchObject({
      transform: { kind: "number" },
    });
    expect(byTarget.get("reaction__v")).toMatchObject({
      evidence: "DOC",
      transform: { kind: "picklist", mapKey: "call2_key_message.reaction" },
    });
    expect(byTarget.get("vehicle__v")).toMatchObject({
      evidence: "DOC",
      transform: { kind: "picklist", mapKey: "call2_key_message.vehicle" },
    });
    expect(byTarget.get("category__v")).toMatchObject({
      evidence: "UNV",
      transform: { kind: "picklist", mapKey: "call2_key_message.category" },
    });
    for (const [t, ev] of [
      ["key_message_name__v", "DOC"],
      ["clm_presentation_name__v", "DOC"],
      ["clm_presentation_version__v", "UNV"],
      ["slide_version__v", "UNV"],
      ["presentation_id__v", "UNV"],
      ["clm_id__v", "DOC"],
      ["segment__v", "UNV"],
      ["entity_reference_km_id__v", "UNV"],
    ] as const)
      expect(byTarget.get(t)).toMatchObject({
        evidence: ev,
        transform: { kind: "text" },
      });
    expect(byTarget.has("ownerid__v")).toBe(false);
    expect(byTarget.has("object_type__v.api_name__v")).toBe(false);
  });

  it("transforms a key-message row (object-model vault)", () => {
    const { result } = run(kmRow());
    expect(result.status).toBe("ok");
    expect(result.payload).toMatchObject({
      legacy_crm_id__v: KM_ROW_ID,
      call2__v: { $fk: { object: "call2", sfdcId: IDS.call1 } },
      key_message__v: {
        $fk: { object: "key_message", sfdcId: KEY_MESSAGE_ID },
      },
      clm_presentation__v: {
        $fk: { object: "clm_presentation", sfdcId: PRESENTATION_ID },
      },
      product__v: { $fk: { object: "product", sfdcId: PRODUCT_ID } },
      account__v: { $fk: { object: "account", sfdcId: IDS.account1 } },
      user__v: { $user: SAMPLE_USER_ID },
      call_date__v: "2025-03-04",
      start_time__v: "2025-03-04T10:05:00.000Z",
      duration__v: 45,
      display_order__v: 2,
      reaction__v: "positive__v",
      category__v: "efficacy__v",
      key_message_name__v: "Cholecap efficacy",
      clm_presentation_name__v: "Cholecap 2025",
      clm_presentation_version__v: "3",
      slide_version__v: "1.2",
      presentation_id__v: "PRES-1",
      clm_id__v: "CLM-1",
      segment__v: "Cardio",
      attendee_type__v: "person_account__v",
      mobile_id__v: "mob-km-1",
    });
    expect(result.payload.name__v).toBeUndefined();
    expect(result.fkEdges).toContainEqual({
      field: "clm_presentation__v",
      targetObjectKey: "clm_presentation",
      targetSfdcId: PRESENTATION_ID,
    });
  });

  it("omits clm_presentation__v on a document-model vault and keeps the text snapshots", () => {
    const { result } = run(kmRow(), { metadata: DOCUMENT_MODEL });
    expect(result.status).toBe("ok");
    expect(result.payload.clm_presentation__v).toBeUndefined();
    expect(result.payload.clm_presentation_name__v).toBe("Cholecap 2025");
    expect(result.payload.presentation_id__v).toBe("PRES-1");
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: CALL2_KM_CLM_PRESENTATION_NOT_OBJECT_CODE,
        field: "clm_presentation__v",
      }),
    );
    expect(result.diagnostics.some((d) => d.fatal)).toBe(false);
    // unit: unknown target type (before preflight) behaves like ref()
    const ctx = buildTransformContext({
      objectKey: "call2_key_message",
      field: {
        source: "Clm_Presentation_vod__c",
        target: "clm_presentation__v",
      },
      ids: buildIdResolver({ clm_presentation: { [PRESENTATION_ID]: "V0H1" } }),
    });
    expect(clmPresentationRef(PRESENTATION_ID, kmRow(), ctx)).toMatchObject({
      value: { $fk: { object: "clm_presentation", sfdcId: PRESENTATION_ID } },
    });
    expect(clmPresentationRef("", kmRow(), ctx)).toBeUndefined();
  });

  it("reports an unknown parent call as pending_fk", () => {
    const { result } = run(kmRow(), { knownCall: false });
    expect(result.status).toBe("pending_fk");
    expect(result.unresolvedRequiredFks).toEqual([
      { field: "call2__v", objectKey: "call2", sfdcId: IDS.call1 },
    ]);
  });

  it("scope: through the parent's call date", () => {
    const { mapping } = run(kmRow());
    expect(mapping.scope.cutoffDate).toBe(CUTOFF);
    expect(
      buildScopePredicate(mapping.scope, {
        parentOpenPredicate: CALL2_OPEN_PREDICATE,
      }).predicate,
    ).toBe(
      `(Call2_vod__r.Call_Date_vod__c >= ${CUTOFF}) OR (Call2_vod__r.Status_vod__c = 'Planned_vod')`,
    );
  });
});
