import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "./server";
import { LastestClient } from "./client";
import { TOOL_RULES, decideTool, levelAllows } from "./policy";
import type { ToolAccessLevel } from "./policy";

/**
 * Drift guard for `policy.ts`.
 *
 * The rules table is hand-maintained on purpose (see the header comment in
 * policy.ts), so the thing that has to be automated is noticing when it stops
 * describing the real tool surface: a tool renamed, an action added to an enum,
 * a rule left behind for a tool that no longer exists. Every assertion below is
 * about that gap — none of them re-encode the product judgement itself.
 */

/** Run `fn` against a live client wired to a server at `level`. */
async function withClientAt<T>(
  level: ToolAccessLevel,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const server = createServer(
    new LastestClient({ baseUrl: "http://localhost:0", apiKey: "test" }),
    { accessLevel: level },
  );
  const client = new Client({ name: "policy-test", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  try {
    return await fn(client);
  } finally {
    await Promise.allSettled([client.close(), server.close()]);
  }
}

/** The tool list an access level actually gets, read off a live server. */
async function toolsAt(level: ToolAccessLevel) {
  return withClientAt(
    level,
    async (client) => (await client.listTools()).tools,
  );
}

/** The `action` enum a tool advertises, if it has one. */
function advertisedActions(
  tool: { inputSchema?: unknown },
  param: string,
): string[] | undefined {
  const schema = tool.inputSchema as
    | { properties?: Record<string, { enum?: string[] }> }
    | undefined;
  return schema?.properties?.[param]?.enum;
}

describe("tool policy", () => {
  it("full sees every tool, and every tool has a rule", async () => {
    const tools = await toolsAt("full");
    const live = tools.map((t) => t.name).sort();
    const ruled = Object.keys(TOOL_RULES).sort();
    expect(live).toEqual(ruled);
  });

  it("each rule's actions match the tool's real action enum", async () => {
    const tools = await toolsAt("full");
    for (const tool of tools) {
      const rule = TOOL_RULES[tool.name];
      const param = rule.actionParam ?? "action";
      const advertised = advertisedActions(tool, param);
      if (!rule.actions) {
        // A tool with no rule actions must not have an action enum either,
        // otherwise a new action would silently inherit the tool-level floor.
        expect(
          advertised,
          `${tool.name} gained an ${param} enum`,
        ).toBeUndefined();
        continue;
      }
      expect(advertised, `${tool.name} lost its ${param} enum`).toBeDefined();
      expect(advertised!.slice().sort()).toEqual(
        Object.keys(rule.actions).sort(),
      );
    }
  });

  it("levels are cumulative — read ⊆ write ⊆ full", async () => {
    const [read, write, full] = await Promise.all([
      toolsAt("read"),
      toolsAt("write"),
      toolsAt("full"),
    ]);
    const names = (t: { name: string }[]) => new Set(t.map((x) => x.name));
    const [r, w, f] = [names(read), names(write), names(full)];
    for (const n of r) expect(w.has(n), `${n} lost at write`).toBe(true);
    for (const n of w) expect(f.has(n), `${n} lost at full`).toBe(true);
    expect(r.size).toBeLessThan(w.size);
    expect(w.size).toBeLessThan(f.size);
  });

  it("never advertises an action the caller may not use", async () => {
    for (const level of ["read", "write"] as const) {
      for (const tool of await toolsAt(level)) {
        const rule = TOOL_RULES[tool.name];
        if (!rule.actions) continue;
        const advertised =
          advertisedActions(tool, rule.actionParam ?? "action") ?? [];
        for (const action of advertised) {
          expect(
            levelAllows(level, rule.actions[action]),
            `${level} was offered ${tool.name}.${action}`,
          ).toBe(true);
        }
      }
    }
  });

  it("no OAuth level reaches a delete, a revoke, or a public share", async () => {
    for (const level of ["read", "write"] as const) {
      const tools = await toolsAt(level);
      const byName = new Map(tools.map((t) => [t.name, t]));
      expect(byName.has("lastest_publish_share")).toBe(false);
      expect(byName.has("lastest_quickstart")).toBe(false);
      for (const [name, rule] of Object.entries(TOOL_RULES)) {
        const destructive = Object.keys(rule.actions ?? {}).filter(
          (a) => a === "delete" || a === "revoke",
        );
        if (!destructive.length) continue;
        const tool = byName.get(name);
        if (!tool) continue;
        const advertised =
          advertisedActions(tool, rule.actionParam ?? "action") ?? [];
        for (const a of destructive) expect(advertised).not.toContain(a);
      }
    }
  });

  it("a read caller cannot CALL a write tool, not merely fail to see it", async () => {
    // The mapping tests above assert what each level is *shown*. This asserts
    // the property the security review actually cares about: that a read-level
    // connection cannot reach a write tool end-to-end. A tool that is not
    // registered has no handler, so the call is rejected by the server itself.
    await withClientAt("read", async (client) => {
      const approve = await client.callTool({
        name: "lastest_decide_diff",
        arguments: { action: "approve", diffId: "d1" },
      });
      expect(approve.isError).toBe(true);
      expect(JSON.stringify(approve.content)).toContain("not found");

      // A `full`-only tool is equally out of reach.
      const publish = await client.callTool({
        name: "lastest_publish_share",
        arguments: { buildId: "b1" },
      });
      expect(publish.isError).toBe(true);
    });
  });

  it("a read caller cannot invoke a write ACTION on a tool it can see", async () => {
    // `lastest_repo` is visible at read, but `create`/`update` are write. The
    // narrowed enum keeps them off the advertised schema; this exercises the
    // handler backstop for a caller that sends one anyway.
    await withClientAt("read", async (client) => {
      const res = await client.callTool({
        name: "lastest_repo",
        arguments: { action: "update", repositoryId: "r1", name: "x" },
      });
      // Either the schema rejects it or the backstop throws — both surface as
      // an error result rather than as a repo that got updated.
      expect(res.isError).toBe(true);
    });
  });

  it("fails closed for a tool with no rule", () => {
    expect(decideTool("lastest_not_a_tool", "read").registered).toBe(false);
    expect(decideTool("lastest_not_a_tool", "write").registered).toBe(false);
    expect(decideTool("lastest_not_a_tool", "full").registered).toBe(true);
  });
});
