/**
 * RFC 9728 protected-resource metadata for `/api/mcp`.
 *
 * This is the document the `WWW-Authenticate` header on a 401 from `/api/mcp`
 * points at. `./api/mcp/route.ts` serves the same body at the path-suffixed
 * URL that clients derive from the resource's own path — both spellings are in
 * the wild, so we answer both.
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
