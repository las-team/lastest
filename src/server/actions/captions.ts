"use server";

import { revalidatePath } from "next/cache";
import * as queries from "@/lib/db/queries";
import { requireRepoAccess } from "@/lib/auth/session";
import { generateAndStoreCaptionsForBuild } from "@/lib/share/generate-captions";

/**
 * Generate AI subtitle captions for a build's primary recording and persist
 * them onto the build's demo-notes payload. The /r/<slug> share page then
 * serves them as the <video> subtitle track (see the captions.vtt route).
 *
 * Auth: the build must belong to the caller's team. We resolve the build →
 * test run → repository to run `requireRepoAccess`, reusing the same boundary
 * every other repo-scoped action uses.
 */
export async function generateShareCaptions(
  buildId: string,
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const build = await queries.getBuild(buildId);
  if (!build?.testRunId) return { ok: false, error: "Build has no run" };

  const testRun = await queries.getTestRun(build.testRunId);
  if (!testRun?.repositoryId)
    return { ok: false, error: "Build has no repository" };

  await requireRepoAccess(testRun.repositoryId);

  const result = await generateAndStoreCaptionsForBuild(buildId);
  if (result.count === 0) {
    return {
      ok: false,
      error: result.reason ?? "No captions generated",
    };
  }

  // Public share reads notes live (revalidate=0), but revalidate the in-app
  // build view so a "Generate captions" button reflects immediately.
  revalidatePath(`/builds/${buildId}`);
  return { ok: true, count: result.count };
}
