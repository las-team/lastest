/**
 * Front door for the MCP authorization endpoint.
 *
 * This is what `/.well-known/oauth-authorization-server` advertises as the
 * `authorization_endpoint`, rather than better-auth's `/api/auth/mcp/authorize`
 * directly, for one reason: **consent must not be optional.**
 *
 * The plugin only shows the consent screen when the client asks for it with
 * `prompt=consent`, and plenty of MCP clients don't. Combined with anonymous
 * dynamic client registration, that would mean an app that registered itself
 * seconds ago could get a token the moment a signed-in user follows a link,
 * with nothing shown to them. So this route pins `prompt=consent` on the way
 * through, and every other parameter is passed along untouched.
 *
 * It intentionally validates nothing else — `client_id`, `redirect_uri`, PKCE
 * and scope checking all belong to the authorization endpoint proper, and
 * duplicating them here would just create two places to get them wrong.
 */
import { NextRequest, NextResponse } from "next/server";
import { getPublicUrl } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const params = new URLSearchParams(req.nextUrl.searchParams);

  const prompt = params.get("prompt");
  const values = new Set((prompt ?? "").split(/\s+/).filter(Boolean));
  values.add("consent");
  params.set("prompt", Array.from(values).join(" "));

  // Relative to the public origin so the browser stays on the host it started
  // on — a redirect to the internal 127.0.0.1:3001 address would dead-end.
  return NextResponse.redirect(
    new URL(`/api/auth/mcp/authorize?${params.toString()}`, getPublicUrl(req)),
  );
}
