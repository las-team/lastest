import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryStateStore } from "../testkit/memory-store";
import { FileStateStore } from "./file";
import { createStateStore, DEFAULT_RUN_DIR, resolveStoreTarget } from "./index";

const target = { vaultDns: "x.veevavault.com" };

describe("resolveStoreTarget", () => {
  it("infers the driver from staging.databaseUrl / runDir", () => {
    expect(resolveStoreTarget({ target })).toEqual({
      driver: "file",
      vaultDns: "x.veevavault.com",
      dir: path.join(DEFAULT_RUN_DIR, "state"),
    });
    expect(
      resolveStoreTarget({ target, staging: { runDir: "/data/runs" } }),
    ).toMatchObject({
      driver: "file",
      dir: path.join("/data/runs", "state"),
    });
    expect(
      resolveStoreTarget({
        target,
        staging: { databaseUrl: "postgres://u@h/db" },
      }),
    ).toEqual({
      driver: "postgres",
      vaultDns: "x.veevavault.com",
      databaseUrl: "postgres://u@h/db",
    });
    expect(
      resolveStoreTarget({
        target,
        staging: { databaseUrl: "postgresql://u@h/db" },
      }).driver,
    ).toBe("postgres");
    expect(
      resolveStoreTarget({ target, staging: { databaseUrl: "memory:" } })
        .driver,
    ).toBe("memory");
    expect(
      resolveStoreTarget({ target, staging: { databaseUrl: "file:/tmp/s" } }),
    ).toMatchObject({ driver: "file", dir: "/tmp/s" });
    expect(
      resolveStoreTarget({ target, staging: { databaseUrl: "file:///tmp/s" } })
        .dir,
    ).toBe("/tmp/s");
    expect(
      resolveStoreTarget({ target, staging: { databaseUrl: "  " } }).driver,
    ).toBe("file");
  });
  it("honours overrides and rejects bad input", () => {
    expect(
      resolveStoreTarget(
        { target, staging: { databaseUrl: "postgres://x" } },
        { driver: "memory" },
      ).driver,
    ).toBe("memory");
    expect(
      resolveStoreTarget({ target }, { driver: "file", dir: "/x" }).dir,
    ).toBe("/x");
    expect(() =>
      resolveStoreTarget({ target }, { driver: "postgres" }),
    ).toThrow(/postgres:\/\//);
    expect(() =>
      resolveStoreTarget({ target, staging: { databaseUrl: "mysql://x" } }),
    ).toThrow(/unsupported/);
    expect(() => resolveStoreTarget({ target: { vaultDns: "" } })).toThrow(
      /vaultDns/,
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
    const mem = await createStateStore({
      target,
      staging: { databaseUrl: "memory:" },
    });
    expect(mem).toBeInstanceOf(MemoryStateStore);
    expect(mem.vaultDns).toBe("x.veevavault.com");
    const dir = await mkdtemp(path.join(os.tmpdir(), "veeva-factory-"));
    dirs.push(dir);
    const file = await createStateStore({ target, staging: { runDir: dir } });
    expect(file).toBeInstanceOf(FileStateStore);
    expect((file as FileStateStore).dir).toBe(path.join(dir, "state"));
    await file.countryStatus.setFrozen("NL", "t");
    await file.close();
    const again = await createStateStore(
      { target },
      { driver: "file", dir: path.join(dir, "state") },
    );
    expect(await again.countryStatus.isFrozen("NL")).toBe(true);
    await again.close();
  });
});
