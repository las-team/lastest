import { NextRequest, NextResponse } from "next/server";
import {
  getExplorerSession,
  listExplorerFindings,
} from "@lastest/plugin-explorer/actions";

import { getPluginRuntime } from "@/lib/core/runtime";

export const dynamic = "force-dynamic";

/**
 * Polling endpoint for a live explorer run.
 *
 * Thin on purpose: authorization and tenancy are the plugin actions' —
 * `getExplorerSession` resolves scope through the kernel and returns null for a
 * session belonging to another team, so this route has no team check of its own
 * to get wrong. What used to be `getAgentSession(id)` plus three hand-written
 * guards is now one call that cannot be reached unscoped.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  await getPluginRuntime();
  const { sessionId } = await params;

  const session = await getExplorerSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const findings = await listExplorerFindings(sessionId).catch(() => []);

  // Credentials never leave the server — strip before returning.
  const { password: _password, ...metadata } = session.metadata;
  return NextResponse.json(
    { ...session, metadata, findings },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
  );
}
