/**
 * `multichannel_activity_line` — `Multichannel_Activity_Line_vod__c` →
 * `multichannel_activity_line__v` `[UNV]` (spec §6.3.44, §6.1 step 22, §6.2,
 * §3.3, §4.4).
 *
 * Slide-level lines of a multichannel activity (key message / presentation
 * shown, display order, duration). Master-detail child: scoped through the
 * parent's `Multichannel_Activity_vod__r.Start_DateTime_vod__c` (2y), country
 * of the parent activity, `noTriggers = true`, deleted with the parent
 * (`deletePolicy = delete`, §4.4).
 *
 * `Name` is an auto-number (§6.0.4) **and** `[UNVERIFIED-SOURCE]`: it is
 * carried only with `objects.multichannel_activity_line.preserveAutoNumberName`
 * and a describe miss is `info`. `Start_DateTime_vod__c` is
 * `[UNVERIFIED-SOURCE]` too (sfdc-extract.md §10 #3) — kept in the mapping so
 * preflight validates it and degrades safely.
 *
 * §3.3 lists `vexternal_id__v` as a secondary match key for the line as well;
 * the source column is not in the §6.3.44 table, so the row is
 * `[UNVERIFIED-SOURCE]` + optional and the match rule is `[UNV]`.
 */
import { defineObject, type ObjectModuleInput } from "../types";

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const MULTICHANNEL_ACTIVITY_LINE_PARENT_FIELD =
  "Multichannel_Activity_vod__c";
export const MULTICHANNEL_ACTIVITY_LINE_PARENT_SCOPE_PATH =
  "Multichannel_Activity_vod__r.Start_DateTime_vod__c";
export const MULTICHANNEL_ACTIVITY_LINE_VEXTERNAL_ID_FIELD =
  "VExternal_Id_vod__c";

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

export const multichannel_activity_line = defineObject({
  key: "multichannel_activity_line",
  source: "Multichannel_Activity_Line_vod__c",
  target: "multichannel_activity_line__v",
  targetEvidence: "UNV",
  scope: {
    kind: "via-parent",
    parentKey: "multichannel_activity",
    parentField: MULTICHANNEL_ACTIVITY_LINE_PARENT_SCOPE_PATH,
    type: "datetime",
  },
  countryOf: `parent:multichannel_activity:${MULTICHANNEL_ACTIVITY_LINE_PARENT_FIELD}`,
  dependsOn: ["multichannel_activity", "key_message", "clm_presentation"],
  // master-detail child: auto-number Name (also [UNVERIFIED-SOURCE]), no OwnerId
  blockS: { name: "autoNumber", ownerId: false },
  fields: [
    // --- Name: replaces the Block S auto-number row (same gate, unverified source)
    {
      source: "Name",
      target: "name__v",
      transform: "text(128)",
      required: "n",
      evidence: "UNV",
      unverifiedSource: true,
      optionalSource: true,
      enabledBy: "preserveAutoNumberName",
      notes:
        "auto-number [UNVERIFIED-SOURCE] (sfdc-extract.md §10 #3); carried verbatim only with objects.multichannel_activity_line.preserveAutoNumberName",
    },
    // --- parent (§6.3.44 row 1)
    {
      source: MULTICHANNEL_ACTIVITY_LINE_PARENT_FIELD,
      target: "multichannel_activity__v",
      transform: "ref(multichannel_activity)",
      required: "Y",
      evidence: "UNV",
      sourceType: "reference",
      notes:
        "master-detail → Multichannel_Activity_vod__c; scope and country via the parent",
    },
    // --- content references
    unv("Key_Message_vod__c", "key_message__v", "ref(key_message)", {
      sourceType: "reference",
    }),
    unv(
      "Clm_Presentation_vod__c",
      "clm_presentation__v",
      "ref(clm_presentation)",
      { sourceType: "reference" },
    ),
    // --- numbers [DOC sfdc-extract.md §7.15]
    unv("Display_Order_vod__c", "display_order__v", "number", {
      sourceType: "double",
    }),
    unv("Duration_vod__c", "duration__v", "number", {
      sourceType: "double",
    }),
    // --- [UNVERIFIED-SOURCE] datetime
    unv("Start_DateTime_vod__c", "start_datetime__v", "datetime", {
      sourceType: "datetime",
      unverifiedSource: true,
      optionalSource: true,
      notes:
        "[UNVERIFIED-SOURCE] (sfdc-extract.md §10 #3): describe miss = info, row dropped",
    }),
    // --- secondary match key (§3.3) — column not in the §6.3.44 table
    unv(
      MULTICHANNEL_ACTIVITY_LINE_VEXTERNAL_ID_FIELD,
      "vexternal_id__v",
      "copy",
      {
        sourceType: "string",
        unverifiedSource: true,
        optionalSource: true,
        notes: "secondary match key (§3.3) when the column exists",
      },
    ),
  ],
  picklists: {},
  deletePolicy: "delete",
  inactivate: [],
  createPolicy: "create",
  load: { noTriggers: true },
  match: [
    { method: "legacy_id" },
    {
      method: "external_id",
      keys: [
        {
          target: "vexternal_id__v",
          source: MULTICHANNEL_ACTIVITY_LINE_VEXTERNAL_ID_FIELD,
        },
      ],
      evidence: "UNV",
    },
    {
      method: "mobile_id",
      keys: [{ target: "mobile_id__v", source: "Mobile_ID_vod__c" }],
      evidence: "UNV",
    },
  ],
  notes:
    "Multichannel activity lines (§6.3.44): master-detail child of multichannel_activity, scoped and attributed through the parent's Start_DateTime_vod__c; Name (auto-number) and Start_DateTime_vod__c are [UNVERIFIED-SOURCE]; deleted with the parent (§4.4).",
});
