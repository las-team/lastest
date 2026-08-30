import { NextRequest, NextResponse } from "next/server";
import { getAgentSession } from "@/lib/db/queries";
import { getCurrentSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Polling endpoint for a live healing campaign — the same envelope as
 * `/api/triage-agent/[sessionId]`, so the Healer home page and the roster
 * narrate progress with the same client code.
 *
 * A healer session drives a browser but is never handed a login of its own
 * (it reuses the repo's seed fixture inside the plugin), so the metadata
 * carries no secret to strip.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const auth = await getCurrentSession();
  if (!auth?.team) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sessionId } = await params;
  const session = await getAgentSession(sessionId);

  if (!session || session.kind !== "healer") {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (session.teamId && session.teamId !== auth.team.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json(session, {
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
  });
}
