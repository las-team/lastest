#!/usr/bin/env node
/**
 * Lastest Runner CLI
 * CI-side client: triggers builds on a Lastest server and reports results.
 * Execution happens server-side (embedded browser) — this CLI has no browser dependency.
 */

import { Command } from "commander";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import os from "os";

const CONFIG_DIR = path.join(os.homedir(), ".lastest");
const CONFIG_FILE = path.join(CONFIG_DIR, "runner.config.json");

// Derive a machine-bound decryption key from hostname + username (for legacy config files)
function deriveKey(): Buffer {
  const material = `lastest-runner:${os.hostname()}:${os.userInfo().username}`;
  return crypto.createHash("sha256").update(material).digest();
}

function decryptToken(encrypted: string, iv: string): string {
  const key = deriveKey();
  const decipher = crypto.createDecipheriv(
    "aes-256-cbc",
    key,
    Buffer.from(iv, "base64"),
  );
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf-8");
}

function loadConfig(): {
  token?: string;
  server?: string;
} {
  if (!fs.existsSync(CONFIG_FILE)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
    // Decrypt token if stored encrypted (legacy config from older runner daemon)
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

export async function main() {
  const program = new Command();

  program
    .name("lastest-runner")
    .description(
      "CI client for the Lastest visual regression testing platform.\n\nTriggers a build via the Lastest server API and polls for results — test\nexecution happens server-side, so no local browser is required.",
    )
    .version("0.1.0");

  // Repos command — list available repositories
  program
    .command("repos")
    .description(
      "List repositories available for triggering builds.\n\nFetches the list of repositories accessible to the runner's team\nand displays them in a table with ID, name, and test count.",
    )
    .option("-t, --token <token>", "Runner authentication token")
    .option("-s, --server <url>", "Lastest server URL")
    .action(async (options) => {
      const saved = loadConfig();
      const token = options.token || saved.token;
      const server = options.server || saved.server;

      if (!token || !server) {
        console.error(
          "Error: --token and --server are required (no saved config found)",
        );
        process.exit(1);
      }

      try {
        const res = await fetch(
          `${server.replace(/\/$/, "")}/api/runners/repos`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          console.error(
            `Error: ${(body as { error?: string }).error || res.statusText}`,
          );
          process.exit(1);
        }

        const { repos } = (await res.json()) as {
          repos: {
            id: string;
            name: string;
            fullName: string;
            testCount: number;
          }[];
        };

        if (repos.length === 0) {
          console.log("No repositories found for this team.");
          return;
        }

        // Print table
        const idWidth = Math.max(2, ...repos.map((r) => r.id.length));
        const nameWidth = Math.max(4, ...repos.map((r) => r.fullName.length));
        console.log(
          `${"ID".padEnd(idWidth)}  ${"Name".padEnd(nameWidth)}  Tests`,
        );
        console.log(
          `${"─".repeat(idWidth)}  ${"─".repeat(nameWidth)}  ${"─".repeat(5)}`,
        );
        for (const repo of repos) {
          console.log(
            `${repo.id.padEnd(idWidth)}  ${repo.fullName.padEnd(nameWidth)}  ${repo.testCount}`,
          );
        }
      } catch (error) {
        console.error("Failed to fetch repos:", (error as Error).message);
        process.exit(1);
      }
    });

  // Trigger command — create a build and poll for results
  program
    .command("trigger")
    .description(
      "Trigger a build for a repository and wait for results.\n\nCreates a new build via the Lastest server API, polls for progress,\nand prints a summary when complete. Exits 0 on pass/safe_to_merge/review_required,\nexits 1 on failed/blocked.",
    )
    .requiredOption(
      "-r, --repo <id-or-name>",
      'Repository ID or full name (e.g. "owner/repo")',
    )
    .option("-t, --token <token>", "Runner authentication token")
    .option("-s, --server <url>", "Lastest server URL")
    .option("--timeout <ms>", "Timeout in milliseconds", "300000")
    .option(
      "--branch <branch>",
      "Git branch (defaults to $GITHUB_HEAD_REF || $GITHUB_REF_NAME)",
    )
    .option("--commit <sha>", "Git commit SHA (defaults to $GITHUB_SHA)")
    .option("--target-url <url>", "Override base URL for test execution")
    .option(
      "--fail-on-changes",
      "Exit 1 when visual changes are detected (review_required status)",
    )
    .action(async (options) => {
      const saved = loadConfig();
      const token = options.token || saved.token;
      const server = (options.server || saved.server || "").replace(/\/$/, "");

      if (!token || !server) {
        console.error(
          "Error: --token and --server are required (no saved config found)",
        );
        process.exit(1);
      }

      const timeout = parseInt(options.timeout, 10);
      const failOnChanges = !!options.failOnChanges;
      const repo: string = options.repo;
      const isName = repo.includes("/");
      const gitBranch =
        options.branch ||
        process.env.GITHUB_HEAD_REF ||
        process.env.GITHUB_REF_NAME;
      const gitCommit = options.commit || process.env.GITHUB_SHA;
      const targetUrl = options.targetUrl;

      // 1. Create build
      console.log(`Creating build for ${repo}...`);
      let buildId = "";
      let testCount: number;
      try {
        const createBody: Record<string, string> = isName
          ? { githubRepo: repo }
          : { repositoryId: repo };
        createBody.triggerType = "ci";
        if (gitBranch) createBody.gitBranch = gitBranch;
        if (gitCommit) createBody.gitCommit = gitCommit;
        if (targetUrl) createBody.targetUrl = targetUrl;

        const res = await fetch(`${server}/api/builds/create`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(createBody),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          console.error(
            `Error creating build: ${(body as { error?: string }).error || res.statusText}`,
          );
          process.exit(1);
        }

        const data = (await res.json()) as {
          buildId: string | null;
          testCount: number;
          queued?: boolean;
          jobId?: string;
        };
        testCount = data.testCount;

        if (data.queued && !data.buildId) {
          // Build was queued — poll until it starts
          console.log(
            `Build queued (${testCount} tests), waiting for active build to finish...`,
          );
          const queueStart = Date.now();
          while (Date.now() - queueStart < timeout) {
            await new Promise((resolve) => setTimeout(resolve, 5000));
            try {
              const retryRes = await fetch(`${server}/api/builds/create`, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${token}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify(createBody),
              });
              if (!retryRes.ok) continue;
              const retryData = (await retryRes.json()) as {
                buildId: string | null;
                testCount: number;
                queued?: boolean;
              };
              if (retryData.buildId) {
                buildId = retryData.buildId;
                testCount = retryData.testCount;
                break;
              }
              console.log("  Still queued, retrying...");
            } catch {
              // retry
            }
          }
          if (!buildId) {
            console.error("Timeout: queued build never started");
            process.exit(1);
            return;
          }
        } else {
          buildId = data.buildId!;
        }
      } catch (error) {
        console.error("Failed to create build:", (error as Error).message);
        process.exit(1);
        return; // unreachable but helps TS
      }

      console.log(`Build ${buildId} created (${testCount} tests)`);

      // 2. Poll for status
      const startTime = Date.now();
      let lastCompleted = 0;

      while (Date.now() - startTime < timeout) {
        await new Promise((resolve) => setTimeout(resolve, 3000));

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

          const status = (await res.json()) as {
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

          const completed =
            status.passedCount +
            status.failedCount +
            status.changesDetected +
            status.flakyCount;
          if (completed > lastCompleted) {
            console.log(
              `  Progress: ${completed}/${status.totalTests} tests complete`,
            );
            lastCompleted = completed;
          }

          // Build is done only when completedAt is set (overallStatus alone is unreliable —
          // initial status is 'review_required' before execution even starts)
          if (status.completedAt) {
            const elapsed = status.elapsedMs
              ? `${(status.elapsedMs / 1000).toFixed(1)}s`
              : `${((Date.now() - startTime) / 1000).toFixed(1)}s`;

            // Per-test diff results
            if (status.diffs && status.diffs.length > 0) {
              console.log("");
              const nameWidth = Math.max(
                4,
                ...status.diffs.map(
                  (d) =>
                    (d.testName || "Unknown").length +
                    (d.stepLabel ? d.stepLabel.length + 3 : 0),
                ),
              );
              console.log(`${"Test".padEnd(nameWidth)}  Result       Diff`);
              console.log(
                `${"─".repeat(nameWidth)}  ${"─".repeat(11)}  ${"─".repeat(8)}`,
              );

              for (const diff of status.diffs) {
                const name = diff.testName || "Unknown";
                const label = diff.stepLabel
                  ? `${name} > ${diff.stepLabel}`
                  : name;
                const cls =
                  diff.testResultStatus === "failed"
                    ? "FAILED"
                    : diff.classification === "changed"
                      ? "CHANGED"
                      : diff.classification === "flaky"
                        ? "FLAKY"
                        : "PASS";
                const pct = diff.percentageDifference
                  ? `${parseFloat(diff.percentageDifference).toFixed(2)}%`
                  : "—";
                console.log(
                  `${label.padEnd(nameWidth)}  ${cls.padEnd(11)}  ${pct}`,
                );
                if (diff.errorMessage) {
                  console.log(
                    `${"".padEnd(nameWidth)}  └ ${diff.errorMessage}`,
                  );
                }
              }
            }

            console.log("");
            console.log(
              `Build ${status.overallStatus.toUpperCase()} (${elapsed})`,
            );
            console.log(`  Passed: ${status.passedCount}`);
            if (status.failedCount > 0)
              console.log(`  Failed: ${status.failedCount}`);
            if (status.changesDetected > 0)
              console.log(`  Changes: ${status.changesDetected}`);
            if (status.flakyCount > 0)
              console.log(`  Flaky: ${status.flakyCount}`);

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
              fs.appendFileSync(ghOutput, lines.join("\n") + "\n");
            }

            // Write GitHub Actions step summary
            const ghSummary = process.env.GITHUB_STEP_SUMMARY;
            if (ghSummary) {
              const emoji =
                status.overallStatus === "passed" ||
                status.overallStatus === "safe_to_merge"
                  ? "✅"
                  : status.overallStatus === "review_required"
                    ? "⚠️"
                    : "❌";
              const md = [
                `## ${emoji} Visual Regression Results`,
                "",
                "| Metric | Value |",
                "|--------|-------|",
                `| Status | **${status.overallStatus}** |`,
                `| Passed | ${status.passedCount} |`,
                `| Failed | ${status.failedCount} |`,
                `| Changes | ${status.changesDetected} |`,
                `| Flaky | ${status.flakyCount} |`,
                `| Total | ${status.totalTests} |`,
                `| Duration | ${elapsed} |`,
                "",
                `[View Results](${buildUrl})`,
                "",
              ];
              fs.appendFileSync(ghSummary, md.join("\n"));
            }

            // Determine exit code
            const failStatuses = ["failed", "blocked"];
            if (failStatuses.includes(status.overallStatus)) {
              process.exit(1);
            }
            if (status.overallStatus === "review_required" && failOnChanges) {
              console.log(
                "\nVisual changes detected and --fail-on-changes is enabled",
              );
              process.exit(1);
            }
            process.exit(0);
          }
        } catch (error) {
          console.error(`Poll error: ${(error as Error).message}`);
        }
      }

      console.error(
        `Timeout: build did not complete within ${timeout / 1000}s`,
      );
      process.exit(1);
    });

  await program.parseAsync(process.argv);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
