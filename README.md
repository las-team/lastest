<p align="center">
  <h1 align="center">Lastest2</h1>
  <p align="center">
    <strong>Free, open-source visual regression testing with AI-generated tests</strong>
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
  <a href="#comparison">Comparison</a> •
  <a href="#commands">Commands</a> •
  <a href="#environment-variables">Config</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License" />
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs Welcome" />
  <img src="https://img.shields.io/badge/self--hosted-yes-green" alt="Self Hosted" />
  <img src="https://img.shields.io/badge/cost-%240%20forever-brightgreen" alt="$0 Forever" />
</p>

---

<p align="center">
  <img src="./docs/demo.gif" alt="Lastest2 Demo — Record, Test, Diff, Approve" width="720" />
</p>

## The Problem

Visual regression testing is either **expensive**, **flaky**, or **painful to maintain**.

- Percy: **$199-5,000+/mo** depending on screenshots. Cloud-only
- Applitools: **$699+/mo**. Enterprise pricing, steep learning curve
- Chromatic: **$179+/mo**. Locked to Storybook
- Playwright native: Free, but no dashboard, no collaboration, no AI
- BackstopJS: Free, but maintenance mode and no UI

Meanwhile, you just need to know: **"Did my last commit break the UI?"**

## The Solution

Lastest2 is free, self-hosted visual regression testing that **writes tests for you and fixes them when they break**.

```
1. Point it at your app
2. Record your user flows (point-and-click, no code)
3. AI generates resilient test code
4. Screenshots compared with 3 diff engines (pixelmatch, SSIM, Butteraugli)
5. Approve or reject visual changes in a full review UI
```

Your data stays on your server. Your screenshots never leave your infra. It costs $0 forever.

---

## Features

### Core

- **Record Browser Interactions** — Point-and-click test recording via Playwright with multiple engines (custom recorder or Playwright Inspector). No code required.
- **AI Test Generation** — Claude generates robust test code with multi-selector fallback (data-testid → id → role → aria-label → text → css → OCR).
- **Multi-Engine Visual Diffing** — Three comparison engines: pixelmatch (pixel-perfect), SSIM (structural similarity), and Butteraugli (human-perception-aligned). Choose the best trade-off between speed and accuracy.
- **Multi-Step Screenshots** — Capture multiple labeled screenshots per test run for multi-page flow testing.
- **Approval Workflow** — Review visual diffs before they become baselines. Catch regressions, approve intentional changes.
- **Git-Aware Builds** — Run tests per branch/commit. Compare across PRs. Track coverage.
- **Branch Comparison** — Dedicated compare view for side-by-side branch-to-branch test result diffing.
- **Test Suites** — Organize tests into ordered suites for structured execution.
- **Test Versioning** — Full version history with change reasons (manual edit, AI fix, AI enhance, restored).
- **Test Composition** — Cherry-pick tests and pin specific test versions per build via the Compose page. Override latest with any historical version.
- **Functional Area Hierarchy** — Organize tests into nested parent/child functional areas with drag-and-drop reordering.
- **Debug Mode** — Step-by-step test execution with live feedback for diagnosing failures.
- **Testing Templates** — One-click preset configurations for common app types: SaaS/Dashboard, Marketing Website, Canvas/WebGL, E-commerce, Documentation, Mobile-First, SPA, and CMS.
- **Auto-Detect Capabilities** — Recording automatically detects required browser capabilities (file upload, clipboard, downloads, network interception) and enables corresponding Playwright settings.
- **Early Adopter Mode** — Team-level toggle to access experimental features before general release.

### AI-Powered

- **Multiple AI Providers** — Claude CLI, OpenRouter, Claude Agent SDK, direct Anthropic API, or **Ollama** (local models).
- **Separate AI Diff Provider** — Use a different AI provider for diff analysis than test generation.
- **AI Diff Analysis** — AI-powered visual diff classification (insignificant/meaningful/noise) with confidence scores and change categories.
- **AI Test Fixing** — Automatically fix failing tests or enhance existing ones.
- **Spec-Driven Testing** — Import OpenAPI specs, user stories, or markdown files. AI extracts stories and generates tests automatically.
- **Route Discovery** — AI scans your source code to discover routes and suggest tests.
- **MCP Selector Validation** — Real-time selector validation on live pages via Claude MCP.

### Stabilization & Flaky Test Prevention

- **Text-Region-Aware Diffing** — OCR-based two-pass comparison with separate thresholds for text vs non-text regions. Reduces false positives from dynamic text and cross-OS font rendering.
- **Timestamp Freezing** — Replace `Date.now()` and `new Date()` with fixed values for deterministic screenshots.
- **Random Value Seeding** — Seed `Math.random()` for consistent outputs.
- **Cross-OS Consistency** — Bundled fonts + Chromium flags for identical screenshots across operating systems.
- **Burst Capture** — Multi-frame instability detection: take N screenshots and compare for stability before saving.
- **Auto-Mask Dynamic Content** — Automatically detect and mask timestamps, UUIDs, and relative times before comparison.
- **Network Idle Waiting** — Wait for network activity to settle before capture.
- **DOM Stability Detection** — Wait for DOM mutations to stop before screenshot.
- **Third-Party Blocking** — Block third-party domains with configurable allowlist, mock external images.
- **Font Loading Wait** — Wait for webfonts to load, or disable them entirely.
- **Loading Indicator Hiding** — Auto-hide spinners and loading states with custom selectors.
- **Page Shift Detection** — Detect vertical content shifts (inserted/deleted rows) with fuzzy row matching.

### Integrations

- **GitHub** — OAuth login, repo sync, PR comments, webhook-triggered builds, reusable GitHub Action.
- **GitLab** — OAuth login (self-hosted supported), MR comments, webhook triggers.
- **Google OAuth** — Sign in with Google.
- **Google Sheets** — Use spreadsheet data as test data sources with per-team OAuth, multi-tab support, custom header rows, fixed ranges, and caching.
- **Notifications** — Slack, Discord, custom webhooks, and GitHub/GitLab PR comments for build results.
- **Email** — Team invitation emails via Resend.

### Infrastructure

- **Smart Run** — Analyzes git diffs to run only tests affected by your changes.
- **Remote Runners (v2)** — Distributed test execution with concurrent multi-task support, SHA256 code integrity verification, remote recording, heartbeat polling with command queuing, and per-test abort support.
- **Parallel Test Execution** — Configurable max parallel tests for local and remote runners.
- **Docker Deployment** — Production-ready multi-stage Docker setup based on official Playwright image with persistent volumes.
- **VSCode Extension API** — REST + SSE API (`/api/v1/`) for IDE integration.
- **Accessibility Audits** — Automated axe-core checks on every screenshot capture.
- **Network & Console Tracking** — Capture network requests and browser console errors during test runs.

### Advanced

- **Ignore Regions** — Mask dynamic areas (timestamps, ads, counters) from diff comparison with configurable mask styles (solid-color or placeholder-text).
- **Planned Screenshots** — Compare against design files (Figma exports, etc.) with separate planned vs actual diff tracking.
- **Branch Baseline Management** — Fork baselines per branch, merge back on PR merge, promote test versions across branches. SHA256-based carry-forward matching.
- **Setup & Teardown Orchestration** — Repository-default multi-step setup and teardown sequences, build-level execution, and per-test overrides with skip/add extra steps. Supports Playwright (browser), API (HTTP seeding), and test-as-setup/teardown script types. Teardown errors are non-blocking.
- **App State Inspection** — Access internal app state during tests (`window.__APP_STATE__`, Redux stores, etc.) for complex assertions.
- **Selector Stats** — Track selector success/failure rates and response times for automatic optimization recommendations.
- **Diff Sensitivity** — Configurable pixel/percentage thresholds for unchanged/flaky/changed classification.
- **AI Prompt Logs** — Full audit trail of all AI requests and responses.
- **Background Jobs** — Queue tracking for long-running operations (AI scans, builds).
- **Diff Engine Benchmarks** — Built-in benchmark framework comparing all three diff engines across synthetic test scenarios with timing and accuracy metrics.

### Team & Auth

- **Multi-Tenant Teams** — Slug-based team workspaces with invitations.
- **Role-Based Access** — Owner, admin, member, viewer roles.
- **Multiple Auth Methods** — Email/password (Argon2 hashing), GitHub OAuth, GitLab OAuth, Google OAuth via better-auth.
- **Email Invitations** — Send team invitations via Resend with verification and password reset tokens.

---

## Quick Start

### Option 1: Docker (recommended)

```bash
git clone https://github.com/dexilion-team/lastest2.git
cd lastest2
docker-compose up -d
```

Open [http://localhost:3000](http://localhost:3000) — that's it.

### Option 2: From source

```bash
git clone https://github.com/dexilion-team/lastest2.git
cd lastest2
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000)

### First steps

1. Create an account (local, no external auth required)
2. Add a repository and set its local path or connect GitHub/GitLab
3. Click **Record** — interact with your app, Lastest2 captures everything
4. AI generates test code automatically
5. **Run** the test — screenshots are captured and diffed against baselines
6. **Review** visual changes and approve or reject

### Requirements
- **Docker**: Docker 20+ and Docker Compose
- **From source**: Node.js 18+, pnpm

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

4. **Compare**: New screenshots are diffed against baselines using your chosen engine (pixelmatch, SSIM, or Butteraugli). Text-region-aware comparison available. Accessibility audits run automatically.

5. **Review**: Visual diffs are classified (unchanged/flaky/changed). AI can auto-classify with confidence scores. Approve intentional changes.

---

## Why Lastest2

<a id="comparison"></a>

### Comparison

| Capability | Lastest2 | Percy | Applitools | Chromatic | Argos | Meticulous | Playwright |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **Price** | **$0** | $199+/mo | $699+/mo | $179+/mo | $100+/mo | Custom | $0 |
| **Free screenshots** | **Unlimited** | 5K/mo | OSS only | 5K/mo | 5K/mo | None | Unlimited |
| **Self-hosted** | **Yes** | No | Enterprise | No | OSS core | No | Yes |
| **Open source** | **MIT** | SDKs only | SDKs only | Storybook | MIT core | No | Apache-2.0 |
| **Recording** | **Yes** | No | Low-code | No | No | Session | Codegen |
| **AI test generation** | **Yes** | No | NLP | No | No | Session-based | No |
| **AI auto-fix tests** | **Yes** | No | No | No | No | Auto-maintain | No |
| **AI diff analysis** | **Yes** | AI Review Agent | Visual AI | No | No | Deterministic | No |
| **Multi-engine diffing** | **3 engines** | No | Visual AI | No | No | No | No |
| **Text-region-aware diffing** | **Yes** | No | No | No | No | No | No |
| **Spec-driven test gen** | **Yes** | No | No | No | No | No | No |
| **Approval workflow** | **Yes** | Yes | Yes | Yes | Yes | PR-based | No |
| **Accessibility** | **axe-core** | No | No | Enterprise | ARIA snaps | No | No |
| **Route discovery** | **Yes** | No | No | No | No | No | No |
| **Multi-tenancy** | **Yes** | Projects | Enterprise | Projects | Teams | Projects | No |
| **Figma integration** | **Yes** | No | Yes | No | No | No | No |
| **Google Sheets data** | **Yes** | No | No | No | No | No | No |
| **Debug mode** | **Yes** | No | No | No | Traces | No | Trace |
| **Remote runners** | **Yes** | Cloud | Cloud | Cloud | Cloud | Cloud | No |
| **Local AI (Ollama)** | **Yes** | No | No | No | No | No | No |
| **Cross-OS consistency** | **12 stabilization features** | No | No | No | Stabilization engine | No | No |
| **GitHub Action** | **Yes** | Cloud-only | Cloud-only | Cloud-only | Cloud-only | Cloud-only | No |
| **Test composition** | **Yes** | No | No | No | No | No | No |
| **Testing templates** | **8 presets** | No | No | No | No | No | No |
| **Setup/teardown orchestration** | **Yes** | No | No | No | No | No | No |

### What makes Lastest2 different

- **Record + AI generate + diff + approve** in one self-hosted tool — no competitor does all four
- **AI auto-fix**: tests break as your UI evolves, Lastest2 fixes them automatically
- **$0 with unlimited screenshots** — Percy charges ~$5K/mo for 100K shots
- **Your data never leaves your server** — screenshots stay local, no cloud dependency
- **5 AI providers including Ollama** — run AI locally with zero API costs
- **Spec-driven testing** — feed it OpenAPI specs or user stories, get tests back
- **3 diff engines** — pixelmatch, SSIM, and Butteraugli with text-region-aware comparison
- **Auto-capability detection** — recordings auto-detect clipboard, upload, download, and network needs

---

## Commands

```bash
pnpm dev          # Start development server on localhost:3000
pnpm build        # Production build
pnpm start        # Start production server
pnpm lint         # Run ESLint
pnpm test         # Run unit tests (Vitest)
pnpm test:watch   # Run unit tests in watch mode
pnpm test:coverage # Run tests with coverage report
pnpm test:ui      # Run tests with Vitest UI
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

## GitHub Action

Use the reusable GitHub Action for zero-config CI/CD integration. No local Playwright install needed — tests run on your Lastest2 server via a remote runner.

```yaml
- name: Run visual regression tests
  uses: dexilion-team/lastest2/action@main
  with:
    server-url: ${{ secrets.LASTEST_SERVER_URL }}
    runner-token: ${{ secrets.LASTEST_RUNNER_TOKEN }}
    timeout: '300'
    fail-on-changes: 'false'
```

### Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `server-url` | Lastest2 server URL | Yes | - |
| `runner-token` | Runner authentication token | Yes | - |
| `timeout` | Build completion timeout (seconds) | No | `300` |
| `fail-on-changes` | Fail when visual changes detected | No | `false` |

### Outputs

| Output | Description |
|--------|-------------|
| `status` | Build status (`passed`, `failed`, `review_required`, `safe_to_merge`, `blocked`) |
| `build-url` | Link to build results in Lastest2 |
| `changed-count` | Number of visual changes detected |
| `passed-count` | Number of passed tests |
| `failed-count` | Number of failed tests |
| `total-tests` | Total number of tests run |

Results are automatically posted to the GitHub Actions step summary.

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

Uses the official Playwright base image (`mcr.microsoft.com/playwright`) with Node.js 20, multi-stage build, and health checks via `GET /api/health`. Runs as non-root user.

### Volumes

| Volume | Purpose |
|--------|---------|
| `lastest2-data` | SQLite database |
| `lastest2-screenshots` | Test screenshots |
| `lastest2-baselines` | Approved baselines |

### Environment Variables for Docker

```bash
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
# Install from npm
npm install -g @lastest/runner

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

### Runner Capabilities

- **Run**: Execute tests remotely
- **Record**: Record new tests on remote machines
- **Parallel**: Configurable max parallel tests per runner
- **System Info**: Automatic OS, architecture, memory, and CPU reporting

Config stored in `~/.lastest2/` (runner.pid, runner.log, runner.config.json).

---

## Google Sheets Integration

Use spreadsheet data as test data sources:

1. **Connect** your Google account in Settings → Google Sheets
2. **Select spreadsheets** and configure data sources with aliases (e.g., "users", "products")
3. **Reference data** in test code via the cached headers and rows

Supports per-team OAuth, automatic token refresh, multi-tab spreadsheets, custom header row selection, and fixed data ranges.

---

## Custom Webhooks

Send build results to any HTTP endpoint. Configure in Settings → Notifications. Supports custom HTTP methods and headers.

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
| **Playwright** | Browser type, viewport, headless mode (including shell mode), selector priority, recording engine, animation freezing, screenshot delay, max parallel tests |
| **Stabilization** | Network idle, DOM stability, timestamp freezing, random seeding, third-party blocking, font loading, loading indicator hiding, cross-OS consistency, burst capture, auto-mask dynamic content |
| **Environment** | Server startup (manual vs auto-start), health check URLs |
| **Diff Sensitivity** | Diff engine selection (pixelmatch/SSIM/Butteraugli), text-region-aware diffing, pixel/percentage thresholds, page shift detection |
| **AI** | Test generation provider, diff analysis provider, API keys, model, custom instructions, Ollama support |
| **Notifications** | Slack, Discord, custom webhook configuration |
| **Branches** | Baseline and scanning branch selection |
| **AI Logs** | Audit trail of all AI requests (last 50 entries) |
| **Testing Templates** | One-click preset configurations for SaaS, Marketing, Canvas, E-commerce, Documentation, Mobile-First, SPA, CMS |
| **Setup** | Default repository-wide multi-step setup scripts (Playwright and API types) |
| **Teardown** | Default repository-wide multi-step teardown scripts with per-test overrides |
| **Users** | Team member management, invitations (admin only) |
| **Runners** | Remote runner registration and management (admin only) |

---

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **UI**: React 19, Radix UI, Tailwind CSS 4
- **Browser Automation**: Playwright
- **Visual Diffing**: pixelmatch, SSIM, Butteraugli
- **Accessibility**: axe-core
- **Database**: SQLite + Drizzle ORM (WAL mode)
- **Auth**: better-auth (email/password with Argon2, GitHub, GitLab, Google OAuth)
- **AI**: Claude (Agent SDK, CLI, OpenRouter, direct Anthropic API), Ollama
- **OCR Fallback**: Tesseract.js
- **Test Data**: Google Sheets integration
- **Email**: Resend
- **Testing**: Vitest (unit), Playwright (visual)
- **State**: TanStack React Query

---

## Environment Variables

```bash
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
- [x] Ollama support (local AI models)
- [x] Cross-OS screenshot consistency
- [x] Flaky test prevention (timestamp/random freezing, burst capture)
- [x] Auto-mask dynamic content
- [x] Page shift detection
- [x] Multi-step screenshots
- [x] Debug mode
- [x] Branch comparison view
- [x] App state inspection
- [x] Network & console error tracking
- [x] GitHub Action (reusable composite action)
- [x] Test composition (cherry-pick tests + version overrides)
- [x] Testing templates (8 preset configurations)
- [x] Teardown orchestration (default + per-test overrides)
- [x] Branch baseline management (fork/merge/promote)
- [x] Functional area hierarchy (parent/child organization)
- [x] Multi-engine diffing (SSIM, Butteraugli alongside pixelmatch)
- [x] Text-region-aware diffing (OCR-based)
- [x] Diff engine benchmark framework
- [x] Auto-detect capabilities from recording
- [x] Early adopter mode (experimental feature gating)
- [x] Runner v2 (concurrent execution, code integrity, remote recording)
- [x] better-auth migration (replaced Clerk)
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
