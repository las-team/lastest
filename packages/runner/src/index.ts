#!/usr/bin/env node
/**
 * Lastest2 Runner CLI
 * Remote test execution runner for cloud deployment.
 */

import { Command } from 'commander';
import { RunnerClient } from './client.js';

export { RunnerClient } from './client.js';
export { TestRunner } from './runner.js';
export * from './protocol.js';

export async function main() {
  const program = new Command();

  program
    .name('lastest2-runner')
    .description('Remote test execution runner for Lastest2')
    .version('0.1.0')
    .requiredOption('-t, --token <token>', 'Runner authentication token')
    .requiredOption('-s, --server <url>', 'Server URL (e.g., https://your-app.vercel.app)')
    .option('-i, --interval <ms>', 'Poll interval in milliseconds', '5000')
    .action(async (options) => {
      console.log('');
      console.log('  Lastest2 Runner');
      console.log('  ===============');
      console.log('');

      const client = new RunnerClient({
        token: options.token,
        serverUrl: options.server,
        pollInterval: parseInt(options.interval, 10),
      });

      // Handle shutdown
      process.on('SIGINT', async () => {
        console.log('\nShutting down...');
        await client.stop();
        process.exit(0);
      });

      process.on('SIGTERM', async () => {
        console.log('\nShutting down...');
        await client.stop();
        process.exit(0);
      });

      try {
        await client.start();
      } catch (error) {
        console.error('Failed to start runner:', error);
        process.exit(1);
      }
    });

  await program.parseAsync(process.argv);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
