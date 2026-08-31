/**
 * The pharma seed's insert path, against a real database.
 *
 * `startPharmaOnboarding` itself can't be called here — like every
 * `"use server"` action behind `requireCapability()`, it throws outside a real
 * Next request scope (`next/headers()`). What it reduces to is
 * `seedPharmaSuite`, which is where every claim the onboarding screen makes
 * about the resulting repo actually has to hold.
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
import { seedPharmaSuite } from "@/lib/demo/pharma-seed";
import { REGULATED_CHECK_MODES } from "@/lib/segment/regulated";

let teamId: string;
let repositoryId: string;

beforeAll(async () => {
  teamId = randomUUID();
  repositoryId = randomUUID();
  await db.insert(teams).values({
    id: teamId,
    name: `pharma-seed-${teamId}`,
    slug: `pharma-seed-${teamId}`,
    regulatedMode: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await db.insert(repositories).values({
    id: repositoryId,
    teamId,
    provider: "local",
    owner: "local",
    name: "Vault + Salesforce",
    fullName: "Vault + Salesforce",
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

describe("seedPharmaSuite", () => {
  it("lands the repo with both suites in place", async () => {
    const firstTestId = await seedPharmaSuite(repositoryId);
    expect(firstTestId).toBeTruthy();

    const seeded = await db
      .select()
      .from(tests)
      .where(eq(tests.repositoryId, repositoryId));
    expect(seeded).toHaveLength(2);
    expect(seeded.map((t) => t.name).sort()).toEqual([
      "Salesforce release regression",
      "Vault release regression",
    ]);

    const areas = await db
      .select()
      .from(functionalAreas)
      .where(eq(functionalAreas.repositoryId, repositoryId));
    expect(areas).toHaveLength(2);
  });

  it("quarantines both, so the first build cannot go red on missing credentials", async () => {
    const seeded = await db
      .select()
      .from(tests)
      .where(eq(tests.repositoryId, repositoryId));
    for (const t of seeded) {
      expect(t.quarantined, t.name).toBe(true);
      expect(t.isPlaceholder, t.name).toBe(true);
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

  it("applies the regulated check-layer modes to the repo", async () => {
    const [settings] = await db
      .select()
      .from(playwrightSettings)
      .where(eq(playwrightSettings.repositoryId, repositoryId));
    expect(settings).toBeDefined();
    // Text is the one the segment is bought for — see the profile's comment.
    expect(settings.textMode).toBe(REGULATED_CHECK_MODES.text);
    expect(settings.visualMode).toBe(REGULATED_CHECK_MODES.visual);
    expect(settings.domMode).toBe(REGULATED_CHECK_MODES.dom);
    expect(settings.perfMode).toBe(REGULATED_CHECK_MODES.perf);
    expect(settings.a11yMode).toBe(REGULATED_CHECK_MODES.a11y);
  });

  it("is idempotent — a second call adds nothing", async () => {
    const before = await db
      .select({ id: tests.id })
      .from(tests)
      .where(eq(tests.repositoryId, repositoryId));
    await seedPharmaSuite(repositoryId);
    const after = await db
      .select({ id: tests.id })
      .from(tests)
      .where(eq(tests.repositoryId, repositoryId));
    expect(after).toHaveLength(before.length);
  });
});
