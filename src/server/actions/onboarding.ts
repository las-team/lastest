"use server";

import { revalidatePath } from "next/cache";
import * as queries from "@/lib/db/queries";
import { requireAuth, requireTeamAccess } from "@/lib/auth";
import { assertHttpScheme } from "@/lib/security/url-validation";
import type { OnboardingPath } from "@/lib/db/schema";
import { startPlayAgent } from "./play-agent";

export async function setOnboardingPath(path: OnboardingPath) {
  const session = await requireAuth();
  await queries.updateUser(session.user.id, { onboardingPath: path });
  revalidatePath("/onboarding");
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
  await queries.updateRepository(repositoryId, {
    branchBaseUrls: { ...existing, default: url, [branch]: url },
  });
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
