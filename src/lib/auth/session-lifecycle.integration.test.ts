/**
 * §3 "Auth" (P0, not touched by this refactor — broad regression sweep, not
 * a refactor-specific target).
 *
 * Exercises what's reachable without a browser: the bearer-token session
 * lifecycle (`verifyBearerToken`, src/lib/auth/api-key.ts — the mechanism
 * `getCurrentSession` falls back to for non-cookie clients, and what every
 * v1 API call in this test suite's sibling files authenticates through) end
 * to end against the live app, plus the invitation-token round trip at the
 * query layer that `acceptInvitation` (src/server/actions/users.ts) builds
 * on.
 *
 * Explicitly NOT covered here, and not automatable without a real browser in
 * this environment: the login/register *pages* rendering and submitting a
 * form, the literal OAuth provider consent screens (GitHub/GitLab/Google —
 * these need real OAuth app credentials plus a browser to click "Authorize"),
 * and `acceptInvitation` itself as a "use server" action (it starts with
 * `requireAuth()` → `next/headers()`, which throws outside a real Next
 * request scope — see the sibling `repos-access.integration.test.ts` header
 * for the same constraint). What's tested instead is everything downstream:
 * the token that a completed login/OAuth round trip produces, and the query
 * layer `acceptInvitation` calls once its own auth/email-match guard passes.
 *
 * Run with `pnpm test:integration`.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import * as queries from "@/lib/db/queries";
import { sessions, users } from "@/lib/db/schema";
import { verifyBearerToken } from "@/lib/auth/api-key";

const BASE_URL = "http://localhost:3000";

let team: { id: string };
let userId: string;

beforeAll(async () => {
  team = await queries.createTeam({
    name: `auth-lifecycle-test-${randomUUID()}`,
  });
  userId = randomUUID();
  await db.insert(users).values({
    id: userId,
    email: `auth-lifecycle-test-${userId}@example.test`,
    teamId: team.id,
    role: "member",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
});

afterAll(async () => {
  await db.delete(sessions).where(eq(sessions.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
  await queries.deleteTeam(team.id);
});

async function insertSession(
  overrides: Partial<typeof sessions.$inferInsert>,
): Promise<string> {
  const token = randomUUID();
  await db.insert(sessions).values({
    id: randomUUID(),
    userId,
    kind: "api",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
    token,
  });
  return token;
}

describe("session persistence + expiry (verifyBearerToken)", () => {
  it("resolves a fresh, unexpired session to the right user + team", async () => {
    const token = await insertSession({});
    const session = await verifyBearerToken(token);
    expect(session?.user.id).toBe(userId);
    expect(session?.team?.id).toBe(team.id);
  });

  it("persists across repeated use — the same token authenticates request after request", async () => {
    const token = await insertSession({});
    const first = await verifyBearerToken(token);
    const second = await verifyBearerToken(token);
    expect(first?.sessionId).toBe(second?.sessionId);
    expect(second?.user.id).toBe(userId);
  });

  it("rejects an expired session", async () => {
    const token = await insertSession({
      expiresAt: new Date(Date.now() - 1000),
    });
    const session = await verifyBearerToken(token);
    expect(session).toBeNull();
  });

  it("rejects a 'launch' kind token even if unexpired — it must never double as a full API token", async () => {
    const token = await insertSession({ kind: "launch", scope: "launch:vote" });
    const session = await verifyBearerToken(token);
    expect(session).toBeNull();
  });

  it("rejects any scoped token regardless of kind", async () => {
    const token = await insertSession({ scope: "launch:vote" });
    const session = await verifyBearerToken(token);
    expect(session).toBeNull();
  });

  it("rejects a garbage token", async () => {
    const session = await verifyBearerToken("not-a-real-token");
    expect(session).toBeNull();
  });
});

describe("logout — session deletion invalidates the token end to end", () => {
  it("a live token authenticates over real HTTP, then stops working the moment it's deleted", async () => {
    const token = await insertSession({});

    const before = await fetch(`${BASE_URL}/api/v1/health`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(before.status).toBe(200);

    // What `deleteSession` (the query layer behind any logout path) does.
    await queries.deleteSession(token);

    const after = await fetch(`${BASE_URL}/api/v1/health`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(after.status).toBe(401);
  });
});

describe("invitation token round trip (query layer behind acceptInvitation)", () => {
  it("a created invitation is findable by token, unaccepted, and becomes accepted", async () => {
    const email = `invitee-${randomUUID()}@example.test`;
    const invitedByUserId = userId;
    const token = await queries.createInvitation({
      email,
      teamId: team.id,
      invitedById: invitedByUserId,
      role: "member",
    });

    const invite = await queries.getInvitationByToken(token);
    expect(invite?.email).toBe(email.toLowerCase());
    expect(invite?.teamId).toBe(team.id);
    expect(invite?.acceptedAt).toBeNull();
    expect(invite?.expiresAt.getTime()).toBeGreaterThan(Date.now());

    // What `acceptInvitation` does once its own guards (signed-in, email
    // match, not expired/accepted) have passed.
    await queries.markInvitationAccepted(token);

    const accepted = await queries.getInvitationByToken(token);
    expect(accepted?.acceptedAt).not.toBeNull();

    await queries.deleteInvitation(invite!.id);
  });

  it("getInvitationByEmail surfaces the pending invite for the duplicate-invite guard in inviteUser()", async () => {
    const email = `invitee-dup-${randomUUID()}@example.test`;
    const token = await queries.createInvitation({
      email,
      teamId: team.id,
      role: "member",
    });
    const found = await queries.getInvitationByEmail(email);
    expect(found?.token).toBe(token);
    expect(found?.acceptedAt).toBeNull();

    await queries.deleteInvitation(found!.id);
  });
});
