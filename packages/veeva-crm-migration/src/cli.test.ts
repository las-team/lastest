import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { main, parseClassificationFile } from "./cli";
import type { PlanStep, VaultPlan } from "./model/types";
import { fakeFetch, fixtureSnapshot, success } from "./vault/test-helpers";

const NOW = () => new Date("2026-09-07T12:00:00Z");
const quiet = { log: () => {}, now: NOW };

async function outDirWithSnapshot(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "veeva-cli-"));
  await writeFile(
    path.join(dir, "snapshot.json"),
    JSON.stringify(fixtureSnapshot()),
  );
  return dir;
}

async function readPlan(outDir: string): Promise<VaultPlan> {
  return JSON.parse(
    await readFile(path.join(outDir, "vault-plan", "plan.json"), "utf8"),
  ) as VaultPlan;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseClassificationFile", () => {
  it("accepts the documented shape and normalises country codes", () => {
    expect(
      parseClassificationFile(
        JSON.stringify({
          rules: [{ pattern: "\\bkam\\b", category: "kam" }],
          categoryOverrides: { "Medical Rep DE": "sales_rep" },
          countryOverrides: { "Medical Rep DE": ["de", "AT"] },
          keepEmptyProfiles: true,
        }),
        "rules.json",
      ),
    ).toEqual({
      rules: [{ pattern: "\\bkam\\b", category: "kam" }],
      categoryOverrides: { "Medical Rep DE": "sales_rep" },
      countryOverrides: { "Medical Rep DE": ["DE", "AT"] },
      keepEmptyProfiles: true,
    });
  });

  it.each([
    ["not json", /not valid JSON/],
    ["[]", /expected a JSON object/],
    ['{"categoryOverride":{}}', /unknown key "categoryOverride"/],
    ['{"categoryOverrides":{"X":"salesrep"}}', /categoryOverrides\["X"\]/],
    ['{"countryOverrides":{"X":["Germany"]}}', /countryOverrides\["X"\]/],
    ['{"rules":[{"pattern":"(","category":"msl"}]}', /not a valid regex/],
    ['{"rules":[{"pattern":"x"}]}', /rules\[0\] must be/],
    ['{"keepEmptyProfiles":"yes"}', /keepEmptyProfiles must be a boolean/],
  ])("rejects %s", (text, message) => {
    expect(() => parseClassificationFile(text, "rules.json")).toThrow(message);
  });
});

describe("cli plan", () => {
  it("applies --classification overrides and keepEmptyProfiles to the plan", async () => {
    const outDir = await outDirWithSnapshot();
    const rules = path.join(outDir, "rules.json");
    await writeFile(
      rules,
      JSON.stringify({
        categoryOverrides: { "DE Sales Rep": "kam" },
        keepEmptyProfiles: true,
      }),
    );
    const code = await main(
      ["plan", "--out", outDir, "--classification", rules],
      {},
      quiet,
    );
    expect(code).toBe(0);
    const plan = await readPlan(outDir);
    const ids = plan.steps.map((s) => s.id);
    expect(ids).toContain("ps:DE.kam");
    expect(ids).not.toContain("ps:FR.kam");
    expect(
      plan.unmapped.some((u) => u.source === "Profile DE Legacy Rep"),
    ).toBe(false);
  });

  it("--keep-empty-profiles works without a classification file", async () => {
    const outDir = await outDirWithSnapshot();
    expect(await main(["plan", "--out", outDir], {}, quiet)).toBe(0);
    expect(
      (await readPlan(outDir)).unmapped.some(
        (u) => u.source === "Profile DE Legacy Rep",
      ),
    ).toBe(true);
    expect(
      await main(["plan", "--out", outDir, "--keep-empty-profiles"], {}, quiet),
    ).toBe(0);
    expect(
      (await readPlan(outDir)).unmapped.some(
        (u) => u.source === "Profile DE Legacy Rep",
      ),
    ).toBe(false);
  });

  it("exits 2 on an invalid classification file and on a missing path", async () => {
    const outDir = await outDirWithSnapshot();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const rules = path.join(outDir, "rules.json");
    await writeFile(rules, '{"categoryOverrides":{"DE Sales Rep":"nope"}}');
    expect(
      await main(
        ["plan", "--out", outDir, "--classification", rules],
        {},
        quiet,
      ),
    ).toBe(2);
    expect(err.mock.calls.at(-1)?.[0]).toMatch(
      /categoryOverrides\["DE Sales Rep"\]/,
    );
    expect(
      await main(["plan", "--out", outDir, "--classification"], {}, quiet),
    ).toBe(2);
    expect(err.mock.calls.at(-1)?.[0]).toMatch(/needs a file path/);
  });

  it("documents the new flags in --help", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await main(["--help"], {}, quiet)).toBe(0);
    const help = String(err.mock.calls[0]?.[0]);
    for (const flag of [
      "--classification",
      "--keep-empty-profiles",
      "--allow-review",
      "--continue-on-error",
      "--async-mdl",
    ])
      expect(help).toContain(flag);
  });
});

describe("cli apply", () => {
  const env = { VAULT_DNS: "v.veevavault.com", VAULT_SESSION_ID: "S" };
  const routes = () => [
    {
      method: "GET",
      match: "/metadata/",
      reply: () => ({
        json: {
          responseStatus: "FAILURE",
          errors: [{ type: "INVALID_DATA", message: "absent" }],
        },
      }),
    },
    {
      method: "POST",
      match: "/mdl/execute",
      reply: () => success({ statement_execution: [{ response: "SUCCESS" }] }),
    },
  ];

  async function outDirWithReviewPlan(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), "veeva-cli-apply-"));
    const step: PlanStep = {
      id: "sp:DE.sales_rep",
      kind: "mdl",
      title: "security profile",
      country: "DE",
      category: "sales_rep",
      source: "DE Sales Rep",
      target: "sp_de_sales_rep__c",
      dependsOn: [],
      mdl: "RECREATE Securityprofile sp_de_sales_rep__c ();",
      review: true,
    };
    const plan: VaultPlan = {
      schemaVersion: 1,
      createdAt: "2026-09-07T00:00:00Z",
      apiVersion: "v26.2",
      steps: [step],
      unmapped: [],
    };
    await mkdir(path.join(dir, "vault-plan"), { recursive: true });
    await writeFile(
      path.join(dir, "vault-plan", "plan.json"),
      JSON.stringify(plan),
    );
    return dir;
  }

  async function reportOf(outDir: string) {
    return JSON.parse(
      await readFile(path.join(outDir, "apply-report.json"), "utf8"),
    ) as { ok: boolean; results: { status: string; message?: string }[] };
  }

  it("--execute alone skips review steps; --allow-review runs them", async () => {
    const outDir = await outDirWithReviewPlan();
    const ff = fakeFetch(routes());
    expect(
      await main(["apply", "--out", outDir, "--execute"], env, {
        ...quiet,
        fetch: ff.fetch as typeof fetch,
      }),
    ).toBe(0);
    expect((await reportOf(outDir)).results[0]).toMatchObject({
      status: "skipped",
      message: expect.stringMatching(/review required/),
    });
    expect(ff.callsTo("/mdl/execute")).toHaveLength(0);

    const ff2 = fakeFetch(routes());
    expect(
      await main(
        ["apply", "--out", outDir, "--execute", "--allow-review"],
        env,
        { ...quiet, fetch: ff2.fetch as typeof fetch },
      ),
    ).toBe(0);
    const report = await reportOf(outDir);
    expect(report.ok).toBe(true);
    expect(report.results[0]?.status).toBe("applied");
    expect(ff2.callsTo("/mdl/execute")).toHaveLength(1);
  });
});
