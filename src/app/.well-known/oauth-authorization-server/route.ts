/**
 * RFC 8414 authorization-server metadata, at the path clients actually probe.
 *
 * The `mcp` plugin also serves this under `/api/auth/.well-known/…`, but the
 * issuer this deployment advertises is the site origin, and RFC 8414 says a
 * client derives the metadata URL from the issuer. So it has to live here.
 */
import { NextRequest } from "next/server";
import {
  authorizationServerMetadata,
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
  return discoveryResponse(authorizationServerMetadata(getPublicUrl(req)));
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: DISCOVERY_HEADERS });
}
