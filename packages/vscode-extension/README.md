# Lastest — Visual Regression Testing for VS Code

Run AI-powered visual regression tests, watch live progress, and jump to screenshot diffs straight from your editor. The Lastest extension connects VS Code to your [Lastest](https://lastest.cloud) server so you can drive your full QA suite without context-switching to the browser.

<!-- TODO: add demo gif at docs/vscode-demo.gif -->
<!-- ![Lastest VS Code demo](https://raw.githubusercontent.com/las-team/lastest/main/docs/vscode-demo.gif) -->

## Features

- **Test Explorer** — dedicated activity-bar view with a Repository → Functional Area → Test tree fed live from your Lastest server.
- **One-click runs** — run a single test, an entire functional area, a whole repository, or every test you have, all from the tree's inline actions.
- **Live status bar** — connection state, in-flight test count, and pass/fail tally update in real time over the WebSocket bridge.
- **Live updates** — test starts and completions stream in via WebSocket, so the tree and status bar refresh as the build progresses on the server.
- **Jump to web UI** — open any test directly in the Lastest dashboard for screenshot diffs, baselines, and history.
- **Auto-refresh** — optionally re-pull the test list once a run finishes, so the explorer always reflects the latest state.

## Requirements

- A running [Lastest](https://lastest.cloud) server you can reach (self-hosted or cloud).
- A Lastest API token with access to the repositories you want to control. Generate one in the Lastest UI under user settings.

## Quick start

1. Install the extension from the VS Code Marketplace.
2. Open the **Lastest** view from the activity bar (beaker icon).
3. Open Settings (`Ctrl/Cmd + ,`) and search for `Lastest`.
4. Set `lastest.serverUrl` (e.g. `https://app.lastest.cloud`) and paste your token into `lastest.apiToken`.
5. Click the refresh icon in the Test Explorer — your repositories, functional areas, and tests appear. Use the inline play button to launch a run.

## Configuration

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `lastest.serverUrl` | string | `http://localhost:3000` | URL of the Lastest server. |
| `lastest.apiToken` | string | `""` | Bearer token used for API and WebSocket auth. |
| `lastest.autoRefresh` | boolean | `true` | Automatically refresh the test list after runs complete. |
| `lastest.showStatusBar` | boolean | `true` | Show Lastest connection and test status in the status bar. |

## Commands

| Command | ID | Where |
| --- | --- | --- |
| Run Test | `lastest.runTest` | Inline action on a test or functional area in the Test Explorer. |
| Run All Tests | `lastest.runAllTests` | Test Explorer view title. |
| Refresh Tests | `lastest.refreshTests` | Test Explorer view title. |
| Open in Browser | `lastest.openInBrowser` | Inline action on a test — opens it in the Lastest dashboard. |

## Links

- Homepage: <https://lastest.cloud>
- GitHub: <https://github.com/las-team/lastest>
- Issues: <https://github.com/las-team/lastest/issues>

## License

MIT
