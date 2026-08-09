/**
 * Re-export shim. The implementation moved to `libs/ai-kit` so plugins can use
 * it without importing app code — see `docs/architecture/core-scope.md` §3.
 * App-side callers keep the old specifier.
 */
export { parseAiJson, type ParseAiJsonOptions } from "@lastest/ai-kit";
