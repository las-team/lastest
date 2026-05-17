# Changelog

All notable changes to the Lastest VS Code extension are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.2] - 2026-05-17

### Fixed
- Repositories appearing multiple times in the Test Explorer when activation, config-change reconnect, and manual refresh overlapped. `refresh()` now de-dupes concurrent calls.
- Status bar flickering to "Disconnected" every 90 seconds during the server's planned SSE lifetime-cap recycle. The client now re-dials silently when the server has signalled the recycle, and only reports a disconnect on unexpected closes.

## [0.1.0] - 2026-05-06

Initial release.

### Added
- Test Explorer view in the activity bar, populated from the Lastest server.
- WebSocket bridge for live test-start and test-complete updates.
- Status bar item with connection state, running test count, and pass/fail tally.
- Commands: `lastest.runTest`, `lastest.runAllTests`, `lastest.refreshTests`, `lastest.openInBrowser`.
- Settings: `lastest.serverUrl`, `lastest.apiToken`, `lastest.autoRefresh`, `lastest.showStatusBar`.
