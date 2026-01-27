# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev          # Start development server on localhost:3000
pnpm build        # Production build
pnpm lint         # Run ESLint
pnpm db:studio    # Open Drizzle Studio for database inspection
pnpm db:reset     # Reset database (removes SQLite DB + screenshots/baselines)
pnpm db:push      # Push schema changes to database
pnpm db:generate  # Generate Drizzle migrations
```

Database file: `./lastest2.db` (SQLite with WAL mode)

## Architecture

Visual regression testing platform built with Next.js 16 App Router.

### Core Flow
1. **Record**: User records browser interactions via Playwright (`/record`) → generates test code
2. **Test**: Tests are stored in SQLite and can be run individually or as builds
3. **Diff**: Screenshots are compared against baselines using pixelmatch
4. **Review**: Visual diffs require approval before becoming new baselines

### Key Directories

- `src/lib/playwright/` - Browser automation core
  - `recorder.ts` - Captures user interactions, generates Playwright code with multi-selector fallback
  - `runner.ts` - Executes tests, captures screenshots, manages server lifecycle
  - `server-manager.ts` - Manages target server startup/health checks for test runs
  - `ocr.ts` - Tesseract.js integration for OCR-based selectors
- `src/lib/diff/` - Visual comparison engine
  - `generator.ts` - pixelmatch-based image diffing
  - `hasher.ts` - SHA256 hashing for baseline carry-forward
- `src/lib/db/` - Drizzle ORM schema and queries (SQLite with WAL mode)
- `src/lib/ai/` - AI test generation (Claude CLI, OpenRouter, or Claude Agent SDK)
- `src/lib/scanner/` - Route discovery from source code
- `src/server/actions/` - Server actions for all domain operations

### Data Model

- **Repositories** → synced from GitHub, have local paths for route scanning
- **Tests** → belong to FunctionalAreas, have code and target URL
- **TestRuns** → grouped executions with git branch/commit
- **Builds** → aggregated runs linked to PRs, have approval status
- **VisualDiffs** → comparison results with approval workflow (classification: unchanged/flaky/changed)
- **Baselines** → approved screenshots with SHA256 hash for carry-forward matching
- **Routes** → discovered routes for test coverage tracking
- **EnvironmentConfigs** → managed server startup settings (manual vs auto-start)
- **BackgroundJobs** → queue tracking for long-running operations (AI scans, builds)

### Test Code Format

Tests use a function signature: `export async function test(page, baseUrl, screenshotPath, stepLogger)`. The runner strips TypeScript annotations and executes as JavaScript. Supports multi-selector fallback strategy based on user-configured priority (data-testid → id → role-name → aria-label → text → css-path → ocr-text).

### Environment Variables

```
GITHUB_CLIENT_ID      # GitHub OAuth app client ID
GITHUB_CLIENT_SECRET  # GitHub OAuth app secret
```

### File Storage

- Screenshots: `public/screenshots/{repositoryId}/`
- Baselines: `public/baselines/`
