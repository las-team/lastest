/**
 * Barrel re-export for all query modules.
 *
 * This file was the original monolithic queries file (~4300 lines).
 * It has been split into domain-focused modules under ./queries/.
 * All exports are re-exported here for backward compatibility.
 */

export * from "./queries/tests";
export * from "./queries/builds";
export * from "./queries/visual-diffs";
export * from "./queries/repositories";
export * from "./queries/settings";
export * from "./queries/routes";
export * from "./queries/areas";
export * from "./queries/background-jobs";
export * from "./queries/plugin-jobs";
export * from "./queries/auth";
export * from "./queries/setup";
export * from "./queries/credentials";
export * from "./queries/runners";
export * from "./queries/integrations";
export * from "./queries/misc";
export * from "./queries/analytics";
export * from "./queries/fixtures";
export * from "./queries/storage-states";
// build_schedules moved to plugins/scheduling/src/data/queries.ts (RFC §9
// phase 4) — import from @lastest/plugin-scheduling instead.
export * from "./queries/activity-events";
export * from "./queries/storage";
// public-shares moved to plugins/share/src/data/queries.ts (RFC §9 phase 4) —
// import from @lastest/plugin-share instead.
export * from "./queries/step-comparisons";
export * from "./queries/inspector";
export * from "./queries/change-maps";
export * from "./queries/triage";
export * from "./queries/demo-notes";
export * from "./queries/app-fixes";
export * from "./queries/layer-baselines";
export * from "./queries/layer-feedback";
export * from "./queries/awards";
export * from "./queries/billing";
// qa_tasks/qa_agent_triggers moved to plugins/qa-agent/src/data/ (RFC §9
// phase 4) — server components and routes read them through
// @lastest/plugin-qa-agent/reads, actions through the plugin's own handle.
export * from "./queries/agents-fleet";
export * from "./queries/coverage";
