/**
 * `repo_credentials` against the real dev Postgres.
 *
 * The unit tests in `src/lib/crypto-fields.test.ts` cover the encrypt/decrypt
 * round-trip in isolation. What only a database can show is the property the
 * whole feature is sold on: **the ciphertext is what is stored**, and the
 * masked read is what comes back. A helper that encrypts correctly but a query
 * layer that forgets to call it would pass every unit test and store plaintext.
 *
 * Run with `pnpm test:integration`.
 */
import { v4 as uuid } from "uuid";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { repositories, teams, repoCredentials } from "@/lib/db/schema";
import type { CredentialField } from "@/lib/db/schema";
import {
  createCredential,
  updateCredential,
  deleteCredential,
  listCredentials,
  getCredential,
  getCredentialsForRun,
  getCredentialFieldsRaw,
  credentialNameTaken,
  markCredentialsUsed,
} from "@/lib/db/queries/credentials";

const PASSWORD = "hunter2-correct-horse-🔐";
const USERNAME = "svc-qa@acme.com";

let teamId: string;
let repositoryId: string;
let repoB: string;

beforeAll(async () => {
  if (!process.env.ENCRYPTION_KEY) {
    process.env.ENCRYPTION_KEY =
      "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
  }
  teamId = uuid();
  await db.insert(teams).values({
    id: teamId,
    name: `cred-test-${teamId.slice(0, 8)}`,
    slug: `cred-test-${teamId.slice(0, 8)}`,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  repositoryId = uuid();
  repoB = uuid();
  await db.insert(repositories).values([
    {
      id: repositoryId,
      teamId,
      provider: "local",
      owner: "cred-test",
      name: "repo-a",
      fullName: "cred-test/repo-a",
      createdAt: new Date(),
    },
    {
      id: repoB,
      teamId,
      provider: "local",
      owner: "cred-test",
      name: "repo-b",
      fullName: "cred-test/repo-b",
      createdAt: new Date(),
    },
  ]);
});

afterAll(async () => {
  await db
    .delete(repoCredentials)
    .where(eq(repoCredentials.repositoryId, repositoryId));
  await db
    .delete(repoCredentials)
    .where(eq(repoCredentials.repositoryId, repoB));
  await db.delete(repositories).where(eq(repositories.id, repositoryId));
  await db.delete(repositories).where(eq(repositories.id, repoB));
  await db.delete(teams).where(eq(teams.id, teamId));
});

function fields(password = PASSWORD): CredentialField[] {
  return [
    { key: "username", value: USERNAME, secret: false },
    { key: "password", value: password, secret: true },
  ];
}

describe("repo_credentials", () => {
  it("stores ciphertext, never the plaintext secret", async () => {
    const { id } = await createCredential({
      repositoryId,
      name: "vaultAdmin",
      label: "Vault sandbox admin",
      fields: fields(),
    });

    // Read the raw column, bypassing every helper.
    const [row] = await db
      .select()
      .from(repoCredentials)
      .where(eq(repoCredentials.id, id));
    const raw = JSON.stringify(row.fields);
    expect(raw).not.toContain(PASSWORD);
    expect(raw).toContain("enc:v1:");
    // The non-secret field is deliberately readable, so the list can render
    // it without a decrypt per row.
    expect(raw).toContain(USERNAME);

    await deleteCredential(id);
  });

  it("returns masked fields to the UI and plaintext only to a run", async () => {
    const { id } = await createCredential({
      repositoryId,
      name: "vaultAdmin",
      label: "Vault sandbox admin",
      fields: fields(),
    });

    for (const listed of [
      (await listCredentials(repositoryId))[0],
      (await getCredential(id))!,
    ]) {
      const serialized = JSON.stringify(listed);
      expect(serialized).not.toContain(PASSWORD);
      expect(serialized).not.toContain("enc:v1:");
      expect(listed.fields.find((f) => f.key === "password")?.value).toBe("");
      expect(listed.fields.find((f) => f.key === "username")?.value).toBe(
        USERNAME,
      );
    }

    // The one plaintext read path, keyed by handle for injection.
    expect(await getCredentialsForRun(repositoryId)).toEqual({
      vaultAdmin: { username: USERNAME, password: PASSWORD },
    });

    await deleteCredential(id);
  });

  it("carries a secret forward when an update re-submits its ciphertext", async () => {
    // What the editor does for a secret the user didn't touch: the update
    // action reads the raw (still-encrypted) fields and passes them back
    // through, which must not double-encrypt.
    const { id } = await createCredential({
      repositoryId,
      name: "vaultAdmin",
      label: "Vault sandbox admin",
      fields: fields(),
    });

    const stored = await getCredentialFieldsRaw(id);
    expect(stored!.find((f) => f.key === "password")!.value).toContain(
      "enc:v1:",
    );

    await updateCredential(id, {
      label: "Vault sandbox admin (renamed)",
      fields: [
        { key: "username", value: "new-user@acme.com", secret: false },
        stored!.find((f) => f.key === "password")!,
      ],
    });

    const run = await getCredentialsForRun(repositoryId);
    expect(run.vaultAdmin.password).toBe(PASSWORD);
    expect(run.vaultAdmin.username).toBe("new-user@acme.com");

    await deleteCredential(id);
  });

  it("re-encrypts a genuinely replaced secret", async () => {
    const { id } = await createCredential({
      repositoryId,
      name: "vaultAdmin",
      label: "Vault sandbox admin",
      fields: fields(),
    });

    await updateCredential(id, { fields: fields("rotated-hunter3") });
    const run = await getCredentialsForRun(repositoryId);
    expect(run.vaultAdmin.password).toBe("rotated-hunter3");

    const [row] = await db
      .select()
      .from(repoCredentials)
      .where(eq(repoCredentials.id, id));
    expect(JSON.stringify(row.fields)).not.toContain("rotated-hunter3");

    await deleteCredential(id);
  });

  it("leaves stored secrets alone on a patch that omits fields", async () => {
    const { id } = await createCredential({
      repositoryId,
      name: "vaultAdmin",
      label: "Vault sandbox admin",
      fields: fields(),
    });

    await updateCredential(id, { label: "Renamed only" });
    const run = await getCredentialsForRun(repositoryId);
    expect(run.vaultAdmin.password).toBe(PASSWORD);

    await deleteCredential(id);
  });

  it("scopes names per repo", async () => {
    const a = await createCredential({
      repositoryId,
      name: "vaultAdmin",
      label: "A",
      fields: fields(),
    });
    // Same handle in a different repo is fine — they are separate namespaces.
    const b = await createCredential({
      repositoryId: repoB,
      name: "vaultAdmin",
      label: "B",
      fields: fields(),
    });

    expect(await credentialNameTaken(repositoryId, "vaultAdmin")).toBe(true);
    // ...but not when the row asking is the one that holds it (an edit that
    // keeps the name must not collide with itself).
    expect(await credentialNameTaken(repositoryId, "vaultAdmin", a.id)).toBe(
      false,
    );
    expect(await credentialNameTaken(repositoryId, "other")).toBe(false);

    // A run only ever sees its own repo's credentials.
    expect(Object.keys(await getCredentialsForRun(repoB))).toEqual([
      "vaultAdmin",
    ]);

    await deleteCredential(a.id);
    await deleteCredential(b.id);
  });

  it("rejects a duplicate handle at the database, not just in the action", async () => {
    const { id } = await createCredential({
      repositoryId,
      name: "vaultAdmin",
      label: "A",
      fields: fields(),
    });
    await expect(
      createCredential({
        repositoryId,
        name: "vaultAdmin",
        label: "B",
        fields: fields(),
      }),
    ).rejects.toThrow();
    await deleteCredential(id);
  });

  it("stamps lastUsedAt without touching the stored secret", async () => {
    const { id } = await createCredential({
      repositoryId,
      name: "vaultAdmin",
      label: "A",
      fields: fields(),
    });
    expect((await getCredential(id))!.lastUsedAt).toBeNull();

    await markCredentialsUsed(repositoryId, ["vaultAdmin"]);
    expect((await getCredential(id))!.lastUsedAt).toBeInstanceOf(Date);
    expect((await getCredentialsForRun(repositoryId)).vaultAdmin.password).toBe(
      PASSWORD,
    );

    await deleteCredential(id);
  });

  it("cascades away with its repository", async () => {
    const scratchRepo = uuid();
    await db.insert(repositories).values({
      id: scratchRepo,
      teamId,
      provider: "local",
      owner: "cred-test",
      name: "repo-cascade",
      fullName: "cred-test/repo-cascade",
      createdAt: new Date(),
    });
    await createCredential({
      repositoryId: scratchRepo,
      name: "vaultAdmin",
      label: "A",
      fields: fields(),
    });

    await db.delete(repositories).where(eq(repositories.id, scratchRepo));
    expect(await listCredentials(scratchRepo)).toEqual([]);
  });
});
