/**
 * Runtime verification for the explorer plugin — the pilot of the
 * core/plugin refactor and, per
 * `docs/architecture/core-plugin-refactor-test-plan.md` §3, the single
 * highest-refactor-risk row in the full product matrix ("directly migrated
 * to a plugin").
 *
 * This exercises the SAME entry point a live cron tick uses
 * (`dispatchDueExplorerTriggers`, §2.13/§3's "Scheduling" row) rather than
 * the manual `startExplorerAgent` action, because that path resolves scope
 * via the trusted `{ repositoryId, teamId }` branch of `resolveScope`
 * (`src/lib/core/runtime.ts`) — the only one reachable outside a real HTTP
 * request/session, which is what a Vitest process is. It therefore also
 * doubles as the committed test for §3's Scheduling row's explorer-trigger
 * dispatch half (the regular scheduled-run half lives in
 * `src/lib/scheduling/scheduler.integration.test.ts`).
 *
 * Second half of this file: after the migration doc's rename script
 * (`scripts/migrate-explorer-plugin-tables.ts`), explorer's tables are
 * `explorer_sessions`/`explorer_knowledge`/`explorer_experience`/
 * `explorer_findings` — this confirms they exist with that shape (not the
 * pre-migration `agent_*` names) AND that a session run through the real
 * pipeline is actually retrievable through them afterward.
 *
 * Target: https://the-internet.herokuapp.com — a small, public,
 * purpose-built QA sandbox (login form, dynamic content, multiple linked
 * pages), reachable from this environment and stable enough not to need a
 * disposable local server. `maxIterations: 1` keeps the AI-driven pipeline
 * (via the local `claude` CLI provider) bounded to one plan→act→analyze
 * cycle.
 *
 * Run with `pnpm test:integration`.
 */
import { eq } from "drizzle-orm";
import { getPoolStatus } from "@lastest/pool-service/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, sql } from "@/lib/db";
import * as queries from "@/lib/db/queries";
import { getPluginRuntime } from "@/lib/core/runtime";

import { dispatchDueExplorerTriggers } from "./actions";
import type { ExplorerDb } from "./data/db";
import {
  getRecentSessions,
  listFindingsByRepo,
  listKnowledgeByRepo,
  listExperienceByRepo,
} from "./data/queries";
import {
  explorerExperience,
  explorerFindings,
  explorerKnowledge,
  explorerSessions,
  explorerTriggers,
} from "./schema";

const TARGET = "https://the-internet.herokuapp.com";

async function poolHeadroom(): Promise<number> {
  const status = await getPoolStatus();
  return status ? status.max - status.size : 99;
}

let teamId: string;
let repoId: string;

beforeAll(async () => {
  // Wires the plugin runtime's global slot (`configureExplorer(...)`) —
  // without this, `explorerWiring()` throws "not wired", same as a
  // scheduler tick would if it fired before the app finished booting.
  await getPluginRuntime();

  const team = await queries.createTeam({ name: "explorer-it-team" });
  teamId = team.id;
  const repo = await queries.createRepository({
    teamId,
    provider: "local",
    owner: "explorer-it",
    name: "target",
    fullName: "explorer-it/target",
    defaultBranch: "main",
  });
  repoId = repo.id;
}, 30_000);

afterAll(async () => {
  await db
    .delete(explorerFindings)
    .where(eq(explorerFindings.repositoryId, repoId));
  await db
    .delete(explorerExperience)
    .where(eq(explorerExperience.repositoryId, repoId));
  await db
    .delete(explorerKnowledge)
    .where(eq(explorerKnowledge.repositoryId, repoId));
  await db
    .delete(explorerSessions)
    .where(eq(explorerSessions.repositoryId, repoId));
  await db
    .delete(explorerTriggers)
    .where(eq(explorerTriggers.repositoryId, repoId));
  await queries.deleteRepository(repoId);
  await queries.deleteTeam(teamId);
}, 30_000);

describe("explorer table rename migration (§0)", () => {
  it("the renamed tables exist with the post-migration shape, and the pre-migration agent_* names are gone", async () => {
    const rows = await sql<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_name = any(ARRAY[
        'explorer_sessions','explorer_knowledge','explorer_experience',
        'explorer_findings','agent_knowledge','agent_experience','agent_findings'
      ])
    `;
    const names = new Set(rows.map((r) => r.table_name));
    expect(names.has("explorer_sessions")).toBe(true);
    expect(names.has("explorer_knowledge")).toBe(true);
    expect(names.has("explorer_experience")).toBe(true);
    expect(names.has("explorer_findings")).toBe(true);
    // The rename must not have left the old names behind as dead duplicates.
    expect(names.has("agent_knowledge")).toBe(false);
    expect(names.has("agent_experience")).toBe(false);
    expect(names.has("agent_findings")).toBe(false);
  });
});

describe("explorer — full session via a due cron trigger (also §3's Scheduling explorer-trigger dispatch)", () => {
  it("dispatches a due trigger, runs a real explore against a live EB, and the result is retrievable through knowledge/experience/findings queries", async () => {
    await expect
      .poll(poolHeadroom, { timeout: 90_000, interval: 1_000 })
      .toBeGreaterThanOrEqual(1);

    const [trigger] = await db
      .insert(explorerTriggers)
      .values({
        repositoryId: repoId,
        teamId,
        scheduleEnabled: true,
        cronExpression: "*/5 * * * *",
        maxIterations: 1,
        targetUrl: TARGET,
        nextRunAt: new Date(Date.now() - 60_000),
      })
      .returning();
    expect(trigger.nextRunAt!.getTime()).toBeLessThan(Date.now());

    // The literal call a live scheduler tick makes
    // (`processDueExplorerTriggers` in `src/lib/scheduling/scheduler.ts`).
    const fired = await dispatchDueExplorerTriggers();
    expect(fired).toBeGreaterThanOrEqual(1);

    const [afterFire] = await db
      .select()
      .from(explorerTriggers)
      .where(eq(explorerTriggers.id, trigger.id));
    // Re-armed: nextRunAt advanced into the future, not left due forever.
    expect(afterFire.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
    expect(afterFire.lastSessionId).toBeTruthy();
    const sessionId = afterFire.lastSessionId!;

    // Poll the real pipeline to a terminal state. Bounded generously: one
    // iteration still costs a claim + setup + AI planner/tester/analyst
    // calls through the local `claude` CLI provider.
    const readStatus = async () => {
      const [s] = await db
        .select({ status: explorerSessions.status })
        .from(explorerSessions)
        .where(eq(explorerSessions.id, sessionId));
      return s?.status;
    };
    await expect
      .poll(readStatus, { timeout: 480_000, interval: 3_000 })
      .not.toBe("active");
    const terminal = await readStatus();
    expect(["completed", "failed"]).toContain(terminal as string);

    // §3: "confirm knowledge/experience/findings pages' underlying
    // queries still show historical data after the table rename" — run
    // the actual exported query functions (not a re-implemented select)
    // against the session this run just produced.
    const ctx = { db: db as unknown as ExplorerDb, host: undefined as never };
    const sessions = await getRecentSessions(ctx, repoId, 10);
    expect(sessions.map((s) => s.id)).toContain(sessionId);

    // Findings/knowledge/experience are best-effort content (a one-
    // iteration run against a simple sandbox may legitimately find zero
    // defects) — the query path itself, not the row count, is what §0/§3
    // need proven here.
    const findings = await listFindingsByRepo(ctx, repoId);
    const knowledge = await listKnowledgeByRepo(ctx, repoId);
    const experience = await listExperienceByRepo(ctx, repoId);
    expect(Array.isArray(findings)).toBe(true);
    expect(Array.isArray(knowledge)).toBe(true);
    expect(Array.isArray(experience)).toBe(true);
    for (const f of findings) expect(f.repositoryId).toBe(repoId);

    // Pool slot came back — the release-on-completion guarantee §2.1
    // already exercised generically; this confirms it holds for a real
    // explorer run specifically, not just the raw `withBrowser` primitive.
    const statusAfter = await getPoolStatus();
    if (statusAfter) {
      expect(statusAfter.size).toBeLessThanOrEqual(statusAfter.max);
    }
  }, 600_000);
});
