"use server";

import { requireRepoAccess } from "@/lib/auth";
import { resolveRepoIdForBuild } from "@/lib/change-map/compute";
import { classifyBuildDiffs } from "@/lib/rca/run";
import { revalidatePath } from "next/cache";

/**
 * Recompute the RCA "is this diff the test or the code?" verdict for every
 * changed diff in a build. Guarded entry point — verifies the caller can access
 * the build's repo before touching it. The heavy lifting lives in
 * `@/lib/rca/run` (a plain module, not directly RPC-invocable).
 */
export async function recomputeBuildRca(buildId: string): Promise<number> {
  const repoId = await resolveRepoIdForBuild(buildId);
  if (repoId) await requireRepoAccess(repoId);

  const count = await classifyBuildDiffs(buildId);

  revalidatePath(`/builds/${buildId}`);
  revalidatePath(`/verify/${buildId}`);
  return count;
}
