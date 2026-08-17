import { definePlugin } from "@lastest/kernel";

/**
 * `@lastest/plugin-quickstart` — a one-click, nine-step agent: scout a
 * founder's own site, capture a demo login, generate and run a walkthrough
 * test, and publish a founder-facing `/r/<slug>` outreach share.
 *
 * RFC §9 phase 4's fourteenth and last plugin, and the last of the four
 * split out of `src/lib/playwright` (§6.2) — `recorder` and `ranger` already
 * landed, `authoring-ai` was costed and stopped. QuickStart's own scout
 * module (`src/lib/playwright/quickstart-scout.ts`) hits the identical
 * blocker that stopped `authoring-ai` (handing a raw CDP endpoint to an
 * out-of-process `@playwright/mcp` binary — see `host.ts` item 5) but is
 * only 2 of QuickStart's 9 steps, so rather than stopping the whole
 * migration, that one module stays behind, unmigrated, reached through a
 * host port method instead of an import.
 *
 * ### No schema, no `data` capability
 *
 * QuickStart persists into two **core** tables — `agent_sessions` (kind
 * `"quickstart"`) and `build_demo_notes` — and owns neither. Unlike
 * `explorer`/`ranger`, it deliberately does **not** get its own session
 * table: two of its metadata fields are shared, by core's own design, with
 * the still-unmigrated `qa-agent` pseudo-plugin's rows in the same table
 * (same encryption path). See `host.ts` item 2 for the full reasoning.
 *
 * ### No real capabilities at all — and that is a finding, not a gap
 *
 * `ctx.events.emit()` was tried first and reverted: the pre-migration code
 * emitted every step event with `sourceType: "play_agent"` and
 * `agentType: "quickstart"`, which is what makes `PwAgentType`-keyed UI
 * (`play-agent-timeline.tsx`'s badge map) render the pink "QuickStart" chip.
 * `plugins/events/src/host.ts`'s generic `emit(type, payload)` hard-codes
 * `sourceType: pluginId` and `agentType: null` — correct for a plugin's own,
 * independent activity stream, wrong for QuickStart, which shares the
 * `play_agent` stream with three other still-unmigrated agents (`play`,
 * `ranger`'s pre-migration form, `qa`) and must keep tagging itself as one of
 * them to render correctly. RFC §2 ("behaviour is held constant") wins here:
 * `QuickstartHost.emitActivity` preserves the exact original call shape
 * instead. `ctx.repo`/`ctx.team` still arrive through `contextFor()` for
 * authorization even with an empty capability set — see `actions.ts`.
 *
 * Everything QuickStart needs from core — repo/team reads, session and test
 * CRUD, storage-state capture, build orchestration, notes, sharing, activity
 * emission — has no capability shape yet and goes through `QuickstartHost`
 * instead. See `host.ts`'s header before concluding this plugin's core
 * surface is small; it is exactly as large as a nine-step, full-pipeline
 * orchestrator that touches nearly every other subsystem on purpose.
 */
export const quickstartPlugin = definePlugin({
  id: "quickstart",
  title: "QuickStart",

  capabilities: [],
});

export default quickstartPlugin;

export type { QuickstartHost } from "./host";
export type {
  QuickstartAuthedScout,
  QuickstartAuthSetupMeta,
  QuickstartDemoNoteItem,
  QuickstartDemoNotes,
  QuickstartDemoNoteSkippedRoute,
  QuickstartPublicScout,
  QuickstartSessionMetadata,
  QuickstartSessionRow,
  QuickstartSessionStatus,
  QuickstartStepId,
  QuickstartStepState,
  QuickstartStepStatus,
} from "./types";
export {
  configureQuickstart,
  isQuickstartConfigured,
  type QuickstartWiring,
} from "./wiring";
