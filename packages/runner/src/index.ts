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

  // Repos command — list available repositories
  program
    .command('repos')
    .description('List repositories available for triggering builds.\n\nFetches the list of repositories accessible to the runner\'s team\nand displays them in a table with ID, name, and test count.')
    .option('-t, --token <token>', 'Runner authentication token')
    .option('-s, --server <url>', 'Lastest2 server URL')
    .action(async (options) => {
      const saved = loadConfig();
      const token = options.token || saved.token;
      const server = options.server || saved.server;

      if (!token || !server) {
        console.error('Error: --token and --server are required (no saved config found)');
        process.exit(1);
      }

      try {
        const res = await fetch(`${server.replace(/\/$/, '')}/api/runners/repos`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          console.error(`Error: ${(body as { error?: string }).error || res.statusText}`);
          process.exit(1);
        }

        const { repos } = await res.json() as { repos: { id: string; name: string; fullName: string; testCount: number }[] };

        if (repos.length === 0) {
          console.log('No repositories found for this team.');
          return;
        }

        // Print table
        const idWidth = Math.max(2, ...repos.map(r => r.id.length));
        const nameWidth = Math.max(4, ...repos.map(r => r.fullName.length));
        console.log(`${'ID'.padEnd(idWidth)}  ${'Name'.padEnd(nameWidth)}  Tests`);
        console.log(`${'─'.repeat(idWidth)}  ${'─'.repeat(nameWidth)}  ${'─'.repeat(5)}`);
        for (const repo of repos) {
          console.log(`${repo.id.padEnd(idWidth)}  ${repo.fullName.padEnd(nameWidth)}  ${repo.testCount}`);
        }
      } catch (error) {
        console.error('Failed to fetch repos:', (error as Error).message);
        process.exit(1);
      }
    });

  // Trigger command — create a build and poll for results
  program
    .command('trigger')
    .description('Trigger a build for a repository and wait for results.\n\nCreates a new build via the Lastest2 server API, polls for progress,\nand prints a summary when complete. Exits 0 on pass/safe_to_merge/review_required,\nexits 1 on failed/blocked.')
    .requiredOption('-r, --repo <id-or-name>', 'Repository ID or full name (e.g. "owner/repo")')
    .option('-t, --token <token>', 'Runner authentication token')
    .option('-s, --server <url>', 'Lastest2 server URL')
    .option('--timeout <ms>', 'Timeout in milliseconds', '300000')
    .option('--branch <branch>', 'Git branch (defaults to $GITHUB_HEAD_REF || $GITHUB_REF_NAME)')
    .option('--commit <sha>', 'Git commit SHA (defaults to $GITHUB_SHA)')
    .option('--target-url <url>', 'Override base URL for test execution')
    .option('--fail-on-changes', 'Exit 1 when visual changes are detected (review_required status)')
    .action(async (options) => {
      const saved = loadConfig();
      const token = options.token || saved.token;
      const server = (options.server || saved.server || '').replace(/\/$/, '');

      if (!token || !server) {
        console.error('Error: --token and --server are required (no saved config found)');
        process.exit(1);
      }

      const timeout = parseInt(options.timeout, 10);
      const failOnChanges = !!options.failOnChanges;
      const repo: string = options.repo;
      const isName = repo.includes('/');
      const gitBranch = options.branch || process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME;
      const gitCommit = options.commit || process.env.GITHUB_SHA;
      const targetUrl = options.targetUrl;

      // 1. Create build
      console.log(`Creating build for ${repo}...`);
      let buildId = '';
      let testCount: number;
      try {
        const createBody: Record<string, string> = isName ? { githubRepo: repo } : { repositoryId: repo };
        createBody.triggerType = 'ci';
        if (gitBranch) createBody.gitBranch = gitBranch;
        if (gitCommit) createBody.gitCommit = gitCommit;
        if (targetUrl) createBody.targetUrl = targetUrl;

        const res = await fetch(`${server}/api/builds/create`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(createBody),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          console.error(`Error creating build: ${(body as { error?: string }).error || res.statusText}`);
          process.exit(1);
        }

        const data = await res.json() as { buildId: string | null; testCount: number; queued?: boolean; jobId?: string };
        testCount = data.testCount;

        if (data.queued && !data.buildId) {
          // Build was queued — poll until it starts
          console.log(`Build queued (${testCount} tests), waiting for active build to finish...`);
          const queueStart = Date.now();
          while (Date.now() - queueStart < timeout) {
            await new Promise(resolve => setTimeout(resolve, 5000));
            try {
              const retryRes = await fetch(`${server}/api/builds/create`, {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${token}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify(createBody),
              });
              if (!retryRes.ok) continue;
              const retryData = await retryRes.json() as { buildId: string | null; testCount: number; queued?: boolean };
              if (retryData.buildId) {
                buildId = retryData.buildId;
                testCount = retryData.testCount;
                break;
              }
              console.log('  Still queued, retrying...');
            } catch {
              // retry
            }
          }
          if (!buildId) {
            console.error('Timeout: queued build never started');
            process.exit(1);
            return;
          }
        } else {
          buildId = data.buildId!;
        }
      } catch (error) {
        console.error('Failed to create build:', (error as Error).message);
        process.exit(1);
        return; // unreachable but helps TS
      }

      console.log(`Build ${buildId} created (${testCount} tests)`);

      // 2. Poll for status
      const startTime = Date.now();
      let lastCompleted = 0;

      while (Date.now() - startTime < timeout) {
        await new Promise(resolve => setTimeout(resolve, 3000));

        try {
          const res = await fetch(`${server}/api/builds/${buildId}/status`, {
            headers: { Authorization: `Bearer ${token}` },
          });

          if (!res.ok) {
            console.error(`Poll error: ${res.statusText}`);
            continue;
          }

          interface DiffEntry {
            id: string;
            testId: string;
            testName: string | null;
            stepLabel: string | null;
            classification: string | null;
            status: string;
            percentageDifference: string | null;
            testResultStatus: string | null;
            errorMessage: string | null;
            functionalAreaName: string | null;
          }

          const status = await res.json() as {
            id: string;
            overallStatus: string;
            totalTests: number;
            passedCount: number;
            failedCount: number;
            changesDetected: number;
            flakyCount: number;
            completedAt: string | null;
            elapsedMs: number | null;
            diffs: DiffEntry[];
          };

          const completed = status.passedCount + status.failedCount + status.changesDetected + status.flakyCount;
          if (completed > lastCompleted) {
            console.log(`  Progress: ${completed}/${status.totalTests} tests complete`);
            lastCompleted = completed;
          }

          // Build is done only when completedAt is set (overallStatus alone is unreliable —
          // initial status is 'review_required' before execution even starts)
          if (status.completedAt) {
            const elapsed = status.elapsedMs ? `${(status.elapsedMs / 1000).toFixed(1)}s` : `${((Date.now() - startTime) / 1000).toFixed(1)}s`;

            // Per-test diff results
            if (status.diffs && status.diffs.length > 0) {
              console.log('');
              const nameWidth = Math.max(4, ...status.diffs.map(d => (d.testName || 'Unknown').length + (d.stepLabel ? d.stepLabel.length + 3 : 0)));
              console.log(`${'Test'.padEnd(nameWidth)}  Result       Diff`);
              console.log(`${'─'.repeat(nameWidth)}  ${'─'.repeat(11)}  ${'─'.repeat(8)}`);

              for (const diff of status.diffs) {
                const name = diff.testName || 'Unknown';
                const label = diff.stepLabel ? `${name} > ${diff.stepLabel}` : name;
                const cls = diff.testResultStatus === 'failed'
                  ? 'FAILED'
                  : diff.classification === 'changed'
                    ? 'CHANGED'
                    : diff.classification === 'flaky'
                      ? 'FLAKY'
                      : 'PASS';
                const pct = diff.percentageDifference ? `${parseFloat(diff.percentageDifference).toFixed(2)}%` : '—';
                console.log(`${label.padEnd(nameWidth)}  ${cls.padEnd(11)}  ${pct}`);
                if (diff.errorMessage) {
                  console.log(`${''.padEnd(nameWidth)}  └ ${diff.errorMessage}`);
                }
              }
            }

            console.log('');
            console.log(`Build ${status.overallStatus.toUpperCase()} (${elapsed})`);
            console.log(`  Passed: ${status.passedCount}`);
            if (status.failedCount > 0) console.log(`  Failed: ${status.failedCount}`);
            if (status.changesDetected > 0) console.log(`  Changes: ${status.changesDetected}`);
            if (status.flakyCount > 0) console.log(`  Flaky: ${status.flakyCount}`);

            const buildUrl = `${server}/builds/${buildId}`;
            console.log(`  URL: ${buildUrl}`);

            // Write GitHub Actions outputs
            const ghOutput = process.env.GITHUB_OUTPUT;
            if (ghOutput) {
              const lines = [
                `status=${status.overallStatus}`,
                `build-url=${buildUrl}`,
                `changed-count=${status.changesDetected}`,
                `passed-count=${status.passedCount}`,
                `failed-count=${status.failedCount}`,
                `total-tests=${status.totalTests}`,
              ];
              fs.appendFileSync(ghOutput, lines.join('\n') + '\n');
            }

            // Write GitHub Actions step summary
            const ghSummary = process.env.GITHUB_STEP_SUMMARY;
            if (ghSummary) {
              const emoji = status.overallStatus === 'passed' || status.overallStatus === 'safe_to_merge'
                ? '✅' : status.overallStatus === 'review_required' ? '⚠️' : '❌';
              const md = [
                `## ${emoji} Visual Regression Results`,
                '',
                '| Metric | Value |',
                '|--------|-------|',
                `| Status | **${status.overallStatus}** |`,
                `| Passed | ${status.passedCount} |`,
                `| Failed | ${status.failedCount} |`,
                `| Changes | ${status.changesDetected} |`,
                `| Flaky | ${status.flakyCount} |`,
                `| Total | ${status.totalTests} |`,
                `| Duration | ${elapsed} |`,
                '',
                `[View Results](${buildUrl})`,
                '',
              ];
              fs.appendFileSync(ghSummary, md.join('\n'));
            }

            // Determine exit code
            const failStatuses = ['failed', 'blocked'];
            if (failStatuses.includes(status.overallStatus)) {
              process.exit(1);
            }
            if (status.overallStatus === 'review_required' && failOnChanges) {
              console.log('\nVisual changes detected and --fail-on-changes is enabled');
              process.exit(1);
            }
            process.exit(0);
          }
        } catch (error) {
          console.error(`Poll error: ${(error as Error).message}`);
        }
      }

      console.error(`Timeout: build did not complete within ${timeout / 1000}s`);
      process.exit(1);
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
