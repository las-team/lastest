import { describe, expect, it, vi } from "vitest";

import { definePlugin } from "./define";
import { buildContext, PluginRegistryError, resolveRegistry } from "./registry";

const scope = {
  team: { id: "t1", plan: "pro" as const, entitlements: new Set(["ai"]) },
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  },
};

const problemsOf = (fn: () => unknown): string[] => {
  try {
    fn();
  } catch (err) {
    if (err instanceof PluginRegistryError) return err.problems;
    throw err;
  }
  throw new Error("expected resolveRegistry to throw");
};

describe("resolveRegistry", () => {
  it("accepts a well-formed plugin", () => {
    const explorer = definePlugin({
      id: "explorer",
      title: "Explorer",
      capabilities: ["browser", "ai"],
      jobs: { "explorer.run": async () => {} },
    });
    const resolved = resolveRegistry([explorer]);
    expect(resolved.jobTypes.get("explorer.run")).toBe("explorer");
  });

  it("rejects a malformed or duplicated plugin id", () => {
    const problems = problemsOf(() =>
      resolveRegistry([
        definePlugin({ id: "QA_Agent", title: "a" }),
        definePlugin({ id: "rca", title: "b" }),
        definePlugin({ id: "rca", title: "c" }),
      ]),
    );
    expect(problems).toContain(
      '"QA_Agent" is not a valid plugin id (expected kebab-case, e.g. "qa-agent")',
    );
    expect(problems).toContain('duplicate plugin id "rca"');
  });

  it("rejects a job type that is not namespaced to its plugin", () => {
    // Without this, one plugin could register a handler for another's work.
    const problems = problemsOf(() =>
      resolveRegistry([
        definePlugin({
          id: "explorer",
          title: "Explorer",
          jobs: { "qa-agent.crawl": async () => {} },
        }),
      ]),
    );
    expect(problems[0]).toContain('must be prefixed "explorer."');
  });

  it("rejects storage without a deletion hook", () => {
    // The no-FK rule means the database will not cascade, so a missing hook
    // leaves plugin rows behind when a team is deleted. See core-scope.md §6.
    const problems = problemsOf(() =>
      resolveRegistry([
        definePlugin({
          id: "explorer",
          title: "Explorer",
          schema: async () => ({}),
        }),
      ]),
    );
    expect(problems[0]).toContain("no deletion hook");
  });

  it("accepts storage when a deletion hook is declared", () => {
    expect(() =>
      resolveRegistry([
        definePlugin({
          id: "explorer",
          title: "Explorer",
          schema: async () => ({}),
          deletion: { onTeamDeleted: async () => {} },
        }),
      ]),
    ).not.toThrow();
  });

  describe("provider plugins", () => {
    it("wires a plugin-provided capability to its consumer", () => {
      const events = definePlugin({
        id: "events",
        title: "Events",
        provides: ["events"],
        implement: { events: () => ({ emit: vi.fn(), subscribe: vi.fn() }) },
      });
      const explorer = definePlugin({
        id: "explorer",
        title: "Explorer",
        capabilities: ["events"],
      });
      const resolved = resolveRegistry([events, explorer]);
      expect(resolved.providers.get("events")).toBe("events");
    });

    it("does not care about declaration order", () => {
      const explorer = definePlugin({
        id: "explorer",
        title: "Explorer",
        capabilities: ["events"],
      });
      const events = definePlugin({
        id: "events",
        title: "Events",
        provides: ["events"],
        implement: { events: () => ({ emit: vi.fn(), subscribe: vi.fn() }) },
      });
      expect(() => resolveRegistry([explorer, events])).not.toThrow();
    });

    it("rejects a provided capability with no implementation", () => {
      // Should fail at boot, the same way a missing deletion hook does —
      // not at the first consumer's first request against `undefined`.
      const problems = problemsOf(() =>
        resolveRegistry([
          definePlugin({ id: "events", title: "Events", provides: ["events"] }),
        ]),
      );
      expect(problems[0]).toContain("has no `implement.events`");
    });

    it("rejects a consumed capability that nobody provides", () => {
      const problems = problemsOf(() =>
        resolveRegistry([
          definePlugin({
            id: "explorer",
            title: "Explorer",
            capabilities: ["events"],
          }),
        ]),
      );
      expect(problems[0]).toContain('needs capability "events"');
    });

    it("rejects two plugins providing the same capability", () => {
      const implement = {
        events: () => ({ emit: vi.fn(), subscribe: vi.fn() }),
      };
      const problems = problemsOf(() =>
        resolveRegistry([
          definePlugin({
            id: "events-a",
            title: "A",
            provides: ["events"],
            implement,
          }),
          definePlugin({
            id: "events-b",
            title: "B",
            provides: ["events"],
            implement,
          }),
        ]),
      );
      expect(problems[0]).toContain("provided by both");
    });

    it("rejects a plugin shadowing a core-provided capability", () => {
      const problems = problemsOf(() =>
        resolveRegistry([
          definePlugin({ id: "sneaky", title: "S", provides: ["browser"] }),
        ]),
      );
      expect(problems[0]).toContain("which core already provides");
    });
  });

  describe("check layers", () => {
    const layer = (id: string) => ({
      id,
      name: id,
      icon: "Eye",
      description: "d",
      order: 0,
      defaultMode: "log" as const,
      modeField: `${id}Mode`,
    });

    it("collects a plugin-contributed check layer", () => {
      const a11y = definePlugin({
        id: "a11y",
        title: "Accessibility",
        checkLayers: [layer("a11y")],
      });
      const resolved = resolveRegistry([a11y]);
      expect(resolved.checkLayers.get("a11y")?.pluginId).toBe("a11y");
    });

    it("rejects a plugin claiming a core-owned check layer id", () => {
      const problems = problemsOf(() =>
        resolveRegistry([
          definePlugin({
            id: "sneaky",
            title: "S",
            checkLayers: [layer("visual")],
          }),
        ]),
      );
      expect(problems[0]).toContain(
        'contributes check layer "visual", which core already owns',
      );
    });

    it("rejects two plugins contributing the same check layer id", () => {
      const problems = problemsOf(() =>
        resolveRegistry([
          definePlugin({
            id: "plugin-a",
            title: "A",
            checkLayers: [layer("custom")],
          }),
          definePlugin({
            id: "plugin-b",
            title: "B",
            checkLayers: [layer("custom")],
          }),
        ]),
      );
      expect(problems[0]).toContain("contributed by both");
    });
  });
});

describe("buildContext", () => {
  const factories = {
    browser: () => ({ withBrowser: vi.fn(), withBrowserSwarm: vi.fn() }),
    ai: () => ({ generate: vi.fn(), budget: vi.fn() }),
    storage: () => ({ put: vi.fn() }),
  };

  it("injects exactly the declared capabilities and nothing else", () => {
    const manifest = definePlugin({
      id: "explorer",
      title: "Explorer",
      capabilities: ["browser"],
    });

    const ctx = buildContext(manifest, scope, factories);

    expect(ctx.pluginId).toBe("explorer");
    expect(ctx.browser).toBeDefined();
    // Undeclared capabilities must be absent at runtime, not merely untyped —
    // otherwise the compile-time narrowing is decoration.
    expect("ai" in ctx).toBe(false);
    expect("storage" in ctx).toBe(false);
  });

  it("scopes the context to the resolved team", () => {
    const manifest = definePlugin({ id: "rca", title: "RCA" });
    const ctx = buildContext(manifest, scope, factories);
    expect(ctx.team.id).toBe("t1");
    expect(ctx.team.entitlements.has("ai")).toBe(true);
  });

  it("passes the plugin id to each factory so capabilities can namespace", () => {
    const spy = vi.fn(() => ({ put: vi.fn() }));
    const manifest = definePlugin({
      id: "explorer",
      title: "Explorer",
      capabilities: ["storage"],
    });
    buildContext(manifest, scope, { ...factories, storage: spy });
    expect(spy).toHaveBeenCalledWith("explorer", scope);
  });

  it("throws when a declared capability has no factory", () => {
    const manifest = definePlugin({
      id: "explorer",
      title: "Explorer",
      capabilities: ["browser"],
    });
    expect(() => buildContext(manifest, scope, {})).toThrow(
      /No factory registered for capability "browser"/,
    );
  });
});
