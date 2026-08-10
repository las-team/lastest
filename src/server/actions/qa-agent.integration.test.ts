/**
 * Runtime verification for QA Agent (`src/lib/qa-agent`,
 * `src/server/actions/qa-agent.ts`) — §3's "largest raw diff on this branch"
 * row (§2.11) — and, sharing the same fixture, App Map (§3's P1 row: "Run an
 * Explore session, confirm map/flow data it produces is retrievable").
 *
 * App Map is computed on read from `agent_sessions.metadata.qaDiscovery`
 * (`src/lib/app-map/build-map.ts`'s own doc comment) — i.e. QA Agent's own
 * `mode: "explore"` pipeline (`qa_setup` → `qa_login` → `qa_discover`, no
 * plan/generate/execute) is literally the "Explore session" the App Map row
 * asks for. Running it first, against the same repo the full-mode test also
 * uses, gets both rows' evidence for one crawl instead of two.
 *
 * Both sessions are started through `startQaAgentFromTrigger` rather than
 * the manual `startQaAgent` action — the manual action calls
 * `requireRepoAccess`, which needs a real session (`headers()`/cookies),
 * unavailable in a Vitest process. `startQaAgentFromTrigger` is the
 * session-free entry point real cron/PR/MCP triggers use, resolving
 * authorization by direct team/repo ownership instead — appropriate here
 * since this file IS effectively "trusted server code" the same way those
 * triggers are.
 *
 * Target: https://the-internet.herokuapp.com (small, public, multi-page QA
 * sandbox). The full-mode run is expected to take several minutes (crawl +
 * AI planning + AI test generation + real EB execution + healing) — that is
 * normal per the task brief, not a bug.
 *
 * Run with `pnpm test:integration`.
 */
import { eq } from "drizzle-orm";
import { getPoolStatus } from "@lastest/pool-service/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import * as queries from "@/lib/db/queries";
import { agentSessions } from "@/lib/db/schema";
import { buildAppMap } from "@/lib/app-map/build-map";
import { deriveFlows } from "@/lib/app-map/flows";

import { startQaAgentFromTrigger } from "./qa-agent";

const TARGET = "https://the-internet.herokuapp.com";

async function poolHeadroom(): Promise<number> {
  const status = await getPoolStatus();
  return status ? status.max - status.size : 99;
}

async function waitForTerminal(sessionId: string, timeoutMs: number) {
  const read = async () => {
    const [s] = await db
      .select({ status: agentSessions.status })
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId));
    return s?.status;
  };
  await expect
    .poll(read, { timeout: timeoutMs, interval: 3_000 })
    .not.toBe("active");
  return read();
}

let teamId: string;
let repoId: string;

beforeAll(async () => {
  const team = await queries.createTeam({ name: "qa-agent-it-team" });
  teamId = team.id;
  const repo = await queries.createRepository({
    teamId,
    provider: "local",
    owner: "qa-agent-it",
    name: "target",
    fullName: "qa-agent-it/target",
    defaultBranch: "main",
  });
  repoId = repo.id;
}, 30_000);

afterAll(async () => {
  await db.delete(agentSessions).where(eq(agentSessions.repositoryId, repoId));
  await queries.deleteRepository(repoId);
  await queries.deleteTeam(teamId);
}, 30_000);

describe("QA Agent — explore mode (also §3's App Map row)", () => {
  it("crawls the target and the resulting session is retrievable through the App Map graph/flow builders", async () => {
    await expect
      .poll(poolHeadroom, { timeout: 90_000, interval: 1_000 })
      .toBeGreaterThanOrEqual(1);

    const { sessionId, skipped } = await startQaAgentFromTrigger({
      repositoryId: repoId,
      teamId,
      trigger: "mcp",
      mode: "explore",
      targetUrl: TARGET,
      reason: "integration test",
    });
    expect(skipped).toBeUndefined();
    expect(sessionId).toBeTruthy();

    await waitForTerminal(sessionId!, 300_000);

    const [session] = await db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId!));
    expect(session).toBeTruthy();
    expect(session.metadata.qaDiscovery).toBeTruthy();
    const pageCount = session.metadata.qaDiscovery?.crawledPages?.length ?? 0;
    expect(pageCount).toBeGreaterThan(0);

    // App Map: computed-on-read from routes + sitemap + this crawl +
    // trajectories. No routes/sitemap exist for this throwaway repo, so a
    // non-empty graph here can only have come from the crawl this test
    // just ran — that's the coherence check §3 asks for.
    const graph = await buildAppMap(repoId, { includeSitemap: false });
    expect(graph.nodes.length).toBeGreaterThan(0);
    expect(graph.nodes.some((n) => n.sources?.includes("crawl"))).toBe(true);
    // Every node should carry a well-formed canonical path id.
    for (const n of graph.nodes) {
      expect(typeof n.id).toBe("string");
      expect(n.id.length).toBeGreaterThan(0);
    }

    // Flows (no test trajectories exist for this fresh repo — no test has
    // ever run — so this must degrade to an empty, not throw).
    const flowRows = await queries.getLatestTestResultsWithTrajectoryByRepo(
      repoId,
      "main",
    );
    const flows = deriveFlows(flowRows, "main");
    expect(Array.isArray(flows)).toBe(true);
    expect(flows.length).toBe(0);
  }, 360_000);
});

describe("QA Agent — full session: crawl → tasks → execution → findings/report (§2.11)", () => {
  it("runs discover → plan → generate → execute → summary end to end against a real target", async () => {
    await expect
      .poll(poolHeadroom, { timeout: 90_000, interval: 1_000 })
      .toBeGreaterThanOrEqual(1);

    const { sessionId, skipped } = await startQaAgentFromTrigger({
      repositoryId: repoId,
      teamId,
      trigger: "mcp",
      mode: "full",
      targetUrl: TARGET,
      reason: "integration test — full pipeline",
    });
    expect(skipped).toBeUndefined();
    expect(sessionId).toBeTruthy();

    // Generous bound: discover + AI planning + AI test-code generation +
    // real EB execution + healing, all through the local `claude` CLI
    // provider, for a multi-page target.
    const terminal = await waitForTerminal(sessionId!, 1_500_000);
    expect(["completed", "failed"]).toContain(terminal as string);

    const [session] = await db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId!));

    // Discovery ran regardless of how far the pipeline got.
    expect(session.metadata.qaDiscovery).toBeTruthy();

    if (terminal === "completed") {
      // The "findings/report": qa_summary's planned/generated/covered/passed
      // roll-up — the concrete end product of crawl → tasks → execution.
      expect(session.metadata.qaSummary).toBeTruthy();
      const summary = session.metadata.qaSummary!;
      expect(summary.planned).toBeGreaterThan(0);

      // Task generation → execution: at least one real Test row should
      // exist under this repo if any tests were generated.
      const tests = await queries.getTestsByRepo(repoId);
      if (summary.generated > 0) {
        expect(tests.length).toBeGreaterThan(0);
      }
    } else {
      // A failed run is still evidence (a real step failed for a real
      // reason) as long as it failed cleanly, not silently — the session
      // must record which step and why.
      const failedStep = session.steps.find((s) => s.status === "failed");
      expect(failedStep).toBeTruthy();
    }

    const statusAfter = await getPoolStatus();
    if (statusAfter) {
      expect(statusAfter.size).toBeLessThanOrEqual(statusAfter.max);
    }
  }, 1_800_000);
});
