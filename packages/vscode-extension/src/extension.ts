import * as vscode from 'vscode';
import { LastestApi } from './api';
import { LastestWebSocket } from './websocket';
import { TestTreeDataProvider } from './testTree';
import { TestRunner } from './testRunner';
import { StatusBarManager } from './statusBar';

let api: LastestApi;
let ws: LastestWebSocket;
let treeProvider: TestTreeDataProvider;
let testRunner: TestRunner;
let statusBar: StatusBarManager;

export function activate(context: vscode.ExtensionContext) {
  console.log('Lastest extension activating...');

  // Initialize API client
  api = new LastestApi();

  // Initialize WebSocket
  ws = new LastestWebSocket();

  // Initialize tree provider
  treeProvider = new TestTreeDataProvider(api, ws);

  // Initialize test runner
  testRunner = new TestRunner(api, ws, treeProvider);

  // Initialize status bar
  statusBar = new StatusBarManager(api, ws, treeProvider);

  // Register tree view
  const treeView = vscode.window.createTreeView('lastest.testExplorer', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('lastest.refreshTests', () => {
      treeProvider.refresh();
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

  // Listen for configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('lastest.serverUrl') || e.affectsConfiguration('lastest.apiToken')) {
        api.updateConfig();
        reconnect();
      }
    })
  );

  // Add disposables
  context.subscriptions.push(
    treeView,
    { dispose: () => ws.dispose() },
    { dispose: () => testRunner.dispose() },
    { dispose: () => statusBar.dispose() }
  );

  // Initial connection
  connect();

  console.log('Lastest extension activated');
}

async function connect() {
  const config = vscode.workspace.getConfiguration('lastest');
  const serverUrl = config.get<string>('serverUrl', 'http://localhost:3000');
  const apiToken = config.get<string>('apiToken', '');

  // Check connection
  const connected = await api.checkConnection();
  if (connected) {
    ws.connect(serverUrl, apiToken);
    await treeProvider.refresh();
    vscode.window.showInformationMessage('Connected to Lastest server');
  } else {
    vscode.window.showWarningMessage(
      `Cannot connect to Lastest server at ${serverUrl}`,
      'Configure'
    ).then(action => {
      if (action === 'Configure') {
        vscode.commands.executeCommand('workbench.action.openSettings', 'lastest.serverUrl');
      }
    });
  }
}

async function reconnect() {
  ws.disconnect();
  await connect();
}

export function deactivate() {
  ws?.dispose();
  testRunner?.dispose();
  statusBar?.dispose();
}
