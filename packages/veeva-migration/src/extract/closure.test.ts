import { afterEach, describe, expect, it } from "vitest";
import { parseCountryOf } from "../country-of";
import {
  FakeSfdcClient,
  IDS,
  MemoryStateStore,
  SAMPLE_QUEUE_ID,
  SAMPLE_USER_ID,
  buildDescribe,
  buildMaterialisedMapping,
  sampleAccountDescribe,
} from "../testkit";
import { to18 } from "../transform/ids";
import { parseTransform } from "../transform/spec";
import type { MaterialisedMapping, ObjectKey, SourceRow } from "../types";
import type { ResolvedTarget } from "../preflight/types";
import { collectRowFks, runClosure } from "./closure";
import { readCsvRows } from "./files";
import { cleanup, makeTarget, tmpRunDir } from "./test-helpers";
import type { FkIdSets } from "./types";

const A = (n: number) => `0010000000000${String(n).padStart(2, "0")}AAA`;
const ADDR = (n: number) => to18(`a0A0000000000${String(n).padStart(2, "0")}`);

const accountMapping = buildMaterialisedMapping({
  objectKey: "account",
  sourceObject: "Account",
  targetObject: "account__v",
  countryOf: parseCountryOf("field:Country_vod__r.Alpha_2_Code_vod__c"),
  fields: [
    {
      source: "Id",
      target: "legacy_crm_id__v",
      transform: parseTransform("legacyId"),
      required: "K",
    },
    {
      source: "Name",
      target: "name__v",
      transform: parseTransform("text"),
      required: "Y",
    },
    {
      source: "Primary_Parent_vod__c",
      target: "primary_parent__v",
      transform: parseTransform("ref(account) secondPass"),
      required: "n",
    },
    {
      source: "OwnerId",
      target: "ownerid__v",
      transform: parseTransform("refUser"),
      required: "n",
    },
  ],
});

function addressDescribe() {
  return buildDescribe(
    "Address_vod__c",
    [
      {
        name: "Account_vod__c",
        type: "reference",
        referenceTo: ["Account"],
        relationshipName: "Account_vod__r",
      },
      {
        name: "Controlling_Address_vod__c",
        type: "reference",
        referenceTo: ["Address_vod__c"],
        relationshipName: "Controlling_Address_vod__r",
      },
    ],
    { keyPrefix: "a0A" },
  );
}

const addressMapping = buildMaterialisedMapping({
  objectKey: "address",
  sourceObject: "Address_vod__c",
  targetObject: "address__v",
  countryOf: parseCountryOf("account"),
  dependsOn: ["account"],
  fields: [
    {
      source: "Id",
      target: "legacy_crm_id__v",
      transform: parseTransform("legacyId"),
      required: "K",
    },
    {
      source: "Account_vod__c",
      target: "account__v",
      transform: parseTransform("ref(account)"),
      required: "Y",
    },
    {
      source: "Controlling_Address_vod__c",
      target: "controlling_address__v",
      transform: parseTransform("ref(address) secondPass"),
      required: "n",
    },
  ],
});

function account(
  n: number,
  parent: number | null,
  extra: Partial<SourceRow> = {},
): SourceRow {
  return {
    Id: A(n),
    Name: `Account ${n}`,
    Primary_Parent_vod__c: parent === null ? null : A(parent),
    "Country_vod__r.Alpha_2_Code_vod__c": "US",
    OwnerId: SAMPLE_USER_ID,
    CreatedById: SAMPLE_USER_ID,
    LastModifiedById: SAMPLE_USER_ID,
    SystemModstamp: "2020-01-01T00:00:00.000Z",
    ...extra,
  };
}

function setup() {
  const sfdc = new FakeSfdcClient()
    .addDescribe(sampleAccountDescribe())
    .addDescribe(addressDescribe())
    .addRows("Account", [
      account(1, 2),
      account(2, 3),
      account(3, null, { OwnerId: SAMPLE_QUEUE_ID }),
      account(4, null, { IsDeleted: true }),
      account(5, 1), // child of 1 — closure never adds children
    ])
    .addRows("Address_vod__c", [
      {
        Id: ADDR(1),
        Account_vod__c: A(1),
        Controlling_Address_vod__c: ADDR(2),
        CreatedById: SAMPLE_USER_ID,
        LastModifiedById: SAMPLE_USER_ID,
      },
      {
        Id: ADDR(2),
        Account_vod__c: A(3),
        Controlling_Address_vod__c: null,
        CreatedById: SAMPLE_USER_ID,
        LastModifiedById: SAMPLE_USER_ID,
      },
    ]);
  const store = new MemoryStateStore();
  const mappings = new Map<ObjectKey, MaterialisedMapping>([
    ["account", accountMapping],
    ["address", addressMapping],
  ]);
  const targets = new Map<ObjectKey, ResolvedTarget>([
    ["account", makeTarget("account", sampleAccountDescribe())],
    ["address", makeTarget("address", addressDescribe())],
  ]);
  return { sfdc, store, mappings, targets };
}

function needed(entries: Record<string, string[]>): FkIdSets {
  return new Map(
    Object.entries(entries).map(([k, v]) => [k as ObjectKey, new Set(v)]),
  );
}

describe("runClosure (§2.2 step 5)", () => {
  let runDir: string | undefined;
  afterEach(async () => cleanup(runDir));

  it("converges over a self-referencing chain, one REST call per round, ≤ 400 ids", async () => {
    runDir = await tmpRunDir();
    const { sfdc, store, mappings, targets } = setup();
    const r = await runClosure(
      { sfdc, store },
      {
        runId: "r1",
        country: "US",
        runDir,
        needed: needed({ account: [A(1)] }),
        mappings,
        targets,
        maxRounds: 20,
        strategy: "soqlIn",
      },
    );
    expect(r.rounds).toBe(3);
    expect(r.fetched.get("account")).toBe(3);
    expect(r.dangling.size).toBe(0);
    expect(r.findings).toEqual([]);
    const files = r.files.get("account")!;
    expect(files.map((f) => f.jobId)).toEqual([
      "closure-r1",
      "closure-r2",
      "closure-r3",
    ]);
    expect(files.every((f) => f.closure)).toBe(true);
    expect(files[0].path).toContain(`/US/account/extract/`);
    const ids: string[] = [];
    for (const f of files)
      for (const row of await readCsvRows(f.path)) ids.push(row.Id);
    expect(ids).toEqual([A(1), A(2), A(3)]); // parents only — A5 (a child) is never pulled
    const calls = sfdc.calls.filter((c) => c.method === "queryIds");
    expect(calls).toHaveLength(3);
    for (const c of calls)
      expect((c.args[1] as string[]).length).toBeLessThanOrEqual(400);
    expect(calls[0].args[2]).toEqual(
      expect.arrayContaining([
        "Id",
        "IsDeleted",
        "Primary_Parent_vod__c",
        "Name",
      ]),
    );
    expect(r.queueOwners.has(to18(SAMPLE_QUEUE_ID))).toBe(true);
    expect(r.userIds.has(SAMPLE_USER_ID)).toBe(true);
  });

  it("stops at ids already in the id map or in this run's extract", async () => {
    runDir = await tmpRunDir();
    const { sfdc, store, mappings, targets } = setup();
    await store.seedIdMap("account", "account__v", { [A(2)]: "V2" }, "US");
    const r = await runClosure(
      { sfdc, store },
      {
        runId: "r1",
        country: "US",
        runDir,
        needed: needed({ account: [A(1), A(3)] }),
        mappings,
        targets,
        maxRounds: 20,
        strategy: "soqlIn",
        have: needed({ account: [A(3)] }),
      },
    );
    expect(r.rounds).toBe(1);
    expect(r.fetched.get("account")).toBe(1);
    expect(
      sfdc.calls.find((c) => c.method === "queryIds")!.args[1] as string[],
    ).toEqual([A(1)]);
  });

  it("crosses objects (address → account → account) and reports deleted/missing parents as dangling", async () => {
    runDir = await tmpRunDir();
    const { sfdc, store, mappings, targets } = setup();
    const missing = to18("a0A000000000099");
    const r = await runClosure(
      { sfdc, store },
      {
        runId: "r1",
        country: "DE",
        runDir,
        needed: needed({
          address: [ADDR(1), missing],
          account: [A(4)],
          user: [SAMPLE_USER_ID],
        }),
        mappings,
        targets,
        maxRounds: 20,
        strategy: "soqlIn",
      },
    );
    // round 1: ADDR1 (+missing), A4 deleted; round 2: ADDR2, A1; round 3: A3, A2; round 4: A3 already seen → A2's parent A3 seen → done
    expect(r.fetched.get("address")).toBe(2);
    expect(r.fetched.get("account")).toBe(3);
    expect([...r.dangling.get("address")!]).toEqual([missing]);
    expect([...r.dangling.get("account")!]).toEqual([A(4)]);
    expect(r.deletedParents.get("account")).toBe(1);
    expect(r.findings).toMatchObject([
      { severity: "info", code: "EXTRACT_CLOSURE_DANGLING", count: 2 },
    ]);
    expect(r.files.get("address")![0].path).toContain("/DE/address/extract/"); // referencing row's country
    expect(
      sfdc.calls.some((c) => c.method === "queryIds" && c.args[0] === "User"),
    ).toBe(false);
  });

  it("caps the rounds with a blocking finding", async () => {
    runDir = await tmpRunDir();
    const { sfdc, store, mappings, targets } = setup();
    const r = await runClosure(
      { sfdc, store },
      {
        runId: "r1",
        country: "US",
        runDir,
        needed: needed({ account: [A(1)] }),
        mappings,
        targets,
        maxRounds: 2,
        strategy: "soqlIn",
      },
    );
    expect(r.rounds).toBe(2);
    expect(r.findings[0]).toMatchObject({
      severity: "blocking",
      code: "EXTRACT_CLOSURE_ROUNDS_EXCEEDED",
      count: 1,
    });
    expect([...r.dangling.get("account")!]).toEqual([A(3)]);
  });

  it("uses one Bulk queryAll + client filter above the threshold", async () => {
    runDir = await tmpRunDir();
    const { sfdc, store, mappings, targets } = setup();
    const r = await runClosure(
      { sfdc, store },
      {
        runId: "r1",
        country: "US",
        runDir,
        needed: needed({ account: [A(1), A(2)] }),
        mappings,
        targets,
        maxRounds: 20,
        strategy: "soqlIn",
      },
      { bulkThreshold: 1 },
    );
    expect(r.fetched.get("account")).toBe(3);
    const bulk = sfdc.calls.filter((c) => c.method === "bulkQuery");
    expect(bulk.length).toBeGreaterThanOrEqual(1);
    expect(bulk[0].args[1]).toMatchObject({ all: true });
    expect(bulk[0].args[0]).not.toMatch(/WHERE/);
    expect(
      sfdc.calls.some(
        (c) => c.method === "queryIds" && (c.args[1] as string[]).length > 1,
      ),
    ).toBe(false);
  });

  it("objects outside the run cannot be closed over (warning, dangling)", async () => {
    runDir = await tmpRunDir();
    const { sfdc, store, targets } = setup();
    const r = await runClosure(
      { sfdc, store },
      {
        runId: "r1",
        country: "US",
        runDir,
        needed: needed({ product: [to18("a0P000000000001")] }),
        mappings: new Map(),
        targets,
        maxRounds: 20,
        strategy: "soqlIn",
      },
    );
    expect(r.findings[0]).toMatchObject({
      severity: "warning",
      code: "EXTRACT_CLOSURE_NO_MAPPING",
      objectKey: "product",
    });
    expect(r.dangling.get("product")!.size).toBe(1);
  });
});

describe("collectRowFks", () => {
  it("keys by target object, keeps 005 owners, records 00G queues, ignores contacts", () => {
    const sets: FkIdSets = new Map();
    const queues = new Set<string>();
    collectRowFks(
      {
        Id: IDS.call1,
        Account_vod__c: "001000000000001",
        OwnerId: SAMPLE_QUEUE_ID,
        User_vod__c: "003000000000001AAA",
        CreatedById: SAMPLE_USER_ID,
      },
      [
        {
          column: "Account_vod__c",
          targetObjectKey: "account",
          polymorphic: false,
        },
        { column: "OwnerId", targetObjectKey: "user", polymorphic: true },
        { column: "User_vod__c", targetObjectKey: "user", polymorphic: false },
        { column: "CreatedById", targetObjectKey: "user", polymorphic: false },
      ],
      sets,
      queues,
    );
    expect([...sets.get("account")!]).toEqual([IDS.account1]);
    expect([...sets.get("user")!]).toEqual([SAMPLE_USER_ID]);
    expect([...queues]).toEqual([to18(SAMPLE_QUEUE_ID)]);
  });
});
