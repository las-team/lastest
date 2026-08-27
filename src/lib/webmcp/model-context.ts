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
import { requestWebMcpConsent } from "@/lib/webmcp/consent";
import type {
  JsonSchemaObject,
  WebMcpContext,
  WebMcpToolDef,
} from "@/lib/webmcp/types";

interface ModelContextLike {
  registerTool(
    descriptor: {
      name: string;
      title?: string;
      description: string;
      inputSchema: JsonSchemaObject;
      annotations?: { readOnlyHint?: boolean };
      execute: (input: Record<string, unknown>) => Promise<unknown>;
    },
    /**
     * The current draft unregisters through an `AbortSignal` passed here, and
     * has no `unregisterTool` in its IDL; Chrome's implementation and the
     * ChatGPT docs still describe `unregisterTool`. We do both — see
     * `registerWebMcpTools`.
     */
    options?: { signal?: AbortSignal },
  ): unknown;
  unregisterTool?(name: string): unknown;
  /**
   * Present in Chrome's implementation; dropped from at least one draft
   * revision. Called opportunistically — Lastest's own consent dialog
   * (`requestWebMcpConsent`) is the gate that actually holds.
   */
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
 * Ask before a mutation runs. `requestUserInteraction()` (where it exists) only
 * buys the page a moment of user attention — it does not say what is about to
 * happen — so it is best-effort, and the decision is always Lastest's own
 * dialog naming the exact action. Agent clients run their own confirmation for
 * consequential actions too, but we do not rely on any client's policy.
 */
async function requireConsent(
  mc: ModelContextLike,
  tool: WebMcpToolDef,
): Promise<void> {
  if (typeof mc.requestUserInteraction === "function") {
    try {
      await mc.requestUserInteraction();
    } catch {
      // Not available in this client, or the user dismissed the browser's own
      // prompt — our dialog below is the decision either way.
    }
  }
  const allowed = await requestWebMcpConsent({
    title: tool.title,
    description: tool.description,
  });
  if (!allowed) throw new Error("The user declined this action.");
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
 * Install the `@mcp-b/webmcp-polyfill` runtime when the browser has none.
 *
 * This does not conjure an agent: it gives pages a spec-shaped
 * `document.modelContext` that extension-based clients (the MCP-B extension)
 * can bridge to a desktop agent. Native implementations always win — the
 * polyfill is only reached when `getModelContext()` came back empty. Loaded
 * dynamically so it stays out of the main bundle for the browsers that do not
 * need it.
 */
export async function ensureModelContext(): Promise<ModelContextLike | null> {
  const native = getModelContext();
  if (native) return native;
  if (typeof window === "undefined") return null;
  try {
    const { initializeWebMCPPolyfill } = await import("@mcp-b/webmcp-polyfill");
    initializeWebMCPPolyfill();
  } catch {
    return null;
  }
  return getModelContext();
}

/**
 * How a registered tool reaches the server. Defaults to the signed-in bridge
 * (`/api/mcp/session`); the public share surface passes its own, because those
 * tools are slug-scoped and unauthenticated.
 */
export type WebMcpDispatch = (
  tool: WebMcpToolDef,
  args: Record<string, unknown>,
) => Promise<unknown>;

const sessionDispatch: WebMcpDispatch = async (tool, args) => {
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
    throw new Error(JSON.stringify(shapeResult(response.result)).slice(0, 500));
  }
  return shapeResult(response.result);
};

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
  options: { dispatch?: WebMcpDispatch } = {},
): () => void {
  const mc = getModelContext();
  if (!mc) return () => {};
  const dispatch = options.dispatch ?? sessionDispatch;

  const registered: string[] = [];
  // The draft unregisters through an AbortSignal passed at registration;
  // `unregisterTool` below covers the implementations that shipped before it.
  const abort = new AbortController();

  for (const tool of tools) {
    if (!isToolAvailable(tool, context)) continue;
    try {
      mc.registerTool(
        {
          name: tool.name,
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: { readOnlyHint: tool.readOnly },
          execute: async (input: Record<string, unknown>) => {
            if (tool.consent) await requireConsent(mc, tool);
            return dispatch(tool, buildToolArguments(tool, input, context));
          },
        },
        { signal: abort.signal },
      );
      registered.push(tool.name);
    } catch {
      // One bad descriptor must not take the rest of the surface down.
    }
  }

  return () => {
    abort.abort();
    for (const name of registered) {
      try {
        mc.unregisterTool?.(name);
      } catch {
        // Nothing useful to do if the document is already gone.
      }
    }
  };
}

/**
 * `registerWebMcpTools`, preceded by the polyfill install. The providers use
 * this; the synchronous form stays for callers that already know the API is
 * present.
 */
export async function registerWebMcpToolsWithPolyfill(
  tools: readonly WebMcpToolDef[],
  context: WebMcpContext,
  options: { dispatch?: WebMcpDispatch } = {},
): Promise<() => void> {
  await ensureModelContext();
  return registerWebMcpTools(tools, context, options);
}
