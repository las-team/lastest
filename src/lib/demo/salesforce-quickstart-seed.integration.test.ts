/**
 * The Salesforce quickstart seed's insert path, against a real database.
 *
 * `createLocalRepo` itself can't be called here — like every `"use server"`
 * action behind `requireCapability()`, it throws outside a real Next request
 * scope. What the "Salesforce CRM" template reduces to is
 * `seedSalesforceQuickstart`, which is where every claim the template card
 * makes about the resulting repo has to hold.
 *
 * Run with `pnpm test:integration`.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  functionalAreas,
  playwrightSettings,
  repositories,
  teams,
  tests,
  testVersions,
} from "@/lib/db/schema";
import {
  SALESFORCE_QUICKSTART_AREAS,
  SALESFORCE_QUICKSTART_PLAYWRIGHT_PROFILE,
  SALESFORCE_QUICKSTART_TESTS,
  seedSalesforceQuickstart,
} from "@/lib/demo/salesforce-quickstart-seed";

let teamId: string;
let repositoryId: string;

beforeAll(async () => {
  teamId = randomUUID();
  repositoryId = randomUUID();
  await db.insert(teams).values({
    id: teamId,
    name: `sfdc-seed-${teamId}`,
    slug: `sfdc-seed-${teamId}`,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await db.insert(repositories).values({
    id: repositoryId,
    teamId,
    provider: "local",
    owner: "local",
    name: "Salesforce CRM",
    fullName: "Salesforce CRM",
  });
});

afterAll(async () => {
  const seeded = await db
    .select({ id: tests.id })
    .from(tests)
    .where(eq(tests.repositoryId, repositoryId));
  for (const t of seeded) {
    await db.delete(testVersions).where(eq(testVersions.testId, t.id));
  }
  await db.delete(tests).where(eq(tests.repositoryId, repositoryId));
  await db
    .delete(functionalAreas)
    .where(eq(functionalAreas.repositoryId, repositoryId));
  await db
    .delete(playwrightSettings)
    .where(eq(playwrightSettings.repositoryId, repositoryId));
  await db.delete(repositories).where(eq(repositories.id, repositoryId));
  await db.delete(teams).where(eq(teams.id, teamId));
});

describe("seedSalesforceQuickstart", () => {
  it("lands the repo with all 18 tests in their 8 areas", async () => {
    const firstTestId = await seedSalesforceQuickstart(repositoryId);
    expect(firstTestId).toBeTruthy();

    const seeded = await db
      .select()
      .from(tests)
      .where(eq(tests.repositoryId, repositoryId));
    expect(seeded).toHaveLength(SALESFORCE_QUICKSTART_TESTS.length);
    expect(seeded.map((t) => t.name).sort()).toEqual(
      SALESFORCE_QUICKSTART_TESTS.map((t) => t.name).sort(),
    );

    const areas = await db
      .select()
      .from(functionalAreas)
      .where(eq(functionalAreas.repositoryId, repositoryId));
    expect(areas).toHaveLength(SALESFORCE_QUICKSTART_AREAS.length);
    const areaById = new Map(areas.map((a) => [a.id, a.name]));
    for (const t of seeded) {
      const expected = SALESFORCE_QUICKSTART_TESTS.find(
        (s) => s.name === t.name,
      );
      expect(t.functionalAreaId).toBeTruthy();
      expect(areaById.get(t.functionalAreaId!)).toBe(expected?.area);
    }
  });

  it("quarantines every test, so the first build cannot go red on a missing credential", async () => {
    const seeded = await db
      .select()
      .from(tests)
      .where(eq(tests.repositoryId, repositoryId));
    for (const t of seeded) {
      expect(t.quarantined, t.name).toBe(true);
      expect(t.isPlaceholder, t.name).toBe(true);
      // No per-test target: the repo base URL the user sets applies to all.
      expect(t.targetUrl, t.name).toBeNull();
    }
  });

  it("writes a version row per test, so the code has history from the start", async () => {
    const seeded = await db
      .select({ id: tests.id })
      .from(tests)
      .where(eq(tests.repositoryId, repositoryId));
    for (const t of seeded) {
      const versions = await db
        .select()
        .from(testVersions)
        .where(eq(testVersions.testId, t.id));
      expect(versions).toHaveLength(1);
      expect(versions[0].version).toBe(1);
    }
  });

  it("applies the validated Playwright profile to the repo", async () => {
    const [settings] = await db
      .select()
      .from(playwrightSettings)
      .where(eq(playwrightSettings.repositoryId, repositoryId));
    expect(settings).toBeDefined();
    expect(settings.viewportWidth).toBe(
      SALESFORCE_QUICKSTART_PLAYWRIGHT_PROFILE.viewportWidth,
    );
    expect(settings.viewportHeight).toBe(
      SALESFORCE_QUICKSTART_PLAYWRIGHT_PROFILE.viewportHeight,
    );
    expect(settings.navigationTimeout).toBe(
      SALESFORCE_QUICKSTART_PLAYWRIGHT_PROFILE.navigationTimeout,
    );
    expect(settings.consoleMode).toBe("log");
    expect(settings.networkMode).toBe("log");
    expect(settings.enableVideoRecording).toBe(true);
  });

  it("is idempotent — a second call adds nothing", async () => {
    const before = await db
      .select({ id: tests.id })
      .from(tests)
      .where(eq(tests.repositoryId, repositoryId));
    await seedSalesforceQuickstart(repositoryId);
    const after = await db
      .select({ id: tests.id })
      .from(tests)
      .where(eq(tests.repositoryId, repositoryId));
    expect(after).toHaveLength(before.length);
  });
});
