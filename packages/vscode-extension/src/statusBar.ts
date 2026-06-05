import * as vscode from "vscode";

export class StatusBarManager {
  private statusBarItem: vscode.StatusBarItem;
  private isConnected = false;
  private passedCount = 0;
  private failedCount = 0;
  private totalCount = 0;
  private runningCount = 0;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100,
    );
    this.statusBarItem.command = "lastest.showOutput";
    this.updateDisplay();
  }

  setConnected(connected: boolean) {
    this.isConnected = connected;
    this.updateDisplay();
  }

  incrementRunning() {
    this.runningCount++;
    this.updateDisplay();
  }

  decrementRunning() {
    this.runningCount = Math.max(0, this.runningCount - 1);
    this.updateDisplay();
  }

  recordResult(passed: boolean) {
    if (passed) {
      this.passedCount++;
    } else {
      this.failedCount++;
    }
    this.updateDisplay();
  }

  private updateDisplay() {
    const config = vscode.workspace.getConfiguration("lastest");
    if (!config.get("showStatusBar", true)) {
      this.statusBarItem.hide();
      return;
    }

    if (!this.isConnected) {
      this.statusBarItem.text = "$(debug-disconnect) Lastest: Disconnected";
      this.statusBarItem.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.warningBackground",
      );
      this.statusBarItem.tooltip = "Click to reconnect";
    } else if (this.runningCount > 0) {
      this.statusBarItem.text = `$(loading~spin) Lastest: Running ${this.runningCount} test(s)`;
      this.statusBarItem.backgroundColor = undefined;
      this.statusBarItem.tooltip = "Tests in progress...";
    } else if (this.totalCount > 0) {
      const icon = this.failedCount > 0 ? "$(error)" : "$(pass)";
      this.statusBarItem.text = `${icon} Lastest: ${this.passedCount}/${this.totalCount}`;
      this.statusBarItem.backgroundColor =
        this.failedCount > 0
          ? new vscode.ThemeColor("statusBarItem.errorBackground")
          : undefined;
      this.statusBarItem.tooltip = `${this.passedCount} passed, ${this.failedCount} failed`;
    } else {
      this.statusBarItem.text = "$(beaker) Lastest";
      this.statusBarItem.backgroundColor = undefined;
      this.statusBarItem.tooltip = "No tests loaded";
    }

    this.statusBarItem.show();
  }

  updateCounts(passed: number, failed: number, total: number) {
    this.passedCount = passed;
    this.failedCount = failed;
    this.totalCount = total;
    this.updateDisplay();
  }

  show() {
    this.statusBarItem.show();
  }

  hide() {
    this.statusBarItem.hide();
  }

  dispose() {
    this.statusBarItem.dispose();
  }
}
