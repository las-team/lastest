# @lastest/runner

Remote test execution runner for [Lastest](https://github.com/las-team/lastest) — free, open-source visual regression testing with AI-generated tests.

Connects to your Lastest server, receives test jobs, executes them locally using Playwright, and reports results back. Run as a background daemon or in the foreground for CI/CD.

---

## Installation

```bash
# Global installation
npm install -g @lastest/runner

# Or run directly with npx
npx @lastest/runner --help
```

After installing, you need to install Playwright's Chromium browser:

```bash
npx playwright install chromium
```

> The runner will verify Chromium is installed on startup and provide clear instructions if it's missing.

## Requirements

- Node.js 18+
- Playwright Chromium browser (see installation above)

---

## Quick Start

1. **Register a runner** in your Lastest instance at Settings → Runners
2. **Copy the token** (shown only once)
3. **Start the runner**:

```bash
lastest2-runner start -t YOUR_TOKEN -s https://your-lastest2-server
```

That's it. The runner connects, waits for jobs, and executes tests automatically.

---

## Usage

### Start Runner (Daemon Mode)

```bash
lastest2-runner start -t <token> -s <server-url>
```

Spawns a detached background process. Logs are written to `~/.lastest2/runner.log`.

| Option | Description | Default |
|--------|-------------|---------|
| `-t, --token <token>` | Runner authentication token (required on first run) | — |
| `-s, --server <url>` | Lastest server URL (required on first run) | — |
| `-i, --interval <ms>` | Poll interval in milliseconds | `5000` |
| `-b, --base-url <url>` | Override target URL for test execution | — |

After the first run, options are saved to `~/.lastest2/runner.config.json`. Subsequent runs can omit them:

```bash
lastest2-runner start  # Uses saved config
```

### Stop Runner

```bash
lastest2-runner stop
```

### Check Status

```bash
lastest2-runner status
```

### View Logs

```bash
lastest2-runner log              # Show last 50 lines
lastest2-runner log -n 100       # Show last 100 lines
lastest2-runner log -f           # Follow log output (like tail -f)
```

### Run in Foreground

```bash
lastest2-runner run -t <token> -s <server-url>
```

Keeps the process attached to the terminal. Useful for:
- Debugging connection issues
- Docker containers
- CI/CD environments

---

## Configuration

Runner stores its files in `~/.lastest2/`:

| File | Purpose |
|------|---------|
| `runner.pid` | Process ID of running daemon |
| `runner.log` | Log output |
| `runner.config.json` | Saved configuration (token encrypted with AES-256-CBC) |

---

## Capabilities

- **Run**: Execute visual regression tests remotely with Playwright
- **Record**: Record new tests on remote machines with headed browser
- **Screenshots**: Capture full-page screenshots, return as base64
- **Setup scripts**: Inject storage state (cookies/localStorage) from setup flows
- **Code integrity**: SHA256 hash verification prevents code tampering in transit
- **Multi-selector fallback**: data-testid → id → role → aria-label → text → css → OCR
- **Graceful shutdown**: Handles SIGINT/SIGTERM for clean browser cleanup

---

## CI/CD Integration

### GitHub Actions

```yaml
jobs:
  visual-tests:
    runs-on: ubuntu-latest
    steps:
      - name: Run Lastest Runner
        run: |
          npx @lastest/runner run \
            -t ${{ secrets.LASTEST2_TOKEN }} \
            -s ${{ vars.LASTEST2_SERVER }}
```

### Docker

```dockerfile
FROM node:18-slim

RUN npm install -g @lastest/runner && \
    npx playwright install chromium --with-deps

CMD ["lastest2-runner", "run", "-t", "$TOKEN", "-s", "$SERVER"]
```

### GitHub Action (Alternative)

For zero-config CI/CD without installing the runner, use the reusable GitHub Action instead:

```yaml
- name: Run visual regression tests
  uses: las-team/lastest/action@main
  with:
    server-url: ${{ secrets.LASTEST_SERVER_URL }}
    runner-token: ${{ secrets.LASTEST_RUNNER_TOKEN }}
```

---

## Example

```bash
# Install globally
npm install -g @lastest/runner

# Install Playwright Chromium
npx playwright install chromium

# Start the runner
lastest2-runner start -t lastest_runner_abc123 -s https://lastest2.example.com

# Check it's running
lastest2-runner status
# Runner Status: RUNNING
#   PID: 12345
#   Server: https://lastest2.example.com

# View logs
lastest2-runner log -f

# Stop when done
lastest2-runner stop
```

---

## Programmatic Usage

The runner can also be used as a library:

```typescript
import { RunnerClient, TestRunner } from '@lastest/runner';

const client = new RunnerClient({
  token: 'your-token',
  serverUrl: 'https://your-lastest2-server',
  pollInterval: 5000,
});

await client.start();
```

---

## Troubleshooting

### "Playwright Chromium browser is not installed"

Run:
```bash
npx playwright install chromium
```

On Linux, you may also need system dependencies:
```bash
npx playwright install-deps chromium
```

### Runner can't connect to server

- Verify the server URL is reachable from the runner machine
- Check the token hasn't been revoked in Settings → Runners
- Check firewall rules allow outbound HTTPS

### Runner disconnects frequently

- Increase poll interval: `-i 10000` (10 seconds)
- Check network stability between runner and server
- View logs for error details: `lastest2-runner log -f`

---

## License

FSL-1.1-ALv2 — see [LICENSE](./LICENSE)
