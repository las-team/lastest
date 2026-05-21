import * as vscode from 'vscode';
import { LastestApi } from './api';
import { TestTreeDataProvider } from './testTree';
import { TestRunner } from './testRunner';
import { StatusBarManager } from './statusBar';
import { getOutputChannel, disposeOutputChannel } from './output';

let api: LastestApi;
let treeProvider: TestTreeDataProvider;
let testRunner: TestRunner;
let statusBar: StatusBarManager;

export function activate(context: vscode.ExtensionContext) {
  console.log('Lastest extension activating...');

  api = new LastestApi();
  treeProvider = new TestTreeDataProvider(api);
  statusBar = new StatusBarManager();
  testRunner = new TestRunner(api, treeProvider, statusBar);

  const treeView = vscode.window.createTreeView('lastest.testExplorer', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });

  context.subscriptions.push(
    vscode.commands.registerCommand('lastest.refreshTests', async () => {
      await refresh();
    }),

    vscode.commands.registerCommand('lastest.runTest', async (item) => {
      if (item?.test?.id) {
        await testRunner.runTest(item.test.id);
      } else if (item?.area?.id) {
        await testRunner.runFunctionalArea(item.area.id);
      } else if (item?.repo?.id) {
        await testRunner.runRepository(item.repo.id);
      }
    }),

    vscode.commands.registerCommand('lastest.runAllTests', () => {
      testRunner.runAllTests();
    }),

    vscode.commands.registerCommand('lastest.openInBrowser', (item) => {
      if (item?.test?.id) {
        const serverUrl = api.getServerUrl();
        vscode.env.openExternal(vscode.Uri.parse(`${serverUrl}/tests/${item.test.id}`));
      }
    }),

    vscode.commands.registerCommand('lastest.showOutput', () => {
      testRunner.showOutput();
    }),

    vscode.commands.registerCommand('lastest.connect', async () => {
      await connect();
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration('lastest.serverUrl') || e.affectsConfiguration('lastest.apiToken')) {
        api.updateConfig();
        await connect();
      }
    })
  );

  context.subscriptions.push(
    treeView,
    { dispose: () => testRunner.dispose() },
    { dispose: () => statusBar.dispose() }
  );

  connect();

  console.log('Lastest extension activated');
}

async function refresh() {
  const output = getOutputChannel();
  output.appendLine(`[health] GET ${api.getServerUrl()}/api/v1/health`);
  const connected = await api.checkConnection();
  statusBar.setConnected(connected);
  if (!connected) {
    output.appendLine(`[health] failed — cannot reach ${api.getServerUrl()}`);
    return;
  }
  output.appendLine('[health] ok');
  await treeProvider.refresh();
}

async function connect() {
  const output = getOutputChannel();
  const serverUrl = api.getServerUrl();
  output.appendLine(`[health] GET ${serverUrl}/api/v1/health`);
  const connected = await api.checkConnection();
  statusBar.setConnected(connected);
  if (connected) {
    output.appendLine('[health] ok');
    await treeProvider.refresh();
    vscode.window.showInformationMessage('Connected to Lastest server');
  } else {
    output.appendLine(`[health] failed — cannot reach ${serverUrl}`);
    vscode.window.showWarningMessage(
      `Cannot connect to Lastest server at ${serverUrl}`,
      'Configure',
      'Show Output'
    ).then(action => {
      if (action === 'Configure') {
        vscode.commands.executeCommand('workbench.action.openSettings', 'lastest.serverUrl');
      } else if (action === 'Show Output') {
        output.show();
      }
    });
  }
}

export function deactivate() {
  testRunner?.dispose();
  statusBar?.dispose();
  disposeOutputChannel();
}
