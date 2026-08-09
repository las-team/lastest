import "server-only";

import type { TestsHost } from "@lastest/core-tests";

import {
  createFunctionalArea,
  createTest,
  getFunctionalAreasByRepo,
  getFunctionalAreasTree,
  getRepository,
  getTestsByRepo,
} from "@/lib/db/queries";

export const appTestsHost: TestsHost = {
  async repoTeamId(repositoryId) {
    const repo = await getRepository(repositoryId).catch(() => null);
    return repo?.teamId ?? null;
  },

  async listCoverage(repositoryId) {
    const [tests, areas] = await Promise.all([
      getTestsByRepo(repositoryId).catch(() => []),
      getFunctionalAreasTree(repositoryId).catch(() => []),
    ]);

    // Plans can live on nested areas, so the tree is flattened rather than
    // only its roots being read — moved verbatim from the old
    // `explorer-host.ts` implementation this replaces.
    const areaPlans: Array<{ name: string; plan: string }> = [];
    const walk = (nodes: typeof areas) => {
      for (const node of nodes) {
        if (node.agentPlan)
          areaPlans.push({ name: node.name, plan: node.agentPlan });
        if (node.children?.length) walk(node.children);
      }
    };
    walk(areas);

    return {
      tests: tests.map((t) => ({ name: t.name, targetUrl: t.targetUrl })),
      areaPlans,
    };
  },

  async resolveOrCreateArea(repositoryId, areaName) {
    const areas = await getFunctionalAreasByRepo(repositoryId).catch(() => []);
    const existing = areas.find((a) => a.name === areaName);
    if (existing) return { id: existing.id };
    const created = await createFunctionalArea({
      repositoryId,
      name: areaName,
    });
    return { id: created.id };
  },

  async createTest(input) {
    const test = await createTest({
      repositoryId: input.repositoryId,
      functionalAreaId: input.functionalAreaId,
      name: input.name,
      code: input.code,
      targetUrl: input.targetUrl,
      // Machine-authored code is never trusted into a suite unreviewed —
      // `core/tests`'s capability method is named `createQuarantined` and
      // there is no argument that turns this off.
      quarantined: true,
    });
    return { id: test.id };
  },
};
