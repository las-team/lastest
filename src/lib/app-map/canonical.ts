/**
 * Re-export shim. The definition moved to `@lastest/url-canonical` — it is
 * dependency-free logic that App Map and qa-agent both need, and once both are
 * plugins neither may import the other (RFC §4.3: promote the shared part
 * rather than reach across).
 *
 * `flows.ts` still imports from here; qa-agent now goes straight to the lib.
 * (The previous header here claimed `build-map.ts` re-exported this — it does
 * not, and had not for some time.)
 */
export { canonicalPath } from "@lastest/url-canonical";
