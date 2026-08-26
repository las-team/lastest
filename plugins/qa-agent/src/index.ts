import { definePlugin } from "@lastest/kernel";

import { createDeletionHook } from "./deletion";

/**
 * `@lastest/plugin-qa-agent` — the flagship agent: a nine-phase orchestrated
 * pipeline (preflight, login resolution, discovery crawl, planning, a human
 * review gate, generation, execution, healing, summary) plus a direction
 * queue (`qa_agent_tasks`) and per-repo automation triggers
 * (`qa_agent_triggers`).
 *
 * The last `PSEUDO_PLUGINS` feature to migrate, deliberately — it touches
 * more of the product than anything before it. The domain layer (crawl,
 * explorer swarm, login probes, planning, triage, PR/code checks, docs
 * ingestion) migrated first in the browser pass; this manifest, the actions,
 * the UI and the two tables complete it. See
 * `docs/architecture/qa-agent-migration-result.md`.
 *
 * ### Three capabilities
 *
 * - **`browser`** — every EB the pipeline holds (login probes, the discovery
 *   crawl, the explore swarm) is a `ctx.browser.withBrowser(...)` /
 *   `withBrowserSwarm(...)` scope. The plugin never sees a CDP endpoint or a
 *   pod address; storage states are injected by id at claim time.
 * - **`ai`** — the three JSON calls the pipeline makes itself (auth-context
 *   extraction, the planner/journey refiner, task triage) go through
 *   `ctx.ai.generate(...)` under their pre-migration `qa_*` action types
 *   (added to `ai-capability.ts`'s `ACTION_TYPES` — recipe §7's silent row).
 *   Generation and healing do NOT: they run inside
 *   `@lastest/plugin-authoring-ai`'s agents, reached through
 *   `QaAgentHost.withAuthoringSession` (a plugin may not import a plugin).
 * - **`data`** — the two tables below, via the `qa_agent_`-prefixed handle.
 *
 * ### What is deliberately NOT declared
 *
 * - **`tests` / `repos`** — checked method-by-method and neither fits.
 *   `ctx.tests.createQuarantined` cannot express an un-quarantined write
 *   with code, overrides, an `apiDefinition` and bot attribution (the same
 *   finding as `api-test`/`quickstart`), and `listCoverage` returns no test
 *   ids, which the coverage matcher keys on. `ctx.repos.baseUrl` answers a
 *   question this plugin never asks — it needs provider/owner/branches for
 *   GitHub-aware discovery. Both stay host methods; see `host.ts`.
 * - **`events`** — the same finding as `quickstart` (`index.ts` there): the
 *   activity feed keys its agent badges on `sourceType: "qa_agent"` plus a
 *   per-event `agentType` (orchestrator/scout/planner/generator/healer), and
 *   `plugins/events`' `emit()` hard-codes `sourceType: pluginId`,
 *   `agentType: null`. `QaAgentHost.emitActivity` preserves the exact
 *   pre-migration event shape instead.
 *
 * ### Sessions stay in core's `agent_sessions` (`kind: "qa"`)
 *
 * The `quickstart` precedent, now applied from the other side: QA runs write
 * `quickstartEmail`/`quickstartPassword` (and `qaAuthContext`) into session
 * metadata, and core's query layer encrypts those at rest *by field name,
 * across the whole table, regardless of `kind`* (`crypto-fields.ts`, rotated
 * by `scripts/rotate-encryption-key.ts`). Splitting onto a `qa_agent_sessions`
 * table would mean forking that encryption path or shipping the split with
 * this plugin's copy unencrypted. Session CRUD goes through `QaAgentHost`
 * instead — see `host.ts` item 1.
 */
export const qaAgentPlugin = definePlugin({
  id: "qa-agent",
  title: "QA Agent",

  capabilities: ["browser", "ai", "data"],

  // Loaded once at boot by `core/data`, which validates the `qa_agent_` prefix
  // on every table before binding a handle to it.
  schema: () => import("./schema"),

  // Required whenever `schema` is present — `resolveRegistry` refuses to boot
  // without it. See `deletion.ts`.
  deletion: createDeletionHook(),
});

export default qaAgentPlugin;

export type { QaAgentHost } from "./host";
export type {
  QaAgentRole,
  QaSessionMetadata,
  QaSessionRow,
  QaSessionStatus,
  QaSetupOverrides,
  QaStepId,
  QaStepState,
  QaStepStatus,
  QaSubstep,
  QaTaskSource,
  QaTaskStatus,
  QaTaskTestRef,
} from "./types";
export type { QaAgentTask, QaAgentTriggerRow } from "./schema";
export {
  configureQaAgent,
  isQaAgentConfigured,
  type QaAgentWiring,
} from "./wiring";
