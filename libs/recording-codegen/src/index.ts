/**
 * Both modules here have zero imports of their own — the mechanical test in
 * `docs/architecture/plugin-migration-recipe.md` §5 ("nothing, or only other
 * libs/* → library. Promote."). Neither was actually the `recorder`
 * pseudo-plugin's own code, despite living under `src/lib/playwright/` next
 * to it: `event-to-code.ts` is imported by core's
 * `src/lib/playwright/assertion-parser.ts` and by
 * `src/lib/execution/full-build-pipeline.integration.test.ts`, and
 * `debug-parser.ts` is imported by core's `src/lib/execution/executor.ts`
 * and by five app-level consumers outside the record/debug flow
 * (`test-detail-client.tsx`, `test-vars-tab.tsx`, `success-criteria-tab.tsx`,
 * `playback-timeline.tsx`, `src/server/actions/tests.ts`). Reclassifying them
 * as core (recipe §1.6) would have worked too, but a lib needs no CODEOWNERS
 * entry and is importable by core and the `recorder` plugin alike with no
 * review gate — the right destination for logic that guards nothing.
 *
 * See `docs/architecture/recorder-migration-result.md` for the full survey.
 */
export { eventsToCodeLines, type CodeGenEvent } from "./event-to-code";
export {
  parseSteps,
  extractTestBody,
  extractSelectorArray,
  extractEditableValue,
  removeInlineLocateWithFallback,
  removeInlineReplayCursorPath,
  instrumentStepTracking,
  spliceRecordedSteps,
  type DebugStep,
} from "./debug-parser";
