<p align="center">
  <h1 align="center">Lastest2</h1>
  <p align="center">
    <strong>Free visual regression testing with AI-generated tests</strong>
  </p>
  <p align="center">
    Record it. Test it. Ship it. — $0 forever.
  </p>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#how-it-works">How It Works</a> •
  <a href="#why-lastest2">Why Lastest2</a> •
  <a href="#commands">Commands</a> •
  <a href="#environment-variables">Config</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License" />
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs Welcome" />
  <img src="https://img.shields.io/badge/self--hosted-yes-green" alt="Self Hosted" />
</p>

---

<!-- TODO: Add demo GIF here -->
<!-- ![Demo](./docs/demo.gif) -->

## The Problem

You ship fast with AI tools. You break things faster.

- Percy costs **$399/mo** for teams
- Chromatic starts at **$149/mo**
- BackstopJS requires manual test writing

Meanwhile, you're a solo founder who just needs to know: **"Did my last commit break the UI?"**

## The Solution

Lastest2 is free, self-hosted visual regression testing that writes tests for you.

```
1. Point it at your app
2. Record your user flows
3. AI generates the test code
4. Screenshots are compared on every run
5. Approve or reject visual changes
```

Your data stays local. Your wallet stays full.

---

## Features

### Core

- **Record Browser Interactions** — Point-and-click test recording via Playwright. No code required.
- **AI Test Generation** — Claude generates robust test code with multi-selector fallback (data-testid → id → role → aria-label → text → css → OCR).
- **Visual Diffing** — Pixel-perfect comparison using pixelmatch. See exactly what changed.
- **Approval Workflow** — Review visual diffs before they become baselines. Catch regressions, approve intentional changes.
- **Git-Aware Builds** — Run tests per branch/commit. Compare across PRs. Track coverage.
- **Test Suites** — Organize tests into ordered suites for structured execution.
- **Test Versioning** — Full version history with change reasons (manual edit, AI fix, AI enhance, restored).

### AI-Powered

- **Multiple AI Providers** — Claude CLI, OpenRouter, Claude Agent SDK, or direct Anthropic API.
- **AI Diff Analysis** — AI-powered visual diff classification with confidence scores.
- **AI Test Fixing** — Automatically fix failing tests or enhance existing ones.
- **Spec-Driven Testing** — Import and generate tests from OpenAPI specs, user stories, or markdown files.
- **Route Discovery** — AI scans your source code to discover routes and suggest tests.
- **MCP Selector Validation** — Real-time selector validation on live pages via Claude MCP.

### Integrations

- **GitHub** — OAuth login, repo sync, PR comments, webhook-triggered builds.
- **GitLab** — OAuth login (self-hosted supported), MR comments, webhook triggers.
- **Google OAuth** — Sign in with Google.
- **Google Sheets** — Use spreadsheet data as test data sources with per-team OAuth and caching.
- **Notifications** — Slack, Discord, custom webhooks, and GitHub/GitLab PR comments for build results.

### Infrastructure

- **Smart Run** — Analyzes git diffs to run only tests affected by your changes.
- **Remote Runners** — Distributed test execution on remote machines with capability tracking.
- **Docker Deployment** — Production-ready multi-stage Docker setup with persistent volumes.
- **VSCode Extension API** — REST + SSE API (`/api/v1/`) for IDE integration.
- **Accessibility Audits** — Automated axe-core checks on every screenshot capture.

### Advanced

- **Ignore Regions** — Mask dynamic areas (timestamps, ads, counters) from diff comparison.
- **Planned Screenshots** — Compare against design files (Figma exports, etc.).
- **Carry-Forward Baselines** — SHA256-based automatic baseline matching across branches.
- **Setup Orchestration** — Repository-default, build-level, and per-test setup scripts with skip/override.
- **Selector Stats** — Track selector success/failure rates for optimization.
- **Diff Sensitivity** — Configurable pixel/percentage thresholds for unchanged/flaky/changed classification.
- **AI Prompt Logs** — Full audit trail of all AI requests and responses.
- **Background Jobs** — Queue tracking for long-running operations (AI scans, builds).

### Team & Auth

- **Multi-Tenant Teams** — Slug-based team workspaces with invitations.
- **Role-Based Access** — Owner, admin, member, viewer roles.
- **Multiple Auth Methods** — Email/password, GitHub OAuth, GitLab OAuth, Google OAuth.

---

## Quick Start

```bash
# Clone
git clone https://github.com/YOUR_USERNAME/lastest2.git
cd lastest2

# Install
pnpm install

# Start
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000)

### Requirements
- Node.js 18+
- pnpm

---

## How It Works

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Record    │ ──▶ │   Test      │ ──▶ │   Review    │
│             │     │             │     │             │
│ Click around│     │ Run tests   │     │ Approve/    │
│ your app    │     │ Get diffs   │     │ Reject      │
└─────────────┘     └─────────────┘     └─────────────┘
        │                  │                   │
        ▼                  ▼                   ▼
   AI generates       Screenshots         New baseline
   test code          compared            saved
```

### Core Flow

1. **Record**: Interact with your app in the browser. Lastest2 captures every click, type, and navigation.

2. **Generate**: AI writes Playwright test code with resilient selectors that survive DOM changes.

3. **Run**: Execute tests locally or on remote runners. Screenshots are captured at key steps.

4. **Compare**: New screenshots are diffed against baselines using pixelmatch. Accessibility audits run automatically.

5. **Review**: Visual diffs are classified (unchanged/flaky/changed). AI can auto-classify with confidence scores. Approve intentional changes.

---

## Why Lastest2

| Feature | Lastest2 | Percy | Chromatic |
|---------|----------|-------|-----------|
| Price | **Free** | $399/mo | $149/mo |
| Self-hosted | Yes | No | No |
| AI test generation | Yes | No | No |
| AI diff analysis | Yes | No | No |
| Data privacy | Local | Cloud | Cloud |
| Open source | Yes | No | No |
| GitHub + GitLab | Yes | Yes | Yes |
| Google Sheets test data | Yes | No | No |
| Smart run (diff-based) | Yes | No | No |
| Accessibility audits | Yes | No | Yes |
| Remote runners | Yes | N/A | N/A |
| Docker deploy | Yes | N/A | N/A |

### Built for Vibe Coders

- **Ship fast**: Record tests in seconds, not hours
- **Stay lean**: $0 visual testing means more runway
- **Own your data**: No vendor lock-in, no cloud uploads
- **AI-native**: Works with your Cursor/Claude/Copilot workflow

---

## Commands

```bash
pnpm dev          # Start development server on localhost:3000
pnpm build        # Production build
pnpm start        # Start production server
pnpm lint         # Run ESLint
pnpm test         # Run unit tests (Vitest)
pnpm test:watch   # Run unit tests in watch mode
pnpm db:studio    # Open Drizzle Studio for database inspection
pnpm db:push      # Push schema changes to database
pnpm db:generate  # Generate Drizzle migrations
pnpm db:reset     # Reset database (removes SQLite DB + screenshots/baselines)
pnpm db:seed      # Seed test data
pnpm test:visual  # Run visual tests via CLI (see below)
```

---

## CLI Test Runner (CI/CD)

Run visual regression tests from the command line for GitHub Actions or other CI pipelines:

```bash
pnpm test:visual --repo-id <id> [options]
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `--repo-id <id>` | Repository ID (required) | - |
| `--base-url <url>` | Override target URL | `http://localhost:3000` |
| `--headless` | Run in headless mode | `true` |
| `--no-headless` | Run with visible browser | - |
| `--output-dir <dir>` | Screenshot output directory | `./test-output` |

### GitHub Actions Example

```yaml
- name: Run Visual Tests
  run: pnpm test:visual --repo-id ${{ env.REPO_ID }} --base-url http://localhost:3000
  env:
    REPO_ID: your-repo-id
```

The runner automatically captures `GITHUB_HEAD_REF`, `GITHUB_REF_NAME`, and `GITHUB_SHA` for git tracking.

---

## Smart Run

Run only tests affected by your code changes:

1. Select a feature branch (not main/master)
2. Lastest2 compares against the default branch via GitHub/GitLab API
3. Tests are matched to changed files by URL patterns and code references
4. Only affected tests run, skipping unchanged areas

This dramatically reduces test time for large suites while maintaining coverage for changed code.

---

## Docker Deployment

Deploy Lastest2 on your home server or any Docker host:

```bash
# Quick start
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

Uses a multi-stage Alpine build (`node:20-alpine`) with health checks via `GET /api/health`.

### Volumes

| Volume | Purpose |
|--------|---------|
| `lastest2-data` | SQLite database |
| `lastest2-screenshots` | Test screenshots |
| `lastest2-baselines` | Approved baselines |

### Environment Variables for Docker

```bash
BETTER_AUTH_SECRET=your-secret-key
GITHUB_CLIENT_ID=your-github-app-id
GITHUB_CLIENT_SECRET=your-github-app-secret
```

A development compose file (`docker-compose.dev.yml`) is also available.

---

## Remote Runners

Run tests on remote machines by deploying runners that connect back to your Lastest2 server via WebSocket.

### Setup

1. **Register a runner** in Settings → Runners
2. **Copy the token** (shown only once)
3. **Install and run** on your target machine

```bash
# From the repo root
cd packages/runner
pnpm install && pnpm build
pnpm link --global

# Start as daemon
lastest2-runner start -t YOUR_TOKEN -s https://your-lastest2-server

# Or run in foreground
lastest2-runner run -t YOUR_TOKEN -s https://your-lastest2-server
```

### Runner CLI

```bash
lastest2-runner start -t <token> -s <server-url>  # Start as background daemon
lastest2-runner stop                               # Stop the daemon
lastest2-runner status                             # Show runner status
lastest2-runner log [-f] [-n <lines>]              # View logs (-f to follow)
lastest2-runner run -t <token> -s <server-url>     # Run in foreground
```

Config stored in `~/.lastest2/` (runner.pid, runner.log, runner.config.json).

---

## Google Sheets Integration

Use spreadsheet data as test data sources:

1. **Connect** your Google account in Settings → Google Sheets
2. **Select spreadsheets** and configure data sources with aliases (e.g., "users", "products")
3. **Reference data** in test code via the cached headers and rows

Supports per-team OAuth, automatic token refresh, custom header row selection, and fixed data ranges.

---

## Custom Webhooks

Send build results to any HTTP endpoint. Configure in Settings → Notifications.

### Payload Format

```json
{
  "event": "build.completed",
  "buildId": "abc123",
  "status": "safe_to_merge | review_required | blocked",
  "totalTests": 10,
  "passedCount": 8,
  "failedCount": 1,
  "changesDetected": 1,
  "flakyCount": 0,
  "gitBranch": "main",
  "gitCommit": "abc123",
  "buildUrl": "https://your-instance/builds/abc123",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

---

## VSCode Extension API

A REST + SSE API is available at `/api/v1/` for IDE integration:

- **Repos** — list, get repositories
- **Functional Areas** — list, create, manage test areas
- **Tests** — CRUD operations, run individual tests
- **Builds** — trigger and monitor builds
- **Runs** — view test run results
- **Events** — SSE stream at `/api/v1/events` for real-time test updates

---

## Settings

All configuration lives under a unified Settings page:

| Section | Description |
|---------|-------------|
| **GitHub** | Connect account, select repositories |
| **GitLab** | Connect account, supports self-hosted instances |
| **Google Sheets** | Connect to Google Drive, manage data sources |
| **Playwright** | Browser type, viewport, headless mode, selector priority, animation freezing |
| **Environment** | Server startup (manual vs auto-start), health check URLs |
| **Diff Sensitivity** | Pixel/percentage thresholds for unchanged/flaky/changed |
| **AI** | Provider selection, API keys, model, custom instructions |
| **Notifications** | Slack, Discord, custom webhook configuration |
| **Branches** | Baseline and scanning branch selection |
| **AI Logs** | Audit trail of all AI requests (last 50 entries) |
| **Setup** | Default repository-wide setup scripts |
| **Users** | Team member management, invitations (admin only) |
| **Runners** | Remote runner registration and management (admin only) |

---

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **UI**: React 19, Radix UI, Tailwind CSS 4
- **Browser Automation**: Playwright
- **Visual Diffing**: pixelmatch
- **Accessibility**: axe-core
- **Database**: SQLite + Drizzle ORM (WAL mode)
- **Auth**: better-auth (email/password, GitHub, GitLab, Google OAuth)
- **AI**: Claude (Agent SDK, CLI, OpenRouter, or direct Anthropic API)
- **OCR Fallback**: Tesseract.js
- **Test Data**: Google Sheets integration
- **Testing**: Vitest (unit), Playwright (visual)
- **State**: TanStack React Query

---

## Environment Variables

```bash
# Session encryption (auto-generated if not set)
BETTER_AUTH_SECRET=

# GitHub OAuth (for repository sync + login)
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_REDIRECT_URI=              # Optional
GITHUB_WEBHOOK_SECRET=            # Optional: verify webhook signatures

# GitLab OAuth (supports self-hosted instances)
GITLAB_CLIENT_ID=
GITLAB_CLIENT_SECRET=
GITLAB_REDIRECT_URI=              # Optional
GITLAB_INSTANCE_URL=              # Default: https://gitlab.com
GITLAB_WEBHOOK_SECRET=            # Optional: verify webhook signatures

# Google OAuth (for login)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=              # Optional

# Google Sheets OAuth (separate scope from login)
GOOGLE_SHEETS_REDIRECT_URI=       # Separate redirect for Sheets OAuth

# Email (optional, for invitations)
RESEND_API_KEY=
EMAIL_FROM=

# Advanced
DATABASE_PATH=                    # Default: ./lastest2.db
MONITORED_BRANCHES=               # Default: main,master,develop
NEXT_PUBLIC_APP_URL=              # Your app's public URL
NEXT_PUBLIC_BASE_URL=             # Base URL for API calls
```

---

## Roadmap

- [x] GitHub Actions integration (CLI runner)
- [x] Slack/Discord notifications
- [x] Team collaboration features
- [x] GitLab integration (OAuth, MR comments, webhooks)
- [x] Docker deployment
- [x] Smart run (git-diff based test selection)
- [x] Custom webhook notifications
- [x] Google OAuth
- [x] Google Sheets test data integration
- [x] AI diff analysis with confidence scoring
- [x] Spec-driven test generation
- [x] Accessibility audits (axe-core)
- [x] VSCode Extension API
- [x] Remote runners with WebSocket
- [x] Test versioning and history
- [x] Planned screenshots (design comparison)
- [x] Ignore regions for dynamic content
- [x] Setup script orchestration
- [ ] Remote runner NPM package publication
- [ ] Production-ready runner infrastructure (Redis queue)

---

## Contributing

PRs welcome! See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

---

## License

MIT

---

<p align="center">
  <sub>Built for solo founders who ship fast and break things (then fix them before users notice).</sub>
</p>
