import { NextRequest, NextResponse } from "next/server";
import { getAgentSession } from "@/lib/db/queries";
import { getCurrentSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Polling endpoint for a live triage run.
 *
 * Deliberately the same shape as `/api/qa-agent/[sessionId]`: same auth (a
 * signed-in team), same 404-on-wrong-kind, same 403 on another team's session,
 * and the session row itself as the response envelope — so the Triage home page
 * and the roster narrate progress with the same client code the QA agent uses.
 *
 * No credential stripping here, unlike the QA route: a triage session drives no
 * browser and is never handed a login, so its metadata carries no secret.
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

  if (!session || session.kind !== "triage") {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (session.teamId && session.teamId !== auth.team.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json(session, {
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
  });
}
