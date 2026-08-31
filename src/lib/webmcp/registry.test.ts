/**
 * Drift + safety guard for the WebMCP tool registry.
 *
 * The registry hand-writes narrow JSON Schemas over tools that live in
 * `@lastest/mcp-server`. That is the one place the WebMCP surface stops being
 * generated, so this test lists the real MCP surface (in-process, over an
 * in-memory transport — no server, no DB) and fails when a registry entry
 * refers to a tool or parameter that no longer exists, or when the narrowing
 * that keeps destructive actions away from browser agents is breached.
 */
import { describe, expect, it, beforeAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, LastestClient } from "@lastest/mcp-server";
import {
  WEBMCP_TOOLS,
  WEBMCP_FORBIDDEN_ACTIONS,
  WEBMCP_FORBIDDEN_SOURCE_TOOLS,
} from "@/lib/webmcp/registry";

type McpTool = { name: string; inputSchema?: { properties?: object } };

let mcpTools: Map<string, McpTool>;

beforeAll(async () => {
  // The client never issues a request, so the base URL is never dialled.
  const server = createServer(
    new LastestClient({ baseUrl: "http://localhost:0", apiKey: "unused" }),
  );
  const client = new Client({ name: "registry-test", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  const { tools } = await client.listTools();
  mcpTools = new Map(tools.map((t) => [t.name, t as McpTool]));
  await Promise.all([client.close(), server.close()]);
});

function paramsOf(toolName: string): string[] {
  const schema = mcpTools.get(toolName)?.inputSchema;
  return Object.keys(
    (schema?.properties as Record<string, unknown> | undefined) ?? {},
  );
}

describe("webmcp registry", () => {
  it("has unique tool names", () => {
    const names = WEBMCP_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("only sources tools that still exist in the MCP server", () => {
    for (const tool of WEBMCP_TOOLS) {
      expect(
        mcpTools.has(tool.source.tool),
        `${tool.name} sources unknown MCP tool ${tool.source.tool}`,
      ).toBe(true);
    }
  });

  it("never sources a tool from the forbidden list", () => {
    for (const tool of WEBMCP_TOOLS) {
      expect(
        WEBMCP_FORBIDDEN_SOURCE_TOOLS,
        `${tool.name} must not expose ${tool.source.tool} to browser agents`,
      ).not.toContain(tool.source.tool);
    }
  });

  it("binds and exposes only real parameters of the source tool", () => {
    for (const tool of WEBMCP_TOOLS) {
      const params = paramsOf(tool.source.tool);
      for (const key of Object.keys(tool.source.bind ?? {})) {
        expect(params, `${tool.name} binds unknown param ${key}`).toContain(
          key,
        );
      }
      for (const key of Object.keys(tool.inputSchema.properties)) {
        expect(params, `${tool.name} exposes unknown param ${key}`).toContain(
          key,
        );
      }
      for (const key of tool.needs ?? []) {
        expect(params, `${tool.name} needs unknown param ${key}`).toContain(
          key,
        );
      }
    }
  });

  it("never lets the agent choose the action, and never binds a destructive one", () => {
    for (const tool of WEBMCP_TOOLS) {
      // `action`/`scope` multiplex read and write on several MCP tools. If the
      // agent could set them, `readOnlyHint` would be a lie and
      // `lastest_test` would come with delete attached.
      expect(
        Object.keys(tool.inputSchema.properties),
        `${tool.name} must pin action/scope via source.bind`,
      ).not.toContain("action");
      expect(Object.keys(tool.inputSchema.properties)).not.toContain("scope");

      const bound = tool.source.bind ?? {};
      const action = bound.action ?? bound.scope;
      if (typeof action === "string") {
        expect(
          WEBMCP_FORBIDDEN_ACTIONS,
          `${tool.name} binds destructive action ${action}`,
        ).not.toContain(action);
      }
      // A tool the agent could re-target at another team's resource by passing
      // an id is not route-scoped at all — ids come from the page.
      const needs = new Set<string>(tool.needs ?? []);
      for (const key of ["repositoryId", "buildId", "testId"]) {
        if (needs.has(key)) {
          expect(Object.keys(tool.inputSchema.properties)).not.toContain(key);
        }
      }
    }
  });

  it("requires consent for every write tool", () => {
    for (const tool of WEBMCP_TOOLS) {
      if (!tool.readOnly) {
        expect(tool.consent, `${tool.name} mutates without consent`).toBe(true);
      }
    }
  });

  it("keeps each page's tool count in agent-friendly territory", () => {
    const perScope = (scope: string) =>
      WEBMCP_TOOLS.filter((t) => t.scope === scope).length;
    // global + the deepest route scope is what an agent sees at once.
    expect(perScope("global") + perScope("repo")).toBeLessThanOrEqual(12);
    expect(perScope("global") + perScope("build")).toBeLessThanOrEqual(12);
  });
});
