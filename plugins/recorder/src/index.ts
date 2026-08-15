import { definePlugin } from "@lastest/kernel";

/**
 * `@lastest/plugin-recorder` — the browser recording experience: the /record
 * flow and the test debug "record from here" view. RFC §9 phase 4, the
 * eleventh plugin and the second out of the §6.2 `src/lib/playwright` split
 * (after `ranger`).
 *
 * No `capabilities`/`schema`/`deletion`: recorder owns no table (a completed
 * recording becomes a row in the core `tests` table — the `api-test` shape,
 * `core-scope.md` §6) and holds its live session state in the runner
 * channel's in-memory map plus the core `remote_recording_events` table,
 * both reached through `RecorderHost` (see `host.ts`, the file to read
 * first). It needs no browser/AI/data capability either: recording is
 * runner-driven over the WS command channel, not a server-held Playwright
 * `Page`, so `ctx.browser.withBrowser` does not fit — see `host.ts` for why
 * that is the honest phase-5 backlog item this migration adds rather than a
 * gap it papered over.
 *
 * ### Two libs came out of this migration, not one
 *
 * `src/lib/playwright/event-to-code.ts` and `debug-parser.ts` lived next to
 * this feature's other files but were never actually the recorder's own
 * code — `event-to-code.ts` is imported by core's `assertion-parser.ts`,
 * `debug-parser.ts` by core's `execution/executor.ts`, and both by five more
 * app-level consumers outside the record/debug flow. Both are pure
 * (zero imports of their own), so the mechanical test in
 * `docs/architecture/plugin-migration-recipe.md` §5 sends them to
 * `libs/recording-codegen` rather than into this package. See
 * `docs/architecture/recorder-migration-result.md` for the full survey,
 * including one confirmed-dead file (`debug-recorder.ts`, deleted rather
 * than migrated) and two shadcn primitives (`tooltip`, `dropdown-menu`)
 * promoted to `@lastest/ui` alongside it.
 */
export const recorderPlugin = definePlugin({
  id: "recorder",
  title: "Recorder",
});

export default recorderPlugin;

export type {
  RecorderHost,
  RecordingEvent,
  RecordingEventUpdate,
  RecordingSession,
  PlaywrightRecordingSettings,
  SetupChainStep,
  ResolvedSetupStep,
  FunctionalAreaRef,
  SaveRecordedTestInput,
  UpdateRerecordedTestInput,
  GuardedFetchOptions,
  GuardedFetchResult,
} from "./host";
export { configureRecorder, isRecorderConfigured } from "./wiring";
export type {
  SelectorType,
  SelectorConfig,
  AssertionType,
  WaitType,
  WaitSelectorCondition,
  WaitParams,
} from "./types";
export { DEFAULT_SELECTOR_PRIORITY } from "./types";
