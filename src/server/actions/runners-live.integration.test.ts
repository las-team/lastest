/**
 * Runtime verification for §3 "Runners (remote runner CLI, `@lastest/runner`)"
 * (core-plugin-refactor-test-plan.md, P1 row — untouched by this refactor,
 * but exercised for real per the plan).
 *
 * `createRunnerInternal` (src/server/actions/runners.ts) requires a live
 * `requireTeamAdmin()` session, which this environment has no browser to
 * produce. So this file registers a runner row with EXACTLY the shape that
 * action inserts (same `hashToken`/`generateRunnerToken` algorithm, mirrored
 * here since they're private to that module) and then drives the runner side
 * of the protocol for real: the live app's own `/api/ws/runner` HTTP
 * endpoint (GET registers + long-polls for commands, POST acks/reports
 * results) — the exact polling transport `packages/runner` and the EB
 * command queue both ride. `queueCommandToDB` (dispatch side, called by the
 * executor / server actions in production) is imported directly since it is
 * a plain export, not a `"use server"` action.
 *
 * Prerequisites: `pnpm dev` running on :3000. Run with `pnpm test:integration`.
 */
import crypto from "node:crypto";
import { v4 as uuid } from "uuid";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import {
  runnerCommandResults,
  runnerCommands,
  runners,
  teams,
  users,
} from "@/lib/db/schema";
import * as queries from "@/lib/db/queries";
import { queueCommandToDB } from "@/app/api/ws/runner/route";

const APP_ORIGIN = process.env.LASTEST_URL || "http://localhost:3000";

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
function generateRunnerToken(): string {
  return `lastest_runner_${crypto.randomBytes(32).toString("hex")}`;
}

let teamId: string;
let userId: string;
let runnerId: string;
let token: string;
let sessionId: string;

beforeAll(async () => {
  teamId = uuid();
  await db.insert(teams).values({
    id: teamId,
    name: `runner-test-${teamId.slice(0, 8)}`,
    slug: `runner-test-${teamId.slice(0, 8)}`,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  userId = uuid();
  await db.insert(users).values({
    id: userId,
    email: `runner-test-${userId.slice(0, 8)}@example.test`,
    name: "Runner Test User",
    teamId,
    role: "owner",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  runnerId = uuid();
  token = generateRunnerToken();
  await db.insert(runners).values({
    id: runnerId,
    teamId,
    createdById: userId,
    name: "integration-test-runner",
    tokenHash: hashToken(token),
    status: "offline",
    capabilities: ["run", "record"],
    type: "remote",
    authOnly: false,
    createdAt: new Date(),
  });
});

afterAll(async () => {
  await db
    .delete(runnerCommandResults)
    .where(eq(runnerCommandResults.runnerId, runnerId));
  await db.delete(runnerCommands).where(eq(runnerCommands.runnerId, runnerId));
  await db.delete(runners).where(eq(runners.id, runnerId));
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(teams).where(eq(teams.id, teamId));
});

describe("runner registration flow (GET /api/ws/runner)", () => {
  it("rejects a bad token", async () => {
    const res = await fetch(`${APP_ORIGIN}/api/ws/runner`, {
      headers: { authorization: "Bearer not-a-real-token" },
    });
    expect(res.status).toBe(401);
  });

  it("registers with a valid token and flips the runner online", async () => {
    const res = await fetch(`${APP_ORIGIN}/api/ws/runner`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.runnerId).toBe(runnerId);
    expect(body.teamId).toBe(teamId);
    expect(typeof body.sessionId).toBe("string");
    sessionId = body.sessionId; // reused below — POSTs without it would 409
    // as a "duplicate connection" against the session this GET just opened.

    const row = await queries.getRunnerById(runnerId);
    expect(row?.status).toBe("online");
  });
});

describe("command dispatch + result round trip", () => {
  it("a command queued via queueCommandToDB is delivered on the next heartbeat, acked, and its result is queryable", async () => {
    const commandId = uuid();
    await queueCommandToDB(runnerId, {
      id: commandId,
      type: "command:run_test",
      timestamp: Date.now(),
      payload: { testId: "fake-test-id", testRunId: "fake-run-id" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    // Heartbeat dispatches pending commands (status:heartbeat POST, same
    // shape packages/runner's daemon loop would send).
    const hbRes = await fetch(`${APP_ORIGIN}/api/ws/runner`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-session-id": sessionId,
      },
      body: JSON.stringify({
        id: uuid(),
        type: "status:heartbeat",
        timestamp: Date.now(),
        payload: { status: "online" },
      }),
    });
    expect(hbRes.status).toBe(200);
    const hbBody = await hbRes.json();
    expect(hbBody.ok).toBe(true);
    expect(
      hbBody.commands.some((c: { id: string }) => c.id === commandId),
    ).toBe(true);

    // Confirm it's dispatched-not-yet-claimed at this point.
    const dispatched = await queries.getRunnerCommandById(commandId);
    expect(dispatched?.status).toBe("pending");
    expect(dispatched?.dispatchedAt).not.toBeNull();

    // Runner acks receipt.
    const ackRes = await fetch(`${APP_ORIGIN}/api/ws/runner`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-session-id": sessionId,
      },
      body: JSON.stringify({
        id: uuid(),
        type: "response:command_ack",
        timestamp: Date.now(),
        payload: { commandId },
      }),
    });
    expect(ackRes.status).toBe(200);

    const claimed = await queries.getRunnerCommandById(commandId);
    expect(claimed?.status).toBe("claimed");

    // Runner posts the terminal result back.
    const resultRes = await fetch(`${APP_ORIGIN}/api/ws/runner`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-session-id": sessionId,
      },
      body: JSON.stringify({
        id: uuid(),
        type: "response:test_result",
        timestamp: Date.now(),
        payload: {
          correlationId: commandId,
          testId: "fake-test-id",
          testRunId: "fake-run-id",
          status: "passed",
        },
      }),
    });
    expect(resultRes.status).toBe(200);

    // Command reaches a terminal state and the result row is queryable via
    // src/lib/db/queries/runners.ts, exactly as the task asks.
    const finalCmd = await queries.getRunnerCommandById(commandId);
    expect(finalCmd?.status).toBe("completed");

    const results = await db
      .select()
      .from(runnerCommandResults)
      .where(eq(runnerCommandResults.commandId, commandId));
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.type).toBe("response:test_result");
    expect((results[0]!.payload as Record<string, unknown>).status).toBe(
      "passed",
    );
  });
});
