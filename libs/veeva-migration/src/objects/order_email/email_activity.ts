/**
 * `email_activity` — `Email_Activity_vod__c` → `email_activity__v` `[UNV]`
 * (spec §6.3.41, §6.1 step 20, §6.2, §3.3, §4.4).
 *
 * Child of `sent_email` (open/click/… events): scoped through the parent's
 * `Sent_Email_vod__r.Email_Sent_Date_vod__c` (2y, plus the parent's
 * open-item term), country of the parent email, `noTriggers = true`, deleted
 * with the parent (`deletePolicy = delete`, §4.4). `Name` is an auto-number
 * (§6.0.4) — carried only with `objects.email_activity.preserveAutoNumberName`.
 *
 * `URL_vod__c`, `User_Agent_vod__c` and `IP_Address_vod__c` are
 * `[UNVERIFIED-SOURCE]`: a describe miss is `info` and the row is dropped
 * silently. The IP address is PII: the row is gated by
 * `objects.email_activity.loadIpAddress` — `true` outside the EU, **`false`
 * by default in `regions.EU`** (§6.3.41, §7.4.9). An explicit `false`
 * removes the row at materialise time (`disabledBy`); when the flag is not
 * set the `custom(ipAddress)` transform applies the region default
 * (`EMAIL_ACTIVITY_IP_REGION_DEFAULTS`) from the unit's `country.region`, so
 * a DE/FR unit whose YAML does not carry the §7.3 `regions.EU` block still
 * never loads `ip_address__v` (omitted and counted `PII_IP_ADDRESS_OMITTED`,
 * value never echoed). Erased ids are skipped by `applyMapping`
 * (`privacy.erasureListPath`).
 */
import { applyTransform } from "../../transform/registry";
import type { CustomTransformFn, TransformResult } from "../../types";
import { defineObject, type ObjectModuleInput } from "../types";

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const EMAIL_ACTIVITY_PARENT_FIELD = "Sent_Email_vod__c";
export const EMAIL_ACTIVITY_IP_FIELD = "IP_Address_vod__c";
export const EMAIL_ACTIVITY_LOAD_IP_FLAG = "loadIpAddress";
/** Region defaults of `loadIpAddress` when the flag is not set (§6.3.41: `false` in `regions.EU`); any other region → `true` (§7.2.1). */
export const EMAIL_ACTIVITY_IP_REGION_DEFAULTS: Readonly<
  Record<string, boolean>
> = { EU: false };
export const PII_IP_ADDRESS_OMITTED_CODE = "PII_IP_ADDRESS_OMITTED";

// ---------------------------------------------------------------------------
// custom transforms (pure)
// ---------------------------------------------------------------------------

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

/**
 * Effective `loadIpAddress`: an explicit boolean wins; otherwise the region
 * default (`EU → false`), `true` everywhere else (§6.3.41, §7.2.1).
 */
export function loadIpAddressEffective(
  option: unknown,
  region: string | undefined,
): boolean {
  if (typeof option === "boolean") return option;
  if (region === undefined) return true;
  return EMAIL_ACTIVITY_IP_REGION_DEFAULTS[region] ?? true;
}

/**
 * `custom(ipAddress)`: `text` when `loadIpAddress` is effectively on; else
 * omitted and counted (`PII_IP_ADDRESS_OMITTED`, the value is PII and is
 * never echoed in the diagnostic).
 */
export const ipAddress: CustomTransformFn = (
  value,
  row,
  ctx,
): TransformResult | undefined => {
  if (isEmpty(value)) return undefined;
  const option = ctx.mapping.options[EMAIL_ACTIVITY_LOAD_IP_FLAG];
  if (!loadIpAddressEffective(option, ctx.country.region))
    return {
      omit: true,
      diagnostic: {
        kind: "custom",
        field: ctx.field.target,
        code: PII_IP_ADDRESS_OMITTED_CODE,
        detail: `${ctx.field.target} omitted: objects.email_activity.loadIpAddress is ${option === undefined ? `unset and defaults to false in region ${ctx.country.region}` : "false"} (§6.3.41)`,
      },
    };
  return applyTransform({ kind: "text" }, value, row, ctx);
};

/** `Event_Type_vod__c` → `event_type__v` (`[UNV]` values by the rename rule; others derive). */
export const EMAIL_ACTIVITY_EVENT_TYPE: Record<string, string> = {
  Open_vod: "open__v",
  Click_vod: "click__v",
  Delivered_vod: "delivered__v",
  Bounce_vod: "bounce__v",
  Unsubscribe_vod: "unsubscribe__v",
  Marked_Spam_vod: "marked_spam__v",
  Dropped_vod: "dropped__v",
};

// ---------------------------------------------------------------------------
// module
// ---------------------------------------------------------------------------

type RowInput = NonNullable<ObjectModuleInput["fields"]>[number];

const unv = (
  source: string,
  target: string,
  transform: string,
  extra: Partial<RowInput> = {},
): RowInput => ({
  source,
  target,
  transform,
  required: "n",
  evidence: "UNV",
  ...extra,
});

export const email_activity = defineObject({
  key: "email_activity",
  source: "Email_Activity_vod__c",
  target: "email_activity__v",
  targetEvidence: "UNV",
  scope: {
    kind: "via-parent",
    parentKey: "sent_email",
    parentField: "Sent_Email_vod__r.Email_Sent_Date_vod__c",
    type: "datetime",
  },
  countryOf: `parent:sent_email:${EMAIL_ACTIVITY_PARENT_FIELD}`,
  dependsOn: ["sent_email"],
  // master-detail child: auto-number Name, no OwnerId
  blockS: { name: "autoNumber", ownerId: false },
  fields: [
    // --- parent (§6.3.41 row 1)
    {
      source: EMAIL_ACTIVITY_PARENT_FIELD,
      target: "sent_email__v",
      transform: "ref(sent_email)",
      required: "Y",
      evidence: "UNV",
      sourceType: "reference",
      notes:
        "master-detail → Sent_Email_vod__c; scope and country via the parent",
    },
    // --- event (row 2)
    {
      source: "Event_Type_vod__c",
      target: "event_type__v",
      transform: "picklist(email_activity.eventType)",
      required: "Y",
      evidence: "UNV",
      sourceType: "picklist",
      notes: "{Open_vod, Click_vod, …}",
    },
    {
      source: "Event_Datetime_vod__c",
      target: "event_datetime__v",
      transform: "datetime",
      required: "Y",
      evidence: "UNV",
      sourceType: "datetime",
      notes: "[DOC sfdc-extract.md §7.15]",
    },
    // --- tracking details (row 3): [UNVERIFIED-SOURCE], dropped silently when absent
    unv("URL_vod__c", "url__v", "text", {
      unverifiedSource: true,
      optionalSource: true,
    }),
    unv("User_Agent_vod__c", "user_agent__v", "text", {
      unverifiedSource: true,
      optionalSource: true,
    }),
    unv(EMAIL_ACTIVITY_IP_FIELD, "ip_address__v", "custom(ipAddress)", {
      unverifiedSource: true,
      optionalSource: true,
      disabledBy: EMAIL_ACTIVITY_LOAD_IP_FLAG,
      notes:
        "PII — objects.email_activity.loadIpAddress (true outside the EU, false by default in regions.EU: custom(ipAddress) applies the region default when the flag is unset; an explicit false removes the row); erasure list respected by applyMapping",
    }),
  ],
  picklists: {
    "email_activity.eventType": { ...EMAIL_ACTIVITY_EVENT_TYPE },
  },
  deletePolicy: "delete",
  inactivate: [],
  createPolicy: "create",
  load: { noTriggers: true },
  match: [
    { method: "legacy_id" },
    {
      method: "mobile_id",
      keys: [{ target: "mobile_id__v", source: "Mobile_ID_vod__c" }],
      evidence: "UNV",
    },
  ],
  // `loadIpAddress` deliberately has no static default: unset means "region
  // default" (EU → false, else true), resolved by custom(ipAddress).
  custom: { ipAddress },
  notes:
    "Email activities (§6.3.41): child of sent_email, scoped and attributed through the parent; URL/User_Agent/IP_Address sources unverified (describe miss = info); ip_address__v gated by loadIpAddress (unset → false in regions.EU, true elsewhere); deleted with the parent (§4.4).",
});
