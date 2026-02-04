import * as vscode from 'vscode';
import type { Lastest2Api } from './api';
import type { Lastest2WebSocket } from './websocket';
import type { Repository, FunctionalArea, Test, TestTreeItem } from './types';

type TreeNode = RepositoryNode | FunctionalAreaNode | TestNode;

class RepositoryNode extends vscode.TreeItem {
  constructor(
    public readonly repo: Repository,
    public children: FunctionalAreaNode[] = []
  ) {
    super(repo.name, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'repository';
    this.iconPath = new vscode.ThemeIcon('repo');
    this.tooltip = repo.fullName;
  }
}

class FunctionalAreaNode extends vscode.TreeItem {
  constructor(
    public readonly area: FunctionalArea,
    public readonly repoId: number,
    public children: TestNode[] = []
  ) {
    super(area.name, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'functionalArea';
    this.iconPath = new vscode.ThemeIcon('folder');
  }

  updateStatus() {
    if (this.children.length === 0) return;

    const hasRunning = this.children.some(t => t.status === 'running');
    const hasFailed = this.children.some(t => t.status === 'failed');
    const allPassed = this.children.every(t => t.status === 'passed');

    if (hasRunning) {
      this.iconPath = new vscode.ThemeIcon('loading~spin');
    } else if (hasFailed) {
      this.iconPath = new vscode.ThemeIcon('folder', new vscode.ThemeColor('testing.iconFailed'));
    } else if (allPassed) {
      this.iconPath = new vscode.ThemeIcon('folder', new vscode.ThemeColor('testing.iconPassed'));
    } else {
      this.iconPath = new vscode.ThemeIcon('folder');
    }
  }
}

class TestNode extends vscode.TreeItem {
  status: 'passed' | 'failed' | 'running' | null;
  lastRunAt: string | null;

  constructor(public readonly test: Test) {
    super(test.name, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'test';
    this.status = test.lastRunStatus;
    this.lastRunAt = test.lastRunAt;
    this.updateDisplay();
  }

  updateDisplay() {
    // Status icon
    switch (this.status) {
      case 'passed':
        this.iconPath = new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
        break;
      case 'failed':
        this.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
        break;
      case 'running':
        this.iconPath = new vscode.ThemeIcon('loading~spin');
        break;
      default:
        this.iconPath = new vscode.ThemeIcon('circle-outline');
    }

    // Description with last run time
    if (this.lastRunAt) {
      const ago = this.formatTimeAgo(new Date(this.lastRunAt));
      this.description = ago;
    } else {
      this.description = 'never run';
    }

    // Tooltip
    this.tooltip = new vscode.MarkdownString();
    this.tooltip.appendMarkdown(`**${this.test.name}**\n\n`);
    this.tooltip.appendMarkdown(`URL: ${this.test.targetUrl}\n\n`);
    if (this.status) {
      this.tooltip.appendMarkdown(`Status: ${this.status}\n`);
    }
  }

  private formatTimeAgo(date: Date): string {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  }
}

export class TestTreeDataProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private repositories: RepositoryNode[] = [];
  private testNodeMap = new Map<number, TestNode>();

  constructor(
    private readonly api: Lastest2Api,
    private readonly ws: Lastest2WebSocket
  ) {
    // Listen for test updates
    this.ws.onTestStart((payload) => {
      const node = this.testNodeMap.get(payload.testId);
      if (node) {
        node.status = 'running';
        node.updateDisplay();
        this._onDidChangeTreeData.fire(node);
      }
    });

    this.ws.onTestComplete((payload) => {
      const node = this.testNodeMap.get(payload.testId);
      if (node) {
        node.status = payload.status === 'error' ? 'failed' : payload.status;
        node.lastRunAt = new Date().toISOString();
        node.updateDisplay();
        this._onDidChangeTreeData.fire(node);
      }
    });
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeNode): Thenable<TreeNode[]> {
    if (!element) {
      return Promise.resolve(this.repositories);
    }

    if (element instanceof RepositoryNode) {
      return Promise.resolve(element.children);
    }

    if (element instanceof FunctionalAreaNode) {
      return Promise.resolve(element.children);
    }

    return Promise.resolve([]);
  }

  getParent(element: TreeNode): TreeNode | undefined {
    if (element instanceof TestNode) {
      for (const repo of this.repositories) {
        for (const area of repo.children) {
          if (area.children.includes(element)) {
            return area;
          }
        }
      }
    }

    if (element instanceof FunctionalAreaNode) {
      for (const repo of this.repositories) {
        if (repo.children.includes(element)) {
          return repo;
        }
      }
    }

    return undefined;
  }

  async refresh(): Promise<void> {
    try {
      const repos = await this.api.getRepositories();
      this.repositories = [];
      this.testNodeMap.clear();

      for (const repo of repos) {
        const repoNode = new RepositoryNode(repo);

        const areas = await this.api.getFunctionalAreas(repo.id);
        const tests = await this.api.getTests(repo.id);

        for (const area of areas) {
          const areaNode = new FunctionalAreaNode(area, repo.id);
          const areaTests = tests.filter(t => t.functionalAreaId === area.id);

          areaNode.children = areaTests.map(t => {
            const testNode = new TestNode(t);
            this.testNodeMap.set(t.id, testNode);
            return testNode;
          });

          areaNode.updateStatus();
          repoNode.children.push(areaNode);
        }

        this.repositories.push(repoNode);
      }

      this._onDidChangeTreeData.fire();
    } catch (e) {
      vscode.window.showErrorMessage(`Failed to load tests: ${e}`);
    }
  }

  getTestNode(testId: number): TestNode | undefined {
    return this.testNodeMap.get(testId);
  }

  getAllTestIds(): number[] {
    return Array.from(this.testNodeMap.keys());
  }

  getTestIdsByFunctionalArea(areaId: number): number[] {
    for (const repo of this.repositories) {
      for (const area of repo.children) {
        if (area.area.id === areaId) {
          return area.children.map(t => t.test.id);
        }
      }
    }
    return [];
  }

  getTestIdsByRepository(repoId: number): number[] {
    for (const repo of this.repositories) {
      if (repo.repo.id === repoId) {
        return repo.children.flatMap(area => area.children.map(t => t.test.id));
      }
    }
    return [];
  }
}
