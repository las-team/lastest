/**
 * Streamable HTTP MCP endpoint.
 *
 * Lets remote MCP clients (Smithery, Claude Code via `--transport http`,
 * Cursor, Cline, …) talk to this Lastest instance without spawning the
 * `@lastest/mcp-server` stdio process locally.
 *
 * Authentication:
 *   Authorization: Bearer <api-key>
 * where the API key is created in Settings → Runners & API Access.
 *
 * The tool surface is shared with the stdio package by re-using
 * `createServer()` from `@lastest/mcp-server`. The server's tools call our
 * own `/api/v1/*` endpoints over HTTP — slight loopback overhead, but keeps
 * a single source of truth for tool definitions and auth.
 */
import { NextRequest } from 'next/server';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createServer, LastestClient } from '@lastest/mcp-server';
import { verifyBearerToken } from '@/lib/auth/api-key';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handle(req: NextRequest): Promise<Response> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.toLowerCase().startsWith('bearer ')) {
    return unauthorized('Missing Bearer token. Create an API key in Settings → Runners & API Access.');
  }
  const token = authHeader.slice(7).trim();
  const session = await verifyBearerToken(token);
  if (!session) {
    return unauthorized('Invalid or expired API key.');
  }

  // Use this request's own origin so the MCP tools call the same instance
  // they're being served from (works across localhost, self-hosted, cloud).
  const baseUrl = new URL(req.url).origin;
  const client = new LastestClient({ baseUrl, apiKey: token });
  const server = createServer(client);

  // Stateless: fresh transport per request, no session persistence.
  // Serverless-friendly and plays nicely with Smithery's connection model.
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  await server.connect(transport);
  return transport.handleRequest(req as unknown as Request);
}

function unauthorized(detail: string): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Unauthorized', data: { detail } },
      id: null,
    }),
    {
      status: 401,
      headers: {
        'content-type': 'application/json',
        'www-authenticate': 'Bearer realm="lastest"',
      },
    },
  );
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
