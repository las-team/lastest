import pino from "pino";
import { describe, expect, it } from "vitest";
import {
  canonicalVaultType,
  normaliseFieldMetadata,
  normaliseObjectMetadata,
  OBJECT_TYPE_FALLBACK_SOURCE,
  stripPicklistPrefix,
} from "./metadata";
import { API, authRoutes, failureBody, makeTestClient } from "./test-support";

function collectLogger() {
  const lines: string[] = [];
  const logger = pino(
    { level: "debug" },
    { write: (s: string) => lines.push(s) },
  );
  return { logger: logger.child({ scope: "Vault" }), lines };
}

describe("metadata normalisation (§2.5.6)", () => {
  it("normalises field types case-insensitively and strips the Picklist. prefix", () => {
    expect(canonicalVaultType("longtext")).toBe("LongText");
    expect(canonicalVaultType("RICHTEXT")).toBe("RichText");
    expect(canonicalVaultType("String")).toBe("String");
    expect(canonicalVaultType("Weird")).toBe("Weird");
    expect(stripPicklistPrefix("Picklist.country__v")).toBe("country__v");
    expect(stripPicklistPrefix("picklist.x__v")).toBe("x__v");
    expect(stripPicklistPrefix("country__v")).toBe("country__v");
    expect(stripPicklistPrefix(undefined)).toBeUndefined();
    const f = normaliseFieldMetadata({
      name: "country__v",
      type: "picklist",
      required: "true",
      status: "active__v",
      picklist: "Picklist.country__v",
      max_length: "1500",
      object: "country__v",
    });
    expect(f).toMatchObject({
      name: "country__v",
      type: "Picklist",
      required: true,
      status: ["active__v"],
      picklist: "country__v",
      max_length: 1500,
      object: { name: "country__v" },
    });
  });

  it("normalises object metadata (status arrays, object types, urls)", () => {
    const m = normaliseObjectMetadata({
      name: "account__v",
      status: ["active__v"],
      allow_types: "true",
      object_types: [{ name: "base__v", status: "active__v" }],
      available_lifecycles: [{ name: "account_lifecycle__v" }],
      urls: {
        list: "/api/v26.2/vobjects/account__v",
        recalculate_rollups:
          "/api/v26.2/vobjects/account__v/actions/recalculaterollups",
        n: 1,
      },
      fields: [
        { name: "id", type: "ID", required: true, status: ["active__v"] },
      ],
    });
    expect(m.allow_types).toBe(true);
    expect(m.object_types).toEqual([
      { name: "base__v", status: ["active__v"] },
    ]);
    expect(m.available_lifecycles).toEqual(["account_lifecycle__v"]);
    expect(m.urls).toEqual({
      list: "/api/v26.2/vobjects/account__v",
      recalculate_rollups:
        "/api/v26.2/vobjects/account__v/actions/recalculaterollups",
    });
    expect(m.fields[0].type).toBe("ID");
  });
});

describe("metadata endpoints", () => {
  it("listObjects / objectMetadata / fieldMetadata", async () => {
    const t = makeTestClient([
      ...authRoutes(),
      {
        method: "GET",
        path: `${API}/metadata/vobjects`,
        body: {
          responseStatus: "SUCCESS",
          objects: [
            { name: "account__v", label: "Account", status: ["active__v"] },
          ],
        },
      },
      {
        method: "GET",
        path: `${API}/metadata/vobjects/account__v`,
        body: {
          responseStatus: "SUCCESS",
          object: {
            name: "account__v",
            status: ["active__v"],
            fields: [
              {
                name: "name__v",
                type: "string",
                required: true,
                status: ["active__v"],
                max_length: 128,
              },
            ],
          },
        },
      },
      {
        method: "GET",
        path: `${API}/metadata/vobjects/account__v/fields/name__v`,
        body: {
          responseStatus: "SUCCESS",
          field: { name: "name__v", type: "String", required: true },
        },
      },
    ]);
    await t.client.authenticate();
    expect(await t.client.listObjects()).toEqual([
      { name: "account__v", label: "Account", status: ["active__v"] },
    ]);
    const meta = await t.client.objectMetadata("account__v");
    expect(meta.fields).toEqual([
      {
        name: "name__v",
        type: "String",
        required: true,
        status: ["active__v"],
        max_length: 128,
      },
    ]);
    const f = await t.client.fieldMetadata("account__v", "name__v");
    expect(f).toMatchObject({
      name: "name__v",
      type: "String",
      required: true,
      status: [],
    });
  });

  it("picklistValues keeps active values only; create/setStatus use forms", async () => {
    const t = makeTestClient([
      ...authRoutes(),
      {
        method: "GET",
        path: `${API}/objects/picklists/country__v`,
        body: {
          responseStatus: "SUCCESS",
          picklistValues: [
            { name: "us__v", label: "US", status: "active" },
            { name: "old__v", label: "Old", status: "inactive" },
            { name: "de__v", label: "DE" },
          ],
        },
      },
      {
        method: "POST",
        path: `${API}/objects/picklists/country__v`,
        body: {
          responseStatus: "SUCCESS",
          picklistValues: [{ name: "new_value__c", label: "New Value" }],
        },
      },
      {
        method: "PUT",
        path: `${API}/objects/picklists/country__v/old__v`,
        body: { responseStatus: "SUCCESS" },
      },
    ]);
    await t.client.authenticate();
    expect(await t.client.picklistValues("Picklist.country__v")).toEqual([
      { name: "us__v", label: "US", status: "active" },
      { name: "de__v", label: "DE" },
    ]);
    expect(
      await t.client.createPicklistValues!("country__v", [
        "New Value",
        "Other",
      ]),
    ).toEqual([{ name: "new_value__c", label: "New Value" }]);
    const create = t.fetch.calls.at(-1)!;
    expect(create.form?.get("value_1")).toBe("New Value");
    expect(create.form?.get("value_2")).toBe("Other");
    await t.client.setPicklistValueStatus!("country__v", "old__v", "active");
    expect(t.fetch.calls.at(-1)?.form?.get("status")).toBe("active");
  });

  it("objectTypes fetches /configuration/Objecttype.{object}.{type} per type; an unreadable one is warned about and falls back to the base object's required fields", async () => {
    const { logger, lines } = collectLogger();
    const t = makeTestClient(
      [
        ...authRoutes(),
        {
          method: "GET",
          path: `${API}/metadata/vobjects/call2__v`,
          body: {
            responseStatus: "SUCCESS",
            object: {
              name: "call2__v",
              status: ["active__v"],
              object_types: [
                { name: "base__v" },
                { name: "group_call__v", status: ["active__v"] },
              ],
              fields: [
                { name: "name__v", type: "String", required: true },
                { name: "call_date__v", type: "Date", required: true },
                { name: "notes__v", type: "LongText", required: false },
              ],
            },
          },
        },
        {
          method: "GET",
          path: `${API}/configuration/Objecttype.call2__v.base__v`,
          body: {
            responseStatus: "SUCCESS",
            data: {
              name: "base__v",
              object: "call2__v",
              active: true,
              type_fields: [
                { name: "account__v", required: true, source: "standard" },
              ],
            },
          },
        },
        {
          method: "GET",
          path: `${API}/configuration/Objecttype.call2__v.group_call__v`,
          body: failureBody("INSUFFICIENT_ACCESS", "no configuration access"),
        },
      ],
      { logger },
    );
    await t.client.authenticate();
    const detailed = await t.client.objectTypesDetailed("call2__v");
    expect(detailed.types).toEqual([
      {
        name: "base__v",
        object: "call2__v",
        active: true,
        type_fields: [
          { name: "account__v", required: true, source: "standard" },
        ],
      },
      {
        name: "group_call__v",
        object: "call2__v",
        active: true,
        type_fields: [
          {
            name: "name__v",
            required: true,
            source: OBJECT_TYPE_FALLBACK_SOURCE,
          },
          {
            name: "call_date__v",
            required: true,
            source: OBJECT_TYPE_FALLBACK_SOURCE,
          },
        ],
      },
    ]);
    expect(detailed.unreadable).toEqual([
      {
        name: "group_call__v",
        error: "INSUFFICIENT_ACCESS",
        message: "INSUFFICIENT_ACCESS: no configuration access",
        fallback: "object_metadata_required",
      },
    ]);
    const warn = lines
      .map((l) => JSON.parse(l))
      .find((r) => r.code === "VT_OBJECT_TYPE_CONFIG_UNREADABLE");
    expect(warn).toMatchObject({
      level: 40,
      object: "call2__v",
      object_type: "group_call__v",
      error_type: "INSUFFICIENT_ACCESS",
      fallback_required_fields: ["name__v", "call_date__v"],
    });
    // metadata is cached: a second objectTypes() call re-reads only the type configs
    t.fetch.add(
      {
        method: "GET",
        path: `${API}/configuration/Objecttype.call2__v.base__v`,
        body: {
          responseStatus: "SUCCESS",
          data: { name: "base__v", type_fields: [] },
        },
      },
      {
        method: "GET",
        path: `${API}/configuration/Objecttype.call2__v.group_call__v`,
        body: {
          responseStatus: "SUCCESS",
          data: { name: "group_call__v", type_fields: [] },
        },
      },
    );
    await t.client.objectTypes("call2__v");
    expect(
      t.fetch.calls.filter(
        (c) => c.pathname === `${API}/metadata/vobjects/call2__v`,
      ),
    ).toHaveLength(1);
  });

  it("objectTypes falls back to the full Objecttype list when metadata has no types", async () => {
    const t = makeTestClient([
      ...authRoutes(),
      {
        method: "GET",
        path: `${API}/metadata/vobjects/x__v`,
        body: failureBody("INVALID_DATA"),
      },
      {
        method: "GET",
        path: `${API}/configuration/Objecttype`,
        body: {
          responseStatus: "SUCCESS",
          data: [
            { name: "base__v", object: "x__v", active: true, type_fields: [] },
            { name: "base__v", object: "y__v", active: true, type_fields: [] },
          ],
        },
      },
    ]);
    await t.client.authenticate();
    expect(await t.client.objectTypes("x__v")).toEqual([
      { name: "base__v", object: "x__v", active: true, type_fields: [] },
    ]);
  });

  it("lifecycleStates parses state api names", async () => {
    const t = makeTestClient([
      ...authRoutes(),
      {
        method: "GET",
        path: `${API}/configuration/Objectlifecycle.call_lifecycle__v`,
        body: {
          responseStatus: "SUCCESS",
          data: {
            name: "call_lifecycle__v",
            label: "Call",
            states: [
              {
                name: "planned_state__v",
                label: "Planned",
                initial_state: true,
              },
              { name: "submitted_state__v", label: "Submitted" },
            ],
          },
        },
      },
    ]);
    await t.client.authenticate();
    expect(await t.client.lifecycleStates("call_lifecycle__v")).toEqual({
      name: "call_lifecycle__v",
      label: "Call",
      states: [
        { name: "planned_state__v", label: "Planned", initial: true },
        { name: "submitted_state__v", label: "Submitted" },
      ],
    });
  });

  it("limits strips the envelope; usersMetadata & userPermissions read lists", async () => {
    const t = makeTestClient([
      ...authRoutes(),
      {
        method: "GET",
        path: `${API}/limits`,
        body: {
          responseStatus: "SUCCESS",
          records_per_object: { standard: 1 },
        },
      },
      {
        method: "GET",
        path: `${API}/metadata/objects/users`,
        body: {
          responseStatus: "SUCCESS",
          properties: [{ name: "user_name__v" }],
        },
      },
      {
        method: "GET",
        path: `${API}/objects/users/12345/permissions`,
        body: {
          responseStatus: "SUCCESS",
          data: [
            { name: "object.account__v.create", permissions: { create: true } },
          ],
        },
      },
    ]);
    await t.client.authenticate();
    expect(await t.client.limits!()).toEqual({
      records_per_object: { standard: 1 },
    });
    expect(await t.client.usersMetadata()).toEqual([{ name: "user_name__v" }]);
    expect(
      await t.client.userPermissions(12345, "object.account__v.create"),
    ).toHaveLength(1);
    expect(t.fetch.calls.at(-1)?.search.get("filter")).toBe(
      "object.account__v.create",
    );
  });
});
