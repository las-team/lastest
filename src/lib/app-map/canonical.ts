/**
 * Re-export shim. The definition moved to `@lastest/url-canonical` — it is
 * dependency-free logic that App Map and qa-agent both need, and once both are
 * plugins neither may import the other (RFC §4.3: promote the shared part
 * rather than reach across).
 *
 * `build-map.ts` re-exports `canonicalPath` from here and `flows.ts` imports
 * it, so server callers are unchanged; qa-agent now goes straight to the lib.
 */
export { canonicalPath } from "@lastest/url-canonical";
