"use server";

import { revalidatePath } from "next/cache";

import { rcaPlugin } from "./index";
import { classifyBuildDiffs } from "./run";
import { rcaWiring } from "./wiring";

/**
 * Recompute the RCA "is this diff the test or the code?" verdict for every
 * changed diff in a build.
 *
 * The guard is the interesting part. The pre-plugin version resolved the
 * build's repo and then called `requireRepoAccess` itself; here it resolves
 * the repo and hands it to `contextFor()`, and the kernel's `resolveScope`
 * runs the same check. The plugin never decides who the caller is — it names
 * the repository it wants to act on and is either given a scope or thrown at.
 *
 * A build whose repo cannot be resolved gets the context request with no
 * `repositoryId`, which falls through to `requireTeamAccess()`. That is
 * deliberately still a check: an unauthenticated caller cannot reach the
 * classifier by passing a buildId that resolves to nothing.
 */
export async function recomputeBuildRca(buildId: string): Promise<number> {
  const { runtime, host } = rcaWiring();

  const repositoryId = (await host.resolveRepoIdForBuild(buildId)) ?? undefined;
  await runtime.contextFor(rcaPlugin, { repositoryId });

  const count = await classifyBuildDiffs(host, buildId);

  revalidatePath(`/builds/${buildId}`);
  revalidatePath(`/verify/${buildId}`);
  return count;
}
