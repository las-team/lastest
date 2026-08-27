/**
 * Remote MCP endpoint (Streamable HTTP).
 *
 * Lets remote MCP clients talk to this Lastest instance without spawning the
 * `@lastest/mcp-server` stdio process locally. Two kinds of caller arrive here:
 *
 *  - **A developer's own agent** (Claude Code `--transport http`, Cursor,
 *    Cline, Smithery) carrying an API key from Settings → Runners & API Access.
 *  - **An agent platform** (Salesforce Agentforce, ChatGPT, Claude web) that
 *    discovered our OAuth 2.1 authorization server from the `WWW-Authenticate`
 *    header below, registered itself, and is carrying an access token.
 *
 * The two are not equally trusted, and the difference is the whole point of
 * `@/lib/mcp/remote-auth` + the tool policy in `@lastest/mcp-server`: an API key
 * sees every tool, an OAuth token sees a read- or write-level subset with no
 * deletes, no share revocation and no public publishing. Tools are filtered at
 * registration, so a restricted caller never sees an action it cannot call.
 *
 * The tool surface itself is shared with the stdio package via `createServer()`.
 * Its tools call our own `/api/v1/*` endpoints over HTTP — slight loopback
 * overhead, but it keeps one implementation of every ownership and capability
 * guard.
 */
import { NextRequest } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createServer, LastestClient } from "@lastest/mcp-server";
import { authenticateMcpRequest, wwwAuthenticate } from "@/lib/mcp/remote-auth";
import { getLogger } from "@/lib/logger";
import { getPublicUrl } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = getLogger("MCP");

async function handle(req: NextRequest): Promise<Response> {
  // Two different origins, deliberately.
  //
  // `loopbackOrigin` is where the MCP tools send their /api/v1 calls: this
  // request's own address, so they hit the very instance being served and skip
  // a pointless round trip back out through the front proxy.
  //
  // `publicOrigin` is what we advertise to the client in WWW-Authenticate. It
  // must be the externally reachable host — `req.url` here is the internal
  // 127.0.0.1:3001 address that scripts/front-proxy.js forwards to.
  const loopbackOrigin = new URL(req.url).origin;
  const publicOrigin = getPublicUrl(req);

  const result = await authenticateMcpRequest(req);
  if (!result.ok) {
    return unauthorized(publicOrigin, result.status, result.detail);
  }
  const { caller } = result;

  log.debug(
    { client: caller.client, accessLevel: caller.accessLevel },
    "MCP request authenticated",
  );

  const client = new LastestClient({
    baseUrl: loopbackOrigin,
    apiKey: caller.loopbackToken,
  });
  const server = createServer(client, { accessLevel: caller.accessLevel });

  // Stateless: fresh transport per request, no session persistence.
  // Serverless-friendly and plays nicely with Smithery's connection model.
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  await server.connect(transport);
  return transport.handleRequest(req as unknown as Request);
}

function unauthorized(
  origin: string,
  status: number,
  detail: string,
): Response {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (status === 401) {
    // RFC 9728. This is how an agent platform finds the authorization server
    // without being told about it out of band — it is the difference between
    // "paste the URL and click connect" and "go generate an API key first".
    headers["www-authenticate"] = wwwAuthenticate(origin, "invalid_token");
  }
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: status === 401 ? -32001 : -32603,
        message: status === 401 ? "Unauthorized" : "Unavailable",
        data: { detail },
      },
      id: null,
    }),
    { status, headers },
  );
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
