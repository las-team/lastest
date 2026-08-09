/**
 * `@lastest/page-map` — rendered-DOM observation.
 *
 * A library, not core (`docs/architecture/core-scope.md` §3): several features
 * need it, and *useful to many* is the definition of a library, explicitly not
 * a reason to be gate-kept. It holds no credential, meters no spend, and cannot
 * exhaust a shared resource — it only reads a page someone else opened.
 *
 * It also does not open one. There is no browser lifecycle here and no page
 * type: see `scripts.ts` for why that is load-bearing rather than incidental.
 */
export { condensePageMap, describeSnapshot } from "./condense";

export {
  headingsScript,
  interactableSnapshotScript,
  pageMapScript,
  type ExtractedPageMap,
  type ExtractedSnapshot,
} from "./scripts";

export type {
  InteractableSnapshot,
  PageMap,
  PageMapForm,
  PageMapHeading,
  PageMapInput,
  PageMapLink,
} from "./types";
