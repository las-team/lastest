/**
 * `@lastest/ai-kit` — prompt/response plumbing.
 *
 * `docs/architecture/core-scope.md` §4 splits the RFC's `core/ai` in two.
 * Credential custody and spend metering are core (`ctx.ai`). Everything else
 * people associate with an "AI layer" — response parsing, retry-on-malformed-
 * JSON, prompt templating — holds no secret and gates no spend, so it belongs
 * here, where changing it does not require a core review.
 */
export { parseAiJson, type ParseAiJsonOptions } from "./json-parse";
