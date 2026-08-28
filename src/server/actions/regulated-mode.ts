"use server";

import { revalidatePath } from "next/cache";
import * as queries from "@/lib/db/queries";
import { requireTeamAdmin } from "@/lib/auth";
import { revokeTeamPublicShares } from "@/lib/core/share-reads";

/**
 * Toggle the regulated (pharma / life-sciences) segment profile for the team.
 *
 * Turning it ON also revokes every live public share the team holds — see the
 * comment on that branch for why refusing to mint new ones is not enough.
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

  // Refusing to mint new share links is not the control on its own: every
  // `/r/<slug>` minted before the switch keeps serving run screenshots to
  // anyone holding the URL, which is exactly the exposure this profile exists
  // to close. Revoke them, so the toast ("public share links are now refused")
  // is true of the links that already exist and not only of future ones. The
  // public page refuses independently on the owner's flags — see
  // `plugins/share/src/ui/page.tsx` — so a failure here is not the only guard.
  //
  // Turning the profile OFF does not un-revoke: a revoked link is a decision,
  // and silently reanimating public URLs is never the safe direction.
  let revokedShares = 0;
  if (enabled) {
    revokedShares = await revokeTeamPublicShares(session.team.id);
  }

  revalidatePath("/", "layout");
  revalidatePath("/settings");
  revalidatePath("/r", "layout");
  return { enabled, revokedShares };
}
