/**
 * The environment model (B2) against the real dev Postgres.
 *
 * Three properties only a database can demonstrate, and each is a bug the
 * feature exists to prevent:
 *
 *  1. **Baseline precedence.** A UAT run must not silently compare against
 *     PROD's baseline, and a repo that just adopted environments must not lose
 *     the approvals it already had. Both are ordering behaviour across four
 *     scopes — untestable without rows.
 *  2. **Credential resolution.** The same handle resolves to different secrets
 *     per environment, falling back to the repo-wide row, with the resulting
 *     map identically shaped either way. That is what lets one test body run
 *     against both.
 *  3. **Promotion and refresh.** Promoting supersedes rather than deletes, and
 *     a recorded refresh leaves every baseline standing.
 *
 * Run with `pnpm test:integration`.
 */
import { v4 as uuid } from "uuid";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import {
  repositories,
  teams,
  tests as testsTable,
  baselines,
  environments,
  repoCredentials,
} from "@/lib/db/schema";
import {
  createEnvironment,
  getDefaultEnvironment,
  setDefaultEnvironment,
  deleteEnvironment,
  listEnvironments,
  promoteBaselines,
  recordEnvironmentRefresh,
  upsertEnvironmentVariable,
  getEnvironmentVariableMap,
} from "@/lib/db/queries/environments";
import {
  createCredential,
  getCredentialsForRun,
  credentialNameTaken,
} from "@/lib/db/queries/credentials";
import {
  getActiveBaseline,
  getBranchBaseline,
} from "@/lib/db/queries/visual-diffs";

const BRANCH = "main";

let teamId: string;
let repositoryId: string;
let testId: string;

beforeAll(async () => {
  if (!process.env.ENCRYPTION_KEY) {
    process.env.ENCRYPTION_KEY =
      "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
  }
  teamId = uuid();
  await db.insert(teams).values({
    id: teamId,
    name: `env-test-${teamId.slice(0, 8)}`,
    slug: `env-test-${teamId.slice(0, 8)}`,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  repositoryId = uuid();
  await db.insert(repositories).values({
    id: repositoryId,
    teamId,
    provider: "local",
    owner: "env-test",
    name: "repo",
    fullName: "env-test/repo",
    defaultBranch: BRANCH,
    createdAt: new Date(),
  });
  testId = uuid();
  await db.insert(testsTable).values({
    id: testId,
    repositoryId,
    name: "env baseline test",
    code: "export async function test() {}",
    createdAt: new Date(),
  });
});

afterAll(async () => {
  await db.delete(baselines).where(eq(baselines.testId, testId));
  await db.delete(testsTable).where(eq(testsTable.id, testId));
  await db
    .delete(repoCredentials)
    .where(eq(repoCredentials.repositoryId, repositoryId));
  await db
    .delete(environments)
    .where(eq(environments.repositoryId, repositoryId));
  await db.delete(repositories).where(eq(repositories.id, repositoryId));
  await db.delete(teams).where(eq(teams.id, teamId));
});

beforeEach(async () => {
  await db.delete(baselines).where(eq(baselines.testId, testId));
  await db
    .delete(repoCredentials)
    .where(eq(repoCredentials.repositoryId, repositoryId));
  await db
    .delete(environments)
    .where(eq(environments.repositoryId, repositoryId));
});

async function seedBaseline(opts: {
  environmentKey?: string | null;
  dataCell?: string | null;
  imagePath: string;
}) {
  const id = uuid();
  await db.insert(baselines).values({
    id,
    repositoryId,
    testId,
    stepLabel: "step-1",
    imagePath: opts.imagePath,
    imageHash: `hash-${opts.imagePath}`,
    branch: BRANCH,
    browser: "chromium",
    isActive: true,
    environmentKey: opts.environmentKey ?? null,
    dataCell: opts.dataCell ?? null,
    createdAt: new Date(),
  });
  return id;
}

describe("environments", () => {
  it("makes the first environment the default and moves it on request", async () => {
    const prod = await createEnvironment({
      repositoryId,
      key: "prod",
      label: "Production",
      isDefault: true,
    });
    const uat = await createEnvironment({
      repositoryId,
      key: "uat",
      label: "UAT",
    });
    expect((await getDefaultEnvironment(repositoryId))?.id).toBe(prod.id);

    await setDefaultEnvironment(repositoryId, uat.id);
    expect((await getDefaultEnvironment(repositoryId))?.id).toBe(uat.id);
    // Exactly one default — not two.
    const all = await listEnvironments(repositoryId);
    expect(all.filter((e) => e.isDefault)).toHaveLength(1);
  });

  it("returns undefined for a repo with no environments", async () => {
    expect(await getDefaultEnvironment(repositoryId)).toBeUndefined();
  });

  it("rejects a duplicate key at the database level", async () => {
    await createEnvironment({ repositoryId, key: "uat", label: "UAT" });
    await expect(
      createEnvironment({ repositoryId, key: "uat", label: "UAT again" }),
    ).rejects.toThrow();
  });
});

describe("baseline precedence", () => {
  it("prefers this environment's baseline over the unscoped one", async () => {
    await seedBaseline({ environmentKey: null, imagePath: "shared.png" });
    await seedBaseline({ environmentKey: "uat", imagePath: "uat.png" });

    const found = await getActiveBaseline(
      testId,
      "step-1",
      BRANCH,
      BRANCH,
      "chromium",
      null,
      "uat",
    );
    expect(found?.imagePath).toBe("uat.png");
  });

  it("falls back to the unscoped baseline when the environment has none", async () => {
    await seedBaseline({ environmentKey: null, imagePath: "shared.png" });
    const found = await getActiveBaseline(
      testId,
      "step-1",
      BRANCH,
      BRANCH,
      "chromium",
      null,
      "uat",
    );
    expect(found?.imagePath).toBe("shared.png");
  });

  it("never hands another environment's baseline to a run", async () => {
    await seedBaseline({ environmentKey: "prod", imagePath: "prod.png" });
    const found = await getActiveBaseline(
      testId,
      "step-1",
      BRANCH,
      BRANCH,
      "chromium",
      null,
      "uat",
    );
    expect(found).toBeUndefined();
  });

  it("keeps an unscoped run away from environment-scoped baselines", async () => {
    await seedBaseline({ environmentKey: "uat", imagePath: "uat.png" });
    const found = await getActiveBaseline(testId, "step-1", BRANCH, BRANCH);
    expect(found).toBeUndefined();
  });

  /**
   * The ordering decision recorded in `getActiveBaseline`: environment is the
   * OUTER loop. A UAT baseline for a different data cell beats a PROD baseline
   * for this run's own cell, because the environment decides what the page
   * should look like and the cell only decides which data it showed.
   */
  it("prefers the right environment over the right data cell", async () => {
    await seedBaseline({
      environmentKey: "prod",
      dataCell: "country=DE",
      imagePath: "prod-de.png",
    });
    await seedBaseline({
      environmentKey: "uat",
      dataCell: null,
      imagePath: "uat-shared.png",
    });

    const found = await getActiveBaseline(
      testId,
      "step-1",
      BRANCH,
      BRANCH,
      "chromium",
      "country=DE",
      "uat",
    );
    expect(found?.imagePath).toBe("uat-shared.png");
  });

  it("does not let a newer unscoped baseline win on timestamp", async () => {
    await seedBaseline({ environmentKey: "uat", imagePath: "uat.png" });
    // Created later, so a query that took "the newest of both" would pick it.
    await new Promise((r) => setTimeout(r, 10));
    await seedBaseline({ environmentKey: null, imagePath: "shared-newer.png" });

    const found = await getActiveBaseline(
      testId,
      "step-1",
      BRANCH,
      BRANCH,
      "chromium",
      null,
      "uat",
    );
    expect(found?.imagePath).toBe("uat.png");
  });

  it("applies the same fallback in getBranchBaseline", async () => {
    await seedBaseline({ environmentKey: null, imagePath: "shared.png" });
    expect(
      (await getBranchBaseline(testId, "step-1", BRANCH, "chromium", "uat"))
        ?.imagePath,
    ).toBe("shared.png");

    await seedBaseline({ environmentKey: "uat", imagePath: "uat.png" });
    expect(
      (await getBranchBaseline(testId, "step-1", BRANCH, "chromium", "uat"))
        ?.imagePath,
    ).toBe("uat.png");
  });
});

describe("per-environment credentials", () => {
  it("resolves the same handle to different secrets per environment", async () => {
    const uat = await createEnvironment({
      repositoryId,
      key: "uat",
      label: "UAT",
    });
    await createCredential({
      repositoryId,
      name: "vault",
      label: "Vault (repo-wide)",
      fields: [
        { key: "username", value: "prod-user", secret: false },
        { key: "password", value: "prod-pw", secret: true },
      ],
    });
    await createCredential({
      repositoryId,
      environmentId: uat.id,
      name: "vault",
      label: "Vault (UAT)",
      fields: [
        { key: "username", value: "uat-user", secret: false },
        { key: "password", value: "uat-pw", secret: true },
      ],
    });

    const inUat = (await getCredentialsForRun(repositoryId, uat.id))
      .credentials;
    const unscoped = (await getCredentialsForRun(repositoryId)).credentials;

    expect(inUat.vault.password).toBe("uat-pw");
    expect(unscoped.vault.password).toBe("prod-pw");
    // Identical SHAPE — this is what lets one test body serve both.
    expect(Object.keys(inUat.vault).sort()).toEqual(
      Object.keys(unscoped.vault).sort(),
    );
  });

  it("falls back to the repo-wide credential for a handle the environment lacks", async () => {
    const uat = await createEnvironment({
      repositoryId,
      key: "uat",
      label: "UAT",
    });
    await createCredential({
      repositoryId,
      name: "salesforce",
      label: "SF",
      fields: [{ key: "password", value: "sf-pw", secret: true }],
    });
    const inUat = (await getCredentialsForRun(repositoryId, uat.id))
      .credentials;
    expect(inUat.salesforce.password).toBe("sf-pw");
  });

  it("lets the same handle exist once per environment", async () => {
    const uat = await createEnvironment({
      repositoryId,
      key: "uat",
      label: "UAT",
    });
    await createCredential({
      repositoryId,
      environmentId: uat.id,
      name: "vault",
      label: "V",
      fields: [{ key: "password", value: "x", secret: true }],
    });
    // Free repo-wide, taken inside UAT.
    expect(
      await credentialNameTaken(repositoryId, "vault", undefined, null),
    ).toBe(false);
    expect(
      await credentialNameTaken(repositoryId, "vault", undefined, uat.id),
    ).toBe(true);
  });

  it("orphans rather than deletes credentials when its environment goes", async () => {
    const uat = await createEnvironment({
      repositoryId,
      key: "uat",
      label: "UAT",
    });
    await createCredential({
      repositoryId,
      environmentId: uat.id,
      name: "vault",
      label: "V",
      fields: [{ key: "password", value: "x", secret: true }],
    });
    await deleteEnvironment(uat.id);

    // The login survives, repo-wide — deleting an environment is not a way to
    // silently lose a password.
    const rows = await db
      .select()
      .from(repoCredentials)
      .where(eq(repoCredentials.repositoryId, repositoryId));
    expect(rows).toHaveLength(1);
    expect(rows[0].environmentId).toBeNull();
  });
});

describe("environment variables", () => {
  it("upserts by key so a sandbox refresh is one edit", async () => {
    const uat = await createEnvironment({
      repositoryId,
      key: "uat",
      label: "UAT",
    });
    await upsertEnvironmentVariable({
      environmentId: uat.id,
      key: "docId",
      value: "OLD-DOC",
    });
    await upsertEnvironmentVariable({
      environmentId: uat.id,
      key: "docId",
      value: "NEW-DOC",
    });
    expect(await getEnvironmentVariableMap(uat.id)).toEqual({
      docId: "NEW-DOC",
    });
  });
});

describe("promotion and refresh", () => {
  it("copies baselines across, sharing the image and superseding the target", async () => {
    await createEnvironment({ repositoryId, key: "uat", label: "UAT" });
    await createEnvironment({ repositoryId, key: "prod", label: "PROD" });
    await seedBaseline({
      environmentKey: "uat",
      imagePath: "uat-approved.png",
    });
    await seedBaseline({ environmentKey: "prod", imagePath: "prod-old.png" });

    const outcome = await promoteBaselines(repositoryId, "uat", "prod");
    expect(outcome).toEqual({ promoted: 1, superseded: 1 });

    const active = await getActiveBaseline(
      testId,
      "step-1",
      BRANCH,
      BRANCH,
      "chromium",
      null,
      "prod",
    );
    // Same image, new row — the PNG is shared, not duplicated.
    expect(active?.imagePath).toBe("uat-approved.png");
    expect(active?.environmentKey).toBe("prod");

    // Superseded, not deleted: a regretted promotion has to be recoverable.
    const all = await db
      .select()
      .from(baselines)
      .where(eq(baselines.testId, testId));
    const old = all.find((b) => b.imagePath === "prod-old.png");
    expect(old?.isActive).toBe(false);
  });

  it("promotes a repo's unscoped approvals into its first environment", async () => {
    await createEnvironment({ repositoryId, key: "uat", label: "UAT" });
    await seedBaseline({ environmentKey: null, imagePath: "legacy.png" });

    const outcome = await promoteBaselines(repositoryId, null, "uat");
    expect(outcome.promoted).toBe(1);
    const active = await getActiveBaseline(
      testId,
      "step-1",
      BRANCH,
      BRANCH,
      "chromium",
      null,
      "uat",
    );
    expect(active?.environmentKey).toBe("uat");
  });

  it("refuses to promote an environment onto itself", async () => {
    await expect(promoteBaselines(repositoryId, "uat", "uat")).rejects.toThrow(
      /must differ/,
    );
  });

  it("leaves every baseline standing across a sandbox refresh", async () => {
    const uat = await createEnvironment({
      repositoryId,
      key: "uat",
      label: "UAT",
    });
    await seedBaseline({ environmentKey: "uat", imagePath: "uat.png" });

    await recordEnvironmentRefresh(uat.id, "26R2 sandbox refresh");

    const [env] = await db
      .select()
      .from(environments)
      .where(eq(environments.id, uat.id));
    expect(env.refreshedAt).toBeInstanceOf(Date);
    expect(env.refreshNote).toBe("26R2 sandbox refresh");

    // The point of the whole exercise: the approval is still there.
    const active = await getActiveBaseline(
      testId,
      "step-1",
      BRANCH,
      BRANCH,
      "chromium",
      null,
      "uat",
    );
    expect(active?.imagePath).toBe("uat.png");
  });
});
