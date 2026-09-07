/**
 * Test doubles for `vault/`: a recording fake `fetch` and a small synthetic
 * `OrgSnapshot`. Not part of the public API.
 */
import type {
  FieldConfig,
  ObjectConfig,
  OrgSnapshot,
  ProfileConfig,
} from "../model/types";

export interface FakeRequest {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

export interface FakeReply {
  status?: number;
  json?: unknown;
  text?: string;
  headers?: Record<string, string>;
}

export interface Route {
  method?: string;
  /** Substring of the full URL, or a RegExp against it. */
  match: string | RegExp;
  reply: (req: FakeRequest, callIndex: number) => FakeReply;
}

export interface FakeFetch {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  calls: FakeRequest[];
  callsTo(fragment: string): FakeRequest[];
}

function toRequest(url: string, init?: RequestInit): FakeRequest {
  const headers: Record<string, string> = {};
  const raw = init?.headers;
  if (raw) {
    if (raw instanceof Headers)
      raw.forEach((v, k) => (headers[k.toLowerCase()] = v));
    else if (Array.isArray(raw))
      for (const [k, v] of raw) headers[k.toLowerCase()] = v;
    else
      for (const [k, v] of Object.entries(raw))
        headers[k.toLowerCase()] = String(v);
  }
  return {
    url: new URL(url),
    method: (init?.method ?? "GET").toUpperCase(),
    headers,
    body: typeof init?.body === "string" ? init.body : null,
  };
}

export function fakeFetch(routes: Route[]): FakeFetch {
  const calls: FakeRequest[] = [];
  const perRoute = new Map<Route, number>();
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const req = toRequest(url, init);
    calls.push(req);
    const route = routes.find(
      (r) =>
        (!r.method || r.method.toUpperCase() === req.method) &&
        (typeof r.match === "string"
          ? req.url.href.includes(r.match)
          : r.match.test(req.url.href)),
    );
    if (!route) {
      return new Response(
        JSON.stringify({
          responseStatus: "FAILURE",
          errors: [
            {
              type: "NO_ROUTE",
              message: `no fake route for ${req.method} ${req.url.href}`,
            },
          ],
        }),
        { status: 404, headers: { "content-type": "application/json" } },
      );
    }
    const idx = perRoute.get(route) ?? 0;
    perRoute.set(route, idx + 1);
    const reply = route.reply(req, idx);
    const headers: Record<string, string> = { ...reply.headers };
    let body: string | null = null;
    if (reply.json !== undefined) {
      body = JSON.stringify(reply.json);
      headers["content-type"] ??= "application/json";
    } else if (reply.text !== undefined) body = reply.text;
    return new Response(body, { status: reply.status ?? 200, headers });
  };
  return {
    fetch,
    calls,
    callsTo: (fragment) => calls.filter((c) => c.url.href.includes(fragment)),
  };
}

export function success(extra: Record<string, unknown> = {}): FakeReply {
  return { json: { responseStatus: "SUCCESS", ...extra } };
}

export function failure(type: string, message: string): FakeReply {
  return {
    json: { responseStatus: "FAILURE", errors: [{ type, message }] },
  };
}

// ---------------------------------------------------------------------------
// snapshot fixture
// ---------------------------------------------------------------------------

export function field(
  apiName: string,
  type: string,
  extra: Partial<FieldConfig> = {},
): FieldConfig {
  const custom = /__c$/.test(apiName);
  const managed = /_vod__c$/.test(apiName);
  return {
    apiName,
    label: apiName.replace(/(_vod)?__c$/, "").replace(/_/g, " "),
    type,
    custom,
    managed,
    required: false,
    ...extra,
  };
}

export function object(
  apiName: string,
  fields: FieldConfig[],
  extra: Partial<ObjectConfig> = {},
): ObjectConfig {
  const managed = /_vod__c$/.test(apiName);
  return {
    apiName,
    label: apiName.replace(/(_vod)?__c$/, "").replace(/_/g, " "),
    labelPlural: apiName.replace(/(_vod)?__c$/, "").replace(/_/g, " ") + "s",
    custom: /__c$/.test(apiName),
    managed,
    fields: [
      field("Name", "string", { custom: false, managed: false }),
      ...fields,
    ],
    recordTypes: [],
    layouts: [],
    validationRules: [],
    ...extra,
  };
}

export function profile(
  name: string,
  users: Record<string, number>,
  extra: Partial<ProfileConfig> = {},
): ProfileConfig {
  return {
    id: `00e${name.replace(/\W/g, "")}`,
    name,
    userLicense: "Salesforce",
    custom: true,
    objectPermissions: [
      {
        object: "Call2_vod__c",
        create: true,
        read: true,
        edit: true,
        delete: false,
        viewAll: false,
        modifyAll: false,
      },
      {
        object: "Account",
        create: false,
        read: true,
        edit: true,
        delete: false,
        viewAll: true,
        modifyAll: false,
      },
      {
        object: "Speaker_Engagement__c",
        create: true,
        read: true,
        edit: true,
        delete: true,
        viewAll: false,
        modifyAll: false,
      },
    ],
    fieldPermissions: [
      {
        object: "Call2_vod__c",
        field: "Visit_Purpose__c",
        readable: true,
        editable: true,
      },
      {
        object: "Account",
        field: "Pharmacy_Id__c",
        readable: true,
        editable: false,
      },
    ],
    recordTypeVisibilities: [],
    tabVisibilities: [
      { tab: "Call2_vod__c", visibility: "DefaultOn" },
      { tab: "standard-Account", visibility: "DefaultOn" },
      { tab: "standard-Lead", visibility: "Hidden" },
    ],
    applicationVisibilities: [],
    layoutAssignments: [
      {
        object: "Call2_vod__c",
        recordType: null,
        layout: `Call2_vod__c-Call Layout ${name.split(" ")[0]}`,
      },
      {
        object: "Speaker_Engagement__c",
        recordType: "Hospital",
        layout: "Speaker_Engagement__c-Speaker Engagement Layout",
      },
    ],
    activeUsersByCountry: users,
    permissionSetNames: [],
    ...extra,
  };
}

/** A synthetic Veeva CRM org: 2 countries, 4 profiles, 4 objects, 1 custom object. */
export function fixtureSnapshot(extra: Partial<OrgSnapshot> = {}): OrgSnapshot {
  const callLayout = (suffix: string) => ({
    fullName: `Call2_vod__c-Call Layout ${suffix}`,
    object: "Call2_vod__c",
    recordTypes: [],
    sections: [
      {
        heading: "Information",
        columns: 2,
        fields: ["Account_vod__c", "Call_Date_vod__c", "Visit_Purpose__c"],
        items: [
          { field: "Account_vod__c", behavior: "Required" as const },
          { field: "Call_Date_vod__c", behavior: "Edit" as const },
          { field: "Visit_Purpose__c", behavior: "Readonly" as const },
        ],
      },
    ],
    relatedLists: ["Call2_Detail_vod__c"],
    managed: false,
  });
  return {
    schemaVersion: 1,
    extractedAt: "2026-09-07T00:00:00Z",
    instanceUrl: "https://example.my.salesforce.com",
    apiVersion: "v64.0",
    countries: [
      { code: "DE", name: "Germany", activeUsers: 10 },
      { code: "FR", name: "France", activeUsers: 5 },
    ],
    profiles: [
      profile("DE Sales Rep", { DE: 8 }),
      profile("FR Sales Rep", { FR: 3 }),
      profile("MSL", { DE: 1, FR: 1 }),
      profile("DE Legacy Rep", {}),
    ],
    permissionSets: [],
    objects: [
      object(
        "Call2_vod__c",
        [
          field("Account_vod__c", "reference", { referenceTo: ["Account"] }),
          field("Call_Date_vod__c", "date"),
          field("Call_Type_vod__c", "picklist", {
            picklistValues: [
              {
                value: "Detail_vod",
                label: "Detail",
                active: true,
                default: false,
              },
              {
                value: "Lunch and Learn",
                label: "Lunch and Learn",
                active: true,
                default: false,
              },
            ],
          }),
          field("Visit_Purpose__c", "picklist", {
            picklistValues: [
              {
                value: "Follow-up",
                label: "Follow-up",
                active: true,
                default: false,
              },
              { value: "New", label: "New", active: true, default: true },
            ],
          }),
          field("Legacy_Score__c", "double", {
            formula: "Attendees_vod__c * 2",
            precision: 18,
            scale: 2,
          }),
          field("Geo__c", "location"),
        ],
        {
          recordTypes: [
            {
              id: "012A",
              developerName: "Detail_vod",
              name: "Detail",
              active: true,
            },
            {
              id: "012B",
              developerName: "Hospital_Visit",
              name: "Hospital Visit",
              active: true,
            },
            {
              id: "012C",
              developerName: "Old_Type",
              name: "Old",
              active: false,
            },
          ],
          layouts: [callLayout("DE"), callLayout("FR"), callLayout("MSL")],
          validationRules: [
            {
              object: "Call2_vod__c",
              name: "Require_Purpose",
              active: true,
              errorConditionFormula: "ISBLANK(Visit_Purpose__c)",
              errorMessage: "Purpose required",
            },
            { object: "Call2_vod__c", name: "Sample_vod", active: true },
          ],
        },
      ),
      object("Account", [
        field("Pharmacy_Id__c", "string", { length: 40 }),
        field("Specialty_1_vod__c", "picklist", {
          picklistValues: [
            {
              value: "Cardiology_vod",
              label: "Cardiology",
              active: true,
              default: false,
            },
          ],
        }),
      ]),
      object(
        "Speaker_Engagement__c",
        [
          field("Account__c", "reference", {
            referenceTo: ["Account"],
            required: true,
          }),
          field("Status__c", "picklist", {
            picklistValues: [
              {
                value: "Planned",
                label: "Planned",
                active: true,
                default: true,
              },
              { value: "Done", label: "Done", active: true, default: false },
            ],
          }),
          field("Fee__c", "currency", { precision: 10, scale: 2 }),
          field("Parent__c", "reference", {
            referenceTo: ["Speaker_Engagement__c"],
          }),
        ],
        {
          recordTypes: [
            {
              id: "012D",
              developerName: "Hospital",
              name: "Hospital",
              active: true,
            },
          ],
          layouts: [
            {
              fullName: "Speaker_Engagement__c-Speaker Engagement Layout",
              object: "Speaker_Engagement__c",
              recordTypes: ["Hospital"],
              sections: [],
              relatedLists: [],
            },
          ],
        },
      ),
      object("Lead", [field("Source_Channel__c", "string")], {
        custom: false,
        managed: false,
      }),
    ],
    vmocs: [
      {
        id: "a0V1",
        name: "Call2_vod__c DE iPad",
        objectApiName: "Call2_vod__c",
        profile: "DE Sales Rep",
        device: "iPad",
        active: true,
        whereClause:
          "WHERE Country_vod__c = 'DE' AND Status_vod__c = @@VOD_STATUS@@",
        extra: { Type_vod__c: "Full" },
        enhancedSync: true,
      },
      {
        id: "a0V2",
        name: "Product_vod__c All",
        objectApiName: "Product_vod__c",
        profile: null,
        device: "iPad",
        active: true,
        whereClause: null,
        extra: {},
      },
    ],
    veevaSettings: [
      {
        settingObject: "Veeva_Settings_vod__c",
        level: "org",
        ownerName: null,
        values: { ENABLE_SAMPLE_OPT_IN_vod__c: false, CALL_SUBMIT_vod__c: "1" },
      },
      {
        settingObject: "Veeva_Settings_vod__c",
        level: "profile",
        ownerName: "DE Sales Rep",
        values: { ENABLE_SAMPLE_OPT_IN_vod__c: true, Id: "a0X1" },
      },
      {
        settingObject: "Veeva_Settings_vod__c",
        level: "user",
        ownerName: "someone",
        values: { ENABLE_SAMPLE_OPT_IN_vod__c: true },
      },
    ],
    messages: [
      {
        name: "HELLO",
        category: "Common",
        language: "de",
        text: "Hallo",
        country: "DE",
        active: true,
      },
      {
        name: "HELLO",
        category: "Common",
        language: "en_US",
        text: "Hello",
        country: null,
        active: true,
      },
      {
        name: "OLD",
        category: "Common",
        language: "en_US",
        text: "Old",
        country: null,
        active: false,
      },
    ],
    warnings: [],
    automation: [
      {
        kind: "apex_trigger",
        name: "CallCountryTrigger",
        object: "Call2_vod__c",
        active: true,
        managed: false,
        countryLogic: true,
      },
      {
        kind: "flow",
        name: "Account_Sync",
        object: "Account",
        active: false,
        managed: false,
        countryLogic: false,
      },
      {
        kind: "apex_trigger",
        name: "VOD_CALL",
        object: "Call2_vod__c",
        active: true,
        managed: true,
        countryLogic: false,
      },
    ],
    ...extra,
  };
}
