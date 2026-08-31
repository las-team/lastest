/**
 * RFC 9728 protected-resource metadata, at the path-suffixed spelling.
 *
 * RFC 9728 §3.1 says a client inserts `/.well-known/oauth-protected-resource`
 * between the resource's host and its path, so a resource at `/api/mcp` is
 * described at `/.well-known/oauth-protected-resource/api/mcp`. Several clients
 * instead probe the bare well-known path, which `../../route.ts` serves with
 * the same body.
 */
import { NextRequest } from "next/server";
import {
  protectedResourceMetadata,
  discoveryResponse,
  DISCOVERY_HEADERS,
} from "@/lib/mcp/discovery";
import { getPublicUrl } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  // The public origin, not `req.url`: every deployment sits behind
  // scripts/front-proxy.js, so `req.url` is the internal 127.0.0.1:3001
  // address. Advertising that as the issuer would point every client at
  // an unreachable host.
  return discoveryResponse(protectedResourceMetadata(getPublicUrl(req)));
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: DISCOVERY_HEADERS });
}
