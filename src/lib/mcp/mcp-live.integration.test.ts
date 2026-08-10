/**
 * Runtime verification for §3 "MCP server" (core-plugin-refactor-test-plan.md,
 * P2 row — untouched by this refactor, but exercised for real per the plan).
 *
 * Lives under `src/` (not `packages/mcp-server/`) so it can import `@/lib/db`
 * directly without the mcp-server package reaching back into the app —
 * `@lastest/mcp-server` is meant to be a standalone published CLI, so a
 * cross-boundary `@/` import belongs on the app side of that seam, not
 * inside the package itself.
 *
 * Mints a real DB-backed API token (same shape `createApiToken` in
 * src/lib/db/queries/auth.ts writes: a `sessions` row with kind='api'), spawns
 * the actual production entry point (`packages/mcp-server/bin/lastest-mcp.js`
 * → `dist/index.js`'s exported `main()` — same thing `npx @lastest/mcp-server`
 * or a configured MCP client would run; requires `pnpm --filter
 * @lastest/mcp-server build` to have been run at least once) as a child
 * process pointed at the live app, and drives it with the real
 * `@modelcontextprotocol/sdk` Client over stdio: list tools, then call
 * read-only tools end to end.
 *
 * (`packages/mcp-server/src/index.ts`'s `main()` is exported but never
 * self-invoked — only the bin wrapper calls it — so running the TS source
 * directly through tsx silently does nothing; confirmed by hand while
 * writing this file. The built bin is the only thing that actually starts
 * the server, which is what a real client uses anyway.)
 *
 * Run with `pnpm test:integration`.
 */
import { v4 as uuid } from "uuid";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { db } from "@/lib/db";
import { sessions, teams, users } from "@/lib/db/schema";

const APP_ORIGIN = process.env.LASTEST_URL || "http://localhost:3000";
const MCP_BIN = new URL(
  "../../../packages/mcp-server/bin/lastest-mcp.js",
  import.meta.url,
).pathname;

let teamId: string;
let userId: string;
let token: string;
let client: Client;
let transport: StdioClientTransport;

beforeAll(async () => {
  teamId = uuid();
  await db.insert(teams).values({
    id: teamId,
    name: `mcp-test-${teamId.slice(0, 8)}`,
    slug: `mcp-test-${teamId.slice(0, 8)}`,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  userId = uuid();
  await db.insert(users).values({
    id: userId,
    email: `mcp-test-${userId.slice(0, 8)}@example.test`,
    name: "MCP Test User",
    teamId,
    role: "owner",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  token = `mcp-integration-test-${uuid()}`;
  await db.insert(sessions).values({
    id: uuid(),
    userId,
    token,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    kind: "api",
    label: "integration-test",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_BIN, "--url", APP_ORIGIN, "--api-key", token],
    stderr: "pipe",
  });
  client = new Client({ name: "integration-test-client", version: "0.0.0" });
  await client.connect(transport);
}, 30_000);

afterAll(async () => {
  await client?.close().catch(() => {});
  await db.delete(sessions).where(eq(sessions.token, token));
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(teams).where(eq(teams.id, teamId));
});

describe("MCP server — real stdio client against the live app", () => {
  it("lists tools, including the read-only repo/status resources", async () => {
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(10);
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        "lastest_status",
        "lastest_repo",
        "lastest_test",
      ]),
    );
  });

  it("runs a real tool call (lastest_status health) end to end", async () => {
    const result = await client.callTool({
      name: "lastest_status",
      arguments: { action: "health" },
    });
    expect(result.isError).not.toBe(true);
    const text = (result.content as Array<{ type: string; text?: string }>)
      .map((c) => c.text ?? "")
      .join("");
    expect(text.length).toBeGreaterThan(0);
  });

  it("runs lastest_repo list, scoped to this token's own team", async () => {
    const result = await client.callTool({
      name: "lastest_repo",
      arguments: { action: "list" },
    });
    expect(result.isError).not.toBe(true);
  });
});
