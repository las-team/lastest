import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryStateStore } from "../testkit/memory-store";
import { FileStateStore } from "./file";
import { createStateStore, resolveStoreTarget } from "./index";

const vaultDns = "x.veevavault.com";

describe("resolveStoreTarget", () => {
  it("defaults to a file store under the caller's run directory", () => {
    expect(resolveStoreTarget({ vaultDns, runDir: "/data/runs" })).toEqual({
      driver: "file",
      vaultDns,
      dir: path.join("/data/runs", "state"),
    });
  });

  it("honours the driver and dir overrides", () => {
    expect(
      resolveStoreTarget(
        { vaultDns, runDir: "/data/runs" },
        { driver: "memory" },
      ),
    ).toEqual({ driver: "memory", vaultDns, dir: undefined });
    expect(
      resolveStoreTarget({ vaultDns, runDir: "/data/runs" }, { dir: "/x" }).dir,
    ).toBe("/x");
  });

  it("rejects a missing vault or a missing directory", () => {
    expect(() =>
      resolveStoreTarget({ vaultDns: "", runDir: "/data/runs" }),
    ).toThrow(/vaultDns/);
    // No CWD-relative default: a run started from the web tier used to write
    // wherever the server process happened to be.
    expect(() => resolveStoreTarget({ vaultDns, runDir: "" })).toThrow(
      /runDir/,
    );
  });
});

describe("createStateStore", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const d of dirs.splice(0))
      await rm(d, { recursive: true, force: true });
  });

  it("builds memory and file stores bound to the vault", async () => {
    const mem = await createStateStore(
      { vaultDns, runDir: "/unused" },
      { driver: "memory" },
    );
    expect(mem).toBeInstanceOf(MemoryStateStore);
    expect(mem.vaultDns).toBe(vaultDns);

    const dir = await mkdtemp(path.join(os.tmpdir(), "veeva-factory-"));
    dirs.push(dir);
    const file = await createStateStore({ vaultDns, runDir: dir });
    expect(file).toBeInstanceOf(FileStateStore);
    expect((file as FileStateStore).dir).toBe(path.join(dir, "state"));
    await file.countryStatus.setFrozen("NL", "t");
    await file.close();

    const again = await createStateStore(
      { vaultDns, runDir: dir },
      { driver: "file", dir: path.join(dir, "state") },
    );
    expect(await again.countryStatus.isFrozen("NL")).toBe(true);
    await again.close();
  });
});
