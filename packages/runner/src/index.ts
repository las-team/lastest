#!/usr/bin/env node
/**
 * Lastest2 Runner CLI
 * Remote test execution runner for cloud deployment.
 */

import { Command } from 'commander';
import { spawn, execSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { chromium } from 'playwright';
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

// Derive a machine-bound encryption key from hostname + username
function deriveKey(): Buffer {
  const material = `lastest2-runner:${os.hostname()}:${os.userInfo().username}`;
  return crypto.createHash('sha256').update(material).digest();
}

function encryptToken(token: string): { encrypted: string; iv: string } {
  const key = deriveKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf-8'), cipher.final()]);
  return { encrypted: encrypted.toString('base64'), iv: iv.toString('base64') };
}

function decryptToken(encrypted: string, iv: string): string {
  const key = deriveKey();
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, Buffer.from(iv, 'base64'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]);
  return decrypted.toString('utf-8');
}

function saveConfig(token: string, server: string, interval: string, baseUrl?: string) {
  ensureConfigDir();
  const { encrypted, iv } = encryptToken(token);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ token: encrypted, tokenIv: iv, server, interval, baseUrl }, null, 2));
}

function loadConfig(): { token?: string; server?: string; interval?: string; baseUrl?: string } {
  if (!fs.existsSync(CONFIG_FILE)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    // Decrypt token if stored encrypted
    if (raw.token && raw.tokenIv) {
      try {
        raw.token = decryptToken(raw.token, raw.tokenIv);
      } catch {
        // Decryption failed (machine changed, corrupted) — clear token
        delete raw.token;
      }
    }
    return raw;
  } catch {
    return {};
  }
}

async function ensurePlaywrightBrowsers(): Promise<boolean> {
  try {
    const browser = await chromium.launch({ headless: true });
    await browser.close();
    return true;
  } catch {
    console.error('\n  Playwright Chromium browser is not installed.\n');
    console.error('  Run the following command to install it:\n');
    console.error('    npx playwright install chromium\n');
    console.error('  Or install all browsers with:\n');
    console.error('    npx playwright install\n');
    return false;
  }
}

export async function main() {
  const program = new Command();

  program
    .name('lastest2-runner')
    .description('Remote test execution runner for the Lastest2 visual regression testing platform.\n\nConnects to a Lastest2 server via WebSocket, receives test jobs, executes them\nlocally using Playwright, and reports results back. Can run as a background daemon\nor in the foreground.\n\nConfig directory: ~/.lastest2/')
    .version('0.1.0');

  // Start command - runs in background
  program
    .command('start')
    .description('Start the runner as a background daemon.\n\nSpawns a detached background process that connects to the Lastest2 server,\nlistens for test execution jobs, and runs them using a local Playwright browser.\nThe daemon PID is saved to ~/.lastest2/runner.pid and logs are written to\n~/.lastest2/runner.log. Use "lastest2-runner stop" to terminate the daemon.\n\nIf no options are provided, uses the config saved from the last run.')
    .option('-t, --token <token>', 'Runner authentication token (from Settings > Runners in the Lastest2 UI)')
    .option('-s, --server <url>', 'Lastest2 server URL to connect to (e.g., https://your-app.vercel.app)')
    .option('-i, --interval <ms>', 'Poll interval in milliseconds (default: 5000)')
    .option('-b, --base-url <url>', 'Override the target URL for test execution (useful for testing against local or staging environments)')
    .action(async (options) => {
      ensureConfigDir();

      const existingPid = getRunningPid();
      if (existingPid) {
        console.log(`Runner is already running (PID: ${existingPid})`);
        process.exit(1);
      }

      // Merge with saved config — CLI args override saved values
      const saved = loadConfig();
      const token = options.token || saved.token;
      const server = options.server || saved.server;
      const interval = options.interval || saved.interval || '5000';
      const baseUrl = options.baseUrl ?? saved.baseUrl;

      if (!token || !server) {
        console.error('Error: --token and --server are required (no saved config found)');
        console.error('Run with: lastest2-runner start -t <token> -s <server-url>');
        process.exit(1);
      }

      // Save merged config for future runs
      saveConfig(token, server, interval, baseUrl);

      // Start the daemon process
      const logStream = fs.openSync(LOG_FILE, 'a');
      const args = [
        process.argv[1],
        'run',
        '--token', token,
        '--server', server,
        '--interval', interval,
      ];
      if (baseUrl) {
        args.push('--base-url', baseUrl);
      }
      const child = spawn(process.execPath, args, {
        detached: true,
        stdio: ['ignore', logStream, logStream],
      });

      fs.writeFileSync(PID_FILE, String(child.pid));
      child.unref();

      console.log(`Runner started (PID: ${child.pid})`);
      console.log(`Server: ${server}`);
      if (baseUrl) console.log(`Base URL override: ${baseUrl}`);
      console.log(`Logs: ${LOG_FILE}`);
    });

  // Stop command
  program
    .command('stop')
    .description('Stop the running background daemon.\n\nSends SIGTERM to the process identified in ~/.lastest2/runner.pid and removes\nthe PID file. Exits with code 1 if no runner is currently running.')
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
    .description('Show the current runner status.\n\nDisplays whether the daemon is running, its PID, connected server URL,\nbase URL override (if set), and log file path.')
    .action(() => {
      const pid = getRunningPid();
      const config = loadConfig();

      if (pid) {
        console.log('Runner Status: RUNNING');
        console.log(`  PID: ${pid}`);
        if (config.server) console.log(`  Server: ${config.server}`);
        if (config.baseUrl) console.log(`  Base URL override: ${config.baseUrl}`);
        console.log(`  Logs: ${LOG_FILE}`);
      } else {
        console.log('Runner Status: STOPPED');
      }
    });

  // Log command
  program
    .command('log')
    .alias('logs')
    .description('Show runner logs from ~/.lastest2/runner.log.\n\nBy default shows the last 50 lines. Use -f to follow output in real-time\n(like "tail -f"). Use -n to control how many lines are displayed.')
    .option('-f, --follow', 'Follow log output in real-time (Ctrl+C to stop)')
    .option('-n, --lines <number>', 'Number of recent lines to show (default: 50)', '50')
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
    .description('Run the runner in the foreground.\n\nSame as "start" but keeps the process attached to the current terminal.\nUseful for debugging, Docker containers, or CI/CD environments where you\nwant to see output directly. Handles SIGINT and SIGTERM for graceful shutdown.\n\nIf no options are provided, uses the config saved from the last run.')
    .option('-t, --token <token>', 'Runner authentication token (from Settings > Runners in the Lastest2 UI)')
    .option('-s, --server <url>', 'Lastest2 server URL to connect to (e.g., https://your-app.vercel.app)')
    .option('-i, --interval <ms>', 'Poll interval in milliseconds (default: 5000)')
    .option('-b, --base-url <url>', 'Override the target URL for test execution (useful for testing against local or staging environments)')
    .action(async (options) => {
      ensureConfigDir();

      // Merge with saved config — CLI args override saved values
      const saved = loadConfig();
      const token = options.token || saved.token;
      const server = options.server || saved.server;
      const interval = options.interval || saved.interval || '5000';
      const baseUrl = options.baseUrl ?? saved.baseUrl;

      if (!token || !server) {
        console.error('Error: --token and --server are required (no saved config found)');
        console.error('Run with: lastest2-runner run -t <token> -s <server-url>');
        process.exit(1);
      }

      // Save merged config for future runs
      saveConfig(token, server, interval, baseUrl);

      const timestamp = () => new Date().toISOString();
      console.log(`[${timestamp()}] Lastest2 Runner starting...`);
      console.log(`[${timestamp()}] Server: ${server}`);
      if (baseUrl) {
        console.log(`[${timestamp()}] Base URL override: ${baseUrl}`);
      }
      if (!options.token || !options.server) {
        console.log(`[${timestamp()}] Using saved config from ~/.lastest2/runner.config.json`);
      }

      // Verify Playwright Chromium is installed before connecting
      console.log(`[${timestamp()}] Checking Playwright Chromium installation...`);
      const browsersReady = await ensurePlaywrightBrowsers();
      if (!browsersReady) {
        process.exit(1);
      }
      console.log(`[${timestamp()}] Playwright Chromium is ready.`);

      const client = new RunnerClient({
        token,
        serverUrl: server,
        pollInterval: parseInt(interval, 10),
        baseUrl,
      });

      // Handle shutdown — hard exit after 10s if graceful stop hangs
      let stopping = false;
      const shutdown = async (signal: string) => {
        if (stopping) {
          console.log(`[${timestamp()}] Force exit (second ${signal})`);
          process.exit(1);
        }
        stopping = true;
        console.log(`\n[${timestamp()}] ${signal} received, stopping...`);
        const forceTimer = setTimeout(() => {
          console.error(`[${timestamp()}] Graceful shutdown timed out, forcing exit`);
          process.exit(1);
        }, 10000);
        forceTimer.unref(); // Don't keep process alive just for the timer
        try {
          await client.stop();
        } catch (err) {
          console.error(`[${timestamp()}] Error during shutdown:`, err);
        }
        clearTimeout(forceTimer);
        process.exit(0);
      };
      process.on('SIGINT', () => { shutdown('SIGINT'); });
      process.on('SIGTERM', () => { shutdown('SIGTERM'); });

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
