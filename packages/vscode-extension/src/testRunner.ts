import * as vscode from "vscode";
import type { LastestApi } from "./api";
import type { TestTreeDataProvider } from "./testTree";
import type { StatusBarManager } from "./statusBar";
import { getOutputChannel } from "./output";

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

export class TestRunner {
  private outputChannel: vscode.OutputChannel;
  private activePolls = new Set<number>();

  constructor(
    private readonly api: LastestApi,
    private readonly treeProvider: TestTreeDataProvider,
    private readonly statusBar: StatusBarManager,
  ) {
    this.outputChannel = getOutputChannel();
  }

  async runTest(testId: number): Promise<void> {
    const node = this.treeProvider.getTestNode(testId);
    const testName = node?.test.name ?? `Test #${testId}`;

    this.outputChannel.appendLine(`\n━━━ Starting: ${testName} ━━━`);
    this.outputChannel.show(true);

    try {
      const run = await this.api.runTest(testId);
      this.outputChannel.appendLine(`Run started: #${run.id}`);
      this.pollTestRun(run.id, testName);
    } catch (e) {
      this.outputChannel.appendLine(`❌ Failed to start test: ${e}`);
      vscode.window.showErrorMessage(`Failed to run test: ${e}`);
    }
  }

  async runTests(testIds: number[]): Promise<void> {
    this.outputChannel.appendLine(`\n━━━ Running ${testIds.length} tests ━━━`);
    this.outputChannel.show(true);

    try {
      const { buildId } = await this.api.runTests(testIds);
      this.outputChannel.appendLine(`Build started: #${buildId}`);
      this.pollBuild(buildId, `${testIds.length} test(s)`);
    } catch (e) {
      this.outputChannel.appendLine(`❌ Failed to start tests: ${e}`);
      vscode.window.showErrorMessage(`Failed to run tests: ${e}`);
    }
  }

  async runFunctionalArea(areaId: number): Promise<void> {
    this.outputChannel.appendLine(`\n━━━ Running functional area ━━━`);
    this.outputChannel.show(true);

    try {
      const { buildId } = await this.api.runFunctionalArea(areaId);
      this.outputChannel.appendLine(`Build started: #${buildId}`);
      this.pollBuild(buildId, `functional area #${areaId}`);
    } catch (e) {
      this.outputChannel.appendLine(`❌ Failed to start tests: ${e}`);
      vscode.window.showErrorMessage(`Failed to run tests: ${e}`);
    }
  }

  async runRepository(repoId: number): Promise<void> {
    this.outputChannel.appendLine(`\n━━━ Running all repository tests ━━━`);
    this.outputChannel.show(true);

    try {
      const { buildId } = await this.api.runRepository(repoId);
      this.outputChannel.appendLine(`Build started: #${buildId}`);
      this.pollBuild(buildId, `repository #${repoId}`);
    } catch (e) {
      this.outputChannel.appendLine(`❌ Failed to start tests: ${e}`);
      vscode.window.showErrorMessage(`Failed to run tests: ${e}`);
    }
  }

  async runAllTests(): Promise<void> {
    const testIds = this.treeProvider.getAllTestIds();
    if (testIds.length === 0) {
      vscode.window.showWarningMessage("No tests to run");
      return;
    }

    await this.runTests(testIds);
  }

  isRunning(testId: number): boolean {
    return this.activePolls.has(testId);
  }

  showOutput(): void {
    this.outputChannel.show();
  }

  dispose(): void {
    this.activePolls.clear();
  }

  private async pollBuild(buildId: number, label: string): Promise<void> {
    if (this.activePolls.has(buildId)) return;
    this.activePolls.add(buildId);
    this.statusBar.incrementRunning();

    const started = Date.now();
    let lastStatus = "";

    try {
      while (Date.now() - started < POLL_TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        if (!this.activePolls.has(buildId)) return;

        try {
          const build = await this.api.getBuild(buildId);
          if (build.status !== lastStatus) {
            lastStatus = build.status;
            this.outputChannel.appendLine(
              `  Build #${buildId}: ${build.status} (${build.passedTests}/${build.totalTests})`,
            );
          }
          if (build.status === "completed" || build.status === "failed") {
            const passed = build.failedTests === 0;
            const icon = passed ? "✅" : "❌";
            this.outputChannel.appendLine(
              `${icon} ${label} — ${build.passedTests} passed, ${build.failedTests} failed`,
            );
            this.statusBar.recordResult(passed);
            if (!passed) {
              vscode.window
                .showWarningMessage(
                  `Build #${buildId} failed: ${build.failedTests} test(s) failed`,
                  "Show Output",
                )
                .then((action) => {
                  if (action === "Show Output") this.outputChannel.show();
                });
            }
            await this.treeProvider.refresh();
            return;
          }
        } catch {
          // transient API failure — keep polling
        }
      }
      this.outputChannel.appendLine(
        `⏱ ${label} — poll timeout after ${POLL_TIMEOUT_MS / 1000}s`,
      );
      await this.treeProvider.refresh();
    } finally {
      this.activePolls.delete(buildId);
      this.statusBar.decrementRunning();
    }
  }

  private async pollTestRun(runId: number, testName: string): Promise<void> {
    if (this.activePolls.has(runId)) return;
    this.activePolls.add(runId);
    this.statusBar.incrementRunning();

    const started = Date.now();

    try {
      while (Date.now() - started < POLL_TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        if (!this.activePolls.has(runId)) return;

        try {
          const run = await this.api.getTestRun(runId);
          if (
            run.status === "passed" ||
            run.status === "failed" ||
            run.status === "error"
          ) {
            const passed = run.status === "passed";
            const icon = passed ? "✅" : "❌";
            const duration =
              run.startedAt && run.completedAt
                ? `${((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000).toFixed(1)}s`
                : "";
            this.outputChannel.appendLine(
              `${icon} ${testName}${duration ? ` (${duration})` : ""}`,
            );
            if (run.errorMessage) {
              this.outputChannel.appendLine(`   Error: ${run.errorMessage}`);
            }
            this.statusBar.recordResult(passed);
            if (!passed) {
              vscode.window
                .showWarningMessage(`Test failed: ${testName}`, "Show Output")
                .then((action) => {
                  if (action === "Show Output") this.outputChannel.show();
                });
            }
            await this.treeProvider.refresh();
            return;
          }
        } catch {
          // transient API failure — keep polling
        }
      }
      this.outputChannel.appendLine(`⏱ ${testName} — poll timeout`);
      await this.treeProvider.refresh();
    } finally {
      this.activePolls.delete(runId);
      this.statusBar.decrementRunning();
    }
  }
}
