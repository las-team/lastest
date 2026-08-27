/**
 * Runs in the default node environment with a hand-stubbed `document` /
 * `window` — the module only ever touches `document.modelContext` and
 * `window.confirm`, so a real DOM would buy nothing (and jsdom is not a
 * dependency of this repo).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const callBridge = vi.fn();
vi.mock("@/lib/webmcp/bridge-client", () => ({
  callBridge: (...args: unknown[]) => callBridge(...args),
  WEBMCP_BRIDGE_PATH: "/api/mcp/session",
  WEBMCP_BRIDGE_HEADER: "x-lastest-webmcp",
}));

import {
  getModelContext,
  registerWebMcpTools,
  shapeResult,
} from "@/lib/webmcp/model-context";
import { setWebMcpConsentHandler } from "@/lib/webmcp/consent";

type Descriptor = {
  name: string;
  annotations?: { readOnlyHint?: boolean };
  execute: (input: Record<string, unknown>) => Promise<unknown>;
};

const confirmMock = vi.fn();

function installGlobals() {
  Object.defineProperty(globalThis, "document", {
    value: {},
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "window", {
    value: { confirm: (msg: string) => confirmMock(msg) },
    configurable: true,
    writable: true,
  });
}

const signals: AbortSignal[] = [];

function installModelContext(withInteraction = true) {
  const registered = new Map<string, Descriptor>();
  const requestUserInteraction = vi.fn().mockResolvedValue(undefined);
  const mc = {
    registerTool: (d: Descriptor, options?: { signal?: AbortSignal }) => {
      if (options?.signal) signals.push(options.signal);
      registered.set(d.name, d);
    },
    unregisterTool: (name: string) => registered.delete(name),
    ...(withInteraction ? { requestUserInteraction } : {}),
  };
  (document as unknown as { modelContext: unknown }).modelContext = mc;
  return { registered, requestUserInteraction };
}

beforeEach(() => {
  installGlobals();
  signals.length = 0;
  confirmMock.mockReset();
  confirmMock.mockReturnValue(true);
  callBridge.mockReset();
  callBridge.mockResolvedValue({
    ok: true,
    op: "call",
    result: { content: [{ type: "text", text: '{"status":"ok"}' }] },
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "document");
  Reflect.deleteProperty(globalThis, "window");
});

describe("getModelContext", () => {
  it("returns null when the browser has no WebMCP", () => {
    expect(getModelContext()).toBeNull();
  });
});

describe("shapeResult", () => {
  it("unwraps MCP text content into an object", () => {
    expect(
      shapeResult({ content: [{ type: "text", text: '{"a":1}' }] }),
    ).toEqual({ a: 1 });
  });

  it("keeps non-JSON text as text", () => {
    expect(shapeResult({ content: [{ type: "text", text: "hello" }] })).toEqual(
      {
        text: "hello",
      },
    );
  });

  it("passes anything else through", () => {
    expect(shapeResult({ a: 1 })).toEqual({ a: 1 });
  });
});

describe("registerWebMcpTools", () => {
  it("registers only tools whose ids the route supplies, and unregisters them", () => {
    const { registered } = installModelContext();
    const dispose = registerWebMcpTools(
      [
        {
          name: "read_thing",
          title: "Read",
          description: "d",
          inputSchema: { type: "object", properties: {} },
          scope: "global",
          readOnly: true,
          source: { tool: "lastest_status", bind: { action: "jobs" } },
        },
        {
          name: "needs_build",
          title: "Build",
          description: "d",
          inputSchema: { type: "object", properties: {} },
          scope: "build",
          readOnly: true,
          needs: ["buildId"],
          source: { tool: "lastest_build", bind: { action: "review" } },
        },
      ],
      {},
    );

    expect([...registered.keys()]).toEqual(["read_thing"]);
    expect(registered.get("read_thing")?.annotations?.readOnlyHint).toBe(true);
    dispose();
    expect(registered.size).toBe(0);
  });

  it("dispatches the bound arguments through the bridge", async () => {
    const { registered } = installModelContext();
    registerWebMcpTools(
      [
        {
          name: "review",
          title: "Review",
          description: "d",
          inputSchema: { type: "object", properties: {} },
          scope: "build",
          readOnly: true,
          needs: ["buildId"],
          source: { tool: "lastest_build", bind: { action: "review" } },
        },
      ],
      { buildId: "b1" },
    );

    await expect(registered.get("review")!.execute({})).resolves.toEqual({
      status: "ok",
    });
    expect(callBridge).toHaveBeenCalledWith({
      op: "call",
      name: "lastest_build",
      arguments: { buildId: "b1", action: "review" },
    });
  });

  it("asks for user interaction before a mutation", async () => {
    const { registered, requestUserInteraction } = installModelContext();
    registerWebMcpTools(
      [
        {
          name: "run",
          title: "Run tests",
          description: "d",
          inputSchema: { type: "object", properties: {} },
          scope: "repo",
          readOnly: false,
          consent: true,
          needs: ["repositoryId"],
          source: { tool: "lastest_run_tests" },
        },
      ],
      { repositoryId: "r1" },
    );

    await registered.get("run")!.execute({});
    expect(requestUserInteraction).toHaveBeenCalledOnce();
  });

  it("refuses a mutation the user declines on the polyfill path", async () => {
    const { registered } = installModelContext(false);
    confirmMock.mockReturnValue(false);
    registerWebMcpTools(
      [
        {
          name: "run",
          title: "Run tests",
          description: "d",
          inputSchema: { type: "object", properties: {} },
          scope: "repo",
          readOnly: false,
          consent: true,
          needs: ["repositoryId"],
          source: { tool: "lastest_run_tests" },
        },
      ],
      { repositoryId: "r1" },
    );

    await expect(registered.get("run")!.execute({})).rejects.toThrow(
      /declined/,
    );
    expect(callBridge).not.toHaveBeenCalled();
  });

  it("surfaces bridge errors to the agent", async () => {
    const { registered } = installModelContext();
    callBridge.mockResolvedValue({ ok: false, error: "Not signed in." });
    registerWebMcpTools(
      [
        {
          name: "read",
          title: "Read",
          description: "d",
          inputSchema: { type: "object", properties: {} },
          scope: "global",
          readOnly: true,
          source: { tool: "lastest_status", bind: { action: "jobs" } },
        },
      ],
      {},
    );
    await expect(registered.get("read")!.execute({})).rejects.toThrow(
      "Not signed in.",
    );
  });
});

describe("consent handler", () => {
  it("routes consent through the in-app dialog when one is mounted", async () => {
    const { registered } = installModelContext(false);
    const asked: string[] = [];
    const dispose = setWebMcpConsentHandler(async (request) => {
      asked.push(request.title);
      return true;
    });
    registerWebMcpTools(
      [
        {
          name: "run",
          title: "Run tests",
          description: "d",
          inputSchema: { type: "object", properties: {} },
          scope: "repo",
          readOnly: false,
          consent: true,
          needs: ["repositoryId"],
          source: { tool: "lastest_run_tests" },
        },
      ],
      { repositoryId: "r1" },
    );

    await registered.get("run")!.execute({});
    expect(asked).toEqual(["Run tests"]);
    // The dialog answered, so the crude fallback must not have been reached.
    expect(confirmMock).not.toHaveBeenCalled();
    dispose();
  });

  it("aborts registration on dispose so tools cannot outlive the page", () => {
    const { registered } = installModelContext();
    const dispose = registerWebMcpTools(
      [
        {
          name: "read",
          title: "Read",
          description: "d",
          inputSchema: { type: "object", properties: {} },
          scope: "global",
          readOnly: true,
          source: { tool: "lastest_status", bind: { action: "jobs" } },
        },
      ],
      {},
    );
    expect(signals.at(-1)?.aborted).toBe(false);
    dispose();
    expect(signals.at(-1)?.aborted).toBe(true);
    expect(registered.size).toBe(0);
  });

  it("registers nothing once the caller's signal is aborted", () => {
    // StrictMode's double-effect: the first pass is cancelled while it awaits
    // the polyfill install, and must not register on the way back — its
    // disposer runs a microtask *after* the second pass has claimed the same
    // names, which is what "Tool already registered" was.
    const { registered } = installModelContext();
    const controller = new AbortController();
    controller.abort();
    const dispose = registerWebMcpTools(
      [
        {
          name: "read",
          title: "Read",
          description: "d",
          inputSchema: { type: "object", properties: {} },
          scope: "global",
          readOnly: true,
          source: { tool: "lastest_status", bind: { action: "jobs" } },
        },
      ],
      {},
      { signal: controller.signal },
    );
    expect(registered.size).toBe(0);
    dispose();
  });

  it("swallows an async registerTool rejection instead of leaving it unhandled", async () => {
    // The polyfill's registerTool is async: a duplicate name rejects rather
    // than throwing, and an unhandled rejection is a full-page dev overlay.
    installModelContext();
    const mc = (
      document as unknown as { modelContext: { registerTool: unknown } }
    ).modelContext;
    mc.registerTool = () =>
      Promise.reject(
        new DOMException("Tool already registered: read", "InvalidStateError"),
      );
    const onUnhandled = vi.fn();
    process.on("unhandledRejection", onUnhandled);
    try {
      const dispose = registerWebMcpTools(
        [
          {
            name: "read",
            title: "Read",
            description: "d",
            inputSchema: { type: "object", properties: {} },
            scope: "global",
            readOnly: true,
            source: { tool: "lastest_status", bind: { action: "jobs" } },
          },
        ],
        {},
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(onUnhandled).not.toHaveBeenCalled();
      dispose();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

describe("custom dispatch", () => {
  it("lets the public share surface bypass the session bridge", async () => {
    const { registered } = installModelContext();
    const dispatch = vi.fn().mockResolvedValue({ site: "example.com" });
    registerWebMcpTools(
      [
        {
          name: "lastest_report_summary",
          title: "Summary",
          description: "d",
          inputSchema: { type: "object", properties: {} },
          scope: "global",
          readOnly: true,
          source: { tool: "report_summary" },
        },
      ],
      {},
      { dispatch },
    );

    await expect(
      registered.get("lastest_report_summary")!.execute({}),
    ).resolves.toEqual({ site: "example.com" });
    expect(callBridge).not.toHaveBeenCalled();
  });
});
