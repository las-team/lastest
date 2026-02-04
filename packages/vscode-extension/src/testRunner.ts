import * as vscode from 'vscode';
import type { Lastest2Api } from './api';
import type { Lastest2WebSocket } from './websocket';
import type { TestTreeDataProvider } from './testTree';
import type { TestCompletePayload } from './types';

export class TestRunner {
  private outputChannel: vscode.OutputChannel;
  private runningTests = new Set<number>();

  constructor(
    private readonly api: Lastest2Api,
    private readonly ws: Lastest2WebSocket,
    private readonly treeProvider: TestTreeDataProvider
  ) {
    this.outputChannel = vscode.window.createOutputChannel('Lastest2');

    // Listen for test completion
    this.ws.onTestStart(({ testId }) => {
      this.runningTests.add(testId);
      const node = this.treeProvider.getTestNode(testId);
      if (node) {
        this.outputChannel.appendLine(`▶ Running: ${node.test.name}`);
      }
    });

    this.ws.onTestProgress(({ testId, step, progress }) => {
      const node = this.treeProvider.getTestNode(testId);
      if (node) {
        this.outputChannel.appendLine(`  [${Math.round(progress * 100)}%] ${step}`);
      }
    });

    this.ws.onTestComplete((payload) => {
      this.handleTestComplete(payload);
    });
  }

  private handleTestComplete(payload: TestCompletePayload) {
    this.runningTests.delete(payload.testId);

    const node = this.treeProvider.getTestNode(payload.testId);
    const testName = node?.test.name ?? `Test #${payload.testId}`;

    const statusIcon = payload.status === 'passed' ? '✅' : '❌';
    const duration = `${(payload.duration / 1000).toFixed(1)}s`;

    this.outputChannel.appendLine(`${statusIcon} ${testName} (${duration})`);

    if (payload.errorMessage) {
      this.outputChannel.appendLine(`   Error: ${payload.errorMessage}`);
    }

    // Show notification for failures
    if (payload.status !== 'passed') {
      vscode.window.showWarningMessage(
        `Test failed: ${testName}`,
        'Show Output'
      ).then(action => {
        if (action === 'Show Output') {
          this.outputChannel.show();
        }
      });
    }
  }

  async runTest(testId: number): Promise<void> {
    const node = this.treeProvider.getTestNode(testId);
    const testName = node?.test.name ?? `Test #${testId}`;

    this.outputChannel.appendLine(`\n━━━ Starting: ${testName} ━━━`);
    this.outputChannel.show(true);

    try {
      await this.api.runTest(testId);
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
    } catch (e) {
      this.outputChannel.appendLine(`❌ Failed to start tests: ${e}`);
      vscode.window.showErrorMessage(`Failed to run tests: ${e}`);
    }
  }

  async runAllTests(): Promise<void> {
    const testIds = this.treeProvider.getAllTestIds();
    if (testIds.length === 0) {
      vscode.window.showWarningMessage('No tests to run');
      return;
    }

    await this.runTests(testIds);
  }

  isRunning(testId: number): boolean {
    return this.runningTests.has(testId);
  }

  showOutput(): void {
    this.outputChannel.show();
  }

  dispose(): void {
    this.outputChannel.dispose();
  }
}
