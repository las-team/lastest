#!/usr/bin/env node
/**
 * Lastest2 Runner CLI
 * Remote test execution runner for cloud deployment.
 */

import { Command } from 'commander';
import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { RunnerClient } from './client.js';

export { RunnerClient } from './client.js';
export { TestRunner } from './runner.js';
export * from './protocol.js';

const CONFIG_DIR = path.join(os.homedir(), '.lastest2');
const PID_FILE = path.join(CONFIG_DIR, 'runner.pid');
const LOG_FILE = path.join(CONFIG_DIR, 'runner.log');
const CONFIG_FILE = path.join(CONFIG_DIR, 'runner.config.json');

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getRunningPid(): number | null {
  if (!fs.existsSync(PID_FILE)) return null;
  const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim(), 10);
  if (isNaN(pid) || !isRunning(pid)) {
    fs.unlinkSync(PID_FILE);
    return null;
  }
  return pid;
}

function saveConfig(token: string, server: string, interval: string) {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ token, server, interval }, null, 2));
}

function loadConfig(): { token?: string; server?: string; interval?: string } {
  if (!fs.existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

export async function main() {
  const program = new Command();

  program
    .name('lastest2-runner')
    .description('Remote test execution runner for Lastest2')
    .version('0.1.0');

  // Start command - runs in background
  program
    .command('start')
    .description('Start the runner as a background daemon')
    .requiredOption('-t, --token <token>', 'Runner authentication token')
    .requiredOption('-s, --server <url>', 'Server URL (e.g., https://your-app.vercel.app)')
    .option('-i, --interval <ms>', 'Poll interval in milliseconds', '5000')
    .action(async (options) => {
      ensureConfigDir();

      const existingPid = getRunningPid();
      if (existingPid) {
        console.log(`Runner is already running (PID: ${existingPid})`);
        process.exit(1);
      }

      // Save config for status command
      saveConfig(options.token, options.server, options.interval);

      // Start the daemon process
      const logStream = fs.openSync(LOG_FILE, 'a');
      const child = spawn(process.execPath, [
        process.argv[1],
        'run',
        '--token', options.token,
        '--server', options.server,
        '--interval', options.interval,
      ], {
        detached: true,
        stdio: ['ignore', logStream, logStream],
      });

      fs.writeFileSync(PID_FILE, String(child.pid));
      child.unref();

      console.log(`Runner started (PID: ${child.pid})`);
      console.log(`Server: ${options.server}`);
      console.log(`Logs: ${LOG_FILE}`);
    });

  // Stop command
  program
    .command('stop')
    .description('Stop the running daemon')
    .action(() => {
      const pid = getRunningPid();
      if (!pid) {
        console.log('Runner is not running');
        process.exit(1);
      }

      try {
        process.kill(pid, 'SIGTERM');
        fs.unlinkSync(PID_FILE);
        console.log(`Runner stopped (PID: ${pid})`);
      } catch (error) {
        console.error('Failed to stop runner:', error);
        process.exit(1);
      }
    });

  // Status command
  program
    .command('status')
    .description('Show runner status')
    .action(() => {
      const pid = getRunningPid();
      const config = loadConfig();

      if (pid) {
        console.log('Runner Status: RUNNING');
        console.log(`  PID: ${pid}`);
        if (config.server) console.log(`  Server: ${config.server}`);
        console.log(`  Logs: ${LOG_FILE}`);
      } else {
        console.log('Runner Status: STOPPED');
      }
    });

  // Log command
  program
    .command('log')
    .alias('logs')
    .description('Show runner logs')
    .option('-f, --follow', 'Follow log output')
    .option('-n, --lines <number>', 'Number of lines to show', '50')
    .action((options) => {
      if (!fs.existsSync(LOG_FILE)) {
        console.log('No logs found');
        process.exit(0);
      }

      if (options.follow) {
        // Use tail -f for following
        const tail = spawn('tail', ['-f', LOG_FILE], { stdio: 'inherit' });
        process.on('SIGINT', () => {
          tail.kill();
          process.exit(0);
        });
      } else {
        // Show last N lines
        try {
          const output = execSync(`tail -n ${options.lines} "${LOG_FILE}"`, { encoding: 'utf-8' });
          console.log(output);
        } catch {
          // If tail fails, read the whole file
          const content = fs.readFileSync(LOG_FILE, 'utf-8');
          const lines = content.split('\n').slice(-parseInt(options.lines, 10));
          console.log(lines.join('\n'));
        }
      }
    });

  // Run command - runs in foreground (used by start, or for direct execution)
  program
    .command('run')
    .description('Run the runner in foreground')
    .requiredOption('-t, --token <token>', 'Runner authentication token')
    .requiredOption('-s, --server <url>', 'Server URL (e.g., https://your-app.vercel.app)')
    .option('-i, --interval <ms>', 'Poll interval in milliseconds', '5000')
    .action(async (options) => {
      const timestamp = () => new Date().toISOString();
      console.log(`[${timestamp()}] Lastest2 Runner starting...`);
      console.log(`[${timestamp()}] Server: ${options.server}`);

      const client = new RunnerClient({
        token: options.token,
        serverUrl: options.server,
        pollInterval: parseInt(options.interval, 10),
      });

      // Handle shutdown
      process.on('SIGINT', async () => {
        console.log(`\n[${timestamp()}] Shutting down...`);
        await client.stop();
        process.exit(0);
      });

      process.on('SIGTERM', async () => {
        console.log(`\n[${timestamp()}] Shutting down...`);
        await client.stop();
        process.exit(0);
      });

      try {
        await client.start();
      } catch (error) {
        console.error(`[${timestamp()}] Failed to start runner:`, error);
        process.exit(1);
      }
    });

  await program.parseAsync(process.argv);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
