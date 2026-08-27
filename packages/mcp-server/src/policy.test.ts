import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "./server.js";
import { LastestClient } from "./client.js";
import { TOOL_RULES, decideTool, levelAllows } from "./policy.js";
import type { ToolAccessLevel } from "./policy.js";

/**
 * Drift guard for `policy.ts`.
 *
 * The rules table is hand-maintained on purpose (see the header comment in
 * policy.ts), so the thing that has to be automated is noticing when it stops
 * describing the real tool surface: a tool renamed, an action added to an enum,
 * a rule left behind for a tool that no longer exists. Every assertion below is
 * about that gap — none of them re-encode the product judgement itself.
 */

/** The tool list an access level actually gets, read off a live server. */
async function toolsAt(level: ToolAccessLevel) {
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
    const { tools } = await client.listTools();
    return tools;
  } finally {
    await Promise.allSettled([client.close(), server.close()]);
  }
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

  it("fails closed for a tool with no rule", () => {
    expect(decideTool("lastest_not_a_tool", "read").registered).toBe(false);
    expect(decideTool("lastest_not_a_tool", "write").registered).toBe(false);
    expect(decideTool("lastest_not_a_tool", "full").registered).toBe(true);
  });
});
