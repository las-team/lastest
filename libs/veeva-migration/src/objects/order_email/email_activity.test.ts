import { describe, expect, it } from "vitest";
import {
  EMAIL_ACTIVITY_EVENT_TYPE,
  EMAIL_ACTIVITY_IP_FIELD,
  EMAIL_ACTIVITY_IP_REGION_DEFAULTS,
  EMAIL_ACTIVITY_LOAD_IP_FLAG,
  EMAIL_ACTIVITY_PARENT_FIELD,
  PII_IP_ADDRESS_OMITTED_CODE,
  email_activity,
  ipAddress,
  loadIpAddressEffective,
} from "./email_activity";
import { SENT_EMAIL_OPEN_PREDICATE, sent_email } from "./sent_email";
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
const ACTIVITY_ID = to18("a0W000000000001");
const EMAIL_ID = to18("a0S000000000001");

function makeConfig(
  overrides: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
) {
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
    objects: { email_activity: overrides },
    countries: { US: {} },
    ...extra,
  });
}

function metadata() {
  return resolveMetadata(
    buildVaultMetadata("email_activity__v", [
      {
        name: "sent_email__v",
        type: "Object",
        object: { name: "sent_email__v" },
        required: true,
        relationship_type: "parent",
      },
      {
        name: "event_type__v",
        type: "Picklist",
        picklist: "event_type__v",
        required: true,
      },
      { name: "event_datetime__v", type: "DateTime", required: true },
      { name: "url__v", type: "String", max_length: 1500 },
      { name: "user_agent__v", type: "String", max_length: 500 },
      { name: "ip_address__v", type: "String", max_length: 45 },
      { name: "mobile_id__v", type: "String", max_length: 100 },
    ]),
    {
      picklists: {
        event_type__v: Object.values(EMAIL_ACTIVITY_EVENT_TYPE),
        status__v: ["active__v", "inactive__v"],
      },
    },
  );
}

function sampleRow(extra: Partial<SourceRow> = {}): SourceRow {
  return {
    Id: ACTIVITY_ID,
    IsDeleted: false,
    Name: "EA-000123",
    [EMAIL_ACTIVITY_PARENT_FIELD]: EMAIL_ID,
    Event_Type_vod__c: "Click_vod",
    Event_Datetime_vod__c: "2025-03-05T08:01:00.000Z",
    URL_vod__c: "https://example.com/cholecap?utm=mail",
    User_Agent_vod__c: "Mozilla/5.0",
    [EMAIL_ACTIVITY_IP_FIELD]: "203.0.113.7",
    Mobile_ID_vod__c: "7d2c5f4e-ea-0001",
    CreatedById: SAMPLE_USER_ID,
    LastModifiedById: SAMPLE_USER_ID,
    CreatedDate: "2025-03-05T08:01:00.000Z",
    LastModifiedDate: "2025-03-05T08:01:00.000Z",
    SystemModstamp: "2025-03-05T08:01:00.000Z",
    ...extra,
  };
}

function run(
  row: SourceRow,
  opts: {
    overrides?: Record<string, unknown>;
    configExtra?: Record<string, unknown>;
    iso2?: string;
    emails?: Record<string, string>;
    erased?: string[];
  } = {},
) {
  const config = makeConfig(opts.overrides, opts.configExtra);
  const iso2 = opts.iso2 ?? "US";
  const cc = resolveCountry(config, iso2);
  const mapping = materialise(email_activity, cc, config, { now: NOW });
  const ids = buildIdResolver(
    { sent_email: opts.emails ?? { [EMAIL_ID]: "V0S1" } },
    { [SAMPLE_USER_ID]: 101 },
  );
  return {
    mapping,
    result: applyMapping(row, mapping, {
      country: buildCountryContext({
        iso2,
        region: cc.region,
        erased: opts.erased,
      }),
      metadata: metadata(),
      ids,
      migrationUserId: 1,
      runMode: "init",
      custom: email_activity.custom,
    }),
  };
}

describe("email_activity module", () => {
  it("is structurally valid", () => {
    expect(
      validateObjectModule(email_activity).filter(
        (i) => i.severity === "blocking",
      ),
    ).toEqual([]);
  });

  it("encodes the §6.2 / §6.3.41 / §3.3 / §4.4 catalogue facts", () => {
    expect(email_activity.source).toBe("Email_Activity_vod__c");
    expect(email_activity.target).toBe("email_activity__v");
    expect(email_activity.targetEvidence).toBe("UNV");
    expect(email_activity.scope).toEqual({
      kind: "via-parent",
      parentKey: "sent_email",
      parentField: "Sent_Email_vod__r.Email_Sent_Date_vod__c",
      type: "datetime",
    });
    expect(email_activity.countryOf).toEqual([
      { kind: "parent", key: "sent_email", field: "Sent_Email_vod__c" },
    ]);
    expect(email_activity.dependsOn).toEqual(["sent_email"]);
    expect(email_activity.selfRefs).toEqual([]);
    expect(email_activity.objectTypes).toEqual({});
    expect(email_activity.states).toEqual({});
    expect(email_activity.deletePolicy).toBe("delete");
    expect(email_activity.inactivate).toEqual([]);
    expect(email_activity.createPolicy).toBe("create");
    expect(email_activity.load.noTriggers).toBe(true);
    expect(email_activity.match.map((m) => m.method)).toEqual([
      "legacy_id",
      "mobile_id",
    ]);
    expect(email_activity.match[1]).toMatchObject({
      keys: [{ target: "mobile_id__v", source: "Mobile_ID_vod__c" }],
    });
    expect(email_activity.blockS).toMatchObject({
      name: "autoNumber",
      ownerId: false,
    });
    // no static loadIpAddress default: unset → region default (EU false, else true)
    expect(email_activity.optionDefaults).toBeUndefined();
    expect(Object.keys(email_activity.custom ?? {})).toEqual(["ipAddress"]);
    expect(EMAIL_ACTIVITY_IP_REGION_DEFAULTS).toEqual({ EU: false });
    expect(email_activity.notes).not.toContain("STUB");
    // loads after sent_email (§6.1 step 20)
    const steps = loadOrder([
      { key: "account", dependsOn: [], selfRefs: [] },
      { key: "sent_email", dependsOn: ["account"], selfRefs: [] },
      email_activity,
    ]);
    const level = (k: string) =>
      steps.findIndex((s) => s.keys.includes(k as never));
    expect(level("email_activity")).toBeGreaterThan(level("sent_email"));
  });

  it("carries every §6.3.41 row with its transform, evidence and flags", () => {
    const byTarget = new Map(email_activity.fields.map((f) => [f.target, f]));
    for (const target of [
      "legacy_crm_id__v",
      "name__v",
      "sent_email__v",
      "event_type__v",
      "event_datetime__v",
      "url__v",
      "user_agent__v",
      "ip_address__v",
      "mobile_id__v",
    ])
      expect(byTarget.has(target), target).toBe(true);
    expect(byTarget.has("ownerid__v")).toBe(false);
    expect(byTarget.get("name__v")).toMatchObject({
      enabledBy: "preserveAutoNumberName",
    });
    expect(byTarget.get("sent_email__v")).toMatchObject({
      source: EMAIL_ACTIVITY_PARENT_FIELD,
      transform: { kind: "ref", objectKey: "sent_email" },
      required: "Y",
      evidence: "UNV",
    });
    expect(byTarget.get("event_type__v")).toMatchObject({
      transform: { kind: "picklist", mapKey: "email_activity.eventType" },
      required: "Y",
      evidence: "UNV",
    });
    expect(byTarget.get("event_datetime__v")).toMatchObject({
      transform: { kind: "datetime" },
      required: "Y",
      evidence: "UNV",
    });
    for (const target of ["url__v", "user_agent__v", "ip_address__v"])
      expect(byTarget.get(target), target).toMatchObject({
        required: "n",
        evidence: "UNV",
        unverifiedSource: true,
        optionalSource: true,
      });
    for (const target of ["url__v", "user_agent__v"])
      expect(byTarget.get(target)?.transform, target).toEqual({ kind: "text" });
    expect(byTarget.get("ip_address__v")).toMatchObject({
      source: EMAIL_ACTIVITY_IP_FIELD,
      transform: { kind: "custom", fnName: "ipAddress" },
      disabledBy: EMAIL_ACTIVITY_LOAD_IP_FLAG,
    });
    expect(email_activity.picklists["email_activity.eventType"]).toMatchObject({
      Open_vod: "open__v",
      Click_vod: "click__v",
    });
    for (const f of email_activity.fields)
      if (f.transform.kind !== "skip")
        expect(f.evidence, `${f.target} has an evidence tag`).toBeDefined();
  });

  it("transforms a realistic row: parent FK deferred, event type crosswalked, datetime formatted, tracking text carried, no name", () => {
    const { result } = run(sampleRow());
    expect(result.failure).toBeUndefined();
    expect(result.status).toBe("ok");
    expect(result.payload).toMatchObject({
      legacy_crm_id__v: ACTIVITY_ID,
      sent_email__v: { $fk: { object: "sent_email", sfdcId: EMAIL_ID } },
      event_type__v: "click__v",
      event_datetime__v: "2025-03-05T08:01:00.000Z",
      url__v: "https://example.com/cholecap?utm=mail",
      user_agent__v: "Mozilla/5.0",
      ip_address__v: "203.0.113.7",
      mobile_id__v: "7d2c5f4e-ea-0001",
      created_date__v: "2025-03-05T08:01:00.000Z",
      created_by__v: { $user: SAMPLE_USER_ID },
      modified_by__v: { $user: SAMPLE_USER_ID },
    });
    expect(result.payload.name__v).toBeUndefined();
    expect(result.payload.ownerid__v).toBeUndefined();
    expect(result.payload.status__v).toBeUndefined();
    expect(result.secondPass).toEqual({});
    expect(result.blobs).toEqual({});
    expect(result.unresolvedRequiredFks).toEqual([]);
    expect(result.fkEdges).toContainEqual({
      field: "sent_email__v",
      targetObjectKey: "sent_email",
      targetSfdcId: EMAIL_ID,
    });
    // an unknown event type derives by the rename rule and fails validation under onUnmapped = error
    const { result: unknownType } = run(
      sampleRow({ Event_Type_vod__c: "Forward_vod" }),
    );
    expect(unknownType.status).toBe("failed");
  });

  it("drops ip_address__v when loadIpAddress is false — explicitly or through the regions.EU overlay", () => {
    const { mapping: us, result: usResult } = run(sampleRow());
    expect(us.fields.some((f) => f.target === "ip_address__v")).toBe(true);
    // unset flag: the region default applies (US has no region → loaded)
    expect(us.options[EMAIL_ACTIVITY_LOAD_IP_FLAG]).toBeUndefined();
    expect(usResult.payload.ip_address__v).toBe("203.0.113.7");
    expect(usResult.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: PII_IP_ADDRESS_OMITTED_CODE }),
    );

    const { mapping: off, result: offResult } = run(sampleRow(), {
      overrides: { [EMAIL_ACTIVITY_LOAD_IP_FLAG]: false },
    });
    expect(off.options[EMAIL_ACTIVITY_LOAD_IP_FLAG]).toBe(false);
    expect(off.fields.some((f) => f.target === "ip_address__v")).toBe(false);
    expect(offResult.status).toBe("ok");
    expect(offResult.payload.ip_address__v).toBeUndefined();
    expect(offResult.payload.url__v).toBe(
      "https://example.com/cholecap?utm=mail",
    );

    const { mapping: de, result: deResult } = run(sampleRow(), {
      iso2: "DE",
      configExtra: {
        regions: {
          EU: {
            objects: {
              email_activity: { [EMAIL_ACTIVITY_LOAD_IP_FLAG]: false },
            },
          },
        },
        countries: { US: {}, DE: { region: "EU" } },
      },
    });
    expect(de.country).toBe("DE");
    expect(de.options[EMAIL_ACTIVITY_LOAD_IP_FLAG]).toBe(false);
    expect(de.fields.some((f) => f.target === "ip_address__v")).toBe(false);
    expect(deResult.payload.ip_address__v).toBeUndefined();
    expect(de.mappingHash).not.toBe(us.mappingHash);
  });

  it("never loads ip_address__v for an EU-region unit whose config carries no loadIpAddress at all (§6.3.41 default false in regions.EU)", () => {
    // regions.EU declared but WITHOUT the §7.3 `objects.email_activity.loadIpAddress: false` block
    const configExtra = {
      regions: { EU: {} },
      countries: { US: {}, DE: { region: "EU" } },
    };
    const { mapping, result } = run(sampleRow(), { iso2: "DE", configExtra });
    expect(mapping.country).toBe("DE");
    expect(mapping.options[EMAIL_ACTIVITY_LOAD_IP_FLAG]).toBeUndefined();
    // the row survives materialise (no explicit false) — the transform applies the region default
    expect(mapping.fields.some((f) => f.target === "ip_address__v")).toBe(true);
    expect(result.status).toBe("ok");
    expect(result.payload.ip_address__v).toBeUndefined();
    expect(result.payload.url__v).toBe("https://example.com/cholecap?utm=mail");
    const omitted = result.diagnostics.find(
      (d) => d.code === PII_IP_ADDRESS_OMITTED_CODE,
    );
    expect(omitted).toMatchObject({ kind: "custom", field: "ip_address__v" });
    expect(omitted?.fatal).toBeUndefined();
    // PII never echoed
    expect(JSON.stringify(omitted)).not.toContain("203.0.113.7");
    // an explicit opt-in on the country wins over the region default
    const { result: optIn } = run(sampleRow(), {
      iso2: "DE",
      configExtra: {
        regions: { EU: {} },
        countries: {
          US: {},
          DE: {
            region: "EU",
            objects: {
              email_activity: { [EMAIL_ACTIVITY_LOAD_IP_FLAG]: true },
            },
          },
        },
      },
    });
    expect(optIn.payload.ip_address__v).toBe("203.0.113.7");
    // a non-EU region keeps the §7.2.1 default (true)
    const { result: ca } = run(sampleRow(), {
      iso2: "CA",
      configExtra: {
        regions: { NA: {} },
        countries: { US: {}, CA: { region: "NA" } },
      },
    });
    expect(ca.payload.ip_address__v).toBe("203.0.113.7");
  });

  it("skips erased rows and reports an unresolved parent email as pending_fk", () => {
    const { result: erased } = run(sampleRow(), { erased: [ACTIVITY_ID] });
    expect(erased.status).toBe("skipped");
    expect(erased.skipReason).toBe("erased");
    expect(erased.payload).toEqual({});

    const { result } = run(sampleRow(), { emails: {} });
    expect(result.status).toBe("pending_fk");
    expect(result.payload.sent_email__v).toEqual({
      $fk: { object: "sent_email", sfdcId: EMAIL_ID },
    });
    expect(result.unresolvedRequiredFks).toEqual([
      { field: "sent_email__v", objectKey: "sent_email", sfdcId: EMAIL_ID },
    ]);
  });

  it("is scoped through the parent email's sent date and open-item term", () => {
    const { mapping } = run(sampleRow());
    expect(mapping.scope.spec).toEqual(email_activity.scope);
    expect(mapping.scope.cutoffDate).toBe("2024-09-07");
    const parentOpen =
      sent_email.scope.kind === "dated"
        ? sent_email.scope.openPredicate
        : undefined;
    expect(parentOpen).toBe(SENT_EMAIL_OPEN_PREDICATE);
    const build = buildScopePredicate(mapping.scope, {
      now: NOW,
      parentOpenPredicate: parentOpen,
    });
    expect(build.kind).toBe("via-parent");
    expect(build.dateTerm).toBe(
      "Sent_Email_vod__r.Email_Sent_Date_vod__c >= 2024-09-07T00:00:00Z",
    );
    expect(build.openTerm).toBe(
      "Sent_Email_vod__r.Status_vod__c IN ('Scheduled_vod', 'Saved_vod', 'Pending_vod') OR (Sent_Email_vod__r.Email_Sent_Date_vod__c = null AND Sent_Email_vod__r.CreatedDate >= 2024-09-07T00:00:00Z)",
    );
    expect(build.predicate).toBe(`(${build.dateTerm}) OR (${build.openTerm})`);
    expect(mapping.countryOf).toEqual([
      { kind: "parent", key: "sent_email", field: "Sent_Email_vod__c" },
    ]);
    expect(mapping.options.deletePolicy).toBe("delete");
  });
});

describe("email_activity custom transforms", () => {
  it("loadIpAddressEffective: explicit boolean wins, else EU → false, else true", () => {
    expect(loadIpAddressEffective(undefined, undefined)).toBe(true);
    expect(loadIpAddressEffective(undefined, "NA")).toBe(true);
    expect(loadIpAddressEffective(undefined, "EU")).toBe(false);
    expect(loadIpAddressEffective(true, "EU")).toBe(true);
    expect(loadIpAddressEffective(false, "NA")).toBe(false);
    expect(loadIpAddressEffective("yes", "EU")).toBe(false);
  });

  it("ipAddress carries the value as text outside the EU and omits + counts it under the EU default", () => {
    const ctxFor = (region: string | undefined, option?: boolean) =>
      buildTransformContext({
        objectKey: "email_activity",
        field: { source: EMAIL_ACTIVITY_IP_FIELD, target: "ip_address__v" },
        country: buildCountryContext({ iso2: region ? "DE" : "US", region }),
        mapping:
          option === undefined
            ? undefined
            : {
                options: {
                  ...buildTransformContext().mapping.options,
                  [EMAIL_ACTIVITY_LOAD_IP_FLAG]: option,
                },
              },
      });
    const row = { Id: ACTIVITY_ID };
    expect(ipAddress(" 203.0.113.7 ", row, ctxFor(undefined))).toEqual({
      value: "203.0.113.7",
    });
    expect(ipAddress("203.0.113.7", row, ctxFor("NA"))).toEqual({
      value: "203.0.113.7",
    });
    const eu = ipAddress("203.0.113.7", row, ctxFor("EU"));
    expect(eu).toEqual({
      omit: true,
      diagnostic: {
        kind: "custom",
        field: "ip_address__v",
        code: PII_IP_ADDRESS_OMITTED_CODE,
        detail: expect.stringContaining("region EU"),
      },
    });
    expect(JSON.stringify(eu)).not.toContain("203.0.113.7");
    expect(ipAddress("203.0.113.7", row, ctxFor("EU", true))).toEqual({
      value: "203.0.113.7",
    });
    expect(ipAddress("203.0.113.7", row, ctxFor("NA", false))).toMatchObject({
      omit: true,
      diagnostic: { code: PII_IP_ADDRESS_OMITTED_CODE },
    });
    expect(ipAddress("", row, ctxFor("EU"))).toBeUndefined();
    expect(ipAddress(null, row, ctxFor(undefined))).toBeUndefined();
  });
});
