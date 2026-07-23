import * as queries from "@/lib/db/queries";

/**
 * Coverage digest: what's already tested/known, injected into the explorer
 * planner so it skips covered ground (explorbot's "skips scenarios you
 * already have"). Deterministic and cheap — names/titles only, hard-capped.
 */

const MAX_TESTS = 60;
const MAX_FINDINGS = 40;
const MAX_PLANS = 12;

export async function buildCoverageDigest(
  repositoryId: string,
): Promise<string> {
  const [tests, findings, areas] = await Promise.all([
    queries.getTestsByRepo(repositoryId),
    queries.listFindingsByRepo(repositoryId, { limit: MAX_FINDINGS }),
    queries.getFunctionalAreasTree(repositoryId),
  ]);

  const sections: string[] = [];

  if (tests.length > 0) {
    sections.push(
      `EXISTING TESTS (${tests.length} total — do not re-plan these flows):\n` +
        tests
          .slice(0, MAX_TESTS)
          .map((t) => `- ${t.name}${t.targetUrl ? ` (${t.targetUrl})` : ""}`)
          .join("\n"),
    );
  }

  if (findings.length > 0) {
    sections.push(
      `KNOWN FINDINGS (already reported — do not re-discover):\n` +
        findings
          .map(
            (f) => `- [${f.severity}] ${f.title}${f.url ? ` @ ${f.url}` : ""}`,
          )
          .join("\n"),
    );
  }

  // Flatten the area tree — plans can live on nested areas.
  const flat: Array<{ name: string; agentPlan: string | null }> = [];
  const walk = (nodes: typeof areas) => {
    for (const node of nodes) {
      flat.push({ name: node.name, agentPlan: node.agentPlan });
      if (node.children?.length) walk(node.children);
    }
  };
  walk(areas);

  const plans = flat
    .filter((a) => a.agentPlan)
    .slice(0, MAX_PLANS)
    .map((a) => `- ${a.name}: ${(a.agentPlan ?? "").slice(0, 200)}`);
  if (plans.length > 0) {
    sections.push(`AREA TEST PLANS (existing intent):\n${plans.join("\n")}`);
  }

  return sections.join("\n\n") || "(no existing coverage)";
}
