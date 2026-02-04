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
  <a href="#documentation">Docs</a>
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

### 🎬 Record Browser Interactions
Point-and-click test recording via Playwright. No code required.

### 🤖 AI Test Generation
Claude generates robust test code with multi-selector fallback (data-testid → id → role → aria-label → text → css → OCR).

### 📸 Visual Diffing
Pixel-perfect comparison using pixelmatch. See exactly what changed.

### ✅ Approval Workflow
Review visual diffs before they become baselines. Catch regressions, approve intentional changes.

### 🔄 Git-Aware Builds
Run tests per branch/commit. Compare across PRs. Track coverage.

### 🏠 100% Self-Hosted
SQLite database, local file storage. No external dependencies. No data leaves your machine.

### 🔔 Notifications
Slack, Discord, custom webhooks, and GitHub/GitLab PR comments for build results.

### 🦊 GitLab Support
Full GitLab integration including OAuth, MR comments, and webhook triggers. Supports self-hosted GitLab instances.

### ⚡ Smart Run
Intelligent test selection that analyzes git diffs to run only tests affected by your changes. Save time on large test suites.

### 🐳 Docker Deployment
Production-ready Docker setup with persistent volumes for easy home server deployment.

### 👥 Team Management
Multi-tenant support with teams, user roles (owner/admin/member/viewer), and invitations.

### 📊 Test Suites
Organize tests into ordered suites for structured execution.

### 🧠 Multiple AI Providers
Choose between Claude CLI, OpenRouter, or Claude Agent SDK for test generation.

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

3. **Run**: Execute tests locally. Screenshots are captured at key steps.

4. **Compare**: New screenshots are diffed against baselines using pixelmatch.

5. **Review**: Visual diffs are classified (unchanged/flaky/changed). Approve intentional changes.

---

## Why Lastest2

| Feature | Lastest2 | Percy | Chromatic |
|---------|----------|-------|-----------|
| Price | **Free** | $399/mo | $149/mo |
| Self-hosted | ✅ | ❌ | ❌ |
| AI test generation | ✅ | ❌ | ❌ |
| Data privacy | ✅ Local | Cloud | Cloud |
| Open source | ✅ | ❌ | ❌ |
| GitHub + GitLab | ✅ | ✅ | ✅ |
| Smart run (diff-based) | ✅ | ❌ | ❌ |
| Docker deploy | ✅ | N/A | N/A |

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
pnpm lint         # Run ESLint
pnpm db:studio    # Open Drizzle Studio for database inspection
pnpm db:reset     # Reset database (removes SQLite DB + screenshots/baselines)
pnpm db:push      # Push schema changes to database
```

---

## CLI Test Runner (CI/CD)

Run visual regression tests directly from the command line for GitHub Actions or other CI pipelines:

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

---

## Remote Agent (Preview)

Run tests on remote machines by deploying agents that connect back to your Lastest2 server.

> ⚠️ **Status**: The agent package exists but is not yet published to NPM. Currently available for local development only.

### Local Development Setup

```bash
# From the repo root, build the runner package
cd packages/runner
pnpm install
pnpm build

# Link globally for local testing
pnpm link --global

# Run the runner
lastest2-runner --token YOUR_TOKEN --server http://localhost:3000
```

### How It Works

1. **Create an agent** in Settings → Agents
2. **Copy the token** (shown only once)
3. **Run the agent** on your target machine
4. **Execute tests** remotely via the web UI

### Current Limitations

- Uses HTTP polling (Next.js doesn't support native WebSocket in App Router)
- In-memory command queue (restart clears pending commands)
- Package not yet published to NPM

### Coming Soon

- [ ] NPM package publication (`npm install -g @lastest2/agent`)
- [ ] Redis-backed command queue for production
- [ ] Agent health monitoring dashboard

---

## Custom Webhooks

Send build results to any HTTP endpoint. Configure in Settings → Notifications.

### Payload Format

```json
{
  "event": "build.completed",
  "buildId": "abc123",
  "status": "safe" | "needs_review" | "blocked",
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

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Browser Automation**: Playwright
- **Visual Diffing**: pixelmatch
- **Database**: SQLite + Drizzle ORM
- **AI**: Claude (via Agent SDK, CLI, or OpenRouter)
- **OCR Fallback**: Tesseract.js

---

## Environment Variables

```bash
# Session encryption (auto-generated if not set)
BETTER_AUTH_SECRET=

# GitHub OAuth (for repository sync + login)
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_WEBHOOK_SECRET=        # Optional: verify webhook signatures

# GitLab OAuth (supports self-hosted instances)
GITLAB_CLIENT_ID=
GITLAB_CLIENT_SECRET=
GITLAB_INSTANCE_URL=          # Default: https://gitlab.com
GITLAB_WEBHOOK_SECRET=        # Optional: verify webhook signatures

# Google OAuth (for login)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Email (optional, for invitations)
RESEND_API_KEY=
EMAIL_FROM=

# Advanced
DATABASE_PATH=                # Default: ./lastest2.db
MONITORED_BRANCHES=           # Default: main,master,develop
NEXT_PUBLIC_APP_URL=          # Your app's public URL
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
- [ ] Remote agent NPM package publication
- [ ] Production-ready agent infrastructure (Redis queue)

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
