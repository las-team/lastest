<p align="center">
  <h1 align="center">Lastest</h1>
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
  <a href="#why-lastest">Why Lastest</a> •
  <a href="#comparison">Comparison</a> •
  <a href="#commands">Commands</a> •
  <a href="#environment-variables">Config</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-FSL--1.1--ALv2-blue.svg" alt="License" />
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs Welcome" />
  <img src="https://img.shields.io/badge/self--hosted-yes-green" alt="Self Hosted" />
  <img src="https://img.shields.io/badge/cost-%240%20forever-brightgreen" alt="$0 Forever" />
</p>

---

<p align="center">
  <img src="./docs/demo.gif" alt="Lastest Demo — Record, Test, Diff, Approve" width="720" />
</p>

## The Problem

Visual regression testing is either **expensive**, **flaky**, or **painful to maintain**.

- **Cloud tools**: per-screenshot pricing, cloud-only, no self-hosting
- **Enterprise tools**: steep learning curve, locked to specific frameworks
- **Open-source tools**: free but no dashboard, no collaboration, no AI, or in maintenance mode

Meanwhile, you just need to know: **"Did my last commit break the UI?"**

## The Solution

Lastest is a free, self-hosted visual regression testing platform that **records your tests, writes them with AI, runs them anywhere, and fixes them when they break** — all in one tool.

```
1. Point it at your app
2. Record your user flows (point-and-click, no code)
3. AI generates resilient test code with multi-selector fallback
4. Run locally, on remote runners, or in an embedded browser container
5. Screenshots compared with 3 diff engines (pixelmatch, SSIM, Butteraugli)
6. Review and approve visual changes — or let AI auto-classify them
```

Your data stays on your server. Your screenshots never leave your infra. It costs $0 forever.

---

## Three Ways to Work

Lastest adapts to how you want to build tests — from fully manual to fully autonomous.

### 1. AI-Free (Manual Recording)

Open the recorder, click through your app, hit stop. Lastest captures every interaction and generates deterministic Playwright code — no AI involved, no API keys needed. You own the test code and can edit it by hand.

**Best for:** Teams that don't want AI, air-gapped environments, simple flows.

### 2. AI-Assisted (Human-in-the-Loop)

AI generates, fixes, or enhances tests — but you review and approve before anything is saved. Feed it a URL and get a test back. Import OpenAPI specs or user stories and AI extracts test cases. When a test breaks, AI proposes a fix and you decide whether to accept it.

**Best for:** Day-to-day development, iterating on tests, fixing breakages fast.

### 3. Full Autonomous (Play Agent)

One click kicks off an 11-step pipeline: check settings, select repo, set up environment, scan routes & apply testing template, plan functional areas, review plan, generate tests, run them, fix failures (up to 3 attempts per test), re-run, and report results. Uses specialized sub-agents (Orchestrator, Planner, Scout, Diver, Generator, Healer). The agent pauses and asks for help only when it hits something it can't resolve on its own. You resume and it picks up where it left off.

**Best for:** Onboarding a new project, generating full coverage from scratch, CI bootstrapping.

---

## Three Ways to Run

Once your tests exist, you have three execution modes:

| Mode | How | When |
|------|-----|------|
| **Local** | Playwright runs on the same machine as Lastest | Development, debugging |
| **Remote Runner** | Tests dispatched to remote machines via WebSocket | Distributed execution, different OS/browsers |
| **Embedded Browser** | Browser runs in a container with live streaming back to the UI | Cloud deployments, recording/running without local Playwright |

All three modes support both **running** and **recording** tests. Builds can be triggered **manually** (click Run), by **webhook** (PR opened/updated), on **push** to monitored branches via CI/CD (GitHub Action or CLI runner), or on a **schedule** (cron-based automation). Smart Run analyzes git diffs to run only affected tests.

---

## Build Once, Run Forever — $0

Tests are recorded or generated once, then stored as code. Every subsequent run re-executes the same code, captures new screenshots, and diffs them against approved baselines.

- **First run**: screenshot becomes the baseline
- **Every run after**: new screenshot is SHA256-hashed — if it matches the baseline, instant pass (no pixel comparison needed). If it differs, the diff engine runs and you review the change.
- **AI costs are one-time**: AI is only used during test creation and fixing. Running tests uses zero AI — it's pure Playwright execution.
- **No per-screenshot pricing**: every run is free regardless of volume.

```
Create tests (one-time)          Run tests (forever, $0)
┌──────────────────────┐         ┌──────────────────────┐
│ Manual recording     │         │ Execute Playwright    │
│   — or —             │  ────▶  │ Capture screenshots   │
│ AI generation        │  save   │ Diff against baseline │
│   — or —             │         │ Review changes        │
│ Play Agent autonomy  │         │ Approve/reject        │
└──────────────────────┘         └──────────────────────┘
  AI may be used here              No AI needed here
```

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
- **Scheduled Test Runs** — Cron-based automated builds with preset schedules (daily, weekly, hourly) or custom cron expressions. Auto-disables after consecutive failures. Optional branch targeting.
- **Success Criteria Tab** — Parsed assertion tracking per test: see which `expect()` calls passed/failed with expected vs actual values, error messages, and code line references.
- **WCAG 2.2 AA Compliance Scoring** — Automated 0–100 accessibility score per build with severity-weighted deductions (critical/serious/moderate/minor), trend sparklines across builds, and per-test violation detail.
- **Guided Onboarding** — 8-step setup guide for new users: connect GitHub, configure AI, scan routes, record first test, run, set baselines, re-run, check results. Auto-detects completion.
- **AI Failure Triage** — Automatic classification of test failures into real regression, flaky test, environment issue, or test maintenance — with confidence scores and reasoning.
- **Bug Reports** — In-app bug reporting with auto-captured context (URL, viewport, console errors, failed requests, breadcrumbs), screenshot attachment, and GitHub issue creation.
- **Review Todos** — Branch-specific actionable items created when a reviewer flags a diff. Track review feedback as todos tied to specific builds and tests.

### AI-Powered

- **Multiple AI Providers** — Claude CLI, OpenRouter, Claude Agent SDK, direct Anthropic API, **OpenAI**, or **Ollama** (local models).
- **Separate AI Diff Provider** — Use a different AI provider for diff analysis than test generation.
- **AI Diff Analysis** — AI-powered visual diff classification (insignificant/meaningful/noise) with confidence scores and change categories.
- **AI Test Fixing** — Automatically fix failing tests or enhance existing ones.
- **Spec-Driven Testing** — Import OpenAPI specs, user stories, or markdown files. AI extracts stories and generates tests automatically.
- **Route Discovery** — AI scans your source code to discover routes and suggest tests.
- **MCP Selector Validation** — Real-time selector validation on live pages via Claude MCP.
- **Play Agent (Autonomous)** — One-click 11-step pipeline: check settings → select repo → environment setup → scan & template → plan areas → review → generate tests → run → fix failures (up to 3 attempts) → re-run → summary. Uses specialized sub-agents (Orchestrator, Planner, Scout, Diver, Generator, Healer). Pause/resume, approve plans, skip steps.
- **Agent Monitoring & Activity Feed** — Real-time tracking of Play Agent sessions with step-by-step progress, SSE streaming, and session history. Monitor active/paused/completed agents from the dashboard.
- **Codebase Intelligence** — Automatic detection of project context (framework, CSS framework, auth, state management, API layer, key dependencies) to enrich AI prompts. 100+ package database mapping dependencies to testing recommendations.

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
- **Remote Runners (v2)** — Distributed test execution with concurrent multi-task support, SHA256 code integrity verification, remote recording, DB-backed command queue with result tracking, heartbeat polling, and per-test abort support.
- **Parallel Test Execution** — Configurable max parallel tests for local and remote runners.
- **Embedded Browser** — Containerized Chromium with CDP live streaming back to the UI. Record and run tests without local Playwright. JPEG streaming with configurable quality/framerate, WebSocket auth, concurrent contexts.
- **Docker Deployment** — Production-ready multi-stage Docker setup based on official Playwright image with persistent volumes.
- **MCP Server** — Model Context Protocol server (`@lastest/mcp-server`) exposing 29 tools for AI agent integration: run tests, review diffs, approve baselines, create/heal tests, check coverage. Install via `npx @lastest/mcp-server`.
- **VSCode Extension API** — REST + SSE API (`/api/v1/`) for IDE integration.
- **Accessibility Audits** — Automated axe-core checks on every screenshot capture with WCAG 2.2 AA compliance scoring.
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
git clone https://github.com/las-team/lastest.git
cd lastest
export BETTER_AUTH_SECRET=$(openssl rand -hex 32)
export SYSTEM_EB_TOKEN=$(openssl rand -hex 32)
docker compose up -d --build
```

This spins up three services:
- **lastest** — the Next.js backend on [http://localhost:3000](http://localhost:3000)
- **postgres** — PostgreSQL 17 database
- **embedded-browser** — containerized Chromium with CDP live streaming (ports 9223/9224)

`SYSTEM_EB_TOKEN` is shared between the backend and the embedded browser so the backend trusts the instance. `BETTER_AUTH_SECRET` is required for session signing.

### Option 2: From source

```bash
git clone https://github.com/las-team/lastest.git
cd lastest
docker run -d --name lastest-dev-db -e POSTGRES_USER=lastest -e POSTGRES_PASSWORD=lastest -e POSTGRES_DB=lastest -p 5432:5432 postgres:17-alpine
pnpm install
pnpm db:push
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000)

### First steps

1. Create an account (local, no external auth required)
2. Add a repository and set its local path or connect GitHub/GitLab
3. Click **Record** — interact with your app, Lastest captures everything
4. AI generates test code automatically
5. **Run** the test — screenshots are captured and diffed against baselines
6. **Review** visual changes and approve or reject

### Requirements
- **Docker**: Docker 20+ and Docker Compose
- **From source**: Node.js 18+, pnpm, PostgreSQL 15+

---

## How It Works

```
┌──────────────────┐     ┌─────────────┐     ┌─────────────┐
│   Create Tests   │ ──▶ │   Run       │ ──▶ │   Review    │
│                  │     │             │     │             │
│ Record manually  │     │ Local or    │     │ Approve/    │
│ AI-assisted      │     │ remote or   │     │ Reject      │
│ Play Agent auto  │     │ CI/CD       │     │ changes     │
└──────────────────┘     └─────────────┘     └─────────────┘
   One-time cost           $0 per run         New baseline
   (AI optional)           (no AI needed)     saved
```

### Core Flow

1. **Create**: Build tests your way — record manually in the browser, let AI generate from a URL or spec, or let the Play Agent autonomously scan your entire app.

2. **Run**: Execute tests locally, on remote runners, or in CI/CD. Screenshots are captured at key steps. No AI needed — pure Playwright execution at zero cost.

3. **Compare**: New screenshots are diffed against baselines using your chosen engine (pixelmatch, SSIM, or Butteraugli). Text-region-aware comparison available. Accessibility audits run automatically.

4. **Review**: Visual diffs are classified (unchanged/flaky/changed). AI can optionally auto-classify with confidence scores. Approve intentional changes — they become the new baseline.

5. **Fix**: When tests break, AI can propose fixes (human-in-the-loop) or the Play Agent can fix and re-run autonomously. Or edit the code by hand — your choice.

---

## Why Lastest

<a id="comparison"></a>

### Comparison

| Capability | Lastest | Percy | Applitools | Chromatic | Argos | Meticulous | Playwright |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **Price** | **$0** | Paid | Paid | Paid | Paid | Paid | $0 |
| **Free screenshots** | **Unlimited** | Limited | OSS only | Limited | Limited | None | Unlimited |
| **Self-hosted** | **Yes** | No | Enterprise | No | OSS core | No | Yes |
| **Open source** | **FSL-1.1-ALv2** | SDKs only | SDKs only | Storybook | MIT core | No | Apache-2.0 |
| **No-code recording** | **Yes** | No | Low-code | No | No | Session | Codegen |
| **AI test generation** | **Yes** | No | NLP | No | No | Session-based | No |
| **AI auto-fix tests** | **Yes** | No | No | No | No | Auto-maintain | No |
| **Autonomous agent** | **Yes (Play Agent)** | No | No | No | No | No | No |
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
| **Remote runners** | **Yes (npm package)** | Cloud | Cloud | Cloud | Cloud | Cloud | No |
| **Embedded browser** | **Yes (container + live stream)** | No | No | No | No | No | No |
| **Local AI (Ollama)** | **Yes** | No | No | No | No | No | No |
| **Cross-OS consistency** | **12 stabilization features** | No | No | No | Stabilization engine | No | No |
| **GitHub Action** | **Yes** | Cloud-only | Cloud-only | Cloud-only | Cloud-only | Cloud-only | No |
| **GitLab integration** | **Yes (self-hosted)** | Yes | Yes | No | No | No | No |
| **Test composition** | **Yes** | No | No | No | No | No | No |
| **Testing templates** | **8 presets** | No | No | No | No | No | No |
| **Setup/teardown orchestration** | **Yes** | No | No | No | No | No | No |
| **Branch baseline management** | **Yes** | Yes | Yes | Yes | No | No | No |
| **Scheduled test runs** | **Yes (cron)** | Cloud | Cloud | Cloud | Cloud | Cloud | No |
| **MCP server (AI agent API)** | **Yes (29 tools)** | No | No | No | No | No | No |
| **WCAG compliance scoring** | **Yes (0–100)** | No | No | No | No | No | No |
| **AI failure triage** | **Yes** | No | No | No | No | No | No |
| **Assertion tracking** | **Yes** | No | No | No | No | No | No |
| **Agent monitoring** | **Yes (real-time SSE)** | No | No | No | No | No | No |
| **In-app bug reports** | **Yes (auto-context)** | No | No | No | No | No | No |

### What makes Lastest different

- **Record + AI generate + run + diff + approve** in one self-hosted tool — no competitor does all five
- **Three execution modes**: local, remote runners (`@lastest/runner` on npm), or embedded browser container with live streaming — no local Playwright install needed
- **Autonomous Play Agent**: one-click 11-step pipeline scans routes, generates tests, runs them, fixes failures, and reports results
- **AI auto-fix**: tests break as your UI evolves, Lastest fixes them automatically
- **$0 with unlimited screenshots** — no per-screenshot pricing, no volume limits
- **Your data never leaves your server** — screenshots stay local, no cloud dependency
- **MCP server with 29 tools** — let AI agents (Claude, etc.) run tests, review diffs, and heal failures autonomously
- **Scheduled test runs** — cron-based automation with smart failure handling
- **WCAG 2.2 AA compliance scoring** — automated 0–100 accessibility score per build with trend tracking
- **6 AI providers including OpenAI and Ollama** — run AI completely locally with zero API costs
- **Agent monitoring** — real-time SSE activity feed tracking Play Agent progress step-by-step
- **Codebase intelligence** — auto-detects your stack to generate better, more relevant tests
- **Spec-driven testing** — feed it OpenAPI specs, user stories, or markdown files and get tests back
- **3 diff engines** — pixelmatch, SSIM, and Butteraugli with OCR-based text-region-aware comparison
- **12 stabilization features** — timestamp freezing, random seeding, burst capture, auto-masking, DOM/network stability, and more
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
pnpm db:reset     # Reset database (drops all tables + removes screenshots/baselines)
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

Use the reusable GitHub Action for zero-config CI/CD integration. No local Playwright install needed — tests run on your Lastest server via a remote runner.

```yaml
- name: Run visual regression tests
  uses: las-team/lastest/action@main
  with:
    server-url: ${{ secrets.LASTEST_SERVER_URL }}
    runner-token: ${{ secrets.LASTEST_RUNNER_TOKEN }}
    timeout: '300'
    fail-on-changes: 'false'
```

### Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `server-url` | Lastest server URL | Yes | - |
| `runner-token` | Runner authentication token | Yes | - |
| `timeout` | Build completion timeout (seconds) | No | `300` |
| `fail-on-changes` | Fail when visual changes detected | No | `false` |

### Outputs

| Output | Description |
|--------|-------------|
| `status` | Build status (`passed`, `failed`, `review_required`, `safe_to_merge`, `blocked`) |
| `build-url` | Link to build results in Lastest |
| `changed-count` | Number of visual changes detected |
| `passed-count` | Number of passed tests |
| `failed-count` | Number of failed tests |
| `total-tests` | Total number of tests run |

Results are automatically posted to the GitHub Actions step summary.

---

## Smart Run

Run only tests affected by your code changes:

1. Select a feature branch (not main/master)
2. Lastest compares against the default branch via GitHub/GitLab API
3. Tests are matched to changed files by URL patterns and code references
4. Only affected tests run, skipping unchanged areas

This dramatically reduces test time for large suites while maintaining coverage for changed code.

---

## Docker Deployment

Deploy Lastest on your home server or any Docker host:

```bash
# Quick start (backend + postgres + embedded browser)
docker compose up -d --build

# View logs
docker compose logs -f

# Stop
docker compose down
```

Uses the official Playwright base image (`mcr.microsoft.com/playwright`) with Node.js 20, multi-stage build, and health checks via `GET /api/health`. Runs as non-root user.

### Volumes

| Volume | Purpose |
|--------|---------|
| `lastest-pgdata` | PostgreSQL data |
| `lastest-storage` | Screenshots, baselines, diffs, traces |
| `lastest-claude-auth` | Claude CLI auth state (optional AI features) |

### Environment Variables for Docker

```bash
POSTGRES_PASSWORD=your-secure-password
BETTER_AUTH_SECRET=your-auth-secret          # required
SYSTEM_EB_TOKEN=your-embedded-browser-token  # required for embedded-browser service
GITHUB_CLIENT_ID=your-github-app-id
GITHUB_CLIENT_SECRET=your-github-app-secret
```

A development compose file (`docker-compose.dev.yml`) is also available.

---

## Remote Runners

Run tests on remote machines by deploying runners that connect back to your Lastest server via WebSocket.

### Setup

1. **Register a runner** in Settings → Runners
2. **Copy the token** (shown only once)
3. **Install and run** on your target machine

```bash
# Install from npm
npm install -g @lastest/runner

# Start as daemon
lastest-runner start -t YOUR_TOKEN -s https://your-lastest-server

# Or run in foreground
lastest-runner run -t YOUR_TOKEN -s https://your-lastest-server
```

### Runner CLI

```bash
lastest-runner start -t <token> -s <server-url>  # Start as background daemon
lastest-runner stop                               # Stop the daemon
lastest-runner status                             # Show runner status
lastest-runner log [-f] [-n <lines>]              # View logs (-f to follow)
lastest-runner run -t <token> -s <server-url>     # Run in foreground
```

### Runner Capabilities

- **Run**: Execute tests remotely
- **Record**: Record new tests on remote machines
- **Parallel**: Configurable max parallel tests per runner
- **System Info**: Automatic OS, architecture, memory, and CPU reporting

Config stored in `~/.lastest/` (runner.pid, runner.log, runner.config.json).

---

## MCP Server (AI Agent Integration)

Let AI agents interact with Lastest programmatically via the Model Context Protocol:

```bash
npx @lastest/mcp-server --url http://localhost:3000 --api-key YOUR_API_KEY
```

### Available Tools

| Tool | Description |
|------|-------------|
| `lastest_run_tests` | Trigger a test build. Returns build ID for polling. |
| `lastest_get_build_status` | Get build results: pass/fail counts, visual diffs, overall status. |
| `lastest_list_tests` | List all tests with latest pass/fail status. |
| `lastest_list_failing_tests` | List currently failing tests with error details. |
| `lastest_get_visual_diff` | Get visual diff details with AI classification and confidence. |
| `lastest_approve_baseline` | Approve visual changes (updates baselines). |
| `lastest_reject_baseline` | Reject visual changes (blocks build). |
| `lastest_create_test` | Generate a test via AI from a URL or natural language prompt. |
| `lastest_heal_test` | Auto-fix a failing test using AI healer agent. |
| `lastest_get_coverage` | Get test coverage stats by functional area and route. |

### Typical Agent Workflow

1. `lastest_run_tests` — start a build
2. `lastest_get_build_status` — poll until complete
3. If visual changes: `lastest_get_visual_diff` — inspect diffs
4. `lastest_approve_baseline` or `lastest_reject_baseline` — act on diffs
5. If failures: `lastest_heal_test` — auto-fix, then re-run

Every tool returns structured JSON: `{ status, summary, actionRequired, details }`.

---

## Scheduled Test Runs

Automate test execution with cron-based schedules:

1. Go to **Settings → Schedules**
2. Choose a preset (daily at 3am, weekly on Sunday, every 6 hours, hourly, every 15 minutes) or enter a custom cron expression
3. Optionally target a specific git branch
4. Enable/disable schedules at any time

Schedules auto-disable after 5 consecutive failures. Manual trigger available for testing.

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

## VSCode Extension

A dedicated VS Code extension (`lastest-vscode`) provides full IDE integration:

- **Test Explorer** — Tree view of all tests organized by functional area in the Activity Bar
- **Run Tests** — Run individual tests or all tests directly from VS Code
- **Status Bar** — Live build status and test counts in the VS Code status bar
- **Real-Time Updates** — WebSocket-based live updates for test run progress
- **REST + SSE API** — Backend API at `/api/v1/` powering the extension: repos, functional areas, tests CRUD, builds, runs, and SSE event stream at `/api/v1/events`

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
| **Schedules** | Cron-based automated test runs with presets and custom expressions |
| **Users** | Team member management, invitations (admin only) |
| **Runners** | Remote runner registration and management (admin only) |

---

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **UI**: React 19, Radix UI, Tailwind CSS 4
- **Browser Automation**: Playwright
- **Visual Diffing**: pixelmatch, SSIM, Butteraugli
- **Accessibility**: axe-core
- **Database**: PostgreSQL + Drizzle ORM
- **Auth**: better-auth (email/password with Argon2, GitHub, GitLab, Google OAuth)
- **AI**: Claude (Agent SDK, CLI, OpenRouter, direct Anthropic API), OpenAI, Ollama
- **MCP**: `@lastest/mcp-server` for AI agent integration
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

# Database
DATABASE_URL=                     # Default: postgresql://lastest:lastest@localhost:5432/lastest
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
- [x] Remote runner NPM package (`@lastest/runner` on npm)
- [x] Embedded browser container (live streaming, no local Playwright needed)
- [x] Runner management UI (register, monitor, configure from dashboard)
- [x] Play Agent (autonomous 11-step test generation pipeline with sub-agents)
- [x] Guided onboarding (8-step setup guide with auto-detection)
- [x] MCP server v2 (`@lastest/mcp-server` — 29 tools for AI agent integration)
- [x] AI failure triage (auto-classify failures: regression, flaky, environment, maintenance)
- [x] Scheduled test runs (cron-based automation with preset schedules)
- [x] WCAG 2.2 AA compliance scoring (severity-weighted 0–100 score with trends)
- [x] Success criteria tab (parsed assertion tracking with pass/fail per `expect()`)
- [x] Selector stats & recommendations (auto-suggest enable/disable/reorder)
- [x] Storage state management (browser state persistence for auth flows)
- [x] OpenAI provider (6th AI provider)
- [x] Agent monitoring & activity feed (real-time SSE tracking of Play Agent sessions)
- [x] Codebase intelligence (auto-detect project context for AI prompts)
- [x] Bug reports (in-app reporting with auto-captured context + GitHub issue creation)
- [x] Review todos (branch-specific reviewer feedback tracking)
- [x] GitHub issues integration (cached issues for analytics and bug report linking)
- [x] DB-backed runner commands (persistent command queue replacing in-memory approach)
- [x] Embedded session lifecycle management (claim/release with status tracking)
- [ ] Gamification / "Beat the Bot" (scoring, seasons, leaderboards, Bug Blitz — in progress)


---

## Contributing

PRs welcome! See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

---

## License

FSL-1.1-ALv2 — see [LICENSE](./LICENSE)

---

<p align="center">
  <sub>Built for solo founders who ship fast and break things (then fix them before users notice).</sub>
</p>
