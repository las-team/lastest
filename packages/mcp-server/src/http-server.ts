/**
 * Standalone remote MCP server (Streamable HTTP).
 *
 * `lastest-mcp --transport http` runs the same tool surface as the stdio CLI,
 * but over HTTP, so an agent platform that can only reach a URL — Salesforce
 * Agentforce, ChatGPT, a hosted Claude — can talk to a self-hosted Lastest
 * without anyone installing this package next to it.
 *
 * Relationship to `/api/mcp`
 * --------------------------
 * The Lastest app serves the same protocol at `/api/mcp`, and that is the
 * endpoint to prefer: it is the one that carries OAuth 2.1, so a client can
 * connect without a human pasting a key. This process exists for the case where
 * you want the MCP endpoint on its own host/port — a separate container, a
 * different network zone, an instance you do not want to expose the whole app
 * from. It authenticates with an API key only.
 *
 * Auth
 * ----
 * Every request must carry `Authorization: Bearer <api-key>`. The key is passed
 * straight through to the Lastest REST API, which is the thing that actually
 * authenticates it — this process stores no credentials and makes no trust
 * decisions of its own. `--api-key` supplies a fallback for single-tenant
 * deployments; when a request brings its own key, the request's key wins, so
 * one process can serve several users.
 *
 * State
 * -----
 * Stateless: a fresh server + transport per request, no session ids. That keeps
 * it safe to run behind a load balancer with no sticky sessions, at the cost of
 * not supporting server-initiated notifications between calls (no MCP client we
 * target relies on those here).
 */
import { createServer as createHttpServer, type Server } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { LastestClient } from "./client";
import { createServer } from "./server";
import type { ToolAccessLevel } from "./policy";

export interface HttpServerOptions {
  /** Lastest instance the tools call. */
  url: string;
  /** Fallback API key, used when a request brings no `Authorization` header. */
  apiKey?: string;
  port: number;
  host: string;
  /** Tool surface handed to callers. See ./policy.ts. */
  accessLevel?: ToolAccessLevel;
  /** Path the MCP endpoint is served at. */
  path?: string;
}

const MAX_BODY_BYTES = 4 * 1024 * 1024;

function jsonRpcError(code: number, message: string, detail?: string): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    error: { code, message, ...(detail ? { data: { detail } } : {}) },
    id: null,
  });
}

async function readBody(
  req: import("node:http").IncomingMessage,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    // Bounded so an unauthenticated caller cannot make us buffer arbitrarily.
    if (size > MAX_BODY_BYTES) throw new Error("Request body too large");
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function startHttpServer(options: HttpServerOptions): Server {
  const path = options.path ?? "/mcp";

  const server = createHttpServer(async (req, res) => {
    if (
      req.url &&
      new URL(req.url, "http://localhost").pathname === "/health"
    ) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (!req.url || new URL(req.url, "http://localhost").pathname !== path) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(jsonRpcError(-32601, "Not found"));
      return;
    }

    const header = req.headers.authorization;
    const bearer = header?.toLowerCase().startsWith("bearer ")
      ? header.slice(7).trim()
      : undefined;
    const apiKey = bearer || options.apiKey;
    if (!apiKey) {
      res.writeHead(401, {
        "content-type": "application/json",
        "www-authenticate": 'Bearer realm="lastest"',
      });
      res.end(
        jsonRpcError(
          -32001,
          "Unauthorized",
          "Send Authorization: Bearer <api-key>. Create a key in Settings → Runners & API Access.",
        ),
      );
      return;
    }

    let body: unknown;
    try {
      body = await readBody(req);
    } catch (err) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(
        jsonRpcError(
          -32700,
          "Bad request",
          err instanceof Error ? err.message : String(err),
        ),
      );
      return;
    }

    const mcp = createServer(
      new LastestClient({ baseUrl: options.url, apiKey }),
      { accessLevel: options.accessLevel },
    );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    // The transport owns the response from here; closing the MCP server when
    // the response ends is what releases the per-request pair.
    res.on("close", () => {
      void transport.close();
      void mcp.close();
    });

    try {
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(
          jsonRpcError(
            -32603,
            "Internal error",
            err instanceof Error ? err.message : String(err),
          ),
        );
      }
    }
  });

  server.listen(options.port, options.host);
  return server;
}
