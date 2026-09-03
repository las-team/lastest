/**
 * WebMCP bridge endpoint — the cookie-authed sibling of `/api/mcp`.
 *
 * `/api/mcp` serves remote MCP clients over Streamable HTTP with a Bearer API
 * key. This route serves *our own pages*, which register WebMCP tools via
 * `document.modelContext` and have a better-auth session cookie rather than an
 * API key. It exposes the same tool surface — `createServer()` from
 * `@lastest/mcp-server`, driven over an in-memory MCP transport — as plain JSON
 * (`{op:"list"}` / `{op:"call"}`), so the browser side needs no MCP SDK.
 *
 * Authentication: the caller's session cookie. `LastestClient` gets no API key;
 * it forwards the cookie header to `/api/v1/*`, whose `getCurrentSession()` is
 * cookie-first. Every per-resource guard (`requireTeamAccess`,
 * `requireRepoAccess`, capabilities) therefore applies exactly as it does for
 * the UI — an agent can only reach what the signed-in user can reach.
 *
 * CSRF: a cookie-authed JSON-RPC endpoint is a CSRF target, so this route
 * demands BOTH a same-origin `Origin`/`Sec-Fetch-Site` and the custom
 * `x-lastest-webmcp` header. The custom header alone makes the request
 * non-simple, so a cross-origin page cannot send it without a preflight this
 * route never approves (there is no CORS handler here at all).
 *
 * The narrowing of these 29 tools down to the ~10 an agent actually sees is
 * done client-side in `src/lib/webmcp/registry.ts`; this route is the
 * unnarrowed surface, which is fine because it is exactly the surface the same
 * user already has via `/api/mcp` with their own API key.
 */
import { NextRequest } from "next/server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, LastestClient } from "@lastest/mcp-server";
import { getCurrentSession } from "@/lib/auth";
import { getLogger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = getLogger("WebMCP");

const BRIDGE_HEADER = "x-lastest-webmcp";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Same-origin only. No CORS headers are ever emitted by this route. */
function isSameOrigin(req: NextRequest): boolean {
  if (req.headers.get(BRIDGE_HEADER) !== "1") return false;

  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return false;

  const origin = req.headers.get("origin");
  // Same-origin fetch() always sends Origin for POST. A missing Origin with a
  // browser-set Sec-Fetch-Site of same-origin is still fine (some clients omit
  // it); anything else is not a page of ours.
  if (origin) {
    try {
      // Compare against the host the *browser* addressed, not `req.url`'s.
      // `scripts/front-proxy.js` owns the public port in every deployment and
      // forwards to Next on 127.0.0.1:3001, so `req.url` here is the upstream
      // address and never equals the page's origin — comparing the two 403s
      // every WebMCP tool call everywhere. The proxy sets `x-forwarded-host`
      // (and `src/proxy.ts` already trusts it for the same reason), so that is
      // the value to check; `req.url` remains the fallback for a direct hit.
      const forwardedHost = req.headers.get("x-forwarded-host");
      const forwardedProto =
        req.headers.get("x-forwarded-proto") ??
        new URL(req.url).protocol.replace(":", "");
      const expected = forwardedHost
        ? new URL(`${forwardedProto}://${forwardedHost}`).origin
        : new URL(req.url).origin;
      if (new URL(origin).origin !== expected) return false;
    } catch {
      return false;
    }
  } else if (site !== "same-origin") {
    return false;
  }
  return true;
}

export async function POST(req: NextRequest): Promise<Response> {
  if (!isSameOrigin(req)) {
    return json({ ok: false, error: "Forbidden: cross-origin request." }, 403);
  }

  const session = await getCurrentSession();
  if (!session) {
    return json({ ok: false, error: "Not signed in." }, 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body." }, 400);
  }

  const op = (body as { op?: unknown })?.op;
  if (op !== "list" && op !== "call") {
    return json({ ok: false, error: "Unsupported op." }, 400);
  }

  const cookie = req.headers.get("cookie");
  if (!cookie) {
    // The session resolved from a cookie we now cannot forward — refuse rather
    // than fall through to an unauthenticated loopback call.
    return json({ ok: false, error: "Missing session cookie." }, 401);
  }

  // Loopback is always plain HTTP: Next builds `req.url` as
  // `${x-forwarded-proto}://${hostname}:${port}`, so a request that arrived
  // over TLS (Cloudflare/envoy set `x-forwarded-proto: https`) would otherwise
  // yield `https://127.0.0.1:3001` and the fetch dies with "fetch failed".
  const loopback = new URL(req.url);
  loopback.protocol = "http:";
  const baseUrl = loopback.origin;
  const server = createServer(
    new LastestClient({ baseUrl, extraHeaders: { cookie } }),
  );
  const client = new Client({
    name: "lastest-webmcp-bridge",
    version: "1.0.0",
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  try {
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    if (op === "list") {
      const { tools } = await client.listTools();
      return json({
        ok: true,
        op: "list",
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });
    }

    const name = (body as { name?: unknown }).name;
    if (typeof name !== "string" || !name) {
      return json({ ok: false, error: "Missing tool name." }, 400);
    }
    const args = (body as { arguments?: Record<string, unknown> }).arguments;

    const result = await client.callTool({ name, arguments: args ?? {} });
    return json({
      ok: true,
      op: "call",
      result,
      isError: Boolean((result as { isError?: boolean }).isError),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ err, op }, "WebMCP bridge call failed");
    return json({ ok: false, error: message }, 500);
  } finally {
    await Promise.allSettled([client.close(), server.close()]);
  }
}
