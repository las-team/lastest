/**
 * Shared fixtures for the run-engine tests: three small modules
 * (account → address → call2 with a self reference), matching SFDC describes
 * and Vault metadata, a fake preflight that resolves targets from the fake
 * vault's metadata, and a config with one wave/country.
 */
import { parseConfig, type MigrationConfig } from "../config/schema";
import { defineObject } from "../objects/types";
import type { ObjectModule } from "../objects/types";
import type {
  Preflight,
  PreflightInput,
  PreflightResult,
  ResolvedTarget,
} from "../preflight/types";
import {
  FakeSfdcClient,
  FakeVaultClient,
  MemoryStateStore,
  buildDescribe,
  buildVaultMetadata,
  resolveMetadata,
  IDS,
} from "../testkit";
import { to18 } from "../transform/ids";
import {
  GLOBAL_COUNTRY,
  unitId,
  type MaterialisedMapping,
  type ObjectKey,
  type SourceRow,
  type Unit,
} from "../types";
import { DefaultRunEngine, type EngineDeps } from "./engine";

export const USER1 = "005000000000001AAA";
export const ACC = [
  to18("001000000000001"),
  to18("001000000000002"),
  to18("001000000000003"),
];
export const ADDR = [to18("a0A000000000001"), to18("a0A000000000002")];
export const CALL = [to18("a0K000000000001"), to18("a0K000000000002")];
export const T0 = "2026-01-10T10:00:00.000Z";
export const NOW = "2026-09-07T12:00:00.000Z";

const blockS = {
  audit: false,
  ownerId: false,
  mobileId: false,
  lastDevice: false,
  mobileDatetimes: false,
  locks: false,
  unlock: false,
  externalId: false,
  currency: false,
  objectType: false,
} as const;

export function testModules(): Record<
  "account" | "address" | "call2",
  ObjectModule
> {
  const account = defineObject({
    key: "account",
    source: "Account",
    target: "account__v",
    countryOf: "field:Country_vod__r.Alpha_2_Code_vod__c",
    blockS,
    fields: [
      {
        source: "Inactive_vod__c",
        target: "inactive__v",
        transform: "bool",
        required: "n",
      },
      {
        source: "Primary_Parent_vod__c",
        target: "primary_parent__v",
        transform: "ref(account) secondPass",
        required: "n",
      },
    ],
    selfRefs: [
      { target: "primary_parent__v", source: "Primary_Parent_vod__c" },
    ],
    deletePolicy: "inactivate",
    inactivate: [],
    load: { noTriggers: false },
    match: [{ method: "legacy_id" }],
  });
  const address = defineObject({
    key: "address",
    source: "Address_vod__c",
    target: "address__v",
    countryOf: "account",
    dependsOn: ["account"],
    blockS,
    fields: [
      {
        source: "Account_vod__c",
        target: "account__v",
        transform: "ref(account)",
        required: "Y",
      },
      {
        source: "City_vod__c",
        target: "city__v",
        transform: "text",
        required: "n",
      },
    ],
    deletePolicy: "delete",
    match: [{ method: "legacy_id" }],
  });
  const call2 = defineObject({
    key: "call2",
    source: "Call2_vod__c",
    target: "call2__v",
    scope: {
      kind: "dated",
      predicates: [{ field: "Call_Date_vod__c", type: "date" }],
    },
    countryOf: "account",
    dependsOn: ["account"],
    blockS,
    fields: [
      {
        source: "Account_vod__c",
        target: "account__v",
        transform: "ref(account)",
        required: "Y",
      },
      {
        source: "Call_Date_vod__c",
        target: "call_date__v",
        transform: "date",
        required: "Y",
      },
      {
        source: "Parent_Call_vod__c",
        target: "parent_call__v",
        transform: "ref(call2) secondPass",
        required: "n",
      },
    ],
    selfRefs: [{ target: "parent_call__v", source: "Parent_Call_vod__c" }],
    deletePolicy: "ignore",
    match: [{ method: "legacy_id" }],
  });
  return { account, address, call2 };
}

export function testDescribes() {
  return {
    Account: buildDescribe("Account", [
      { name: "Inactive_vod__c", type: "boolean" },
      {
        name: "Primary_Parent_vod__c",
        type: "reference",
        referenceTo: ["Account"],
        relationshipName: "Primary_Parent_vod__r",
      },
      {
        name: "Country_vod__c",
        type: "reference",
        referenceTo: ["Country_vod__c"],
        relationshipName: "Country_vod__r",
      },
    ]),
    Address_vod__c: buildDescribe("Address_vod__c", [
      {
        name: "Account_vod__c",
        type: "reference",
        referenceTo: ["Account"],
        relationshipName: "Account_vod__r",
        nillable: false,
      },
      { name: "City_vod__c", type: "string" },
    ]),
    Call2_vod__c: buildDescribe("Call2_vod__c", [
      {
        name: "Account_vod__c",
        type: "reference",
        referenceTo: ["Account"],
        relationshipName: "Account_vod__r",
      },
      { name: "Call_Date_vod__c", type: "date" },
      {
        name: "Parent_Call_vod__c",
        type: "reference",
        referenceTo: ["Call2_vod__c"],
        relationshipName: "Parent_Call_vod__r",
      },
    ]),
    Country_vod__c: buildDescribe("Country_vod__c", [
      { name: "Alpha_2_Code_vod__c", type: "string" },
    ]),
  };
}

export function testVaultMetadata() {
  return {
    account__v: buildVaultMetadata("account__v", [
      { name: "inactive__v", type: "Boolean" },
      {
        name: "primary_parent__v",
        type: "Object",
        object: { name: "account__v" },
      },
    ]),
    address__v: buildVaultMetadata("address__v", [
      {
        name: "account__v",
        type: "Object",
        object: { name: "account__v" },
        required: true,
      },
      { name: "city__v", type: "String" },
    ]),
    call2__v: buildVaultMetadata("call2__v", [
      {
        name: "account__v",
        type: "Object",
        object: { name: "account__v" },
        required: true,
      },
      { name: "call_date__v", type: "Date" },
      { name: "parent_call__v", type: "Object", object: { name: "call2__v" } },
    ]),
  };
}

const sys = (
  id: string,
  modstamp = T0,
  extra: Record<string, unknown> = {},
): SourceRow => ({
  Id: id,
  IsDeleted: false,
  SystemModstamp: modstamp,
  CreatedDate: T0,
  CreatedById: USER1,
  LastModifiedDate: modstamp,
  LastModifiedById: USER1,
  ...extra,
});

export function seedSfdc(sfdc: FakeSfdcClient): void {
  const d = testDescribes();
  for (const desc of Object.values(d)) sfdc.addDescribe(desc);
  sfdc.addRows("Account", [
    sys(ACC[0], T0, {
      Name: "Acme Hospital",
      Inactive_vod__c: false,
      Country_vod__c: IDS.countryUS,
      "Country_vod__r.Alpha_2_Code_vod__c": "US",
    }),
    sys(ACC[1], T0, {
      Name: "Dr Jane Doe",
      Inactive_vod__c: false,
      Primary_Parent_vod__c: ACC[0],
      Country_vod__c: IDS.countryUS,
      "Country_vod__r.Alpha_2_Code_vod__c": "US",
    }),
    sys(ACC[2], T0, {
      Name: "Klinik Berlin",
      Inactive_vod__c: false,
      Country_vod__c: IDS.countryDE,
      "Country_vod__r.Alpha_2_Code_vod__c": "DE",
    }),
  ]);
  sfdc.addRows("Address_vod__c", [
    sys(ADDR[0], T0, {
      Name: "1 Main St",
      Account_vod__c: ACC[0],
      City_vod__c: "Boston",
      "Account_vod__r.Country_vod__r.Alpha_2_Code_vod__c": "US",
    }),
    sys(ADDR[1], T0, {
      Name: "2 Side St",
      Account_vod__c: ACC[1],
      City_vod__c: "Boston",
      "Account_vod__r.Country_vod__r.Alpha_2_Code_vod__c": "US",
    }),
  ]);
  sfdc.addRows("Call2_vod__c", [
    sys(CALL[0], T0, {
      Name: "C-1",
      Account_vod__c: ACC[0],
      Call_Date_vod__c: "2026-01-05",
      "Account_vod__r.Country_vod__r.Alpha_2_Code_vod__c": "US",
    }),
    sys(CALL[1], T0, {
      Name: "C-2",
      Account_vod__c: ACC[1],
      Call_Date_vod__c: "2026-01-05",
      Parent_Call_vod__c: CALL[0],
      "Account_vod__r.Country_vod__r.Alpha_2_Code_vod__c": "US",
    }),
  ]);
}

export function seedVault(vault: FakeVaultClient): void {
  for (const m of Object.values(testVaultMetadata())) vault.addObject(m);
}

export function testConfig(
  over: Record<string, unknown> = {},
): MigrationConfig {
  return parseConfig({
    version: 1,
    source: {
      loginUrl: "https://x.my.salesforce.com",
      auth: { kind: "jwt", clientId: "c", username: "u", privateKeyPath: "k" },
    },
    target: {
      vaultDns: "acme-crm.veevavault.com",
      auth: { kind: "password", username: "u", password: "p" },
      migrationUserId: 12345,
    },
    staging: { databaseUrl: "memory:" },
    countries: { US: {} },
    waves: [{ name: "w1", countries: ["US"] }],
    ...over,
  });
}

/** Preflight stand-in: resolves every unit's target from the fake vault metadata, never blocks. */
export class FakePreflight implements Preflight {
  findings: PreflightResult["findings"] = [];
  blockedUnits: Unit[] = [];
  constructor(
    private readonly vault: FakeVaultClient,
    private readonly sfdc: FakeSfdcClient,
  ) {}
  async run(input: PreflightInput): Promise<PreflightResult> {
    const resolvedTargets = new Map<string, ResolvedTarget>();
    const mappings = new Map<string, MaterialisedMapping>();
    for (const unit of input.units) {
      const mapping = input.mappings.get(unitId(unit))!;
      mappings.set(unitId(unit), mapping);
      if (resolvedTargets.has(unit.objectKey)) continue;
      const raw = await this.vault.objectMetadata(mapping.targetObject);
      const describe = await this.sfdc.describe(mapping.sourceObject);
      const known = new Set(describe.fields.map((f) => f.name));
      resolvedTargets.set(unit.objectKey, {
        objectKey: unit.objectKey as ObjectKey,
        targetObject: mapping.targetObject,
        legacyIdField: "legacy_crm_id__v",
        metadata: resolveMetadata(raw),
        rawMetadata: raw,
        objectTypes: [],
        picklists: {},
        describe,
        replicateable: true,
        columns: mapping.fields
          .map((f) => f.source)
          .filter((s) => s && (known.has(s) || s.includes("."))),
      });
    }
    await input.store.findings.add(input.runId, this.findings);
    return {
      runId: input.runId,
      findings: this.findings,
      resolvedTargets,
      mappings,
      blockedUnits: this.blockedUnits,
      blocking: this.findings.some(
        (f) => f.severity === "blocking" && !f.objectKey,
      ),
      source: {
        orgId: this.sfdc.orgId,
        apiVersion: "67.0",
        multiCurrency: false,
        personAccounts: false,
        territory2: true,
        now: NOW,
      },
      countries: new Map([
        [
          this.vault.vaultDns,
          [
            {
              iso2: "US",
              sfdcId: IDS.countryUS,
              vaultId: "V0C000000000101",
              name: "United States",
            },
            {
              iso2: "DE",
              sfdcId: IDS.countryDE,
              vaultId: "V0C000000000102",
              name: "Germany",
            },
          ],
        ],
      ]),
    };
  }
}

export interface Harness {
  sfdc: FakeSfdcClient;
  vault: FakeVaultClient;
  store: MemoryStateStore;
  preflight: FakePreflight;
  engine: DefaultRunEngine;
  config: MigrationConfig;
  deps: EngineDeps;
  clock: { now: string };
}

export function makeHarness(
  runDir: string,
  over: Partial<EngineDeps> = {},
  configOver: Record<string, unknown> = {},
): Harness {
  const sfdc = new FakeSfdcClient({ now: NOW });
  const vault = new FakeVaultClient();
  seedSfdc(sfdc);
  seedVault(vault);
  const store = new MemoryStateStore(vault.vaultDns);
  const preflight = new FakePreflight(vault, sfdc);
  const config = testConfig(configOver);
  const clock = { now: NOW };
  const deps: EngineDeps = {
    sfdc,
    vaults: new Map([[vault.vaultDns, vault]]),
    store,
    preflight,
    modules: testModules(),
    runDir,
    keepAliveMs: 0,
    now: () => new Date(clock.now),
    loader: { retry: { sleep: async () => {}, policy: { maxAttempts: 2 } } },
    out: () => {},
    ...over,
  };
  const engine = new DefaultRunEngine(deps);
  return { sfdc, vault, store, preflight, engine, config, deps, clock };
}

export async function seedUsers(store: MemoryStateStore): Promise<void> {
  await store.seedIdMap(
    "user",
    "user__sys",
    { [USER1]: "12345" },
    GLOBAL_COUNTRY,
  );
}
