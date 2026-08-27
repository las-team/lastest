import { Command } from "commander";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { LastestClient } from "./client.js";
import { createServer } from "./server.js";
import { startHttpServer } from "./http-server.js";
import type { ToolAccessLevel } from "./policy.js";

// Re-exports so the Next.js HTTP route (and any other consumer) can build
// an MCP server with the same tool surface as the stdio CLI.
export { LastestClient } from "./client.js";
export type { LastestClientConfig, ToolResponse } from "./client.js";
export { createServer } from "./server.js";
export type { CreateServerOptions } from "./server.js";
export { startHttpServer } from "./http-server.js";
export type { HttpServerOptions } from "./http-server.js";
export {
  TOOL_RULES,
  decideTool,
  levelAllows,
  deniedActionMessage,
} from "./policy.js";
export type { ToolAccessLevel, ToolRule, ToolDecision } from "./policy.js";

const ACCESS_LEVELS: ToolAccessLevel[] = ["read", "write", "full"];

interface CliOptions {
  url: string;
  apiKey?: string;
  transport: string;
  port: string;
  host: string;
  accessLevel: string;
}

export async function main() {
  const program = new Command();

  program
    .name("lastest-mcp")
    .description(
      "MCP server for Lastest — lets AI agents run tests, review diffs, and manage baselines",
    )
    .requiredOption(
      "--url <url>",
      "Lastest instance URL (e.g., http://localhost:3000)",
    )
    .option(
      "--api-key <key>",
      "API key for authentication. Required for stdio; in http mode it is the fallback for requests that carry no Authorization header.",
    )
    .option(
      "--transport <transport>",
      "'stdio' (default, for a local agent) or 'http' for a remote Streamable HTTP endpoint",
      "stdio",
    )
    .option("--port <port>", "Port to listen on in http mode", "9700")
    .option("--host <host>", "Host to bind in http mode", "127.0.0.1")
    .option(
      "--access-level <level>",
      "Tool surface to expose: read | write | full",
      "full",
    )
    .action(async (opts: CliOptions) => {
      const accessLevel = opts.accessLevel as ToolAccessLevel;
      if (!ACCESS_LEVELS.includes(accessLevel)) {
        process.stderr.write(
          `Invalid --access-level '${opts.accessLevel}'. Expected one of: ${ACCESS_LEVELS.join(", ")}\n`,
        );
        process.exit(1);
      }

      if (opts.transport !== "stdio" && opts.transport !== "http") {
        process.stderr.write(
          `Invalid --transport '${opts.transport}'. Expected 'stdio' or 'http'.\n`,
        );
        process.exit(1);
      }

      if (opts.transport === "stdio" && !opts.apiKey) {
        process.stderr.write("--api-key is required for stdio transport\n");
        process.exit(1);
      }

      // Verify connectivity (skipped when LASTEST_SKIP_HEALTH_CHECK=1 — used by
      // tooling that introspects the MCP surface without a live backend, e.g.
      // Glama's container check). Only possible when we hold a key up front;
      // in http mode the key usually arrives per request.
      if (process.env.LASTEST_SKIP_HEALTH_CHECK !== "1" && opts.apiKey) {
        const probe = new LastestClient({
          baseUrl: opts.url,
          apiKey: opts.apiKey,
        });
        try {
          await probe.health();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          process.stderr.write(
            `Failed to connect to Lastest at ${opts.url}: ${msg}\n`,
          );
          process.exit(1);
        }
      }

      if (opts.transport === "http") {
        const port = Number(opts.port);
        startHttpServer({
          url: opts.url,
          apiKey: opts.apiKey,
          port,
          host: opts.host,
          accessLevel,
        });
        process.stderr.write(
          `Lastest MCP server listening on http://${opts.host}:${port}/mcp (upstream ${opts.url}, access: ${accessLevel})\n`,
        );
        return;
      }

      const client = new LastestClient({
        baseUrl: opts.url,
        apiKey: opts.apiKey,
      });
      const server = createServer(client, { accessLevel });
      const transport = new StdioServerTransport();
      await server.connect(transport);

      process.stderr.write(`Lastest MCP server connected to ${opts.url}\n`);
    });

  await program.parseAsync(process.argv);
}
