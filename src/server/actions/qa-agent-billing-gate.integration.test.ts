/**
 * §2.9 / §3 "Settings — Billing": confirms the billing-gating signature change
 * (`hasQaAgentAccess`/`assertQaAgentAccess` now take an explicit
 * `billingEnabled` param — src/lib/billing/feature-access.ts) actually holds
 * at a real call site inside `plugins/qa-agent/src/actions.ts`, not just in
 * the pure-function unit test (src/lib/billing/feature-access.test.ts, which
 * already covers `hasQaAgentAccess`/`assertQaAgentAccess` in isolation with
 * explicit plan/billingEnabled combinations).
 *
 * `startQaAgentFromTrigger` (plugins/qa-agent/src/actions.ts, called by
 * `POST /api/v1/repos/:id/qa-agent/runs`) is used here specifically because
 * it is the one QA-agent entry point that does NOT go through
 * `requireAuth()`/`requireRepoAccess()` — those call `next/headers()`, which
 * throws outside a real Next request scope, so nothing gated by them is
 * callable directly from a test process without a browser (see this suite's
 * sibling files and the §3 report for the auth/repo-access rows). This
 * function instead resolves the team straight from a `teamId` — trusted
 * server-to-server input (webhook, scheduler, this test) — so the plan gate
 * at its top (now `ctx.team.entitlements.has("qa-agent")`, which resolves
 * through the same `hasQaAgentAccess(plan, isBillingEnabled())` in
 * `src/lib/core/entitlements.ts`) can be exercised for
 * real, with explicit plan values AND an explicitly toggled `billingEnabled`
 * (via `STRIPE_SECRET_KEY`), not just this environment's ambient
 * billing-disabled default.
 *
 * A repo with no prior QA sessions and no environment config is used so
 * that, once a plan/billing combination clears the gate, `resolveQaRunSeed`
 * falls through to `getEnvironmentConfig`'s synthetic `localhost` default
 * (settings.ts: "before hardcoding localhost, honor the repo's branch base
 * URLs... "), which the SSRF guard (`assertSafeOutboundUrl`) then rejects —
 * so the function returns `{ skipped: "URL rejected: ..." }` *before*
 * touching the EB pool or writing an agent session row. That's the sentinel
 * this test uses: reaching the SSRF check at all proves the call got past
 * the billing gate, without needing to run a real QA session.
 *
 * `STRIPE_SECRET_KEY` is stubbed only in this test process's env — it never
 * touches the live `pnpm dev` server, which keeps reading its own
 * `.env.local` (no Stripe key in this environment, confirmed billing-disabled
 * per §2.9).
 *
 * Not covered here, and not fakeable without a live Stripe key: the Stripe
 * webhook plan-flip (`teams.plan` updated by `customer.subscription.*`
 * events) — see the final report.
 *
 * Run with `pnpm test:integration`.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import * as queries from "@/lib/db/queries";
import { agentSessions, repositories, teams } from "@/lib/db/schema";
import type { TeamPlan } from "@/lib/db/schema";

const NOT_AVAILABLE = "QA agent not available on the team's plan";

/** Proves the gate was passed: control flow reached the SSRF check on the
 *  synthetic localhost default (see the file header) rather than stopping at
 *  the plan gate. */
function expectGatePassed(skipped: string | undefined) {
  expect(skipped).not.toBe(NOT_AVAILABLE);
  expect(skipped).toMatch(/^URL rejected:/);
}

let repositoryId: string;
let teamId: string;
const originalStripeKey = process.env.STRIPE_SECRET_KEY;

beforeAll(async () => {
  // The action now lives in `@lastest/plugin-qa-agent` and resolves its scope
  // through the plugin runtime — wire it the way a booted server would
  // (`src/instrumentation.ts` awaits the same call before serving requests).
  const { getPluginRuntime } = await import("@/lib/core/runtime");
  await getPluginRuntime();

  const team = await queries.createTeam({
    name: `qa-billing-gate-test-${randomUUID()}`,
  });
  teamId = team.id;
  const repo = await queries.createRepository({
    teamId: team.id,
    provider: "local",
    owner: "local",
    name: "qa-billing-gate-test-repo",
    fullName: "local/qa-billing-gate-test-repo",
  });
  repositoryId = repo.id;
});

afterEach(async () => {
  // Defensive: the "unlocked" cases are expected to stop at "no target URL"
  // without creating a session, but if the gate wiring regresses and a real
  // session gets created, don't leave it behind for the next run.
  await db
    .delete(agentSessions)
    .where(eq(agentSessions.repositoryId, repositoryId));
});

afterAll(async () => {
  if (originalStripeKey === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = originalStripeKey;
  await db
    .delete(agentSessions)
    .where(eq(agentSessions.repositoryId, repositoryId));
  await queries.deleteRepository(repositoryId);
  await queries.deleteTeam(teamId);
});

async function setPlan(plan: TeamPlan) {
  await db.update(teams).set({ plan }).where(eq(teams.id, teamId));
}

describe("startQaAgentFromTrigger — real call site, billing gate", () => {
  it("billing enabled + free plan: locked", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fake_for_gate_check";
    await setPlan("free");
    const { startQaAgentFromTrigger } =
      await import("@lastest/plugin-qa-agent/actions");

    const result = await startQaAgentFromTrigger({
      repositoryId,
      teamId,
      trigger: "mcp",
    });

    expect(result.skipped).toBe(NOT_AVAILABLE);
    expect(result.sessionId).toBeUndefined();
  });

  it("billing enabled + starter plan: still locked (below QA_AGENT_MIN_PLAN='pro')", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fake_for_gate_check";
    await setPlan("starter");
    const { startQaAgentFromTrigger } =
      await import("@lastest/plugin-qa-agent/actions");

    const result = await startQaAgentFromTrigger({
      repositoryId,
      teamId,
      trigger: "mcp",
    });

    expect(result.skipped).toBe(NOT_AVAILABLE);
  });

  it("billing enabled + pro plan: unlocked — gate passes, real code runs past it", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fake_for_gate_check";
    await setPlan("pro");
    const { startQaAgentFromTrigger } =
      await import("@lastest/plugin-qa-agent/actions");

    const result = await startQaAgentFromTrigger({
      repositoryId,
      teamId,
      trigger: "mcp",
    });

    expectGatePassed(result.skipped);
  });

  it("billing disabled (ambient default) + free plan: unlocked regardless of plan", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    await setPlan("free");
    const { startQaAgentFromTrigger } =
      await import("@lastest/plugin-qa-agent/actions");

    const result = await startQaAgentFromTrigger({
      repositoryId,
      teamId,
      trigger: "mcp",
    });

    expectGatePassed(result.skipped);
  });
});
