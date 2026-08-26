/**
 * Re-export shim. The implementation moved to `libs/analytics` so plugins can
 * use it without a cross-plugin import — the scheduling plugin's UI is the
 * first plugin consumer, and event tracking is shared pure logic, which
 * `docs/architecture/core-scope.md` §3 says is a library, not a feature.
 */
export { track, identify } from "@lastest/analytics";
