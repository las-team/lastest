import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the DB layer so we exercise verifyBearerToken's gating logic only.
vi.mock("@/lib/db/queries", () => ({
  getSessionWithUser: vi.fn(),
  touchSessionLastUsed: vi.fn().mockResolvedValue(undefined),
  getTeam: vi.fn().mockResolvedValue(null),
}));

import * as queries from "@/lib/db/queries";
import { verifyBearerToken } from "./api-key";

const q = queries as unknown as Record<string, ReturnType<typeof vi.fn>>;

function sessionRow(over: {
  kind?: string;
  scope?: string | null;
  expiresAt?: Date;
}) {
  return {
    session: {
      id: "s1",
      userId: "u1",
      token: "tok",
      kind: over.kind ?? "api",
      scope: over.scope ?? null,
      expiresAt: over.expiresAt ?? new Date(Date.now() + 60_000),
      lastUsedAt: null,
    },
    user: { id: "u1", teamId: null, role: "member", emailVerified: true },
  };
}

describe("auth/verifyBearerToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    q.touchSessionLastUsed.mockResolvedValue(undefined);
    q.getTeam.mockResolvedValue(null);
  });

  it("resolves a valid api-kind token", async () => {
    q.getSessionWithUser.mockResolvedValue(sessionRow({ kind: "api" }));
    const result = await verifyBearerToken("tok");
    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe("s1");
  });

  it("rejects an unknown token", async () => {
    q.getSessionWithUser.mockResolvedValue(null);
    expect(await verifyBearerToken("nope")).toBeNull();
  });

  it("rejects an expired token", async () => {
    q.getSessionWithUser.mockResolvedValue(
      sessionRow({ expiresAt: new Date(Date.now() - 1000) }),
    );
    expect(await verifyBearerToken("tok")).toBeNull();
  });

  it("rejects launch-kind handoff tokens (never full-privilege API auth)", async () => {
    q.getSessionWithUser.mockResolvedValue(
      sessionRow({ kind: "launch", scope: "launch:vote launch:submit" }),
    );
    expect(await verifyBearerToken("tok")).toBeNull();
  });

  it("rejects playground-scoped handoff tokens", async () => {
    q.getSessionWithUser.mockResolvedValue(
      sessionRow({ kind: "launch", scope: "playground:score" }),
    );
    expect(await verifyBearerToken("tok")).toBeNull();
  });

  it("rejects any scoped session regardless of kind (defense in depth)", async () => {
    q.getSessionWithUser.mockResolvedValue(
      sessionRow({ kind: "api", scope: "launch:vote" }),
    );
    expect(await verifyBearerToken("tok")).toBeNull();
  });
});
