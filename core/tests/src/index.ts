/**
 * `@lastest/core-tests` — the `tests` capability.
 *
 * Core under `docs/architecture/core-scope.md` §6: `tests` is the
 * second-most-referenced table in the schema (24 inbound FKs, §7) and a
 * tenancy anchor, so a plugin reaches it through a function, never `ctx.data`.
 */
import type { TeamRef } from "@lastest/contracts";

import { createTestsCapability } from "./tests";
import type { TestsHost } from "./host";

export { createTestsCapability } from "./tests";
export type {
  AreaPlanRow,
  NewQuarantinedTest,
  TestCoverageRow,
  TestsHost,
} from "./host";
export {
  MAX_AREA_NAME_LENGTH,
  MAX_TARGET_URL_LENGTH,
  MAX_TEST_CODE_LENGTH,
  MAX_TEST_NAME_LENGTH,
} from "./limits";

export interface TestsScope {
  readonly team: TeamRef;
}

export interface TestsFactoryOptions {
  readonly host: TestsHost;
}

/** Mirrors `createBrowserFactory`'s shape — see `core/repos` for the twin. */
export function createTestsFactory(opts: TestsFactoryOptions) {
  return (_pluginId: string, scope: TestsScope) =>
    createTestsCapability(opts.host, scope.team);
}
