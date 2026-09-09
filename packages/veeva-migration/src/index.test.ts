import { describe, expect, it } from "vitest";
import * as api from "./index";
import { OBJECT_KEYS } from "./types";

describe("public barrel", () => {
  it("exposes the documented entry points", () => {
    for (const name of [
      "runMigration",
      "runPreflight",
      "loadConfig",
      "createSfdcClient",
      "createVaultClient",
      "createStateStore",
    ] as const) {
      expect(typeof api[name], name).toBe("function");
    }
    expect(api.OBJECT_MODULES).toBeDefined();
    expect(typeof api.loadOrder).toBe("function");
  });

  it("registers a complete module for every object key", () => {
    expect(OBJECT_KEYS).toHaveLength(46);
    for (const key of OBJECT_KEYS) {
      const mod = api.OBJECT_MODULES[key];
      expect(mod, key).toBeDefined();
      expect(mod.key, key).toBe(key);
      expect(typeof mod.source, key).toBe("string");
      expect(typeof mod.target, key).toBe("string");
      expect(mod.fields.length, key).toBeGreaterThan(0);
    }
  });
});
