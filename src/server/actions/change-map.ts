"use server";

import * as queries from "@/lib/db/queries";
import { requireRepoAccess } from "@/lib/auth";
import {
  computeChangeMap,
  resolveRepoIdForBuild,
} from "@/lib/change-map/compute";
import { revalidatePath } from "next/cache";

// The change-map computation engine lives in `@/lib/change-map/compute` (a plain
// module, NOT a server action) so it is not directly RPC-invocable. Only the
// guarded entry point below is exposed to clients.

/**
 * Set the manually-scoped areas for a build (developer's "Focus on…" pin).
 * Triggers a change-map recomputation so the panel updates without a re-run.
 */
export async function setBuildManualScope(
  buildId: string,
  areaIds: string[],
): Promise<void> {
  // Auth: verify the user can access the repo this build belongs to.
  const repoId = await resolveRepoIdForBuild(buildId);
  if (repoId) await requireRepoAccess(repoId);

  await queries.updateBuild(buildId, { manuallyScopedAreaIds: areaIds });

  // Recompute the change map so the manual scope is reflected immediately.
  await computeChangeMap(buildId);
  revalidatePath(`/verify/${buildId}`);
}
