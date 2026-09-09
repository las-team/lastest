/**
 * `em_event_team_member` — `EM_Event_Team_Member_vod__c` → `em_event_team_member__v` (spec §6.3.25).
 *
 * TODO(family agent "em_event"): replace this stub with the full module — field
 * mappings from §6.3.25, Block S opt-outs, objectTypes/states/picklists
 * defaults, match rules (§3.3), inactivate set (§4.4), custom functions.
 */
import { defineObject } from "../types";

export const em_event_team_member = defineObject({
  key: "em_event_team_member",
  source: "EM_Event_Team_Member_vod__c",
  target: "em_event_team_member__v",
  targetEvidence: "OBS",
  countryOf: "parent:em_event:Event_vod__c",
  dependsOn: ["em_event", "user"],
  scope: {
    kind: "via-parent",
    parentKey: "em_event",
    parentField: "Event_vod__r.Start_Time_vod__c",
    type: "datetime",
    retentionFamily: "tov",
  },
  deletePolicy: "delete",
  notes: "STUB — see docs/MIGRATION_SPEC.md §6.3.25",
});
