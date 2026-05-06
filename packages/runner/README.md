# @lastest/runner

[![npm version](https://img.shields.io/npm/v/@lastest/runner.svg)](https://www.npmjs.com/package/@lastest/runner)
[![npm downloads](https://img.shields.io/npm/dw/@lastest/runner.svg)](https://www.npmjs.com/package/@lastest/runner)
[![License](https://img.shields.io/npm/l/@lastest/runner.svg)](https://github.com/las-team/lastest/blob/main/LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/las-team/lastest.svg?style=social)](https://github.com/las-team/lastest)

Self-hosted Playwright runner for visual regression testing. Connect any machine to your [Lastest](https://lastest.cloud) server and execute browser tests with screenshot diffs, baseline approval, and AI-authored test healing — locally, in Docker, or in CI.

## Quick start

```bash
npm install -g @lastest/runner
npx playwright install chromium
lastest-runner start -t YOUR_TOKEN -s https://your-lastest-server
```

Get `YOUR_TOKEN` from **Settings → Runners** in your Lastest UI (shown once at create time).

## Why @lastest/runner

- **Run tests where they matter** — VPN, staging, localhost, or behind your firewall; no need to expose the SUT to a SaaS.
- **Single binary, zero infra** — one `npm install -g`, optional daemon mode with PID/log management in `~/.lastest/`.
- **Multi-selector resilience** — `data-testid` → `id` → `role` → `aria-label` → `text` → `css` → OCR fallback.
- **Tamper-proof transit** — SHA256 hash verification on every test payload before execution.
- **CI-friendly** — foreground `run` mode plays nicely with GitHub Actions, GitLab CI, Docker, and any process supervisor.

## Installation

```bash
# Global install
npm install -g @lastest/runner

# Or one-off via npx
npx @lastest/runner --help
```

The runner uses Playwright Chromium under the hood. Install it once:

```bash
npx playwright install chromium
# Linux: also install OS deps if needed
npx playwright install-deps chromium
```

The runner verifies Chromium on startup and prints clear instructions if it's missing.

**Requirements:** Node.js 18+ and a reachable [Lastest](https://lastest.cloud) instance.

## Usage

### Start in daemon mode

```bash
lastest-runner start -t <token> -s <server-url>
```

Spawns a detached background process. Logs go to `~/.lastest/runner.log`.

| Option | Description | Default |
|--------|-------------|---------|
| `-t, --token <token>` | Runner authentication token (required first run) | — |
| `-s, --server <url>` | Lastest server URL (required first run) | — |
| `-i, --interval <ms>` | Poll interval in milliseconds | `5000` |
| `-b, --base-url <url>` | Override target URL for test execution | — |

After the first run, options are saved to `~/.lastest/runner.config.json` (token encrypted with AES-256-CBC). Subsequent runs can omit them:

```bash
lastest-runner start  # uses saved config
```

### Stop, status, logs

```bash
lastest-runner stop
lastest-runner status
lastest-runner log              # last 50 lines
lastest-runner log -n 100       # last 100 lines
lastest-runner log -f           # follow (tail -f)
```

### Run in foreground

```bash
lastest-runner run -t <token> -s <server-url>
```

Stays attached to the terminal — ideal for CI, Docker, or debugging connection issues.

## Configuration files

Stored under `~/.lastest/`:

| File | Purpose |
|------|---------|
| `runner.pid` | PID of the running daemon |
| `runner.log` | Daemon log output |
| `runner.config.json` | Saved configuration (token AES-256-CBC encrypted) |

## Capabilities

- **Run** — execute visual regression tests remotely with Playwright
- **Record** — record new tests on remote machines with a headed browser
- **Screenshots** — full-page captures returned as base64 to the server
- **Setup scripts** — inject storage state (cookies, localStorage) from named flows
- **Code integrity** — SHA256 verification prevents test-payload tampering
- **Multi-selector fallback** — `data-testid` → `id` → `role` → `aria-label` → `text` → `css` → OCR
- **Graceful shutdown** — handles `SIGINT`/`SIGTERM` for clean browser teardown

## CI/CD integration

### GitHub Actions

```yaml
jobs:
  visual-tests:
    runs-on: ubuntu-latest
    steps:
      - name: Run Lastest Runner
        run: |
          npx @lastest/runner run \
            -t ${{ secrets.LASTEST_TOKEN }} \
            -s ${{ vars.LASTEST_SERVER }}
```

### GitLab CI

```yaml
visual-tests:
  image: mcr.microsoft.com/playwright:v1.57.0-jammy
  script:
    - npm install -g @lastest/runner
    - lastest-runner run -t $LASTEST_TOKEN -s $LASTEST_SERVER
```

### Docker

```dockerfile
FROM node:18-slim

RUN npm install -g @lastest/runner && \
    npx playwright install chromium --with-deps

CMD ["lastest-runner", "run", "-t", "$TOKEN", "-s", "$SERVER"]
```

### Reusable GitHub Action

For zero-config CI without managing the runner yourself:

```yaml
- name: Run visual regression tests
  uses: las-team/lastest/action@main
  with:
    server-url: ${{ secrets.LASTEST_SERVER_URL }}
    runner-token: ${{ secrets.LASTEST_RUNNER_TOKEN }}
```

## Used with

- **[Playwright](https://playwright.dev)** — drives Chromium and produces traces/videos
- **[Lastest](https://lastest.cloud)** — the server that orchestrates tests, baselines, and diffs
- **[GitHub Actions](https://github.com/features/actions)** / **[GitLab CI](https://docs.gitlab.com/ee/ci/)** — runs the runner on every PR
- **[Claude](https://claude.ai)** / **[Cursor](https://cursor.com)** — pair with [@lastest/mcp-server](https://www.npmjs.com/package/@lastest/mcp-server) so AI agents can trigger and review test runs

## End-to-end example

```bash
# Install globally
npm install -g @lastest/runner

# Install Playwright Chromium
npx playwright install chromium

# Start the runner
lastest-runner start -t lastest_runner_abc123 -s https://lastest.example.com

# Verify
lastest-runner status
# Runner Status: RUNNING
#   PID: 12345
#   Server: https://lastest.example.com

# Tail logs
lastest-runner log -f

# Stop when done
lastest-runner stop
```

## Programmatic usage

The runner is also exported as a library:

```typescript
import { RunnerClient, TestRunner } from '@lastest/runner';

const client = new RunnerClient({
  token: 'your-token',
  serverUrl: 'https://your-lastest-server',
  pollInterval: 5000,
});

await client.start();
```

## Troubleshooting

### "Playwright Chromium browser is not installed"

```bash
npx playwright install chromium
# Linux:
npx playwright install-deps chromium
```

### Runner can't connect to server

- Verify the server URL is reachable from the runner machine
- Check the token hasn't been revoked in **Settings → Runners**
- Confirm firewall rules allow outbound HTTPS

### Runner disconnects frequently

- Increase the poll interval: `-i 10000` (10 s)
- Inspect logs: `lastest-runner log -f`
- Check network stability between runner and server

## Links

- **Homepage:** https://lastest.cloud
- **GitHub:** https://github.com/las-team/lastest
- **Issues:** https://github.com/las-team/lastest/issues
- **npm:** https://www.npmjs.com/package/@lastest/runner
- **MCP server:** https://www.npmjs.com/package/@lastest/mcp-server

## License

FSL-1.1-ALv2 — see [LICENSE](./LICENSE).
