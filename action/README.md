# Lastest Visual Regression Action

Run visual regression tests via Lastest remote runner directly from your GitHub Actions workflow.

## Features

- **Lightweight**: No Playwright browsers needed in CI - tests run on your remote runner
- **Fast setup**: Single action step, no complex configuration
- **Full integration**: Get build status, change count, and direct links to results

## Prerequisites

1. A running Lastest server instance
2. A remote runner configured and connected to your Lastest server
3. Runner token for authentication

## Usage

### Basic Usage

```yaml
- name: Visual Regression Tests
  uses: las-team/lastest@v1
  with:
    server-url: ${{ secrets.LASTEST_SERVER_URL }}
    runner-token: ${{ secrets.LASTEST_RUNNER_TOKEN }}
    repo-id: ${{ vars.LASTEST_REPO_ID }}
    team-id: ${{ vars.LASTEST_TEAM_ID }}
    runner-id: ${{ vars.LASTEST_RUNNER_ID }}
```

### Full Example

```yaml
name: Visual Regression Tests

on:
  pull_request:
    branches: [main]

jobs:
  visual-tests:
    runs-on: ubuntu-latest
    steps:
      - name: Run visual regression tests
        id: visual
        uses: las-team/lastest@v1
        with:
          server-url: ${{ secrets.LASTEST_SERVER_URL }}
          runner-token: ${{ secrets.LASTEST_RUNNER_TOKEN }}
          repo-id: ${{ vars.LASTEST_REPO_ID }}
          team-id: ${{ vars.LASTEST_TEAM_ID }}
          runner-id: ${{ vars.LASTEST_RUNNER_ID }}
          timeout: '300'
          fail-on-changes: 'false'

      - name: Comment on PR
        if: always()
        uses: actions/github-script@v7
        with:
          script: |
            const status = '${{ steps.visual.outputs.status }}';
            const buildUrl = '${{ steps.visual.outputs.build-url }}';
            const changes = '${{ steps.visual.outputs.changed-count }}';
            const passed = '${{ steps.visual.outputs.passed-count }}';
            const failed = '${{ steps.visual.outputs.failed-count }}';

            let emoji = status === 'passed' ? '✅' : status === 'review_required' ? '⚠️' : '❌';

            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: `## ${emoji} Visual Regression Results\n\n` +
                    `**Status:** ${status}\n` +
                    `**Passed:** ${passed} | **Failed:** ${failed} | **Changes:** ${changes}\n\n` +
                    `[View Full Results](${buildUrl})`
            });
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `server-url` | Lastest server URL | Yes | - |
| `runner-token` | Runner authentication token | Yes | - |
| `repo-id` | Repository ID in Lastest | Yes | - |
| `team-id` | Team ID in Lastest | Yes | - |
| `runner-id` | Remote runner ID | Yes | - |
| `timeout` | Build timeout in seconds | No | `300` |
| `fail-on-changes` | Fail when changes detected | No | `false` |

## Outputs

| Output | Description |
|--------|-------------|
| `status` | Build status: `passed`, `failed`, `review_required`, `safe_to_merge`, `blocked` |
| `build-url` | Direct link to build results in Lastest |
| `changed-count` | Number of visual changes detected |
| `passed-count` | Number of passed tests |
| `failed-count` | Number of failed tests |
| `total-tests` | Total number of tests run |

## Exit Codes

- **0**: Tests passed or visual changes need review (configurable)
- **1**: Tests failed or timed out

Set `fail-on-changes: 'true'` to make the action fail when visual changes are detected.

## Setting Up Secrets

1. Go to your repository Settings > Secrets and variables > Actions
2. Add the following secrets:
   - `LASTEST_SERVER_URL`: Your Lastest server URL
   - `LASTEST_RUNNER_TOKEN`: Runner token from Lastest

3. Add the following variables:
   - `LASTEST_REPO_ID`: Repository ID (from Lastest dashboard)
   - `LASTEST_TEAM_ID`: Team ID (from Lastest dashboard)
   - `LASTEST_RUNNER_ID`: Runner ID (from Lastest runners page)

## Architecture

This action dispatches tests to your remote Lastest runner instead of running Playwright locally:

```
GitHub Actions ──> Lastest Server ──> Remote Runner
                         │
                    ┌────┴────┐
                    │ Polling │
                    └────┬────┘
                         │
                    Build Results
```

Benefits:
- No browser installation in CI (~2GB saved)
- Consistent test environment
- Centralized result management
- Parallel test execution on dedicated hardware
