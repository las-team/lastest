"use server";

import { revalidatePath } from "next/cache";
import * as queries from "@/lib/db/queries";
import { requireTeamAdmin } from "@/lib/auth";

/**
 * Toggle the regulated (pharma / life-sciences) segment profile for the team.
 *
 * Deliberately does *not* re-apply `REGULATED_CHECK_MODES` to existing
 * projects. Those are per-repo defaults a validation lead may have already
 * tuned, and silently rewriting them from a settings switch would overwrite a
 * deliberate choice — the profile seeds them at project creation instead.
 * Turning the flag off likewise leaves the modes where they are.
 */
export async function toggleRegulatedMode(enabled: boolean) {
  const session = await requireTeamAdmin();
  await queries.updateTeam(session.team.id, { regulatedMode: enabled });
  revalidatePath("/", "layout");
  revalidatePath("/settings");
  return { enabled };
}
