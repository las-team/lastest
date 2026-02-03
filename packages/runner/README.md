# @lastest2/runner

Remote test execution runner for Lastest2 visual regression testing platform.

## Installation

```bash
npm install -g @lastest2/runner
# or
pnpm add -g @lastest2/runner
```

## Usage

### Start Runner (Daemon Mode)

```bash
lastest2-runner start -t <token> -s <server-url>
```

Options:
- `-t, --token <token>` - Runner authentication token (required)
- `-s, --server <url>` - Server URL, e.g., `https://your-app.vercel.app` (required)
- `-i, --interval <ms>` - Poll interval in milliseconds (default: `5000`)

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

## Configuration

Runner stores its files in `~/.lastest2/`:
- `runner.pid` - Process ID of running daemon
- `runner.log` - Log output
- `runner.config.json` - Saved configuration

## Example

```bash
# Start the runner
lastest2-runner start -t lastest_runner_abc123 -s http://localhost:3000

# Check it's running
lastest2-runner status
# Output: Runner Status: RUNNING
#         PID: 12345
#         Server: http://localhost:3000

# View logs
lastest2-runner log -f

# Stop when done
lastest2-runner stop
```
