/**
 * Types shared by the WebMCP bridge (`src/lib/webmcp/*`) and the client
 * components that register tools (`src/components/webmcp/*`).
 *
 * WebMCP (W3C Web Machine Learning CG) lets a page hand typed tools to whatever
 * agent the user is running — Chrome 149's origin trial, and ChatGPT desktop /
 * ChatGPT Work / Codex, which call the same thing "site tools". We do not
 * define a second tool surface for it: every tool here is a narrowed view of a
 * tool that already exists in `@lastest/mcp-server`, executed through
 * `/api/mcp/session`. See `docs/design/webmcp.md`.
 */

/** The subset of JSON Schema we hand to agents. */
export interface JsonSchemaObject {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

/** Ids the current route can contribute, used to prefill tool arguments. */
export interface WebMcpContext {
  repositoryId?: string;
  buildId?: string;
  testId?: string;
}

export type WebMcpContextKey = keyof WebMcpContext;

/** Which page a tool belongs to. `global` is registered app-wide. */
export type WebMcpScope = "global" | "repo" | "build" | "test";

export interface WebMcpToolDef {
  /** Name the agent sees. Narrow and action-oriented, not the MCP tool's name. */
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchemaObject;
  scope: WebMcpScope;
  /**
   * `readOnlyHint` on the registered descriptor. A hint, not a guarantee — the
   * real enforcement is that `source.bind` pins the action and the server-side
   * capability guards run regardless.
   */
  readOnly: boolean;
  /**
   * Ask the user before dispatching (via `requestUserInteraction()`, falling
   * back to an in-page confirm). Required for every mutation: an agent that
   * read a hostile page elsewhere is the realistic attacker, and "approve all
   * diffs" is exactly what it would aim at.
   */
  consent?: boolean;
  /** Route-context ids merged into the arguments before dispatch. */
  needs?: readonly WebMcpContextKey[];
  /** The `@lastest/mcp-server` tool this narrows, plus its pinned arguments. */
  source: {
    tool: string;
    bind?: Record<string, unknown>;
  };
}

/** Wire shape of `POST /api/mcp/session`. */
export type WebMcpBridgeRequest =
  | { op: "list" }
  | { op: "call"; name: string; arguments?: Record<string, unknown> };

export interface WebMcpBridgeToolInfo {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export type WebMcpBridgeResponse =
  | { ok: true; op: "list"; tools: WebMcpBridgeToolInfo[] }
  | { ok: true; op: "call"; result: unknown; isError?: boolean }
  | { ok: false; error: string };
