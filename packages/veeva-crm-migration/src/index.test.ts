import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { migrateVeevaCrmConfig } from "./index";
import type { PlanStep, VaultPlan } from "./model/types";
import { fakeFetch, fixtureSnapshot, success } from "./vault/test-helpers";

const NOW = () => new Date("2026-09-07T12:00:00Z");
const quiet = () => {};

async function outDirWithSnapshot(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "veeva-migrate-"));
  await writeFile(
    path.join(dir, "snapshot.json"),
    JSON.stringify(fixtureSnapshot()),
  );
  return dir;
}

function reviewPlan(): VaultPlan {
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
  return {
    schemaVersion: 1,
    createdAt: "2026-09-07T00:00:00Z",
    apiVersion: "v26.2",
    steps: [step],
    unmapped: [],
  };
}

async function outDirWithReviewPlan(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "veeva-apply-"));
  const planDir = path.join(dir, "vault-plan");
  await writeFile(
    path.join(dir, "snapshot.json"),
    JSON.stringify(fixtureSnapshot()),
  );
  await mkdir(planDir, { recursive: true });
  await writeFile(
    path.join(planDir, "plan.json"),
    JSON.stringify(reviewPlan()),
  );
  return dir;
}

const vaultRoutes = () => [
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

describe("migrateVeevaCrmConfig plan stage", () => {
  it("forwards classify.keepEmptyProfiles to the planner", async () => {
    const outDir = await outDirWithSnapshot();
    const dropped = await migrateVeevaCrmConfig({
      stages: ["plan"],
      outDir,
      log: quiet,
      now: NOW,
    });
    expect(dropped.plan?.unmapped).toContainEqual({
      source: "Profile DE Legacy Rep",
      reason: "dropped from the plan: 0 active users (country DE, sales_rep)",
    });

    const kept = await migrateVeevaCrmConfig({
      stages: ["plan"],
      outDir,
      classify: { keepEmptyProfiles: true },
      log: quiet,
      now: NOW,
    });
    expect(
      kept.plan?.unmapped.some((u) => u.source === "Profile DE Legacy Rep"),
    ).toBe(false);
    const ps = kept.plan?.steps.find((s) => s.id === "ps:DE.sales_rep");
    expect(ps?.title).toContain("DE Legacy Rep");
    // and the plan on disk is the kept one
    const onDisk = JSON.parse(
      await readFile(path.join(outDir, "vault-plan", "plan.json"), "utf8"),
    ) as VaultPlan;
    expect(
      onDisk.unmapped.some((u) => u.source === "Profile DE Legacy Rep"),
    ).toBe(false);
  });
});

describe("migrateVeevaCrmConfig apply stage", () => {
  const vault = {
    kind: "session" as const,
    vaultDns: "v.veevavault.com",
    sessionId: "S",
  };

  it("skips review steps by default when executing", async () => {
    const outDir = await outDirWithReviewPlan();
    const ff = fakeFetch(vaultRoutes());
    const { applyReport } = await migrateVeevaCrmConfig({
      stages: ["apply"],
      outDir,
      vault,
      dryRun: false,
      fetch: ff.fetch as typeof fetch,
      log: quiet,
      now: NOW,
    });
    expect(applyReport?.results[0]).toMatchObject({
      stepId: "sp:DE.sales_rep",
      status: "skipped",
      message: expect.stringMatching(/review required/),
    });
    expect(ff.callsTo("/mdl/execute")).toHaveLength(0);
  });

  it("runs review steps when allowReview is set, and asyncMdl picks the async endpoint", async () => {
    const outDir = await outDirWithReviewPlan();
    const ff = fakeFetch(vaultRoutes());
    const { applyReport } = await migrateVeevaCrmConfig({
      stages: ["apply"],
      outDir,
      vault,
      dryRun: false,
      allowReview: true,
      fetch: ff.fetch as typeof fetch,
      log: quiet,
      now: NOW,
    });
    expect(applyReport?.ok).toBe(true);
    expect(applyReport?.results[0]).toMatchObject({
      stepId: "sp:DE.sales_rep",
      status: "applied",
    });
    const calls = ff.callsTo("/mdl/execute");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.pathname.endsWith("/mdl/execute")).toBe(true);
    expect(calls[0]!.body).toContain("RECREATE Securityprofile");
    const report = JSON.parse(
      await readFile(path.join(outDir, "apply-report.json"), "utf8"),
    ) as { results: { status: string }[] };
    expect(report.results[0]?.status).toBe("applied");

    const ffAsync = fakeFetch(vaultRoutes());
    await migrateVeevaCrmConfig({
      stages: ["apply"],
      outDir,
      vault,
      dryRun: false,
      allowReview: true,
      asyncMdl: true,
      fetch: ffAsync.fetch as typeof fetch,
      log: quiet,
      now: NOW,
    });
    expect(ffAsync.callsTo("/mdl/execute_async")).toHaveLength(1);
  });
});
