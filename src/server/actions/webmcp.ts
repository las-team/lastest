"use server";

import { revalidatePath } from "next/cache";
import * as queries from "@/lib/db/queries";
import { requireTeamAdmin } from "@/lib/auth";

/**
 * Team-level switch for the WebMCP tool surface. Admin-only: it decides whether
 * a browser AI agent may act with any team member's permissions, which is a
 * tenant-wide security decision rather than a personal preference.
 */
export async function toggleWebMcp(enabled: boolean) {
  const session = await requireTeamAdmin();
  await queries.updateTeam(session.team.id, { webMcpEnabled: enabled });
  revalidatePath("/settings");
  revalidatePath("/", "layout");
  return { enabled };
}
