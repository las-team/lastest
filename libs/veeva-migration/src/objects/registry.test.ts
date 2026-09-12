import { describe, expect, it } from "vitest";
import { OBJECT_KEYS } from "../types";
import {
  CycleError,
  loadOrder,
  OBJECT_FAMILIES,
  OBJECT_MODULES,
  orderedKeys,
} from "./registry";
import { validateObjectModule } from "./types";

type Stub = {
  key: (typeof OBJECT_KEYS)[number];
  dependsOn: (typeof OBJECT_KEYS)[number][];
  selfRefs: Array<{
    target: string;
    source: string;
    objectKey?: (typeof OBJECT_KEYS)[number];
  }>;
};
const stub = (
  key: Stub["key"],
  dependsOn: Stub["dependsOn"] = [],
  selfRefs: Stub["selfRefs"] = [],
): Stub => ({ key, dependsOn, selfRefs });

describe("loadOrder (§6.1)", () => {
  it("layers parents before children and ignores self references", () => {
    const steps = loadOrder([
      stub("country"),
      stub("user", ["country"]),
      stub(
        "territory",
        [],
        [{ target: "parent_territory__v", source: "ParentTerritory2Id" }],
      ),
      stub("account", ["country", "user"]),
      stub("address", ["account"]),
    ]);
    expect(steps.map((s) => s.keys)).toEqual([
      ["country", "territory"],
      ["user"],
      ["account"],
      ["address"],
    ]);
    expect(steps[0].pass2).toEqual([
      {
        objectKey: "territory",
        target: "parent_territory__v",
        source: "ParentTerritory2Id",
        refKey: "territory",
      },
    ]);
  });
  it("breaks the medical_inquiry ↔ call2 cycle through the declared pass-2 selfRef", () => {
    const mods = [
      stub("account"),
      stub(
        "medical_inquiry",
        ["account", "call2"],
        [{ target: "call2__v", source: "Call2_vod__c", objectKey: "call2" }],
      ),
      stub("call2", ["account", "medical_inquiry"]),
    ];
    expect(orderedKeys(mods)).toEqual(["account", "medical_inquiry", "call2"]);
  });
  it("throws MAP_CYCLE_UNDECLARED for undeclared cycles", () => {
    const mods = [stub("order", ["call2"]), stub("call2", ["order"])];
    expect(() => loadOrder(mods)).toThrow(CycleError);
    try {
      loadOrder(mods);
    } catch (e) {
      expect((e as CycleError).cycle).toEqual(["call2", "order", "call2"]);
    }
  });
  it("respects enabledKeys (disabled parents are dropped from the DAG)", () => {
    const mods = [
      stub("account"),
      stub("territory"),
      stub("account_territory", ["account", "territory"]),
      stub("tsf", ["account", "territory", "address"]),
      stub("address", ["account"]),
    ];
    const steps = loadOrder(mods, ["account", "address", "tsf"]);
    expect(steps.map((s) => s.keys)).toEqual([
      ["account"],
      ["address"],
      ["tsf"],
    ]);
  });
});

describe("OBJECT_MODULES", () => {
  it("registers all 46 keys under their families", () => {
    expect(Object.keys(OBJECT_MODULES).sort()).toEqual([...OBJECT_KEYS].sort());
    expect(Object.values(OBJECT_FAMILIES).flat().sort()).toEqual(
      [...OBJECT_KEYS].sort(),
    );
    for (const [key, m] of Object.entries(OBJECT_MODULES))
      expect(m.key).toBe(key);
  });
  it("every module passes the structural lint", () => {
    for (const m of Object.values(OBJECT_MODULES)) {
      const blocking = validateObjectModule(m).filter(
        (i) => i.severity === "blocking",
      );
      expect(
        blocking,
        `${m.key}: ${blocking.map((i) => i.code + " " + i.message).join("; ")}`,
      ).toEqual([]);
    }
  });
  it("the real registry produces the §6.1 order without cycles", () => {
    const keys = orderedKeys(OBJECT_MODULES);
    expect(keys).toHaveLength(OBJECT_KEYS.length);
    const pos = (k: string) => keys.indexOf(k as never);
    expect(pos("user")).toBeGreaterThan(pos("country"));
    expect(pos("account")).toBeGreaterThan(pos("user"));
    expect(pos("address")).toBeGreaterThan(pos("account"));
    expect(pos("call2")).toBeGreaterThan(pos("medical_inquiry"));
    expect(pos("call2_detail")).toBeGreaterThan(pos("call2"));
    expect(pos("sample_transaction")).toBeGreaterThan(pos("call2"));
    expect(pos("multichannel_activity_line")).toBeGreaterThan(
      pos("multichannel_activity"),
    );
    expect(pos("expense_line")).toBeGreaterThan(pos("expense_header"));
    expect(keys[0]).toBe("country");
  });
});
