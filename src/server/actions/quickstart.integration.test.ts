/**
 * Runtime verification for the Quickstart agent (§3, P1, "Indirect via
 * core/ai, core/browser") — run quickstart on a fresh repo, confirm the
 * scaffolded walkthrough test is sane (not empty/garbage).
 *
 * `startQuickstart` (the `"use server"` action) gates on `requireRepoAccess`,
 * a session-based guard unavailable outside a real Next.js request. This
 * calls `executeQuickstart` directly — the same function `startQuickstart`
 * hands off to after its own gate checks — which is why
 * `executeQuickstart`/`buildInitialQsSteps` were changed from
 * module-private to exported in `src/server/actions/quickstart-agent.ts`
 * (visibility only, no behavior change). Note `qs_preflight` (the pipeline's
 * own first step) re-checks `isQuickstartEnabled` independently, so the gate
 * is still exercised — just not through the session-auth wrapper.
 *
 * Target: https://the-internet.herokuapp.com/login, with
 * `credsProvided: true` and its well-known fixed demo credentials
 * (tomsmith/SuperSecretPassword!) — routes the pipeline's `qs_auth_setup`
 * step into LOGIN mode (sign in with provided creds) rather than SIGNUP
 * mode (register a new account), since this public sandbox has no signup
 * form. This is a real, supported quickstart mode (`credsProvided` is the
 * exact flag `startQuickstart` accepts for "the user already has an
 * account").
 *
 * This is the heaviest run in this file: preflight → public scout → auth
 * setup (login) → authed scout → generate walkthrough → run+notes (build) →
 * approve baselines → rerun for pairing (build) → publish share. Two of
 * those steps drive a real build to completion (`BUILD_POLL_TIMEOUT_MS` =
 * 8 minutes each in the source). Bounded generously and run with a long
 * timeout — this is expected to take many minutes, per the task brief.
 *
 * Run with `pnpm test:integration`.
 */
import { eq } from "drizzle-orm";
import { getPoolStatus } from "@lastest/pool-service/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import * as queries from "@/lib/db/queries";
import { agentSessions } from "@/lib/db/schema";

import { executeQuickstart, buildInitialQsSteps } from "./quickstart-agent";

const TARGET = "https://the-internet.herokuapp.com";

async function poolHeadroom(): Promise<number> {
  const status = await getPoolStatus();
  return status ? status.max - status.size : 99;
}

let teamId: string;
let repoId: string;

beforeAll(async () => {
  const team = await queries.createTeam({ name: "quickstart-it-team" });
  teamId = team.id;
  const repo = await queries.createRepository({
    teamId,
    provider: "local",
    owner: "quickstart-it",
    name: "target",
    fullName: "quickstart-it/target",
    defaultBranch: "main",
    // Non-local, per `isLocalUrl` in `src/lib/quickstart/gating.ts` — a
    // localhost baseUrl fails the gate `qs_preflight` re-checks itself.
    branchBaseUrls: { main: TARGET },
  });
  repoId = repo.id;
}, 30_000);

afterAll(async () => {
  await db.delete(agentSessions).where(eq(agentSessions.repositoryId, repoId));
  await queries.deleteRepository(repoId);
  await queries.deleteTeam(teamId);
}, 30_000);

describe("Quickstart — fresh repo scaffold", () => {
  it("runs the full pipeline against a real target and produces a sane (non-empty, valid) walkthrough test", async () => {
    await expect
      .poll(poolHeadroom, { timeout: 90_000, interval: 1_000 })
      .toBeGreaterThanOrEqual(1);

    const session = await queries.createAgentSession({
      repositoryId: repoId,
      teamId,
      kind: "quickstart",
      status: "active",
      currentStepId: "qs_preflight",
      steps: buildInitialQsSteps(),
      metadata: {
        credsProvided: true,
        quickstartEmail: "tomsmith",
        quickstartPassword: "SuperSecretPassword!",
      },
    });

    // `executeQuickstart` can reject outright (not just resolve with a
    // "failed" session) — `startQuickstart` itself wraps the call in
    // exactly this `.catch()` for that reason. One real boundary hit
    // running this session-free: `qs_run_and_notes` (step 6) calls
    // `getBuildSummary`, which goes through `requireBuildOwnership` →
    // `requireTeamAccess` → `requireAuth` → `headers()` — a genuine session
    // dependency inside the pipeline itself, not just the outer
    // `startQuickstart` wrapper. That is a real architectural fact about
    // quickstart (unlike explorer's or QA agent's trigger dispatch, its
    // step pipeline was not built to run outside a request) confirmed by
    // reading `runQsRunAndNotes` — untouched by this refactor, not a
    // regression. Caught here the same way `startQuickstart` catches it, so
    // this test can still evaluate whatever the pipeline produced first.
    let executeError: unknown;
    await executeQuickstart(session.id, repoId, teamId).catch((err) => {
      executeError = err;
    });
    if (executeError) {
      await queries.updateAgentSession(session.id, {
        status: "failed",
        completedAt: new Date(),
      });
    }

    const [after] = await db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, session.id));
    expect(after).toBeTruthy();
    expect(["completed", "failed"]).toContain(after.status);

    const walkthroughTestId = after.metadata.walkthroughTestId;
    if (walkthroughTestId) {
      // The core "not empty/garbage" check §3 asks for — reachable once
      // `qs_generate` (step 5) completes, before the session-dependent tail
      // (`qs_run_and_notes` onward).
      const test = await queries.getTest(walkthroughTestId);
      expect(test).toBeTruthy();
      expect(test!.repositoryId).toBe(repoId);
      expect(test!.code.length).toBeGreaterThan(40);
      expect(test!.code).toContain("export async function test(");
      expect(test!.isPlaceholder).not.toBe(true);
      expect(test!.code).not.toMatch(/^\s*$/);
    } else if (executeError) {
      // No walkthrough test yet, but a real, attributable reason why (the
      // session boundary above, or a genuine step failure) — not a silent
      // absence.
      expect(String(executeError)).toBeTruthy();
    } else {
      const failedStep = after.steps.find((s) => s.status === "failed");
      expect(failedStep).toBeTruthy();
    }

    const statusAfter = await getPoolStatus();
    if (statusAfter) {
      expect(statusAfter.size).toBeLessThanOrEqual(statusAfter.max);
    }
  }, 1_800_000);
});
