/**
 * §3.3 natural-key match for `multichannel_consent` against the real matcher:
 * `(account__v, consent_type__v, channel_value__v, capture_datetime__v)`.
 * The matcher compares `payload.consent_type__v` with what Vault stores, so
 * the hit only exists when the config crosswalk emitted the preflight-resolved
 * Vault id — a lookup-form payload (`consent_type__v.external_id__v`) can never
 * match and would create a duplicate on a re-`init`.
 */
import { describe, expect, it } from "vitest";
import {
  MULTICHANNEL_CONSENT_OBJECT_TYPES,
  MULTICHANNEL_CONSENT_OPT_TYPE,
  multichannel_consent,
} from "./multichannel_consent";
import { materialise, resolveCountry } from "../../config/resolve";
import { parseConfig } from "../../config/schema";
import { applyMapping } from "../../transform/apply";
import { to18 } from "../../transform/ids";
import { matchRows, type PayloadRowWithSource } from "../../load/matcher";
import type { LoadPlan } from "../../load/types";
import type { ResolvedTarget } from "../../preflight/types";
import type { SourceRow } from "../../types";
import {
  FakeVaultClient,
  IDS,
  MemoryStateStore,
  SAMPLE_USER_ID,
  buildCountryContext,
  buildIdResolver,
  buildVaultMetadata,
  resolveMetadata,
} from "../../testkit";

const NOW = new Date("2026-09-07T00:00:00Z");
const CONSENT_ID = to18("a0M000000000001");
const CONSENT_TYPE_ID = to18("a0X000000000001");
const VAULT_ACCOUNT = "V0A000000000001";
const VAULT_CONSENT_TYPE = "V0X000000000001";
const EXISTING_CONSENT = "V0M000000000001";
const CAPTURE = "2025-03-04T10:05:00.000Z";
const CHANNEL = "dr.smith@example.com";

const RAW_META = buildVaultMetadata(
  "multichannel_consent__v",
  [
    { name: "legacy_crm_id__v", type: "String", max_length: 18, unique: true },
    {
      name: "account__v",
      type: "Object",
      object: { name: "account__v" },
      required: true,
    },
    {
      name: "consent_type__v",
      type: "Object",
      object: { name: "consent_type__v" },
      required: true,
    },
    {
      name: "opt_type__v",
      type: "Picklist",
      picklist: "opt_type__v",
      required: true,
    },
    {
      name: "channel_value__v",
      type: "String",
      max_length: 80,
      required: true,
    },
    { name: "capture_datetime__v", type: "DateTime" },
    { name: "external_id__v", type: "String", max_length: 120, unique: true },
    { name: "mobile_id__v", type: "String", max_length: 100 },
    { name: "ownerid__v", type: "Object", object: { name: "user__sys" } },
  ],
  { objectTypes: Object.values(MULTICHANNEL_CONSENT_OBJECT_TYPES) },
);
const METADATA = resolveMetadata(RAW_META, {
  picklists: { opt_type__v: Object.values(MULTICHANNEL_CONSENT_OPT_TYPE) },
});

function sourceRow(): SourceRow {
  return {
    Id: CONSENT_ID,
    Name: "MC-000001",
    "RecordType.DeveloperName": "Approved_Email_vod",
    Account_vod__c: IDS.account1,
    Consent_Type_vod__c: CONSENT_TYPE_ID,
    Opt_Type_vod__c: "Opt_In_vod",
    Channel_Value_vod__c: CHANNEL,
    Capture_Datetime_vod__c: CAPTURE,
    External_ID_vod__c: "EXT-MC-1",
    Mobile_ID_vod__c: "mob-mc-1",
    OwnerId: SAMPLE_USER_ID,
    CreatedById: SAMPLE_USER_ID,
    CreatedDate: CAPTURE,
    LastModifiedById: SAMPLE_USER_ID,
    LastModifiedDate: CAPTURE,
  };
}

/** Transform one consent row with the given `multichannel_consent` overrides. */
function transformed(overrides: Record<string, unknown>) {
  const cfg = parseConfig({
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
    objects: { multichannel_consent: overrides },
    countries: { US: {} },
  });
  const mapping = materialise(
    multichannel_consent,
    resolveCountry(cfg, "US"),
    cfg,
    { now: NOW },
  );
  const row = sourceRow();
  const result = applyMapping(row, mapping, {
    country: buildCountryContext(),
    metadata: METADATA,
    ids: buildIdResolver(
      { account: { [IDS.account1]: VAULT_ACCOUNT } },
      { [SAMPLE_USER_ID]: 101 },
    ),
    migrationUserId: 1,
    runMode: "init",
    custom: multichannel_consent.custom,
  });
  expect(result.status).toBe("ok");
  const payloadRow: PayloadRowWithSource = {
    sfdcId: CONSENT_ID,
    systemModstamp: CAPTURE,
    payload: result.payload,
    sourceHash: result.sourceHash,
    objectType: result.objectType,
    diagnostics: result.diagnostics,
    // the transform runner attaches the raw source row for match keys
    source: row,
  };
  return { mapping, payloadRow };
}

async function matchAgainstVault(
  mapping: LoadPlan["mapping"],
  row: PayloadRowWithSource,
) {
  const vault = new FakeVaultClient();
  vault.addObject(RAW_META, [
    {
      id: EXISTING_CONSENT,
      account__v: VAULT_ACCOUNT,
      consent_type__v: VAULT_CONSENT_TYPE,
      channel_value__v: CHANNEL,
      capture_datetime__v: CAPTURE,
      // pre-existing (Veeva-migrated) record: no legacy id, no external id, no mobile id
    },
  ]);
  await vault.authenticate();
  const store = new MemoryStateStore(vault.vaultDns);
  await store.seedIdMap("account", "account__v", {
    [IDS.account1]: VAULT_ACCOUNT,
  });
  await store.seedIdMap(
    "user",
    "user__sys",
    { [SAMPLE_USER_ID]: "101" },
    "GLOBAL",
  );
  const target: ResolvedTarget = {
    objectKey: "multichannel_consent",
    targetObject: RAW_META.name,
    legacyIdField: "legacy_crm_id__v",
    metadata: METADATA,
    rawMetadata: RAW_META,
    objectTypes: [],
    picklists: {},
    replicateable: true,
    columns: [],
  };
  const plan: LoadPlan = {
    runId: "run-1",
    unit: { objectKey: "multichannel_consent", country: "US" },
    mapping,
    target,
    runDir: "/nonexistent",
    dryRun: false,
    migrationMode: true,
    unchangedFieldBehavior: "AlwaysIgnore",
    batchSize: 500,
    batchWallTimeMs: 60000,
  };
  return matchRows([row], plan, { vault, store });
}

describe("multichannel_consent natural-key match (§3.3)", () => {
  it("hits when consent_type__v carries the preflight-resolved Vault id (external_id: entry resolved by preflight)", async () => {
    const { mapping, payloadRow } = transformed({
      configMaps: { consentType: { [CONSENT_TYPE_ID]: "external_id:AE_US" } },
      configMapsResolved: {
        consentType: { [CONSENT_TYPE_ID]: VAULT_CONSENT_TYPE },
      },
    });
    expect(payloadRow.payload.consent_type__v).toBe(VAULT_CONSENT_TYPE);
    expect(mapping.match.some((m) => m.method === "natural_key")).toBe(true);
    const out = await matchAgainstVault(mapping, payloadRow);
    expect(out.hits.get(CONSENT_ID)).toMatchObject({
      sfdcId: CONSENT_ID,
      vaultId: EXISTING_CONSENT,
      method: "natural_key",
    });
  });

  it("hits with an explicit Vault-id map entry", async () => {
    const { mapping, payloadRow } = transformed({
      configMaps: { consentType: { [CONSENT_TYPE_ID]: VAULT_CONSENT_TYPE } },
    });
    const out = await matchAgainstVault(mapping, payloadRow);
    expect(out.hits.get(CONSENT_ID)?.method).toBe("natural_key");
  });

  it("cannot hit from a lookup-form payload — why preflight must resolve external_id: entries into configMapsResolved", async () => {
    const { mapping, payloadRow } = transformed({
      configMaps: { consentType: { [CONSENT_TYPE_ID]: "external_id:AE_US" } },
    });
    expect(payloadRow.payload["consent_type__v.external_id__v"]).toBe("AE_US");
    expect(payloadRow.payload.consent_type__v).toBeUndefined();
    const out = await matchAgainstVault(mapping, payloadRow);
    // the matcher falls back to the raw SFDC id for the key → no candidate can match
    expect(out.hits.size).toBe(0);
  });
});
