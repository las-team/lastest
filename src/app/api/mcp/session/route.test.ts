/**
 * The WebMCP bridge is a cookie-authed JSON endpoint, i.e. a CSRF target. These
 * tests pin the gate: custom header + same-origin + a session, in that order,
 * before any tool can be listed or called.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const getCurrentSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getCurrentSession: () => getCurrentSession(),
}));

import { POST } from "./route";

const ORIGIN = "http://localhost:3000";
const URL_ = `${ORIGIN}/api/mcp/session`;

function req(
  headers: Record<string, string>,
  body: unknown = { op: "list" },
): NextRequest {
  return new NextRequest(URL_, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const goodHeaders = {
  "x-lastest-webmcp": "1",
  origin: ORIGIN,
  "sec-fetch-site": "same-origin",
  cookie: "better-auth.session_token=abc",
};

beforeEach(() => {
  getCurrentSession.mockReset();
  getCurrentSession.mockResolvedValue({
    user: { id: "u1" },
    team: { id: "t1" },
  });
});

describe("POST /api/mcp/session", () => {
  it("rejects a request without the custom header (the CSRF gate)", async () => {
    const res = await POST(req({ origin: ORIGIN, cookie: "x=1" }));
    expect(res.status).toBe(403);
    expect(getCurrentSession).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin Origin", async () => {
    const res = await POST(
      req({ ...goodHeaders, origin: "https://evil.example" }),
    );
    expect(res.status).toBe(403);
  });

  it("rejects a cross-site Sec-Fetch-Site", async () => {
    const res = await POST(
      req({ ...goodHeaders, "sec-fetch-site": "cross-site" }),
    );
    expect(res.status).toBe(403);
  });

  it("401s when nobody is signed in", async () => {
    getCurrentSession.mockResolvedValue(null);
    const res = await POST(req(goodHeaders));
    expect(res.status).toBe(401);
  });

  it("401s when the session cookie cannot be forwarded", async () => {
    const { cookie: _omitted, ...noCookie } = goodHeaders;
    const res = await POST(req(noCookie));
    expect(res.status).toBe(401);
  });

  it("rejects unsupported ops", async () => {
    const res = await POST(req(goodHeaders, { op: "prompts/list" }));
    expect(res.status).toBe(400);
  });

  it("lists the real MCP tool surface for a signed-in user", async () => {
    const res = await POST(req(goodHeaders));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.op).toBe("list");
    const names = body.tools.map((t: { name: string }) => t.name);
    expect(names).toContain("lastest_run_tests");
    expect(names).toContain("lastest_decide_diff");
    expect(names.length).toBeGreaterThan(20);
  });
});
