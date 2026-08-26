import type {
  QuarantinedTestInput,
  TestRef,
  TestsCapability,
  TeamRef,
} from "@lastest/contracts";

import {
  MAX_AREA_NAME_LENGTH,
  MAX_TARGET_URL_LENGTH,
  MAX_TEST_CODE_LENGTH,
  MAX_TEST_NAME_LENGTH,
} from "./limits";
import type { TestsHost } from "./host";

function requireInRange(value: string, max: number, field: string): void {
  if (value.length === 0 || value.length > max) {
    throw new Error(
      `"${field}" must be 1-${max} characters (got ${value.length})`,
    );
  }
}

/**
 * Build the `tests` capability, scoped to the calling plugin's team.
 *
 * What a hostile plugin can still do through this API, stated plainly rather
 * than overclaimed: it can create an unbounded *number* of quarantined tests
 * for a repo it legitimately owns — there is no rate limit here, because
 * request-rate is a capacity concern for the platform generally, not
 * something a data capability should reimplement per caller. It can also
 * choose an area name freely, so a repo could accumulate many
 * near-duplicate areas; core resolves by exact name match and does not
 * dedupe fuzzily. Neither of those crosses a tenancy line, which is the one
 * thing this capability exists to hold.
 */
export function createTestsCapability(
  host: TestsHost,
  team: TeamRef,
): TestsCapability {
  async function assertOwned(repositoryId: string): Promise<void> {
    const ownerTeamId = await host.repoTeamId(repositoryId);
    if (ownerTeamId !== team.id) {
      throw new Error(`Repository "${repositoryId}" is not in this team`);
    }
  }

  return {
    async listCoverage(repositoryId) {
      // Resolves empty rather than checking tenancy the same way
      // `createQuarantined` does: a distinguishable rejection here would be an
      // existence oracle for repository ids, the same argument
      // `ReposCapability.baseUrl` makes for resolving `null`.
      const ownerTeamId = await host.repoTeamId(repositoryId);
      if (ownerTeamId !== team.id) return { tests: [], areaPlans: [] };
      return host.listCoverage(repositoryId);
    },

    async createQuarantined(input: QuarantinedTestInput): Promise<TestRef> {
      await assertOwned(input.repositoryId);
      requireInRange(input.name, MAX_TEST_NAME_LENGTH, "name");
      requireInRange(input.areaName, MAX_AREA_NAME_LENGTH, "areaName");
      requireInRange(input.targetUrl, MAX_TARGET_URL_LENGTH, "targetUrl");
      requireInRange(input.code, MAX_TEST_CODE_LENGTH, "code");

      const area = await host.resolveOrCreateArea(
        input.repositoryId,
        input.areaName,
      );

      return host.createTest({
        repositoryId: input.repositoryId,
        functionalAreaId: area.id,
        name: input.name,
        code: input.code,
        targetUrl: input.targetUrl,
      });
    },
  };
}
