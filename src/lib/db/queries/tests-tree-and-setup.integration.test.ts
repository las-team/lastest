/**
 * Runtime verification for two §3 "Full product feature matrix" rows
 * (core-plugin-refactor-test-plan.md):
 *
 *   - Setup/teardown scripts, configs (P1, no change): create/edit a setup
 *     script, confirm it runs before recorded tests.
 *   - Tests list / functional areas tree (P0, indirect via `core/tests`):
 *     browse the tree, create/move a test, confirm quarantine flag behavior
 *     matches §2.6 (`ctx.tests.createQuarantined` — tenancy-correct,
 *     functional area resolved/created by name, near-duplicate
 *     functional-area accumulation is an accepted nuisance not a crash).
 *
 * DB-only (no EB/browser needed) — these are data-layer / capability-layer
 * checks against the real dev Postgres. The "setup script actually executes
 * before a recorded test on a real target" half of row 2 is covered instead
 * by the real-EB build in execution/full-build-pipeline.integration.test.ts,
 * which uses one of these repos' resolved setup chain end to end.
 *
 * Run with `pnpm test:integration`.
 */
import { v4 as uuid } from "uuid";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import {
  defaultSetupSteps,
  functionalAreas,
  repositories,
  setupScripts,
  teams,
  tests as testsTable,
} from "@/lib/db/schema";
import * as queries from "@/lib/db/queries";
import { resolveBuildSetup } from "@/lib/setup/resolve-build-setup";
import { createTestsCapability } from "@lastest/core-tests";
import { appTestsHost } from "@/lib/core/tests-host";
import type { TeamRef } from "@lastest/contracts";

let teamId: string;
let teamB: string; // a second, unrelated team — for the tenancy check
let repositoryId: string;
let repoB: string;
const cleanupTestIds: string[] = [];
const cleanupAreaIds: string[] = [];
const cleanupScriptIds: string[] = [];

beforeAll(async () => {
  teamId = uuid();
  teamB = uuid();
  await db.insert(teams).values([
    {
      id: teamId,
      name: `tree-setup-test-${teamId.slice(0, 8)}`,
      slug: `tree-setup-test-${teamId.slice(0, 8)}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: teamB,
      name: `tree-setup-test-b-${teamB.slice(0, 8)}`,
      slug: `tree-setup-test-b-${teamB.slice(0, 8)}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]);

  repositoryId = uuid();
  repoB = uuid();
  await db.insert(repositories).values([
    {
      id: repositoryId,
      teamId,
      provider: "local",
      owner: "tree-setup-test",
      name: "repo-a",
      fullName: "tree-setup-test/repo-a",
      createdAt: new Date(),
    },
    {
      id: repoB,
      teamId: teamB,
      provider: "local",
      owner: "tree-setup-test",
      name: "repo-b",
      fullName: "tree-setup-test/repo-b",
      createdAt: new Date(),
    },
  ]);
});

afterAll(async () => {
  for (const id of cleanupTestIds) {
    await db.delete(testsTable).where(eq(testsTable.id, id));
  }
  for (const id of cleanupAreaIds) {
    await db.delete(functionalAreas).where(eq(functionalAreas.id, id));
  }
  for (const id of cleanupScriptIds) {
    await db.delete(setupScripts).where(eq(setupScripts.id, id));
  }
  await db
    .delete(defaultSetupSteps)
    .where(eq(defaultSetupSteps.repositoryId, repositoryId));
  await db.delete(repositories).where(eq(repositories.id, repositoryId));
  await db.delete(repositories).where(eq(repositories.id, repoB));
  await db.delete(teams).where(eq(teams.id, teamId));
  await db.delete(teams).where(eq(teams.id, teamB));
});

describe("core/tests capability — ctx.tests.createQuarantined (§2.6, §3 Tests tree row)", () => {
  const team: TeamRef = {
    id: "",
    plan: "free",
    entitlements: new Set<string>(),
  };

  it("creates a quarantined test under the correct repo/team, resolving the functional area by name", async () => {
    const capability = createTestsCapability(appTestsHost, {
      ...team,
      id: teamId,
    });

    const ref = await capability.createQuarantined({
      repositoryId,
      name: "Explorer-found: checkout button unreachable",
      areaName: "Checkout",
      targetUrl: "https://example.test/checkout",
      code: "export async function test(page) { await page.goto('https://example.test/checkout'); }",
    });
    cleanupTestIds.push(ref.id);

    const [row] = await db
      .select()
      .from(testsTable)
      .where(eq(testsTable.id, ref.id));
    expect(row).toBeDefined();
    expect(row!.repositoryId).toBe(repositoryId);
    expect(row!.quarantined).toBe(true);
    expect(row!.functionalAreaId).toBeTruthy();

    const [area] = await db
      .select()
      .from(functionalAreas)
      .where(eq(functionalAreas.id, row!.functionalAreaId!));
    expect(area?.name).toBe("Checkout");
    expect(area?.repositoryId).toBe(repositoryId);
    cleanupAreaIds.push(area!.id);
  });

  it("rejects creating into a repository owned by a different team (tenancy)", async () => {
    const capability = createTestsCapability(appTestsHost, {
      ...team,
      id: teamId,
    });

    await expect(
      capability.createQuarantined({
        repositoryId: repoB, // owned by teamB, not teamId
        name: "cross-tenant attempt",
        areaName: "Nope",
        targetUrl: "https://example.test/",
        code: "export async function test(page) {}",
      }),
    ).rejects.toThrow(/not in this team/i);
  });

  it("resolving the same area name twice reuses one row; a near-duplicate name creates a second (nuisance, not a crash)", async () => {
    const capability = createTestsCapability(appTestsHost, {
      ...team,
      id: teamId,
    });

    const first = await capability.createQuarantined({
      repositoryId,
      name: "dup-area test 1",
      areaName: "Billing Page",
      targetUrl: "https://example.test/billing",
      code: "export async function test(page) {}",
    });
    const second = await capability.createQuarantined({
      repositoryId,
      name: "dup-area test 2",
      areaName: "Billing Page", // exact same name — must resolve to the SAME area
      targetUrl: "https://example.test/billing",
      code: "export async function test(page) {}",
    });
    cleanupTestIds.push(first.id, second.id);

    const [row1] = await db
      .select()
      .from(testsTable)
      .where(eq(testsTable.id, first.id));
    const [row2] = await db
      .select()
      .from(testsTable)
      .where(eq(testsTable.id, second.id));
    expect(row1!.functionalAreaId).toBe(row2!.functionalAreaId);
    cleanupAreaIds.push(row1!.functionalAreaId!);

    // A near-duplicate name (different casing/spacing) is NOT deduped —
    // this is the accepted nuisance the test plan predicts, confirmed here
    // to still be a nuisance (a second, distinct area) rather than a crash
    // or a silent merge into the wrong area.
    const third = await capability.createQuarantined({
      repositoryId,
      name: "dup-area test 3",
      areaName: "billing page", // same content, different case
      targetUrl: "https://example.test/billing",
      code: "export async function test(page) {}",
    });
    cleanupTestIds.push(third.id);
    const [row3] = await db
      .select()
      .from(testsTable)
      .where(eq(testsTable.id, third.id));
    expect(row3!.functionalAreaId).not.toBe(row1!.functionalAreaId);
    cleanupAreaIds.push(row3!.functionalAreaId!);

    const areasNamedBilling = (
      await queries.getFunctionalAreasByRepo(repositoryId)
    ).filter((a) => a.name.toLowerCase() === "billing page");
    // Two distinct rows accumulated for what a human would call "the same
    // area" — exactly the predicted accumulation, and nothing crashed.
    expect(areasNamedBilling.length).toBe(2);
  });
});

describe("Tests list / functional areas tree — browse + move (§3 P0 row)", () => {
  it("a created test is visible in the functional-area tree under its repo, and can be moved to a different area", async () => {
    const areaA = await queries.createFunctionalArea({
      repositoryId,
      name: "Tree Area A",
    });
    const areaB = await queries.createFunctionalArea({
      repositoryId,
      name: "Tree Area B",
    });
    cleanupAreaIds.push(areaA.id, areaB.id);

    const test = await queries.createTest({
      repositoryId,
      functionalAreaId: areaA.id,
      name: "Tree browse test",
      code: "export async function test(page) {}",
      targetUrl: "https://example.test/tree",
    });
    cleanupTestIds.push(test.id);

    const treeBefore = await queries.getFunctionalAreasTree(repositoryId);
    const nodeABefore = treeBefore.find((n) => n.id === areaA.id);
    expect(nodeABefore?.tests.some((t) => t.id === test.id)).toBe(true);

    // Move it.
    await queries.updateTest(test.id, { functionalAreaId: areaB.id });

    const treeAfter = await queries.getFunctionalAreasTree(repositoryId);
    const nodeAAfter = treeAfter.find((n) => n.id === areaA.id);
    const nodeBAfter = treeAfter.find((n) => n.id === areaB.id);
    expect(nodeAAfter?.tests.some((t) => t.id === test.id)).toBe(false);
    expect(nodeBAfter?.tests.some((t) => t.id === test.id)).toBe(true);
  });
});

describe("Setup scripts — create/edit, attach as repo default, resolve into the run chain (§3 P1 row)", () => {
  let scriptId: string;

  it("creates and edits a setup script", async () => {
    const script = await queries.createSetupScript({
      repositoryId,
      name: "Login as test user",
      type: "playwright",
      code: "export async function setup(page) { await page.goto('/login'); }",
      description: "seeds an authenticated session",
    });
    scriptId = script.id;
    cleanupScriptIds.push(scriptId);

    const fetched = await queries.getSetupScript(scriptId);
    expect(fetched?.name).toBe("Login as test user");

    await queries.updateSetupScript(scriptId, {
      code: "export async function setup(page) { await page.goto('/login'); await page.evaluate(() => localStorage.setItem('setupRan','1')); }",
    });
    const edited = await queries.getSetupScript(scriptId);
    expect(edited?.code).toContain("setupRan");
  });

  it("attaches the script as the repo's default setup step and resolves ahead of the test's own code", async () => {
    await queries.replaceDefaultSetupSteps(repositoryId, [
      { stepType: "script", scriptId },
    ]);

    const steps = await queries.getDefaultSetupSteps(repositoryId);
    expect(steps).toHaveLength(1);
    expect(steps[0].stepType).toBe("script");
    expect(steps[0].scriptId).toBe(scriptId);
    expect(steps[0].scriptCode).toContain("setupRan");

    const recordedTest = await queries.createTest({
      repositoryId,
      functionalAreaId: null,
      name: "Setup-chain test",
      code: "export async function test(page) { /* real test body */ }",
      targetUrl: "https://example.test/dashboard",
    });
    cleanupTestIds.push(recordedTest.id);

    // This is the exact resolver `runBuildAsync`/`runTestsCore` call before
    // dispatching to the executor — confirms the setup step actually
    // resolves into build-ready { code, setupId } ahead of the recorded
    // test's own code, i.e. it WILL run first on a real EB.
    const resolved = await resolveBuildSetup({
      tests: [recordedTest],
      repositoryId,
      build: null,
      logTag: "[integration-test]",
    });

    expect(resolved.setupInfo?.code).toContain("setupRan");
    expect(resolved.setupInfo?.setupId).toBeTruthy();
  });
});
