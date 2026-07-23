import { NextRequest, NextResponse } from "next/server";
import { getAgentSession, listFindingsBySession } from "@/lib/db/queries";
import { getCurrentSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

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

  if (!session || session.kind !== "explorer") {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (session.teamId && session.teamId !== auth.team.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const findings = await listFindingsBySession(sessionId).catch(() => []);

  // Credentials never leave the server — strip before returning.
  const { quickstartPassword: _pw, ...metadata } = session.metadata;
  return NextResponse.json(
    { ...session, metadata, findings },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    },
  );
}
