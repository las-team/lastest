/**
 * §4 step 16 — the per-repo credential store, in a real browser.
 *
 * `feat(credentials): per-repo secret store with run-time injection`
 * (60b5691f) added a surface with a claim no rendering test can settle on its
 * own: a secret typed into the editor is **encrypted at rest**, is **never
 * sent back to the browser**, and is handed to a run as a live
 * `credentials.<handle>.<field>` object rather than substituted into test
 * source. Those are three assertions about what is in the database and what
 * is not in the DOM, taken either side of a real form submission — which is
 * exactly the seam a browser test plus a direct query can cover and nothing
 * else can.
 *
 * The suite is deliberately cheap: no EB, no build, no AI. The run-time half
 * is proved at the `getCredentialsForRun()` seam — the single decrypting read
 * the executor calls at dispatch (`src/lib/execution/run-credentials.ts`) —
 * rather than by running a test against a login form, because what is worth
 * proving here is the decryption contract, not Playwright's `fill()`.
 *
 * Prerequisites: `pnpm dev` (app on :3000), host postgres, `ENCRYPTION_KEY`
 * in `.env.local` (loaded into this process by `vitest.integration.config.ts`
 * — without it `encryptCredentialFields` throws and every case here fails for
 * an environmental reason). Run with `pnpm test:integration`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { repoCredentials, repositories, users } from "@/lib/db/schema";
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

const LABEL = "Vault sandbox admin";
/** Derived from the label by `slugToHandle` — asserted, not typed. */
const HANDLE = "vaultSandboxAdmin";
const USERNAME = "qa@example.test";
const SECRET = `s3cr3t-${Math.random().toString(36).slice(2, 10)}`;

async function rowForRepo() {
  const [row] = await db
    .select()
    .from(repoCredentials)
    .where(eq(repoCredentials.repositoryId, repoId));
  return row;
}

/** Open `/setup` and switch to the Credentials tab (no `?tab=` support). */
async function openCredentialsTab(): Promise<void> {
  await gotoSettled(s.page, "/setup");
  const trigger = s.page.getByRole("tab", { name: /^Credentials$/ });
  await trigger.waitFor({ state: "visible", timeout: 60_000 });
  await trigger.click();
  await s.page
    .getByRole("heading", { name: /^Credentials$/ })
    .first()
    .waitFor({ state: "visible", timeout: 30_000 });
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

beforeAll(async () => {
  s = await launchSession();
  await registerViaUi(s, "Credentials UI");
  teamId = await teamIdForEmail(s.email);

  // `/setup` renders `AddRepoEmptyState` with no repo selected, and
  // `(app)/layout.tsx` bounces to /onboarding until it is marked done. The
  // wizard is `golden-path`'s subject; this suite only needs its outcome.
  const suffix = Date.now().toString(36);
  const repo = await queries.createRepository({
    teamId: teamId!,
    provider: "local",
    owner: "cred-e2e",
    name: `repo-${suffix}`,
    fullName: `cred-e2e/repo-${suffix}`,
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

describe("§4 step 16 — per-repo credentials: create, encrypt, edit, delete", () => {
  it("the Credentials tab starts empty and names the reference syntax", async () => {
    await openCredentialsTab();
    const text = await s.page.evaluate(() => document.body.innerText);
    // The empty state is where the product teaches `credentials.<handle>` —
    // the whole point of the feature being a store rather than a token.
    expect(text).toMatch(/No credentials yet/);
    expect(text).toMatch(/credentials\.vaultAdmin\.password/);
    expect(await rowForRepo()).toBeUndefined();
  });

  it("creating one derives the handle and writes the secret encrypted", async () => {
    const { page } = s;
    await page.getByRole("button", { name: /^New credential$/ }).click();

    const label = page.locator("input#cred-label");
    await label.waitFor({ state: "visible", timeout: 30_000 });
    await label.fill(LABEL);
    // `slugToHandle` fills the code handle as you type the label — asserted
    // rather than typed, because the handle is what test code will read.
    await expect
      .poll(async () => page.locator("input#cred-name").inputValue(), {
        timeout: 15_000,
      })
      .toBe(HANDLE);

    // The two default fields: `username` plain, `password` secret.
    await page.locator('input[value="username"]').first().waitFor({
      state: "visible",
      timeout: 15_000,
    });
    // Field rows are keyed by their `key` input; the value input is its
    // sibling. Locating through the row keeps this stable if a third default
    // field is ever added.
    const rowFor = (key: string) =>
      page.locator("div").filter({
        has: page.locator(`input[value="${key}"]`),
      });
    await rowFor("username").last().locator("input").nth(1).fill(USERNAME);
    await rowFor("password").last().locator("input").nth(1).fill(SECRET);

    await page.getByRole("button", { name: /^Create$/ }).click();

    const row = await (async () => {
      const deadline = Date.now() + 60_000;
      for (;;) {
        const r = await rowForRepo();
        if (r) return r;
        if (Date.now() > deadline)
          throw new Error("credential row never appeared");
        await new Promise((res) => setTimeout(res, 500));
      }
    })();

    expect(row.name).toBe(HANDLE);
    expect(row.label).toBe(LABEL);

    const stored = Object.fromEntries(row.fields.map((f) => [f.key, f]));
    // Plain field: literal. Secret field: AES-GCM ciphertext under the
    // `enc:v1:` prefix from `src/lib/crypto.ts`, and emphatically not the
    // password anywhere in the column.
    expect(stored.username.secret).toBe(false);
    expect(stored.username.value).toBe(USERNAME);
    expect(stored.password.secret).toBe(true);
    expect(stored.password.value.startsWith("enc:v1:")).toBe(true);
    expect(stored.password.value).not.toContain(SECRET);
    expect(JSON.stringify(row.fields)).not.toContain(SECRET);

    // The run-time contract: the executor's single decrypting read hands the
    // test body a live `credentials.<handle>` object.
    const forRun = await queries.getCredentialsForRun(repoId);
    expect(forRun[HANDLE]).toEqual({ username: USERNAME, password: SECRET });
  });

  it("the secret never comes back to the browser", async () => {
    const { page } = s;
    await openCredentialsTab();

    // The list masks secret values outright.
    const listText = await page.evaluate(() => document.body.innerText);
    expect(listText).toContain(LABEL);
    expect(listText).toContain("••••••••");
    expect(listText).not.toContain(SECRET);

    // Neither does the editor: it shows an empty input whose placeholder is
    // the product's word for "we are not going to tell you".
    await page.getByRole("button", { name: `Edit ${LABEL}` }).click();
    const pwRow = page
      .locator("div")
      .filter({ has: page.locator('input[value="password"]') })
      .last();
    const pwValue = pwRow.locator("input").nth(1);
    await pwValue.waitFor({ state: "visible", timeout: 30_000 });
    expect(await pwValue.inputValue()).toBe("");
    expect(await pwValue.getAttribute("placeholder")).toBe(
      "Unchanged — type to replace",
    );

    // And it is nowhere in the delivered HTML either — a masked input over a
    // leaked payload would still be a leak.
    const html = await page.content();
    expect(html).not.toContain(SECRET);
  });

  it("saving an edit with the secret left blank keeps the stored secret", async () => {
    const { page } = s;
    const before = await rowForRepo();

    await page
      .locator("input#cred-description")
      .fill("used by the login setup");
    await page.getByRole("button", { name: /^Update$/ }).click();

    const after = await (async () => {
      const deadline = Date.now() + 60_000;
      for (;;) {
        const r = await rowForRepo();
        if (r?.description === "used by the login setup") return r;
        if (Date.now() > deadline) throw new Error("update never persisted");
        await new Promise((res) => setTimeout(res, 500));
      }
    })();

    // `mergeSecretFields` carries the ciphertext forward untouched — the bug
    // it exists to prevent is an empty box blanking the password.
    const pwBefore = before.fields.find((f) => f.key === "password")!;
    const pwAfter = after.fields.find((f) => f.key === "password")!;
    expect(pwAfter.value).toBe(pwBefore.value);
    const forRun = await queries.getCredentialsForRun(repoId);
    expect(forRun[HANDLE].password).toBe(SECRET);
  });

  it("deleting it through the confirm dialog removes the row", async () => {
    const { page } = s;
    await openCredentialsTab();

    // A native `window.confirm` — Playwright auto-dismisses dialogs, so
    // without this handler the delete silently never happens and the test
    // would fail on the row still being there rather than on the UI.
    page.once("dialog", (d) => {
      expect(d.message()).toMatch(new RegExp(`Delete "${LABEL}"\\?`));
      void d.accept();
    });
    await page.getByRole("button", { name: `Delete ${LABEL}` }).click();

    const deadline = Date.now() + 60_000;
    for (;;) {
      if (!(await rowForRepo())) break;
      if (Date.now() > deadline)
        throw new Error("credential row was not deleted");
      await new Promise((res) => setTimeout(res, 500));
    }
    expect(await queries.getCredentialsForRun(repoId)).toEqual({});
  });

  it("leaves no unexplained client-side errors", async () => {
    expect(s.consoleErrors).toEqual([]);
  });
});
