# @lastest/runner

[![npm version](https://img.shields.io/npm/v/@lastest/runner.svg)](https://www.npmjs.com/package/@lastest/runner)
[![npm downloads](https://img.shields.io/npm/dw/@lastest/runner.svg)](https://www.npmjs.com/package/@lastest/runner)
[![License](https://img.shields.io/npm/l/@lastest/runner.svg)](https://github.com/las-team/lastest/blob/main/LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/las-team/lastest.svg?style=social)](https://github.com/las-team/lastest)

CI client for [Lastest](https://lastest.cloud) visual regression testing. Triggers a build on your Lastest server and polls for results — no local browser required, since execution happens server-side against your team's embedded browser pool.

## Quick start

```bash
npx @lastest/runner trigger -t YOUR_TOKEN -s https://your-lastest-server --repo owner/repo
```

Get `YOUR_TOKEN` from **Settings → Runners** in your Lastest UI (shown once at create time).

## Why @lastest/runner

- **Lightweight CI step** — no browsers, no Docker image bloat; just an HTTP client that creates a build and polls until it's done.
- **CI-native output** — writes `GITHUB_OUTPUT` / `GITHUB_STEP_SUMMARY` automatically; exits non-zero on failed/blocked builds (or on detected changes with `--fail-on-changes`).
- **Works with any CI** — GitHub Actions, GitLab CI, or any system that can run `npx`.

## Installation

```bash
npx @lastest/runner --help
```

**Requirements:** Node.js 18+ and a reachable [Lastest](https://lastest.cloud) instance.

## Usage

### Trigger a build and wait for results

```bash
lastest-runner trigger -r owner/repo -t <token> -s <server-url>
```

| Option                  | Description                                              | Default  |
| ------------------------ | --------------------------------------------------------- | -------- |
| `-r, --repo <id-or-name>` | Repository ID or full name (e.g. `owner/repo`)            | required |
| `-t, --token <token>`    | Runner authentication token                                | —        |
| `-s, --server <url>`     | Lastest server URL                                         | —        |
| `--timeout <ms>`         | Timeout waiting for the build to complete                  | `300000` |
| `--branch <branch>`      | Git branch (defaults to `$GITHUB_HEAD_REF`/`$GITHUB_REF_NAME`) | —     |
| `--commit <sha>`         | Git commit SHA (defaults to `$GITHUB_SHA`)                 | —        |
| `--target-url <url>`     | Override base URL for test execution                       | —        |
| `--fail-on-changes`      | Exit 1 when visual changes are detected (`review_required`) | off    |

Exits `0` on `passed`/`safe_to_merge` (or `review_required` without `--fail-on-changes`), exits `1` on `failed`/`blocked`/timeout.

### List available repositories

```bash
lastest-runner repos -t <token> -s <server-url>
```

## Configuration

`-t`/`-s` can be omitted if a previous run saved them to `~/.lastest/runner.config.json`.

## CI/CD integration

### GitHub Actions

```yaml
jobs:
  visual-tests:
    runs-on: ubuntu-latest
    steps:
      - name: Run visual regression tests
        run: |
          npx @lastest/runner trigger \
            -r ${{ github.repository }} \
            -t ${{ secrets.LASTEST_TOKEN }} \
            -s ${{ vars.LASTEST_SERVER }}
```

### GitLab CI

```yaml
visual-tests:
  image: node:20-bookworm
  script:
    - npx @lastest/runner trigger -r my-group/my-repo -t $LASTEST_TOKEN -s $LASTEST_SERVER
```

### Reusable GitHub Action

For zero-config CI:

```yaml
- name: Run visual regression tests
  uses: las-team/lastest/action@main
  with:
    server-url: ${{ secrets.LASTEST_SERVER_URL }}
    runner-token: ${{ secrets.LASTEST_RUNNER_TOKEN }}
```

## Test execution

Test execution itself happens on your Lastest server using its embedded browser pool — either system-managed or a BYO embedded browser you register from **Settings → Runners**. This CLI never launches a browser; it only creates the build and reports on it.

## Used with

- **[Lastest](https://lastest.cloud)** — the server that orchestrates tests, baselines, and diffs
- **[GitHub Actions](https://github.com/features/actions)** / **[GitLab CI](https://docs.gitlab.com/ee/ci/)** — runs `trigger` on every PR
- **[Claude](https://claude.ai)** / **[Cursor](https://cursor.com)** — pair with [@lastest/mcp-server](https://www.npmjs.com/package/@lastest/mcp-server) so AI agents can trigger and review test runs

## Troubleshooting

### Build never completes / times out

- Check that an embedded browser (system or BYO) is registered and available for the team
- Increase `--timeout` for repos with many tests
- View the build directly at the printed `URL` for diagnostics

### Trigger fails immediately

- Verify the server URL is reachable from the CI runner
- Check the token hasn't been revoked in **Settings → Runners**
- Confirm `--repo` matches either a repository ID or a `owner/repo` full name known to your team

## Links

- **Homepage:** https://lastest.cloud
- **GitHub:** https://github.com/las-team/lastest
- **Issues:** https://github.com/las-team/lastest/issues
- **npm:** https://www.npmjs.com/package/@lastest/runner
- **MCP server:** https://www.npmjs.com/package/@lastest/mcp-server

## License

FSL-1.1-ALv2 — see [LICENSE](./LICENSE).
