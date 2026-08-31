"use server";

import { revalidatePath } from "next/cache";
import * as queries from "@/lib/db/queries";
import { requireAuth, requireTeamAccess } from "@/lib/auth";
import { requireCapability } from "@/lib/auth/capabilities";
import { assertHttpScheme } from "@/lib/security/url-validation";
import type { OnboardingPath } from "@/lib/db/schema";
import { startPlayAgent } from "./play-agent";
import { repointSeededSampleToSmoke } from "@/lib/demo/sandbox-seeds";
import { seedPharmaSuite } from "@/lib/demo/pharma-seed";
import { createLocalRepo } from "./repos";

export async function setOnboardingPath(path: OnboardingPath) {
  const session = await requireAuth();
  await queries.updateUser(session.user.id, { onboardingPath: path });
  revalidatePath("/onboarding");
}

/**
 * The pharma fork of onboarding.
 *
 * Turns on the regulated segment profile for the team, creates a project, and
 * seeds the Vault + Salesforce release-regression suites so the user lands on
 * the two tests they came for rather than on an empty repo.
 *
 * No base URL is passed to `createLocalRepo` on purpose: a base URL there
 * would trip the generic smoke-test seed, and each seeded test carries its own
 * sandbox `targetUrl` for the user to re-point. Their real sandbox URL is
 * something only they can supply, and guessing it would produce a test that
 * runs against nothing.
 */
export async function startPharmaOnboarding(projectName?: string) {
  const session = await requireCapability("repos:manage");
  const previousPath = session.user.onboardingPath ?? null;

  // Flip the team into the regulated profile *before* creating the repo, so a
  // failure between the two leaves a restricted team with no project rather
  // than an unrestricted team holding a Vault suite.
  await queries.updateTeam(session.team.id, { regulatedMode: true });
  await queries.updateUser(session.user.id, { onboardingPath: "manual" });

  let repo: Awaited<ReturnType<typeof createLocalRepo>>;
  let seededTestId: string | null;
  try {
    repo = await createLocalRepo(projectName?.trim() || "Vault + Salesforce");
    seededTestId = await seedPharmaSuite(repo.id);
  } catch (err) {
    // Compensation. `regulatedMode` deliberately stays ON — the ordering above
    // exists so a half-finished fork never leaves an unrestricted team holding
    // a Vault suite, and the settings toggle is the way back out of it. What
    // must roll back is `onboardingPath`: rewritten to "manual" it drops the
    // user outside the fork with no route back into it, having never reached
    // the project the fork exists to create.
    await queries
      .updateUser(session.user.id, { onboardingPath: previousPath })
      .catch(() => {});
    revalidatePath("/onboarding");
    throw err;
  }

  revalidatePath("/");
  revalidatePath("/tests");
  revalidatePath("/settings");
  revalidatePath("/onboarding");

  return { repositoryId: repo.id, seededTestId };
}

export async function setBaseUrl(repositoryId: string, url: string) {
  const session = await requireTeamAccess();
  const repo = await queries.getRepository(repositoryId);
  if (!repo || repo.teamId !== session.team.id) {
    throw new Error("Forbidden");
  }
  // baseUrl flows into `page.goto(baseUrl + path)` and into rendered links
  // on the run page; persisting `javascript:` / `data:` would turn that
  // into an XSS sink. Scheme is checked here; network-reachability is not
  // (devs legitimately set `http://localhost:3000`).
  const schemeErr = assertHttpScheme(url);
  if (schemeErr) throw new Error(`baseUrl rejected: ${schemeErr}`);
  const branch = repo.defaultBranch || "main";
  const existing = (repo.branchBaseUrls ?? {}) as Record<string, string>;
  // Write only the branch key. (We used to also write a repo-wide "default"
  // key, but the per-branch UI never updated it, so it went stale — removed.)
  await queries.updateRepository(repositoryId, {
    branchBaseUrls: { ...existing, [branch]: url },
  });
  // If the only test is an untouched auto-seeded sample (e.g. the herokuapp
  // demo), re-point it at the URL the user just entered so their first test
  // targets their own app instead of a third-party playground that fails.
  try {
    await repointSeededSampleToSmoke(repositoryId, url);
  } catch (err) {
    console.warn("[onboarding] Failed to re-point seeded sample:", err);
  }
  revalidatePath("/onboarding");
  revalidatePath("/settings");
}

export async function completeOnboarding() {
  const session = await requireAuth();
  await queries.updateUser(session.user.id, {
    onboardingCompletedAt: new Date(),
  });
  revalidatePath("/");
  revalidatePath("/onboarding");
}

export async function resetOnboarding() {
  const session = await requireAuth();
  await queries.updateUser(session.user.id, {
    onboardingCompletedAt: null,
    onboardingPath: null,
  });
  revalidatePath("/");
  revalidatePath("/settings");
  revalidatePath("/onboarding");
}

export async function kickoffPlayAgent(repositoryId: string) {
  // requireRepoAccess is enforced inside startPlayAgent.
  return startPlayAgent(repositoryId);
}
