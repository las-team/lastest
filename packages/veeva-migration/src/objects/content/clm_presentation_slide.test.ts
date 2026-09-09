import { describe, expect, it } from "vitest";
import {
  SLIDE_VAULT_EXTERNAL_ID_FALLBACK,
  SLIDE_VAULT_EXTERNAL_ID_SOURCE,
  clm_presentation_slide,
  slideVaultExternalId,
} from "./clm_presentation_slide";
import { clm_presentation } from "./clm_presentation";
import { key_message } from "./key_message";
import { approved_document } from "./approved_document";
import { validateObjectModule } from "../types";
import { loadOrder } from "../registry";
import { materialise, resolveCountry } from "../../config/resolve";
import { parseConfig } from "../../config/schema";
import { applyMapping } from "../../transform/apply";
import { buildScopePredicate } from "../../extract/scope";
import {
  SAMPLE_USER_ID,
  buildCountryContext,
  buildIdResolver,
  buildTransformContext,
  buildVaultMetadata,
  resolveMetadata,
} from "../../testkit";
import { to18 } from "../../transform/ids";
import type { SourceRow } from "../../types";

const NOW = new Date("2026-09-07T00:00:00Z");
const SLIDE_ID = to18("a0O000000000001");
const PRES_ID = to18("a0N000000000001");
const SUB_PRES_ID = to18("a0N000000000002");
const KM_ID = to18("a0M000000000001");

function makeConfig(overrides: Record<string, unknown> = {}) {
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
    objects: { clm_presentation_slide: overrides },
    countries: { US: {} },
  });
}

function metadata(opts: { vaultExternalIdRequired?: boolean } = {}) {
  return resolveMetadata(
    buildVaultMetadata("clm_presentation_slide__v", [
      {
        name: "clm_presentation__v",
        type: "Object",
        object: { name: "clm_presentation__v" },
        relationship_type: "parent",
        required: true,
      },
      {
        name: "key_message__v",
        type: "Object",
        object: { name: "key_message__v" },
      },
      {
        name: "sub_presentation__v",
        type: "Object",
        object: { name: "clm_presentation__v" },
      },
      { name: "external_id__v", type: "String", max_length: 100 },
      { name: "vexternal_id__v", type: "String", max_length: 100 },
      {
        name: "vault_external_id__v",
        type: "String",
        max_length: 255,
        required: opts.vaultExternalIdRequired ?? false,
      },
      { name: "display_order__v", type: "Number", scale: 0 },
      { name: "mandatory_slides__v", type: "String", max_length: 255 },
    ]),
    { picklists: { status__v: ["active__v", "inactive__v"] } },
  );
}

function sampleRow(extra: Partial<SourceRow> = {}): SourceRow {
  return {
    Id: "a0O000000000001",
    Name: " Slide 3 ",
    Clm_Presentation_vod__c: PRES_ID,
    Key_Message_vod__c: KM_ID,
    Sub_Presentation_vod__c: SUB_PRES_ID,
    External_ID_vod__c: "EXT-SLIDE-3",
    VExternal_Id_vod__c: "VEXT-SLIDE-3",
    [SLIDE_VAULT_EXTERNAL_ID_SOURCE]: "vault-slide-3",
    [SLIDE_VAULT_EXTERNAL_ID_FALLBACK]: "vault-km-1",
    Display_Order_vod__c: "3",
    Mandatory_Slides_vod__c: "1;2",
    CreatedDate: "2021-02-03T04:05:06.000Z",
    CreatedById: SAMPLE_USER_ID,
    LastModifiedDate: "2025-01-01T00:00:00.000Z",
    LastModifiedById: SAMPLE_USER_ID,
    ...extra,
  };
}

function run(
  row: SourceRow,
  opts: {
    overrides?: Record<string, unknown>;
    knownPresentation?: boolean;
    knownKeyMessage?: boolean;
    vaultExternalIdRequired?: boolean;
  } = {},
) {
  const config = makeConfig(opts.overrides);
  const mapping = materialise(
    clm_presentation_slide,
    resolveCountry(config, "US"),
    config,
    { now: NOW },
  );
  const ids = buildIdResolver(
    {
      clm_presentation:
        opts.knownPresentation === false
          ? {}
          : { [PRES_ID]: "V0N1", [SUB_PRES_ID]: "V0N2" },
      key_message: opts.knownKeyMessage === false ? {} : { [KM_ID]: "V0M1" },
    },
    { [SAMPLE_USER_ID]: 101 },
  );
  return {
    mapping,
    result: applyMapping(row, mapping, {
      country: buildCountryContext(),
      metadata: metadata({
        vaultExternalIdRequired: opts.vaultExternalIdRequired,
      }),
      ids,
      migrationUserId: 1,
      runMode: "init",
      custom: clm_presentation_slide.custom,
    }),
  };
}

describe("clm_presentation_slide module", () => {
  it("is structurally valid", () => {
    expect(
      validateObjectModule(clm_presentation_slide).filter(
        (i) => i.severity === "blocking",
      ),
    ).toEqual([]);
  });

  it("encodes the §6.2 / §6.1 / §4.4 catalogue facts", () => {
    expect(clm_presentation_slide.source).toBe("Clm_Presentation_Slide_vod__c");
    expect(clm_presentation_slide.target).toBe("clm_presentation_slide__v");
    expect(clm_presentation_slide.targetEvidence).toBe("DOC");
    expect(clm_presentation_slide.scope).toEqual({ kind: "full" });
    expect(clm_presentation_slide.countryOf).toEqual([{ kind: "global" }]);
    expect(clm_presentation_slide.dependsOn).toEqual([
      "clm_presentation",
      "key_message",
    ]);
    expect(clm_presentation_slide.deletePolicy).toBe("delete");
    expect(clm_presentation_slide.inactivate).toEqual([]);
    expect(clm_presentation_slide.createPolicy).toBe("match-only");
    expect(clm_presentation_slide.load.noTriggers).toBe(false);
    expect(clm_presentation_slide.selfRefs).toEqual([
      { target: "sub_presentation__v", source: "Sub_Presentation_vod__c" },
    ]);
    expect(clm_presentation_slide.objectTypes).toEqual({});
    expect(clm_presentation_slide.states).toEqual({});
    // master-detail child: no OwnerId, no status derivation
    expect(clm_presentation_slide.blockS.ownerId).toBe(false);
    expect(clm_presentation_slide.blockS.statusFromFlag).toBeUndefined();
    expect(
      clm_presentation_slide.fields.find((f) => f.target === "ownerid__v"),
    ).toBeUndefined();
    expect(clm_presentation_slide.notes).not.toContain("STUB");
  });

  it("keeps the clm_presentation → slide edge while registering sub_presentation__v as a pass-2 patch (§6.1 step 8)", () => {
    const steps = loadOrder([
      key_message,
      clm_presentation,
      clm_presentation_slide,
      approved_document,
    ]);
    expect(steps.map((s) => s.keys)).toEqual([
      ["key_message", "clm_presentation"],
      ["clm_presentation_slide", "approved_document"],
    ]);
    expect(steps[0].pass2).toEqual([
      {
        objectKey: "key_message",
        target: "shared_resource__v",
        source: "Shared_Resource_vod__c",
        refKey: "key_message",
      },
    ]);
    expect(steps[1].pass2).toEqual([
      {
        objectKey: "clm_presentation_slide",
        target: "sub_presentation__v",
        source: "Sub_Presentation_vod__c",
        refKey: "clm_presentation_slide",
      },
    ]);
  });

  it("maps every §6.3.16 row with the spec's transform, requirement and evidence", () => {
    const byTarget = new Map(
      clm_presentation_slide.fields.map((f) => [f.target, f]),
    );
    expect(byTarget.get("legacy_crm_id__v")).toMatchObject({
      source: "Id",
      required: "K",
      transform: { kind: "legacyId" },
    });
    expect(byTarget.get("clm_presentation__v")).toMatchObject({
      source: "Clm_Presentation_vod__c",
      required: "Y",
      evidence: "DOC",
      transform: { kind: "ref", objectKey: "clm_presentation" },
    });
    expect(byTarget.get("key_message__v")).toMatchObject({
      source: "Key_Message_vod__c",
      required: "y?",
      evidence: "DOC",
      transform: { kind: "ref", objectKey: "key_message" },
    });
    expect(byTarget.get("sub_presentation__v")).toMatchObject({
      source: "Sub_Presentation_vod__c",
      required: "n",
      evidence: "UNV",
      transform: {
        kind: "secondPass",
        inner: { kind: "ref", objectKey: "clm_presentation" },
      },
    });
    expect(byTarget.get("external_id__v")).toMatchObject({
      source: "External_ID_vod__c",
      evidence: "UNV",
      transform: { kind: "copy" },
    });
    expect(byTarget.get("vexternal_id__v")).toMatchObject({
      source: "VExternal_Id_vod__c",
      evidence: "UNV",
      transform: { kind: "copy" },
    });
    expect(byTarget.get("vault_external_id__v")).toMatchObject({
      source: "Vault_External_Id_vod__c",
      required: "y?",
      evidence: "DOC",
      unverifiedSource: true,
      transform: { kind: "custom", fnName: "slideVaultExternalId" },
    });
    expect(byTarget.get("display_order__v")).toMatchObject({
      source: "Display_Order_vod__c",
      transform: { kind: "number" },
    });
    expect(byTarget.get("mandatory_slides__v")).toMatchObject({
      source: "Mandatory_Slides_vod__c",
      transform: { kind: "text" },
    });
    expect(byTarget.get("name__v")).toMatchObject({
      source: "Name",
      required: "Y",
      evidence: "UNV",
      transform: { kind: "text" },
    });
  });

  it("carries the §3.3 precedence: vault external id (own, then key message) → external id → vexternal id → (presentation, key message)", () => {
    expect(clm_presentation_slide.match.map((m) => m.method)).toEqual([
      "external_id",
      "external_id",
      "external_id",
      "external_id",
      "natural_key",
    ]);
    expect(
      clm_presentation_slide.match.map((m) =>
        m.keys?.map((k) => [k.target, k.source]),
      ),
    ).toEqual([
      [["vault_external_id__v", "Vault_External_Id_vod__c"]],
      [["vault_external_id__v", "Key_Message_vod__r.Vault_External_Id_vod__c"]],
      [["external_id__v", "External_ID_vod__c"]],
      [["vexternal_id__v", "VExternal_Id_vod__c"]],
      [
        ["clm_presentation__v", "Clm_Presentation_vod__c"],
        ["key_message__v", "Key_Message_vod__c"],
      ],
    ]);
    expect(clm_presentation_slide.match[0].evidence).toBe("DOC");
    const { mapping } = run(sampleRow());
    expect(mapping.options.createPolicy).toBe("match-only");
    expect(mapping.options.externalIdOwnedBy).toBe("integration");
    expect(mapping.options.deletePolicy).toBe("delete");
  });

  it("transforms a realistic Clm_Presentation_Slide_vod__c row", () => {
    const { result: r } = run(sampleRow());
    expect(r.status).toBe("ok");
    expect(r.failure).toBeUndefined();
    expect(r.payload).toMatchObject({
      legacy_crm_id__v: SLIDE_ID,
      name__v: "Slide 3",
      clm_presentation__v: {
        $fk: { object: "clm_presentation", sfdcId: PRES_ID },
      },
      key_message__v: { $fk: { object: "key_message", sfdcId: KM_ID } },
      external_id__v: "EXT-SLIDE-3",
      vexternal_id__v: "VEXT-SLIDE-3",
      vault_external_id__v: "vault-slide-3",
      display_order__v: 3,
      mandatory_slides__v: "1;2",
      created_date__v: "2021-02-03T04:05:06.000Z",
      created_by__v: { $user: SAMPLE_USER_ID },
      modified_date__v: "2025-01-01T00:00:00.000Z",
      modified_by__v: { $user: SAMPLE_USER_ID },
    });
    expect(JSON.stringify(r.payload)).not.toContain("V0N1");
    expect(r.payload.ownerid__v).toBeUndefined();
    expect(r.payload.status__v).toBeUndefined();
    // sub presentation held back for pass 2 (already resolvable, still patched later per §6.1)
    expect(r.payload.sub_presentation__v).toBeUndefined();
    expect(r.secondPass).toEqual({
      sub_presentation__v: {
        $fk: { object: "clm_presentation", sfdcId: SUB_PRES_ID },
      },
    });
    expect(r.fkEdges).toContainEqual({
      field: "sub_presentation__v",
      targetObjectKey: "clm_presentation",
      targetSfdcId: SUB_PRES_ID,
    });
    expect(r.unresolvedRequiredFks).toEqual([]);
    expect(r.unresolvedOptionalFks).toEqual([]);
  });

  it("reports an unresolved master-detail parent as pending_fk (deferred ref kept)", () => {
    const { result: r } = run(sampleRow(), { knownPresentation: false });
    expect(r.status).toBe("pending_fk");
    expect(r.unresolvedRequiredFks).toEqual([
      {
        field: "clm_presentation__v",
        objectKey: "clm_presentation",
        sfdcId: PRES_ID,
      },
    ]);
    expect(r.payload.clm_presentation__v).toEqual({
      $fk: { object: "clm_presentation", sfdcId: PRES_ID },
    });
    // the pass-2 ref to the same object is optional: recorded, not blocking
    expect(r.unresolvedOptionalFks).toContainEqual(
      expect.objectContaining({
        field: "sub_presentation__v",
        sfdcId: SUB_PRES_ID,
        secondPass: true,
      }),
    );
  });

  it("falls back to the key message's Vault external id and counts rows with neither", () => {
    const fallback = run(sampleRow({ [SLIDE_VAULT_EXTERNAL_ID_SOURCE]: "" }));
    expect(fallback.result.status).toBe("ok");
    expect(fallback.result.payload.vault_external_id__v).toBe("vault-km-1");
    expect(fallback.result.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "custom",
        field: "vault_external_id__v",
        code: "SLIDE_VAULT_EXTERNAL_ID_FROM_KEY_MESSAGE",
      }),
    );
    // neither source, target required (PromoMats content exists) → row still created, counted
    const missing = run(
      sampleRow({
        [SLIDE_VAULT_EXTERNAL_ID_SOURCE]: null,
        [SLIDE_VAULT_EXTERNAL_ID_FALLBACK]: undefined,
      }),
      { vaultExternalIdRequired: true },
    );
    expect(missing.result.status).toBe("ok");
    expect(missing.result.failure).toBeUndefined();
    expect(missing.result.payload.vault_external_id__v).toBeUndefined();
    expect(missing.result.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "custom",
        field: "vault_external_id__v",
        code: "SLIDE_VAULT_EXTERNAL_ID_MISSING",
      }),
    );
    expect(
      missing.result.diagnostics.find(
        (d) => d.code === "SLIDE_VAULT_EXTERNAL_ID_MISSING",
      )?.fatal,
    ).toBeFalsy();
  });

  it("is unscoped (full): the scope builder yields no predicate", () => {
    const { mapping } = run(sampleRow());
    expect(mapping.scope.spec).toEqual({ kind: "full" });
    expect(buildScopePredicate(mapping.scope)).toEqual({ kind: "full" });
  });
});

describe("clm_presentation_slide helpers", () => {
  it("slideVaultExternalId prefers the slide's own value, then the key message's, else omits with a count", () => {
    const ctx = buildTransformContext({
      objectKey: "clm_presentation_slide",
      field: {
        source: SLIDE_VAULT_EXTERNAL_ID_SOURCE,
        target: "vault_external_id__v",
      },
    });
    const withBoth: SourceRow = {
      Id: "a0O000000000001",
      [SLIDE_VAULT_EXTERNAL_ID_FALLBACK]: "vault-km-1",
    };
    expect(slideVaultExternalId(" vault-slide-3 ", withBoth, ctx)).toBe(
      "vault-slide-3",
    );
    expect(slideVaultExternalId("", withBoth, ctx)).toMatchObject({
      value: "vault-km-1",
      diagnostic: { code: "SLIDE_VAULT_EXTERNAL_ID_FROM_KEY_MESSAGE" },
    });
    expect(
      slideVaultExternalId(undefined, { Id: "a0O000000000001" }, ctx),
    ).toMatchObject({
      omit: true,
      diagnostic: {
        kind: "custom",
        code: "SLIDE_VAULT_EXTERNAL_ID_MISSING",
      },
    });
  });
});
