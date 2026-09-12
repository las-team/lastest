import { describe, expect, it } from "vitest";
import { em_event_team_member } from "./em_event_team_member";
import { EM_EVENT_OPEN_PREDICATE } from "./em_event";
import { validateObjectModule } from "../types";
import {
  computeCutoffDate,
  materialise,
  resolveCountry,
} from "../../config/resolve";
import { parseConfig } from "../../config/schema";
import { applyMapping } from "../../transform/apply";
import { buildScopePredicate } from "../../extract/scope";
import {
  SAMPLE_USER_ID,
  SAMPLE_USER_ID_2,
  buildCountryContext,
  buildIdResolver,
  buildVaultMetadata,
  resolveMetadata,
} from "../../testkit";
import { to18 } from "../../transform/ids";
import type { SourceRow } from "../../types";

const NOW = new Date("2026-09-07T00:00:00Z");
const CUTOFF = computeCutoffDate(NOW, 24);
const ROW_1 = to18("a0M000000000001");
const EVENT_1 = to18("a0E000000000001");
const EVENT_UNKNOWN = to18("a0E000000000009");

function config(objects: Record<string, unknown> = {}) {
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
    countries: { US: {} },
    objects,
  });
}

function metadata() {
  return resolveMetadata(
    buildVaultMetadata("em_event_team_member__v", [
      {
        name: "event__v",
        type: "Object",
        object: { name: "em_event__v" },
        required: true,
        relationship_type: "reference",
      },
      {
        name: "team_member__v",
        type: "Object",
        object: { name: "user__sys" },
        required: true,
        relationship_type: "reference",
      },
      { name: "user_id__v", type: "String", max_length: 18 },
      { name: "role__v", type: "Picklist", picklist: "role__v" },
      { name: "external_id__v", type: "String", max_length: 100 },
      { name: "mobile_id__v", type: "String", max_length: 100 },
    ]),
    {
      picklists: {
        role__v: ["organizer__v", "host__v"],
        status__v: ["active__v", "inactive__v"],
      },
    },
  );
}

const ids = buildIdResolver(
  { em_event: { [EVENT_1]: "V0E000000000001" } },
  { [SAMPLE_USER_ID]: 11 },
);

function row(extra: Record<string, unknown> = {}): SourceRow {
  return {
    Id: ROW_1,
    IsDeleted: false,
    Name: "Doe, John — Organizer",
    Event_vod__c: EVENT_1,
    Team_Member_vod__c: SAMPLE_USER_ID,
    Role_vod__c: "Organizer_vod",
    External_ID_vod__c: "TM-001",
    Mobile_ID_vod__c: "7d2c5f4e-t001",
    OwnerId: SAMPLE_USER_ID,
    CreatedById: SAMPLE_USER_ID,
    LastModifiedById: SAMPLE_USER_ID,
    CreatedDate: "2025-02-04T10:11:12.000Z",
    LastModifiedDate: "2025-03-11T03:04:05.000Z",
    SystemModstamp: "2025-03-11T03:04:05.000Z",
    ...extra,
  };
}

function mapping(objects: Record<string, unknown> = {}) {
  const cfg = config(objects);
  return materialise(em_event_team_member, resolveCountry(cfg, "US"), cfg, {
    now: NOW,
  });
}

function applyCtx(overrides: Partial<Parameters<typeof applyMapping>[2]> = {}) {
  return {
    country: buildCountryContext(),
    metadata: metadata(),
    ids,
    migrationUserId: 1,
    runMode: "init" as const,
    custom: em_event_team_member.custom,
    ...overrides,
  };
}

describe("em_event_team_member module", () => {
  it("is structurally valid and encodes the §6.2 / §3.3 / §4.4 catalogue rows", () => {
    expect(
      validateObjectModule(em_event_team_member).filter(
        (i) => i.severity === "blocking",
      ),
    ).toEqual([]);
    expect(em_event_team_member.source).toBe("EM_Event_Team_Member_vod__c");
    expect(em_event_team_member.target).toBe("em_event_team_member__v");
    expect(em_event_team_member.targetEvidence).toBe("OBS");
    expect(em_event_team_member.scope).toEqual({
      kind: "via-parent",
      parentKey: "em_event",
      parentField: "Event_vod__r.Start_Time_vod__c",
      type: "datetime",
      retentionFamily: "tov",
    });
    expect(em_event_team_member.countryOf).toEqual([
      { kind: "parent", key: "em_event", field: "Event_vod__c" },
    ]);
    expect(em_event_team_member.dependsOn).toEqual(["em_event", "user"]);
    expect(em_event_team_member.selfRefs).toEqual([]);
    expect(em_event_team_member.deletePolicy).toBe("delete");
    expect(em_event_team_member.inactivate).toEqual([]);
    expect(em_event_team_member.createPolicy).toBe("create");
    expect(em_event_team_member.load.noTriggers).toBe(true);
    expect(em_event_team_member.objectTypes).toEqual({});
    expect(em_event_team_member.blockS.objectType).toBe(false);
    expect(em_event_team_member.blobs).toBeUndefined();
    expect(em_event_team_member.custom).toBeUndefined();
    expect(em_event_team_member.match.map((m) => m.method)).toEqual([
      "legacy_id",
      "external_id",
      "mobile_id",
      "natural_key",
    ]);
    expect(em_event_team_member.match[3].keys).toEqual([
      { target: "event__v", source: "Event_vod__c" },
      { target: "team_member__v", source: "Team_Member_vod__c" },
    ]);
    expect(em_event_team_member.notes).not.toContain("STUB");
  });

  it("carries every §6.3.25 row with its transform, requirement and evidence", () => {
    const byTarget = new Map(
      em_event_team_member.fields.map((f) => [f.target, f]),
    );
    for (const target of [
      "legacy_crm_id__v",
      "name__v",
      "event__v",
      "team_member__v",
      "user_id__v",
      "role__v",
      "created_date__v",
      "created_by__v",
      "modified_date__v",
      "modified_by__v",
      "ownerid__v",
      "mobile_id__v",
      "external_id__v",
    ])
      expect(byTarget.has(target), target).toBe(true);
    expect(byTarget.has("object_type__v.api_name__v")).toBe(false);
    expect(byTarget.get("event__v")).toMatchObject({
      required: "Y",
      evidence: "OBS",
      transform: { kind: "ref", objectKey: "em_event" },
    });
    expect(byTarget.get("team_member__v")).toMatchObject({
      required: "Y",
      evidence: "OBS",
      transform: { kind: "refUser" },
    });
    expect(byTarget.get("user_id__v")).toMatchObject({
      source: "Team_Member_vod__c",
      transform: { kind: "copy" },
    });
    expect(byTarget.get("role__v")).toMatchObject({
      required: "n",
      evidence: "OBS",
      countryConfigurable: true,
      transform: { kind: "picklist", mapKey: "em_event_team_member.role" },
    });
    expect(byTarget.get("name__v")).toMatchObject({
      required: "Y",
      evidence: "OBS",
      transform: { kind: "text", max: 128 },
    });
    expect(
      em_event_team_member.fields.filter((f) => f.target === "name__v"),
    ).toHaveLength(1);
    expect(em_event_team_member.picklists).toEqual({
      "em_event_team_member.role": {},
    });
    for (const f of em_event_team_member.fields)
      if (f.transform.kind !== "skip")
        expect(f.evidence, `${f.target} has an evidence tag`).toBeDefined();
  });

  it("is scoped through the parent event (with its open term) in the tov family", () => {
    const m = mapping();
    expect(m.scope.spec.kind).toBe("via-parent");
    expect(m.scope.retentionFamily).toBe("tov");
    expect(m.scope.historyMonths).toBe(24);
    const built = buildScopePredicate(m.scope, {
      now: NOW,
      parentOpenPredicate: EM_EVENT_OPEN_PREDICATE,
    });
    expect(built.cutoffDate).toBe(CUTOFF);
    expect(built.predicate).toBe(
      `(Event_vod__r.Start_Time_vod__c >= ${CUTOFF}T00:00:00Z) OR ((Event_vod__r.End_Time_vod__c >= ${CUTOFF}T00:00:00Z) OR (Event_vod__r.Status_vod__c NOT IN ('Closed_vod', 'Canceled_vod', 'Cancelled_vod')))`,
    );
    expect(buildScopePredicate(m.scope, { now: NOW }).predicate).toBe(
      `Event_vod__r.Start_Time_vod__c >= ${CUTOFF}T00:00:00Z`,
    );
    expect(m.options.deletePolicy).toBe("delete");
  });

  it("transforms a row: parent ref, user ref + id text, role crosswalk, name", () => {
    const r = applyMapping(row(), mapping(), applyCtx());
    expect(r.failure).toBeUndefined();
    expect(r.status).toBe("ok");
    expect(r.payload).toMatchObject({
      legacy_crm_id__v: ROW_1,
      name__v: "Doe, John — Organizer",
      event__v: { $fk: { object: "em_event", sfdcId: EVENT_1 } },
      team_member__v: { $user: SAMPLE_USER_ID },
      user_id__v: SAMPLE_USER_ID,
      role__v: "organizer__v",
      external_id__v: "TM-001",
      mobile_id__v: "7d2c5f4e-t001",
      ownerid__v: { $user: SAMPLE_USER_ID },
      created_date__v: "2025-02-04T10:11:12.000Z",
      created_by__v: { $user: SAMPLE_USER_ID },
      modified_by__v: { $user: SAMPLE_USER_ID },
    });
    expect(r.payload.status__v).toBeUndefined();
    expect(r.payload["object_type__v.api_name__v"]).toBeUndefined();
    expect(r.secondPass).toEqual({});
    expect(r.blobs).toEqual({});
    expect(r.unresolvedRequiredFks).toEqual([]);
    expect(r.fkEdges).toContainEqual({
      field: "team_member__v",
      targetObjectKey: "user",
      targetSfdcId: SAMPLE_USER_ID,
    });
    const overlay = applyMapping(
      row({ Role_vod__c: "Co-Host" }),
      mapping(),
      applyCtx({
        country: buildCountryContext({
          picklists: { "em_event_team_member.role": { "Co-Host": "host__v" } },
        }),
      }),
    );
    expect(overlay.payload.role__v).toBe("host__v");
    const unmapped = applyMapping(
      row({ Role_vod__c: "Co-Host" }),
      mapping(),
      applyCtx(),
    );
    expect(unmapped.status).toBe("failed");
    expect(unmapped.failure?.field).toBe("role__v");
  });

  it("reports unresolved required references (parent event, team member user) per §3.5", () => {
    const pendingEvent = applyMapping(
      row({ Event_vod__c: EVENT_UNKNOWN }),
      mapping(),
      applyCtx(),
    );
    expect(pendingEvent.status).toBe("pending_fk");
    expect(pendingEvent.unresolvedRequiredFks).toEqual([
      { field: "event__v", objectKey: "em_event", sfdcId: EVENT_UNKNOWN },
    ]);
    // default unmappedUserPolicy = omit: deferred user kept, required → pending_fk
    const pendingUser = applyMapping(
      row({ Team_Member_vod__c: SAMPLE_USER_ID_2 }),
      mapping(),
      applyCtx(),
    );
    expect(pendingUser.status).toBe("pending_fk");
    expect(pendingUser.payload.team_member__v).toEqual({
      $user: SAMPLE_USER_ID_2,
    });
    expect(pendingUser.payload.user_id__v).toBe(SAMPLE_USER_ID_2);
    expect(pendingUser.unresolvedRequiredFks).toEqual([
      { field: "team_member__v", objectKey: "user", sfdcId: SAMPLE_USER_ID_2 },
    ]);
    // policy fail → the row fails with UNMAPPED_USER
    const failed = applyMapping(
      row({ Team_Member_vod__c: SAMPLE_USER_ID_2 }),
      mapping({ em_event_team_member: { unmappedUserPolicy: "fail" } }),
      applyCtx(),
    );
    expect(failed.status).toBe("failed");
    expect(failed.failure).toMatchObject({
      code: "UNMAPPED_USER",
      field: "team_member__v",
    });
    const missing = applyMapping(
      row({ Team_Member_vod__c: "" }),
      mapping(),
      applyCtx(),
    );
    expect(missing.status).toBe("failed");
    expect(missing.failure).toMatchObject({
      code: "REQUIRED_MISSING",
      field: "team_member__v",
    });
    const erased = applyMapping(
      row(),
      mapping(),
      applyCtx({ country: buildCountryContext({ erased: [ROW_1] }) }),
    );
    expect(erased.status).toBe("skipped");
  });
});
