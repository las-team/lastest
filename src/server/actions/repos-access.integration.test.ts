/**
 * §3 "Repos + repo access" (P0, indirect via repos-host.ts) and the §2.6
 * correction: `ctx.repos`'s tenancy check (`repo.teamId !== team.id → null`,
 * confirmed ahead of `environment_settings` resolution) should mean a
 * bearer-token holder for one team can never read or create against another
 * team's repo through the real HTTP surface.
 *
 * This drives `/api/v1/repos` end to end against the live app
 * (http://localhost:3000, behind the front proxy) — not `requireRepoAccess`
 * in isolation, which can't be called directly from a test process (it goes
 * through `requireAuth()` → `next/headers()`, which throws outside a real
 * Next request). Sessions are minted the way the task brief describes:
 * inserting directly into the `sessions` table (see
 * src/lib/auth/api-key.ts's `verifyBearerToken` for exactly what a valid row
 * needs) and sent as `Authorization: Bearer <token>`.
 *
 * Run with `pnpm test:integration`.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import * as queries from "@/lib/db/queries";
import { repositories, sessions, users } from "@/lib/db/schema";

const BASE_URL = "http://localhost:3000";

async function mintBearerToken(teamId: string): Promise<{
  token: string;
  userId: string;
}> {
  const userId = randomUUID();
  await db.insert(users).values({
    id: userId,
    email: `repos-access-test-${userId}@example.test`,
    teamId,
    role: "owner",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const token = randomUUID();
  await db.insert(sessions).values({
    id: randomUUID(),
    userId,
    token,
    // Long-lived 'api' token, same kind the VS Code extension / MCP server use
    // — see api-key.ts's doc comment.
    kind: "api",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return { token, userId };
}

let teamA: { id: string };
let teamB: { id: string };
let tokenA: string;
let tokenB: string;
let userAId: string;
let userBId: string;
let createdRepoId: string | undefined;

beforeAll(async () => {
  teamA = await queries.createTeam({
    name: `repos-access-team-a-${randomUUID()}`,
  });
  teamB = await queries.createTeam({
    name: `repos-access-team-b-${randomUUID()}`,
  });
  const a = await mintBearerToken(teamA.id);
  const b = await mintBearerToken(teamB.id);
  tokenA = a.token;
  tokenB = b.token;
  userAId = a.userId;
  userBId = b.userId;
});

afterAll(async () => {
  if (createdRepoId)
    await queries.deleteRepository(createdRepoId).catch(() => {});
  await db.delete(sessions).where(eq(sessions.userId, userAId));
  await db.delete(sessions).where(eq(sessions.userId, userBId));
  await db.delete(users).where(eq(users.id, userAId));
  await db.delete(users).where(eq(users.id, userBId));
  await queries.deleteTeam(teamA.id);
  await queries.deleteTeam(teamB.id);
});

describe("bearer-token auth on /api/v1", () => {
  it("rejects a request with no token", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/health`);
    expect(res.status).toBe(401);
  });

  it("rejects a request with a bogus token", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/health`, {
      headers: { Authorization: "Bearer not-a-real-token" },
    });
    expect(res.status).toBe(401);
  });

  it("accepts a valid bearer token minted directly in `sessions`", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/health`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

describe("add/connect a repo + tenancy enforcement (§2.6)", () => {
  it("creates a local repo under the caller's own team", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/repos`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenA}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "repos-access-test-repo",
        baseUrl: "https://example.test",
      }),
    });
    expect(res.status).toBe(201);
    const repo = await res.json();
    expect(repo.teamId).toBe(teamA.id);
    createdRepoId = repo.id;

    // Confirmed directly against the DB, not just trusting the 201 body.
    const dbRepo = await queries.getRepository(repo.id);
    expect(dbRepo?.teamId).toBe(teamA.id);
  });

  it("the owning team can read its own repo", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/repos/${createdRepoId}`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    expect(res.status).toBe(200);
    const repo = await res.json();
    expect(repo.id).toBe(createdRepoId);
  });

  it("a different team's bearer token cannot read the repo (404, not 403 — no existence leak)", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/repos/${createdRepoId}`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    expect(res.status).toBe(404);
  });

  it("a different team's bearer token cannot read the repo's sub-resources either", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/repos/${createdRepoId}/tests`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    expect(res.status).toBe(404);
  });

  it("a different team's bearer token cannot list-into visibility of the repo via the collection endpoint", async () => {
    const res = await fetch(`${BASE_URL}/api/v1/repos`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    expect(res.status).toBe(200);
    const repos = await res.json();
    expect(
      repos.find((r: { id: string }) => r.id === createdRepoId),
    ).toBeUndefined();
  });
});
