import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserSession } from "@lastest/contracts";

/**
 * What is being tested here is one thing: `AiCallOptions.browserTools` is the
 * only way a plugin gets an agentic browser loop, and the CDP endpoint it
 * resolves to never leaves this file.
 *
 * `generateWithAI` is stubbed so the assertions can read the options object
 * core builds — which is where the endpoint would appear if it leaked.
 */

const generateWithAI = vi.fn(async (..._args: unknown[]) => "{}");
const resolveSessionCdpUrl = vi.fn<(s: BrowserSession) => string | undefined>();

vi.mock("@/lib/ai", () => ({
  generateWithAI: (...args: unknown[]) =>
    (generateWithAI as unknown as (...a: unknown[]) => Promise<string>)(
      ...args,
    ),
}));
vi.mock("@lastest/core-browser/internal", () => ({
  resolveSessionCdpUrl: (s: BrowserSession) => resolveSessionCdpUrl(s),
}));
let provider = "openrouter";
vi.mock("@/lib/db/queries", () => ({
  getAISettings: async () => ({ provider, explorerModel: null }),
}));
vi.mock("@/lib/playwright/agent-context", () => ({
  getAIConfig: (settings: { provider: string }) => ({
    provider: settings.provider,
  }),
}));

const { createAiFactory } = await import("./ai-capability");

const scope = {
  team: { id: "t1", plan: "pro" as const, entitlements: new Set(["ai"]) },
  repo: { id: "r1" },
};

function capability() {
  return createAiFactory()(
    "quickstart-scout",
    scope as unknown as Parameters<ReturnType<typeof createAiFactory>>[1],
  );
}

/** A session object with nothing readable on it — the plugin's view. */
const opaqueSession = {
  id: "sess-1",
  page: {},
  streamUrl: null,
  authApplied: false,
} as unknown as BrowserSession;

beforeEach(() => {
  vi.clearAllMocks();
  provider = "openrouter";
  generateWithAI.mockResolvedValue("{}");
});

describe("browserTools", () => {
  it("spawns Playwright MCP against the resolved endpoint", async () => {
    resolveSessionCdpUrl.mockReturnValue("http://10.0.0.5:9232");

    await capability().generate("go", {
      actionType: "agent_discover",
      browserTools: opaqueSession,
    });

    const opts = generateWithAI.mock.calls[0]![3] as {
      useMCP?: boolean;
      mcpConfig?: {
        cdpEndpoint?: string;
        servers?: Record<string, { args?: string[] }>;
      };
    };
    expect(opts.useMCP).toBe(true);
    expect(opts.mcpConfig?.cdpEndpoint).toBe("http://10.0.0.5:9232");
    expect(opts.mcpConfig?.servers?.playwright?.args).toContain(
      "--cdp-endpoint",
    );
    // The plugin passed an object, not a string — the lookup is what produced
    // the address, and it happened here.
    expect(resolveSessionCdpUrl).toHaveBeenCalledWith(opaqueSession);
  });

  it("refuses a session core cannot resolve rather than falling back", async () => {
    // A forged session, or one whose withBrowser scope already ended. Passing
    // `useMCP: true` with no endpoint would spawn a Chromium in this process.
    resolveSessionCdpUrl.mockReturnValue(undefined);

    await expect(
      capability().generate("go", {
        actionType: "agent_discover",
        browserTools: opaqueSession,
      }),
    ).rejects.toThrow(/session core did not issue|scope has already ended/);

    expect(generateWithAI).not.toHaveBeenCalled();
  });

  it("locks the agent-SDK path to browser tools only", async () => {
    resolveSessionCdpUrl.mockReturnValue("http://10.0.0.5:9232");
    // The branch keys off the resolved provider, so this is what selects it.
    provider = "claude-agent-sdk";

    await capability().generate("go", {
      actionType: "agent_discover",
      browserTools: opaqueSession,
    });

    const config = generateWithAI.mock.calls[0]![0] as {
      agentSdkStrictMcpConfig?: boolean;
      agentSdkAllowedTools?: string[];
      agentSdkDisallowedTools?: string[];
    };
    const opts = generateWithAI.mock.calls[0]![3] as { useMCP?: boolean };
    // Without strict mode the SDK falls back to WebFetch when a browser tool
    // fails, which silently turns a browser session into an HTTP fetch.
    expect(config.agentSdkStrictMcpConfig).toBe(true);
    expect(config.agentSdkAllowedTools).toEqual(["mcp__playwright__*"]);
    expect(config.agentSdkDisallowedTools).toContain("WebFetch");
    expect(opts.useMCP).toBe(false);
  });

  it("does not touch MCP wiring when no session is passed", async () => {
    await capability().generate("go", { actionType: "explorer_plan" });

    const opts = generateWithAI.mock.calls[0]![3] as { useMCP?: boolean };
    expect(opts.useMCP).toBeUndefined();
    expect(resolveSessionCdpUrl).not.toHaveBeenCalled();
  });
});

describe("promptLogId", () => {
  it("is returned so a plugin can point an operator at the prompt log", async () => {
    generateWithAI.mockImplementation(async (...args: unknown[]) => {
      const o = args[3] as { onLogCreated?: (id: string) => void };
      o.onLogCreated?.("log-42");
      return "{}";
    });

    const res = await capability().generate("go", {
      actionType: "agent_discover",
    });

    expect(res.promptLogId).toBe("log-42");
    // Still no spend data — that stays behind `budget()`.
    expect(res.inputTokens).toBe(0);
  });
});

describe("action-type attribution", () => {
  it("passes `agent_discover` through instead of dropping it", async () => {
    await capability().generate("go", { actionType: "agent_discover" });

    const opts = generateWithAI.mock.calls[0]![3] as { actionType?: string };
    expect(opts.actionType).toBe("agent_discover");
  });

  it("still drops an action type the enum column does not have", async () => {
    await capability().generate("go", { actionType: "not_a_real_action" });

    const opts = generateWithAI.mock.calls[0]![3] as { actionType?: string };
    expect(opts.actionType).toBeUndefined();
  });
});
