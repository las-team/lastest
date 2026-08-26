import { describe, expect, it } from "vitest";

import type { DataCapability } from "@lastest/contracts";

import { definePlugin } from "./define";
import { requireSlot, wiringSlotsFor } from "./wiring";

const runtime = { contextFor: async () => ({}) };
const storageHost = { put: () => {} };
const dataHandles = new Map<string, DataCapability>();
const dataFor = (pluginId: string): DataCapability => {
  const existing = dataHandles.get(pluginId);
  if (existing) return existing;
  const handle = { db: {} } as unknown as DataCapability;
  dataHandles.set(pluginId, handle);
  return handle;
};
const from = { runtime, dataFor, storageHost };

describe("wiringSlotsFor", () => {
  it("grants the full tenanted shape to a plugin with schema and storage", () => {
    const manifest = definePlugin({
      id: "data-sources",
      title: "Data sources",
      capabilities: ["data", "storage"],
      schema: async () => ({}),
      deletion: { onTeamDeleted: async () => {} },
    });

    const slots = wiringSlotsFor(manifest, from);

    expect(slots.runtime).toBe(runtime);
    expect(slots.data).toBe(dataFor("data-sources"));
    expect(slots.storageHost).toBe(storageHost);
  });

  it("withholds the runtime from an untenanted plugin", () => {
    // `buildContext` would throw `UntenantedPluginError` on any `contextFor`
    // call anyway — deriving `runtime: undefined` here means the wiring can
    // never even advertise the call.
    const launch = definePlugin({
      id: "launch",
      title: "Launch board",
      tenancy: "none",
      capabilities: ["data"],
      schema: async () => ({}),
      deletion: { onUserDeleted: async () => {} },
    });

    const slots = wiringSlotsFor(launch, from);

    expect(slots.runtime).toBeUndefined();
    expect(slots.data).toBe(dataFor("launch"));
    expect(slots.storageHost).toBeUndefined();
  });

  it("withholds data from a plugin with no schema", () => {
    const rca = definePlugin({ id: "rca", title: "RCA" });

    const slots = wiringSlotsFor(rca, from);

    expect(slots.runtime).toBe(runtime);
    expect(slots.data).toBeUndefined();
    expect(slots.storageHost).toBeUndefined();
  });
});

describe("requireSlot", () => {
  it("returns a granted slot", () => {
    expect(requireSlot(runtime, "explorer", "runtime")).toBe(runtime);
  });

  it("turns an ungranted slot into a boot error naming the manifest fix", () => {
    // The property the composition root relies on: a wiring that demands a
    // slot the manifest does not grant fails at startup, not at review time.
    expect(() => requireSlot(undefined, "launch", "runtime")).toThrow(
      /Plugin "launch"'s wiring requires the "runtime" slot.*tenancy/,
    );
    expect(() => requireSlot(undefined, "rca", "data")).toThrow(/schema/);
    expect(() => requireSlot(undefined, "quickstart", "storageHost")).toThrow(
      /storage/,
    );
  });
});
