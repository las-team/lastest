/**
 * Environments and SUT connectors, in a real browser.
 *
 * The feature makes one claim that no unit test can settle, because it spans a
 * form submission, two tables and an encryption boundary: **connecting a Vault
 * org named `vault` is what makes `credentials.vault.password` exist**, in that
 * environment, with the password encrypted at rest and never returned to the
 * browser. A consultant should not have to know the magic handle or the exact
 * field keys — that knowledge moves into the connector definition.
 *
 * The second claim is the one the environment model exists for: the SAME handle
 * can be connected twice, once per environment, and the two rows coexist. That
 * is a partial-unique-index behaviour, and only a database can demonstrate it.
 *
 * Deliberately cheap: no EB, no build, no network to Veeva or Salesforce. The
 * live connection check is exercised by `src/lib/connectors/*.test.ts` against
 * a stubbed fetch; what is proved here is the persistence contract.
 *
 * Prerequisites: `pnpm dev` (app on :3000), host postgres, `ENCRYPTION_KEY`
 * in `.env.local`. Run with `pnpm test:integration`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, and } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  repoCredentials,
  repositories,
  sutConnectors,
  environments,
  users,
} from "@/lib/db/schema";
import * as queries from "@/lib/db/queries";

import {
  destroyTeam,
  gotoSettled,
  launchSession,
  registerViaUi,
  teamIdForEmail,
  type Session,
} from "./harness";

let s: Session;
let teamId: string | undefined;
let repoId: string;

const VAULT_DNS = "acme-sandbox.veevavault.com";
const VAULT_USER = "svc-qa@acme.test";
const UAT_SECRET = `uat-${Math.random().toString(36).slice(2, 10)}`;
const PROD_SECRET = `prod-${Math.random().toString(36).slice(2, 10)}`;

async function connectorsForRepo() {
  return db
    .select()
    .from(sutConnectors)
    .where(eq(sutConnectors.repositoryId, repoId));
}

async function credentialsForRepo() {
  return db
    .select()
    .from(repoCredentials)
    .where(eq(repoCredentials.repositoryId, repoId));
}

/** Open Settings → Integrations, where both surfaces live. */
async function openIntegrations(): Promise<void> {
  await gotoSettled(s.page, "/settings?tab=integrations");
  await s.page
    .getByRole("heading", { name: /^Environments$/ })
    .first()
    .waitFor({ state: "visible", timeout: 60_000 });
}

/** Wait for a row to appear, since the form saves and then refreshes. */
async function waitFor<T>(
  read: () => Promise<T | undefined>,
  what: string,
): Promise<T> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const r = await read();
    if (r) return r;
    if (Date.now() > deadline) throw new Error(`${what} never appeared`);
    await new Promise((res) => setTimeout(res, 500));
  }
}

async function destroyTeamDeep(id: string | undefined): Promise<void> {
  if (!id) return;
  for (const repo of await db
    .select({ id: repositories.id })
    .from(repositories)
    .where(eq(repositories.teamId, id))) {
    await queries.deleteRepository(repo.id).catch(() => {});
  }
  for (const member of await queries.getTeamMembers(id)) {
    await queries.deleteUser(member.id).catch(async () => {
      await db
        .update(users)
        .set({ teamId: null })
        .where(eq(users.id, member.id));
    });
  }
  await destroyTeam(id);
}

/** Fill an environment dialog and save. */
async function createEnvironment(label: string, baseUrl: string) {
  const { page } = s;
  await page.getByRole("button", { name: /^New environment$/ }).click();
  const labelInput = page.locator("input#env-label");
  await labelInput.waitFor({ state: "visible", timeout: 30_000 });
  await labelInput.fill(label);
  await page.locator("input#env-url").fill(baseUrl);
  await page.getByRole("button", { name: /^Create$/ }).click();
  await page.getByRole("button", { name: /^Create$/ }).waitFor({
    state: "hidden",
    timeout: 30_000,
  });
}

/** Fill a Vault connector dialog and save. */
async function connectVault(opts: {
  label: string;
  environmentLabel: string;
  password: string;
}) {
  const { page } = s;
  await page
    .getByRole("button", { name: /^Add Veeva Vault connector$/ })
    .click();

  const labelInput = page.locator("input#connector-label");
  await labelInput.waitFor({ state: "visible", timeout: 30_000 });
  await labelInput.fill(opts.label);

  // The handle is derived from the label by `slugToHandle` and is the thing a
  // test body reads — overwritten here so both environments share it, which is
  // the point of the model.
  await page.locator("input#connector-handle").fill("vault");

  // Environment select: first combobox in the dialog.
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox").first().click();
  await page
    .getByRole("option", { name: new RegExp(`^${opts.environmentLabel}`) })
    .click();

  await page.locator("input#cfg-vaultDns").fill(VAULT_DNS);
  await page.locator("input#sec-username").fill(VAULT_USER);
  await page.locator("input#sec-password").fill(opts.password);

  await page.getByRole("button", { name: /^Connect$/ }).click();
  await page.getByRole("button", { name: /^Connect$/ }).waitFor({
    state: "hidden",
    timeout: 30_000,
  });
}

beforeAll(async () => {
  s = await launchSession();
  await registerViaUi(s, "Connectors UI");
  teamId = await teamIdForEmail(s.email);

  const suffix = Date.now().toString(36);
  const repo = await queries.createRepository({
    teamId: teamId!,
    provider: "local",
    owner: "conn-e2e",
    name: `repo-${suffix}`,
    fullName: `conn-e2e/repo-${suffix}`,
  });
  repoId = repo.id;
  await db
    .update(users)
    .set({ onboardingCompletedAt: new Date(), selectedRepositoryId: repoId })
    .where(eq(users.email, s.email));
}, 300_000);

afterAll(async () => {
  await s?.close();
  await destroyTeamDeep(teamId);
});

describe("environments and SUT connectors", () => {
  it("starts with no environments and no Vault orgs connected", async () => {
    await openIntegrations();
    const text = await s.page.evaluate(() => document.body.innerText);
    expect(text).toMatch(/No environments yet/);
    expect(text).toMatch(/No Veeva Vault orgs connected yet/);
    expect(await connectorsForRepo()).toHaveLength(0);
  });

  it("creates two environments, the first becoming the default", async () => {
    await createEnvironment("UAT", "https://acme-uat.veevavault.com");
    const uat = await waitFor(
      async () =>
        (
          await db
            .select()
            .from(environments)
            .where(
              and(
                eq(environments.repositoryId, repoId),
                eq(environments.key, "uat"),
              ),
            )
        )[0],
      "UAT environment",
    );
    // The key is derived from the label, and the first environment is made
    // default whether or not the form asked — a repo with environments but no
    // default would silently run unscoped.
    expect(uat.key).toBe("uat");
    expect(uat.isDefault).toBe(true);
    expect(uat.baseUrl).toBe("https://acme-uat.veevavault.com");

    await createEnvironment("Production", "https://acme.veevavault.com");
    const all = await db
      .select()
      .from(environments)
      .where(eq(environments.repositoryId, repoId));
    expect(all).toHaveLength(2);
    expect(all.filter((e) => e.isDefault)).toHaveLength(1);
  });

  it("connecting a Vault org provisions its credential under the same handle", async () => {
    await openIntegrations();
    await connectVault({
      label: "Vault UAT",
      environmentLabel: "UAT",
      password: UAT_SECRET,
    });

    const connector = await waitFor(
      async () => (await connectorsForRepo())[0],
      "connector row",
    );
    expect(connector.type).toBe("vault");
    expect(connector.name).toBe("vault");
    expect(connector.authMethod).toBe("vault-password");
    expect(connector.credentialId).toBeTruthy();

    // Non-secret config, in the clear and readable.
    const config = connector.config as unknown as Record<string, string>;
    expect(config.vaultDns).toBe(VAULT_DNS);
    expect(config.apiVersion).toMatch(/^v\d/);
    // The password must NOT be here — this column is plaintext jsonb.
    expect(JSON.stringify(config)).not.toContain(UAT_SECRET);

    // The credential the connector created, under the handle a test reads.
    const [cred] = await credentialsForRepo();
    expect(cred.name).toBe("vault");
    expect(cred.environmentId).toBe(connector.environmentId);
    const password = cred.fields.find((f) => f.key === "password")!;
    expect(password.secret).toBe(true);
    expect(password.value).toMatch(/^enc:v1:/);
    expect(password.value).not.toContain(UAT_SECRET);
    // The username is a non-secret and stays readable.
    expect(cred.fields.find((f) => f.key === "username")!.value).toBe(
      VAULT_USER,
    );
  });

  it("never sends the stored secret back to the browser", async () => {
    await openIntegrations();
    const html = await s.page.content();
    expect(html).not.toContain(UAT_SECRET);
    // The handle a test would read IS shown — that is the point of the card.
    expect(html).toContain("credentials.vault.username");
  });

  it("connects the same handle again in a second environment", async () => {
    await openIntegrations();
    await connectVault({
      label: "Vault Production",
      environmentLabel: "Production",
      password: PROD_SECRET,
    });

    const connectors = await waitFor(async () => {
      const rows = await connectorsForRepo();
      return rows.length === 2 ? rows : undefined;
    }, "second connector");

    // One handle, two environments — the partial unique index in action.
    expect(connectors.map((c) => c.name)).toEqual(["vault", "vault"]);
    expect(new Set(connectors.map((c) => c.environmentId)).size).toBe(2);

    // And the run-time resolver hands each environment its own password,
    // through an identically shaped map. This is the whole feature.
    const uatConn = connectors.find((c) => c.label === "Vault UAT")!;
    const prodConn = connectors.find((c) => c.label === "Vault Production")!;
    const inProd = (await queries.getCredentialsForRun(
      repoId,
      prodConn.environmentId,
    )).credentials;
    const inUat = (await queries.getCredentialsForRun(
      repoId,
      uatConn.environmentId,
    )).credentials;
    expect(inProd.vault.password).toBe(PROD_SECRET);
    expect(inUat.vault.password).toBe(UAT_SECRET);
    expect(Object.keys(inProd.vault).sort()).toEqual(
      Object.keys(inUat.vault).sort(),
    );
  });

  it("keeps the stored secret when an edit leaves the field blank", async () => {
    const { page } = s;
    await openIntegrations();
    await page.getByRole("button", { name: /^Edit Vault UAT$/ }).click();

    const labelInput = page.locator("input#connector-label");
    await labelInput.waitFor({ state: "visible", timeout: 30_000 });
    // Change only the display name; the password field stays untouched.
    await labelInput.fill("Vault UAT (26R2)");
    await page.getByRole("button", { name: /^Save$/ }).click();
    await page
      .getByRole("button", { name: /^Save$/ })
      .waitFor({ state: "hidden", timeout: 30_000 });

    await waitFor(async () => {
      const rows = await connectorsForRepo();
      return rows.find((c) => c.label === "Vault UAT (26R2)");
    }, "renamed connector");

    const creds = await credentialsForRepo();
    const uatCred = creds.find(
      (c) => c.label === "Vault UAT (26R2)" || c.label === "Vault UAT",
    )!;
    const password = uatCred.fields.find((f) => f.key === "password")!;
    expect(password.value).toMatch(/^enc:v1:/);
  });

  it("removes the managed credential when the connector is disconnected", async () => {
    const { page } = s;
    await openIntegrations();
    page.once("dialog", (d) => void d.accept());
    await page
      .getByRole("button", { name: /^Remove Vault Production$/ })
      .click();

    await waitFor(async () => {
      const rows = await connectorsForRepo();
      return rows.length === 1 ? rows : undefined;
    }, "connector removal");

    // No orphan: a credential left behind would keep a stale password in the
    // store while the UI says the org is disconnected.
    const creds = await credentialsForRepo();
    expect(creds).toHaveLength(1);
    const remaining = (await queries.getCredentialsForRun(
      repoId,
      creds[0].environmentId,
    )).credentials;
    expect(remaining.vault.password).toBe(UAT_SECRET);
  });

  it("reports no unexplained client errors", async () => {
    // The harness already strips known-benign dev-mode noise.
    expect(s.consoleErrors).toEqual([]);
  });
});
