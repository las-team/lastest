import { Command } from 'commander';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { LastestClient } from './client.js';
import { createServer } from './server.js';

export async function main() {
  const program = new Command();

  program
    .name('lastest2-mcp')
    .description('MCP server for Lastest2 — lets AI agents run tests, review diffs, and manage baselines')
    .requiredOption('--url <url>', 'Lastest2 instance URL (e.g., http://localhost:3000)')
    .requiredOption('--api-key <key>', 'API key for authentication')
    .action(async (opts: { url: string; apiKey: string }) => {
      const client = new LastestClient({
        baseUrl: opts.url,
        apiKey: opts.apiKey,
      });

      // Verify connectivity
      try {
        await client.health();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`Failed to connect to Lastest2 at ${opts.url}: ${msg}\n`);
        process.exit(1);
      }

      const server = createServer(client);
      const transport = new StdioServerTransport();
      await server.connect(transport);

      process.stderr.write(`Lastest2 MCP server connected to ${opts.url}\n`);
    });

  await program.parseAsync(process.argv);
}
