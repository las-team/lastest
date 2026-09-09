import { describe, expect, it } from "vitest";
import { ConfigError } from "./config/load";
import { main, toRunOptions, buildProgram } from "./cli";
import { EXIT_CODES, type RunOptions } from "./run/types";
import { testConfig } from "./run/test-helpers";

/** Drive `main()` with a fake engine and a fake config loader; returns the exit code and what the engine saw. */
async function run(argv: string, exitCode = 0) {
  const seen: RunOptions[] = [];
  const errors: string[] = [];
  const loaded: string[] = [];
  const code = await main(argv.split(" ").filter(Boolean), {
    run: async (opts) => {
      seen.push(opts);
      return exitCode;
    },
    loadConfig: (path) => {
      loaded.push(path);
      if (path === "broken.yaml")
        throw new ConfigError("CONFIG_INVALID: bad yaml");
      return testConfig();
    },
    stderr: (t) => errors.push(t),
  });
  return { code, opts: seen[0], seen, errors, loaded };
}

describe("cli (§8.10)", () => {
  it("exports buildProgram with every §8.10 command", () => {
    const names = buildProgram({ exitOverride: true }).commands.map((c) =>
      c.name(),
    );
    expect(names).toEqual([
      "preflight",
      "init",
      "delta",
      "final-delta",
      "verify",
      "retry-failed",
      "blobs",
      "report",
    ]);
  });

  it("init: parses wave, countries (case-insensitive, comma or repeated), objects, dry-run and limit", async () => {
    const r = await run(
      "init --config cfg.yaml --wave w1 --country us --objects account,address --dry-run --limit 10 --allow-mdl --allow-picklist-create --accept-mapping-change --justification triage",
    );
    expect(r.code).toBe(0);
    expect(r.loaded).toEqual(["cfg.yaml"]);
    expect(r.opts).toMatchObject({
      mode: "init",
      configPath: "cfg.yaml",
      wave: "w1",
      countries: ["US"],
      objects: ["account", "address"],
      dryRun: true,
      limit: 10,
      allowMdl: true,
      allowPicklistCreate: true,
      acceptMappingChange: true,
      justification: "triage",
      verify: undefined,
    });
    const multi = await run(
      "delta --config cfg.yaml --country US,de --country fr",
    );
    expect(multi.opts.countries).toEqual(["US", "DE", "FR"]);
    expect(multi.opts.dryRun).toBe(false);
    expect(multi.opts.limit).toBeUndefined();
  });

  it("propagates the engine exit code (0 / 2 / 3 / 4)", async () => {
    for (const code of [
      EXIT_CODES.success,
      EXIT_CODES.blockingFindings,
      EXIT_CODES.unitFailures,
      EXIT_CODES.gateFailed,
    ])
      expect((await run("delta --config cfg.yaml --wave w1", code)).code).toBe(
        code,
      );
  });

  it("exits 5 on missing --config, unknown commands/options and config errors without running the engine", async () => {
    const missing = await run("init --wave w1");
    expect(missing.code).toBe(EXIT_CODES.configError);
    expect(missing.seen).toEqual([]);
    expect(missing.errors.join("\n")).toMatch(/--config/);
    expect((await run("frobnicate --config cfg.yaml")).code).toBe(
      EXIT_CODES.configError,
    );
    expect((await run("preflight --config cfg.yaml --dry-run")).code).toBe(
      EXIT_CODES.configError,
    ); // not an option of preflight
    const broken = await run("init --config broken.yaml");
    expect(broken.code).toBe(EXIT_CODES.configError);
    expect(broken.seen).toEqual([]);
    expect(broken.errors.join("\n")).toContain("CONFIG_INVALID");
  });

  it("validates flag values: limit, sample, object keys, country codes, freeze-at", async () => {
    expect((await run("init --config cfg.yaml --limit abc")).code).toBe(
      EXIT_CODES.configError,
    );
    expect((await run("init --config cfg.yaml --limit 0")).code).toBe(
      EXIT_CODES.configError,
    );
    expect((await run("verify --config cfg.yaml --sample -1")).code).toBe(
      EXIT_CODES.configError,
    );
    const badKey = await run("init --config cfg.yaml --objects account,nope");
    expect(badKey.code).toBe(EXIT_CODES.configError);
    expect(badKey.errors.join("\n")).toContain("CONFIG_OBJECT_KEY_UNKNOWN");
    const badCountry = await run("init --config cfg.yaml --country USA");
    expect(badCountry.code).toBe(EXIT_CODES.configError);
    expect(badCountry.errors.join("\n")).toContain("CONFIG_COUNTRY_INVALID");
    expect(
      (await run("final-delta --config cfg.yaml --freeze-at yesterday")).code,
    ).toBe(EXIT_CODES.configError);
    expect((await run("final-delta --config cfg.yaml")).code).toBe(
      EXIT_CODES.configError,
    ); // --freeze-at is required
  });

  it("final-delta: normalises --freeze-at to ISO and carries the exceptions file", async () => {
    const r = await run(
      "final-delta --config cfg.yaml --wave w1 --freeze-at 2027-03-06T22:00:00Z --accept-gate-exceptions ex.json --unfreeze",
    );
    expect(r.code).toBe(0);
    expect(r.opts).toMatchObject({
      mode: "final-delta",
      freezeAt: "2027-03-06T22:00:00.000Z",
      acceptGateExceptions: "ex.json",
      unfreeze: true,
    });
  });

  it("verify: --fk --keys --samples --sample N", async () => {
    const r = await run(
      "verify --config cfg.yaml --wave w1 --fk --keys --samples --sample 50",
    );
    expect(r.opts.verify).toEqual({
      fk: true,
      keys: true,
      samples: true,
      sample: 50,
    });
    const bare = await run("verify --config cfg.yaml");
    expect(bare.opts.verify).toEqual({
      fk: false,
      keys: false,
      samples: false,
      sample: undefined,
    });
  });

  it("retry-failed / blobs require --run and pass runId, errorType and objects", async () => {
    const r = await run(
      "retry-failed --config cfg.yaml --run init-1 --error-type INVALID_DATA --objects call2",
    );
    expect(r.opts).toMatchObject({
      mode: "retry-failed",
      runId: "init-1",
      errorType: "INVALID_DATA",
      objects: ["call2"],
    });
    expect((await run("retry-failed --config cfg.yaml")).code).toBe(
      EXIT_CODES.configError,
    );
    const b = await run(
      "blobs --config cfg.yaml --run init-1 --objects call2,sample_transaction",
    );
    expect(b.opts).toMatchObject({
      mode: "blobs",
      runId: "init-1",
      objects: ["call2", "sample_transaction"],
    });
    expect((await run("blobs --config cfg.yaml")).code).toBe(
      EXIT_CODES.configError,
    );
  });

  it("preflight: --probe-writes; report works without --config", async () => {
    const p = await run("preflight --config cfg.yaml --wave w1 --probe-writes");
    expect(p.opts).toMatchObject({
      mode: "preflight",
      probeWrites: true,
      dryRun: false,
    });
    const rep = await run("report --run init-1");
    expect(rep.code).toBe(0);
    expect(rep.loaded).toEqual([]);
    expect(rep.opts).toMatchObject({
      mode: "report",
      runId: "init-1",
      configPath: undefined,
    });
    expect(rep.opts.config.target.vaultDns).toBeDefined();
  });

  it("--help and --version exit 0 without running anything", async () => {
    const help = await run("--help");
    expect(help.code).toBe(0);
    expect(help.seen).toEqual([]);
    expect((await run("init --help")).code).toBe(0);
  });

  it("engine errors that are not config errors exit 3", async () => {
    const errors: string[] = [];
    const code = await main(["init", "--config", "cfg.yaml"], {
      run: async () => {
        throw new Error("vault exploded");
      },
      loadConfig: () => testConfig(),
      stderr: (t) => errors.push(t),
    });
    expect(code).toBe(EXIT_CODES.unitFailures);
    expect(errors.join("\n")).toContain("vault exploded");
  });

  it("toRunOptions rejects --dry-run for modes that cannot simulate", () => {
    expect(() =>
      toRunOptions("preflight", { dryRun: true }, testConfig()),
    ).toThrow(/dry-run/);
    expect(() =>
      toRunOptions("report", { dryRun: true }, testConfig()),
    ).toThrow(/dry-run/);
    expect(
      toRunOptions("delta", { dryRun: true, config: "c" }, testConfig()).dryRun,
    ).toBe(true);
  });
});
