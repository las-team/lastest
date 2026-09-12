/**
 * `em_event_team_member` — `EM_Event_Team_Member_vod__c` →
 * `em_event_team_member__v` `[OBS]` (spec §6.3.25, §6.1 step 12, §6.2,
 * §3.3, §3.5, §4.4).
 *
 * Transfer-of-value family child of `em_event`: scoped through the parent's
 * `Start_Time_vod__c` (`via-parent`, widened by `scope.tovRetentionMonths`),
 * attributed to the parent's country (`parent:em_event`), `noTriggers = true`.
 * Pure child row: `deletePolicy = delete` (§4.4).
 *
 * `team_member__v ← refUser(Team_Member_vod__c)` is required (unmapped users
 * follow `objects.em_event_team_member.unmappedUserPolicy`, §3.5) and the
 * SFDC user id is carried as text in `user_id__v`. `Role_vod__c` is a
 * country-configurable picklist. `Name` is loaded as text (`name__v`, Y).
 */
import { defineObject } from "../types";

export const em_event_team_member = defineObject({
  key: "em_event_team_member",
  source: "EM_Event_Team_Member_vod__c",
  target: "em_event_team_member__v",
  targetEvidence: "OBS",
  scope: {
    kind: "via-parent",
    parentKey: "em_event",
    parentField: "Event_vod__r.Start_Time_vod__c",
    type: "datetime",
    retentionFamily: "tov",
  },
  countryOf: "parent:em_event:Event_vod__c",
  dependsOn: ["em_event", "user"],
  fields: [
    {
      source: "Event_vod__c",
      target: "event__v",
      transform: "ref(em_event)",
      required: "Y",
      evidence: "OBS",
      sourceType: "reference",
    },
    {
      source: "Team_Member_vod__c",
      target: "team_member__v",
      transform: "refUser",
      required: "Y",
      evidence: "OBS",
      sourceType: "reference",
      notes:
        "business user lookup: unmapped users → objects.em_event_team_member.unmappedUserPolicy (§3.5)",
    },
    {
      source: "Team_Member_vod__c",
      target: "user_id__v",
      transform: "copy",
      required: "n",
      evidence: "OBS",
      notes: "SFDC user id as text",
    },
    {
      source: "Role_vod__c",
      target: "role__v",
      transform: "picklist(em_event_team_member.role)",
      required: "n",
      evidence: "OBS",
      countryConfigurable: true,
      sourceType: "picklist",
    },
    {
      source: "Name",
      target: "name__v",
      transform: "text(128)",
      required: "Y",
      evidence: "OBS",
      disabledBy: "preserveName",
    },
  ],
  // No documented value list: derivation rule by default; overlays add entries.
  picklists: { "em_event_team_member.role": {} },
  deletePolicy: "delete",
  inactivate: [],
  createPolicy: "create",
  load: { noTriggers: true },
  match: [
    { method: "legacy_id" },
    {
      method: "external_id",
      keys: [{ target: "external_id__v", source: "External_ID_vod__c" }],
      evidence: "OBS",
    },
    {
      method: "mobile_id",
      keys: [{ target: "mobile_id__v", source: "Mobile_ID_vod__c" }],
    },
    {
      method: "natural_key",
      keys: [
        { target: "event__v", source: "Event_vod__c" },
        { target: "team_member__v", source: "Team_Member_vod__c" },
      ],
      notes: "(event__v, user) pair (§3.3), warning-level",
    },
  ],
  notes:
    "ToV family child of em_event (§6.3.25): via-parent scope on Event_vod__r.Start_Time_vod__c, parent's country, noTriggers; pure child row deleted with the source (§4.4 deletePolicy = delete).",
});
