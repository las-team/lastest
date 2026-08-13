import { definePlugin } from "@lastest/kernel";

/**
 * `@lastest/plugin-api-test` — headless API tests (E1). One HTTP request plus
 * response assertions, executed without a browser, seeded from a captured
 * network request or authored by AI. Results flow through the same
 * test_results / step_comparisons / evidence pipeline as browser tests, under
 * the `api` check layer. The fourth feature migrated in RFC §9 phase 4.
 *
 * ### One capability, no schema, no nav
 *
 * An API test is a row in `tests` with `testType: "api"` and an
 * `apiDefinition` jsonb — a *core* table. So this plugin owns no storage,
 * declares no `schema`, and therefore needs no `deletion` hook
 * (`resolveRegistry` requires one only when the other is declared): deleting a
 * team already cascades its tests. It also owns no page. Its UI is a dialog
 * mounted by three app surfaces (test detail, verify focus view, diff viewer),
 * which is why `ui` is absent rather than empty.
 *
 * That makes it the first migrated feature whose data lives *entirely* in core
 * tables. `core-scope.md` §6 is unambiguous about what that costs — a plugin
 * does not reach a core table, it calls a core function — and the two writes
 * it needs are the two host methods that carry the authorization. See
 * `host.ts`; it is the file to read first.
 *
 * The single declared capability is `ai`, for `ctx.ai.generate()` in the
 * definition generator. Provider keys and spend attribution stay in core.
 */
export const apiTestPlugin = definePlugin({
  id: "api-test",
  title: "API Tests",

  capabilities: ["ai"],
});

export default apiTestPlugin;

export { apiResultToEvidence } from "./evidence";
export type { ApiEvidenceItem } from "./evidence";
export { networkRequestToApiTest } from "./from-network";
export type { ApiTestSeed, CapturedRequest } from "./from-network";
export { generateApiTest } from "./generator";
export type {
  GenerateApiTestInput,
  GenerateApiTestResult,
  GeneratorAi,
} from "./generator";
export {
  REDACTED,
  redactApiDefinition,
  redactSensitiveText,
  renderApiDefinitionForCode,
} from "./redact";
export {
  DEFAULT_API_TEST_TIMEOUT_MS,
  evaluateApiAssertions,
  resolveApiUrl,
  runApiTest,
  valueMatches,
} from "./runner";
export type { RunApiTestContext } from "./runner";
export type {
  ApiTestHost,
  ApiTestRef,
  CreateApiTestInput,
  GuardedRequest,
  GuardedResponse,
  UpdateApiTestInput,
} from "./host";
export type {
  ApiAssertionResult,
  ApiResponseSnapshot,
  ApiTestResult,
} from "./types";
export {
  configureApiTest,
  isApiTestConfigured,
  type ApiTestWiring,
} from "./wiring";
