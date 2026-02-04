import * as vscode from 'vscode';
import { Lastest2Api } from './api';
import { Lastest2WebSocket } from './websocket';
import { TestTreeDataProvider } from './testTree';
import { TestRunner } from './testRunner';
import { StatusBarManager } from './statusBar';

let api: Lastest2Api;
let ws: Lastest2WebSocket;
let treeProvider: TestTreeDataProvider;
let testRunner: TestRunner;
let statusBar: StatusBarManager;

export function activate(context: vscode.ExtensionContext) {
  console.log('Lastest2 extension activating...');

  // Initialize API client
  api = new Lastest2Api();

  // Initialize WebSocket
  ws = new Lastest2WebSocket();

  // Initialize tree provider
  treeProvider = new TestTreeDataProvider(api, ws);

  // Initialize test runner
  testRunner = new TestRunner(api, ws, treeProvider);

  // Initialize status bar
  statusBar = new StatusBarManager(api, ws, treeProvider);

  // Register tree view
  const treeView = vscode.window.createTreeView('lastest2.testExplorer', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('lastest2.refreshTests', () => {
      treeProvider.refresh();
    }),

    vscode.commands.registerCommand('lastest2.runTest', async (item) => {
      if (item?.test?.id) {
        await testRunner.runTest(item.test.id);
      } else if (item?.area?.id) {
        await testRunner.runFunctionalArea(item.area.id);
      } else if (item?.repo?.id) {
        await testRunner.runRepository(item.repo.id);
      }
    }),

    vscode.commands.registerCommand('lastest2.runAllTests', () => {
      testRunner.runAllTests();
    }),

    vscode.commands.registerCommand('lastest2.openInBrowser', (item) => {
      if (item?.test?.id) {
        const serverUrl = api.getServerUrl();
        vscode.env.openExternal(vscode.Uri.parse(`${serverUrl}/tests/${item.test.id}`));
      }
    }),

    vscode.commands.registerCommand('lastest2.showOutput', () => {
      testRunner.showOutput();
    }),

    vscode.commands.registerCommand('lastest2.connect', async () => {
      await connect();
    })
  );

  // Listen for configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('lastest2.serverUrl') || e.affectsConfiguration('lastest2.apiToken')) {
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

  console.log('Lastest2 extension activated');
}

async function connect() {
  const config = vscode.workspace.getConfiguration('lastest2');
  const serverUrl = config.get<string>('serverUrl', 'http://localhost:3000');
  const apiToken = config.get<string>('apiToken', '');

  // Check connection
  const connected = await api.checkConnection();
  if (connected) {
    ws.connect(serverUrl, apiToken);
    await treeProvider.refresh();
    vscode.window.showInformationMessage('Connected to Lastest2 server');
  } else {
    vscode.window.showWarningMessage(
      `Cannot connect to Lastest2 server at ${serverUrl}`,
      'Configure'
    ).then(action => {
      if (action === 'Configure') {
        vscode.commands.executeCommand('workbench.action.openSettings', 'lastest2.serverUrl');
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
