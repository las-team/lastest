import { describe, expect, it, vi } from "vitest";

import { definePlugin } from "./define";
import { resolveRegistry } from "./registry";
import { createRuntime, UnknownJobTypeError } from "./runtime";

const log = {
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const factories = {
  browser: () => ({ withBrowser: vi.fn(), withBrowserSwarm: vi.fn() }),
  ai: () => ({ generate: vi.fn(), budget: vi.fn() }),
};

function runtimeFor(
  plugins: Parameters<typeof resolveRegistry>[0],
  resolveScope = vi.fn(async () => ({
    team: { id: "t1", plan: "pro" as const, entitlements: new Set(["ai"]) },
    log,
  })),
) {
  return {
    runtime: createRuntime({
      registry: resolveRegistry(plugins),
      factories,
      resolveScope,
    }),
    resolveScope,
  };
}

describe("contextFor", () => {
  it("builds a context from the injected scope resolver", async () => {
    // The plugin never learns how the team was established — that is what
    // stops it widening its own scope.
    const explorer = definePlugin({
      id: "explorer",
      title: "Explorer",
      capabilities: ["browser"],
    });
    const { runtime } = runtimeFor([explorer]);

    const ctx = await runtime.contextFor(explorer);

    expect(ctx.pluginId).toBe("explorer");
    expect(ctx.team.id).toBe("t1");
    expect(ctx.browser).toBeDefined();
    expect("ai" in ctx).toBe(false);
  });

  it("passes the repository through to the resolver so it can authorize it", async () => {
    const explorer = definePlugin({ id: "explorer", title: "Explorer" });
    const { runtime, resolveScope } = runtimeFor([explorer]);

    await runtime.contextFor(explorer, { repositoryId: "r1" });

    expect(resolveScope).toHaveBeenCalledWith({
      pluginId: "explorer",
      repositoryId: "r1",
    });
  });

  it("propagates a rejected authorization instead of building a context", async () => {
    // The resolver is where `requireRepoAccess` lives. If it throws, no context
    // — and therefore no capability — is ever constructed.
    const explorer = definePlugin({
      id: "explorer",
      title: "Explorer",
      capabilities: ["browser"],
    });
    const { runtime } = runtimeFor(
      [explorer],
      vi.fn(async () => {
        throw new Error("Forbidden");
      }),
    );

    await expect(runtime.contextFor(explorer)).rejects.toThrow("Forbidden");
  });
});

describe("dispatch", () => {
  it("runs the registered handler with a context and the payload", async () => {
    const handler = vi.fn(async () => {});
    const explorer = definePlugin({
      id: "explorer",
      title: "Explorer",
      capabilities: ["browser"],
      jobs: { "explorer.run": handler },
    });
    const { runtime } = runtimeFor([explorer]);
    const run = {
      id: "j1",
      attempt: 1,
      maxAttempts: 3,
      signal: new AbortController().signal,
    };

    await runtime.dispatch("explorer.run", { sessionId: "s1" }, run);

    expect(handler).toHaveBeenCalledTimes(1);
    const [ctx, payload, passedRun] = handler.mock.calls[0] as unknown[];
    expect((ctx as { pluginId: string }).pluginId).toBe("explorer");
    expect(payload).toEqual({ sessionId: "s1" });
    expect(passedRun).toBe(run);
  });

  it("resolves the scope for a background run that has no session", async () => {
    // The cron path: a trigger fires hours later with only a teamId to go on.
    const explorer = definePlugin({
      id: "explorer",
      title: "Explorer",
      jobs: { "explorer.scheduled": vi.fn(async () => {}) },
    });
    const { runtime, resolveScope } = runtimeFor([explorer]);

    await runtime.dispatch(
      "explorer.scheduled",
      {},
      {
        id: "j1",
        attempt: 1,
        maxAttempts: 1,
        signal: new AbortController().signal,
      },
      { teamId: "t9" },
    );

    expect(resolveScope).toHaveBeenCalledWith({
      pluginId: "explorer",
      teamId: "t9",
    });
  });

  it("rejects a job type no plugin claims", async () => {
    // A stale queue row after a plugin was removed.
    const { runtime } = runtimeFor([
      definePlugin({ id: "explorer", title: "Explorer" }),
    ]);

    await expect(
      runtime.dispatch(
        "ghost.work",
        {},
        {
          id: "j1",
          attempt: 1,
          maxAttempts: 1,
          signal: new AbortController().signal,
        },
      ),
    ).rejects.toBeInstanceOf(UnknownJobTypeError);
  });
});
