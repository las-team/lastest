import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigration } from "./migrate";
import { EXIT_CODES } from "./types";
import { makeHarness, seedUsers, type Harness } from "./test-helpers";
import { unitId } from "../types";

describe("runMigration", () => {
  let runDir: string;
  let h: Harness;
  beforeEach(async () => {
    runDir = mkdtempSync(path.join(os.tmpdir(), "vm-migrate-"));
    h = makeHarness(runDir);
    await seedUsers(h.store);
  });
  afterEach(() => rmSync(runDir, { recursive: true, force: true }));

  it("executes a mode against injected deps and returns the RunSummary", async () => {
    const summary = await runMigration(
      { mode: "init", config: h.config, wave: "w1" },
      { deps: h.deps },
    );
    expect(summary.mode).toBe("init");
    expect(summary.exitCode).toBe(EXIT_CODES.success);
    expect(summary.units.map((u) => `${unitId(u.unit)}=${u.status}`)).toEqual([
      "account:US=succeeded",
      "address:US=succeeded",
      "call2:US=succeeded",
    ]);
    expect(h.vault.records("account__v").length).toBeGreaterThan(0);
  });

  it("honours dryRun through the same entry point", async () => {
    const summary = await runMigration(
      { mode: "init", config: h.config, wave: "w1", dryRun: true },
      { deps: h.deps },
    );
    expect(summary.exitCode).toBe(EXIT_CODES.success);
    expect(h.vault.records("account__v")).toEqual([]);
  });
});
