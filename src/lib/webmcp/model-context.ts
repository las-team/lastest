/**
 * The `document.modelContext` side of the bridge: feature detection, tool
 * registration, consent, and result shaping.
 *
 * Every touch of the WebMCP API lives here. The spec is still moving — the
 * getter moved from `Navigator` to `Document` in May 2026 and
 * `navigator.modelContext` is deprecated in Chromium 150 — so the rest of the
 * app should never reference it directly.
 */
import { callBridge } from "@/lib/webmcp/bridge-client";
import { buildToolArguments, isToolAvailable } from "@/lib/webmcp/arguments";
import type {
  JsonSchemaObject,
  WebMcpContext,
  WebMcpToolDef,
} from "@/lib/webmcp/types";

interface ModelContextLike {
  registerTool(descriptor: {
    name: string;
    title?: string;
    description: string;
    inputSchema: JsonSchemaObject;
    annotations?: { readOnlyHint?: boolean };
    execute: (input: Record<string, unknown>) => Promise<unknown>;
  }): unknown;
  unregisterTool?(name: string): unknown;
  requestUserInteraction?(): unknown;
}

/**
 * `document.modelContext` per the current draft, falling back to the
 * deprecated `navigator.modelContext` for Chrome 146-149 and for the
 * `@mcp-b` polyfill, which still installs on `navigator`.
 */
export function getModelContext(): ModelContextLike | null {
  if (typeof document === "undefined") return null;
  const candidates = [
    (document as unknown as { modelContext?: ModelContextLike }).modelContext,
    typeof navigator !== "undefined"
      ? (navigator as unknown as { modelContext?: ModelContextLike })
          .modelContext
      : undefined,
  ];
  for (const mc of candidates) {
    if (mc && typeof mc.registerTool === "function") return mc;
  }
  return null;
}

/**
 * Ask before a mutation runs. `requestUserInteraction()` is the spec's
 * human-in-the-loop hook; agent clients (ChatGPT's site tools, Chrome) also run
 * their own confirmation for consequential actions, but we do not rely on any
 * particular client's policy. `window.confirm` is the fallback for the polyfill
 * path, which has no browser-native UI to raise.
 */
async function requireConsent(
  mc: ModelContextLike,
  tool: WebMcpToolDef,
): Promise<void> {
  if (typeof mc.requestUserInteraction === "function") {
    await mc.requestUserInteraction();
    return;
  }
  const ok =
    typeof window !== "undefined" &&
    window.confirm(`Allow the AI agent to run "${tool.title}" in Lastest?`);
  if (!ok) throw new Error("The user declined this action.");
}

/**
 * MCP returns `{ content: [{ type: "text", text }] }`; our tools put JSON in
 * that text. Agents do better with the object than with a JSON string, and
 * WebMCP allows returning plain objects, so unwrap when we can.
 */
export function shapeResult(result: unknown): unknown {
  const content = (result as { content?: unknown })?.content;
  if (!Array.isArray(content)) return result;
  const text = content
    .filter(
      (part): part is { type: "text"; text: string } =>
        typeof part === "object" &&
        part !== null &&
        (part as { type?: string }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string",
    )
    .map((part) => part.text)
    .join("\n");
  if (!text) return result;
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

/**
 * Register every tool whose route context is satisfied. Returns a disposer —
 * callers must invoke it on unmount. Unregistering matters: the March 2026 spec
 * revision dropped `provideContext()` precisely because tools outlived the UI
 * that backed them, and a stale `lastest_approve_diffs` pointing at a build the
 * user has navigated away from is exactly that bug.
 */
export function registerWebMcpTools(
  tools: readonly WebMcpToolDef[],
  context: WebMcpContext,
): () => void {
  const mc = getModelContext();
  if (!mc) return () => {};

  const registered: string[] = [];
  for (const tool of tools) {
    if (!isToolAvailable(tool, context)) continue;
    try {
      mc.registerTool({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: { readOnlyHint: tool.readOnly },
        execute: async (input: Record<string, unknown>) => {
          if (tool.consent) await requireConsent(mc, tool);
          const args = buildToolArguments(tool, input, context);
          const response = await callBridge({
            op: "call",
            name: tool.source.tool,
            arguments: args,
          });
          if (!response.ok) throw new Error(response.error);
          if (response.op !== "call") {
            throw new Error("Unexpected response from the Lastest bridge.");
          }
          if (response.isError) {
            throw new Error(
              JSON.stringify(shapeResult(response.result)).slice(0, 500),
            );
          }
          return shapeResult(response.result);
        },
      });
      registered.push(tool.name);
    } catch {
      // One bad descriptor must not take the rest of the surface down.
    }
  }

  return () => {
    for (const name of registered) {
      try {
        mc.unregisterTool?.(name);
      } catch {
        // Nothing useful to do if the document is already gone.
      }
    }
  };
}
