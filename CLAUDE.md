# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## CRITICAL RULES

**ALWAYS use `pnpm` for package management and running scripts.** Never use `npm` or `npx` - this project uses pnpm exclusively.

**NEVER delete the database file (`lastest2.db`) without explicitly asking the user first.** This includes:
- `rm` commands on `.db` files
- `pnpm db:reset`
- Any command that would destroy user data

Always ask for explicit permission before running destructive database operations.

## Commands

```bash
pnpm dev          # Start development server on localhost:3000
pnpm build        # Production build
pnpm lint         # Run ESLint
pnpm test         # Run unit tests (vitest, single run)
pnpm test:watch   # Run unit tests in watch mode
pnpm test -- src/lib/diff  # Run tests in a specific directory
pnpm db:studio    # Open Drizzle Studio for database inspection
pnpm db:reset     # Reset database (removes SQLite DB + screenshots/baselines)
pnpm db:push      # Push schema changes to database
pnpm db:generate  # Generate Drizzle migrations
pnpm start        # Start production server
pnpm test:visual  # Run visual tests via CLI (see below)
```

Database file: `./lastest2.db` (SQLite with WAL mode)

## CLI Test Runner

For CI/CD integration (GitHub Actions, etc.):

```bash
pnpm test:visual --repo-id <id> [--base-url <url>] [--headless] [--output-dir <dir>]
```

- `--repo-id <id>` - Repository ID (required)
- `--base-url <url>` - Target URL (default: `http://localhost:3000`)
- `--no-headless` - Run with visible browser
- `--output-dir <dir>` - Screenshot output (default: `./test-output`)

Auto-captures `GITHUB_HEAD_REF`, `GITHUB_SHA` for git tracking. Exit code 1 on test failures.

## Remote Runner CLI

The `lastest2-runner` CLI manages a remote test execution runner:

```bash
lastest2-runner start -t <token> -s <server-url>  # Start as background daemon
lastest2-runner stop                               # Stop the daemon
lastest2-runner status                             # Show runner status
lastest2-runner log [-f] [-n <lines>]              # View logs (-f to follow)
lastest2-runner run -t <token> -s <server-url>    # Run in foreground
```

Config stored in `~/.lastest2/` (runner.pid, runner.log, runner.config.json).

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
- `src/lib/setup/` - Setup orchestrator for test prerequisites (login flows, API seeding, script execution)
- `src/server/actions/` - Server actions for all domain operations
- `packages/runner/` - Remote test runner CLI (`lastest2-runner`)
- `packages/vscode-extension/` - VS Code extension

### Data Model

**Core Testing:**
- **Repositories** → synced from GitHub, have local paths for route scanning
- **Tests** → belong to FunctionalAreas, have code and target URL
- **TestVersions** → version history with change reasons (manual_edit, ai_fix, ai_enhance, restored)
- **TestRuns** → grouped executions with git branch/commit
- **Builds** → aggregated runs linked to PRs, have approval status
- **VisualDiffs** → comparison results with approval workflow (classification: unchanged/flaky/changed)
- **Baselines** → approved screenshots with SHA256 hash for carry-forward matching
- **Suites** → ordered collections of tests for structured execution

**Configuration:**
- **PlaywrightSettings** → browser, viewport, headless mode, selector priority, animation freezing
- **EnvironmentConfigs** → managed server startup settings (manual vs auto-start)
- **DiffSensitivitySettings** → thresholds for unchanged/flaky classification
- **AISettings** → provider selection (claude-cli, openrouter, claude-agent-sdk, anthropic-direct)
- **NotificationSettings** → Slack/Discord webhooks, GitHub PR comments

**Discovery:**
- **Routes** → discovered routes for test coverage tracking
- **RouteTestSuggestions** → AI-generated test suggestions per route
- **SelectorStats** → success/failure rates per selector for optimization

**Auth & Teams:**
- **Teams** → multi-tenancy with slug-based identification
- **Users** → email/password or OAuth, single team membership, roles (owner/admin/member/viewer)
- **Sessions** → database-backed auth sessions
- **OAuthAccounts** → linked GitHub/Google providers
- **UserInvitations** → team invitations with expiry

**Background:**
- **BackgroundJobs** → queue tracking for long-running operations (AI scans, builds)
- **AIPromptLogs** → audit trail for AI requests/responses

### Test Code Format

Tests use a function signature: `export async function test(page, baseUrl, screenshotPath, stepLogger)`. The runner strips TypeScript annotations and executes as JavaScript. Supports multi-selector fallback strategy based on user-configured priority (data-testid → id → role-name → aria-label → text → css-path → ocr-text).

### Environment Variables

```
GITHUB_CLIENT_ID      # GitHub OAuth app client ID
GITHUB_CLIENT_SECRET  # GitHub OAuth app secret
BETTER_AUTH_SECRET    # Session encryption secret (auto-generated if not set)
```

### Auth System

Uses `better-auth` with database sessions. Supports:
- Email/password registration
- GitHub OAuth
- Team-based multi-tenancy
- Role-based access (owner, admin, member, viewer)

### File Storage

- Screenshots: `public/screenshots/{repositoryId}/`
- Baselines: `public/baselines/`

## Development Patterns

### Schema Changes
1. Edit `src/lib/db/schema.ts`
2. Update default constants (e.g., `DEFAULT_AI_SETTINGS`) at top of schema if adding settings fields
3. Run `pnpm db:push`
4. Update related query functions in `src/lib/db/queries.ts` (select/insert statements)

### Key Conventions
- **UI**: shadcn/ui (New York variant) + Radix primitives + Tailwind CSS + `cn()` from `src/lib/utils.ts`
- **Icons**: lucide-react
- **Toasts**: sonner (bottom-right)
- **Image processing**: `pngjs` + `pixelmatch` — do NOT use `sharp`
- **Imports**: Always use `@/` alias, not relative paths
- **Client components**: Named `*-client.tsx` (e.g., `build-detail-client.tsx`)
- **Server actions**: Must call `revalidatePath()` after mutations; use `requireRepoAccess()` / `requireTeamAccess()` for auth
- **Settings auto-save**: 500ms debounce pattern — when adding fields, update `originalValues`, `hasChanges`, `doSave`, and `useEffect` deps
- **Next.js config**: Standalone output, server actions body limit 10mb, `tesseract.js` as external package

### AI Providers (`src/lib/ai/`)
4 providers: `claude-cli`, `openrouter`, `claude-agent-sdk`, `anthropic-direct`. Settings use upsert pattern — `getAISettings()` returns `DEFAULT_AI_SETTINGS` when no DB record exists, so all new fields must be added to the default.

### Build Polling
`/api/builds/[buildId]/status` → `getBuildSummary()` → `BuildPollingWrapper` → `BuildDetailClient`

### Route Organization
- Auth routes: `src/app/(auth)/` (login, register, invite)
- App routes: `src/app/(app)/` (tests, builds, suites, run, record, settings)

## Gotchas
- `src/lib/db/queries.ts` is 1900+ lines — use offset/limit when reading
- `VisualDiffWithTestStatus` type must stay in sync with `getVisualDiffsWithTestStatus` query select
- Pre-existing lint warnings (~119) — new code should pass clean
- Schema type exports use `$inferSelect` / `$inferInsert` patterns
- `pnpm build` may have a pre-existing type error in `ai-settings-card.tsx` related to Ollama fields — verify errors are from your changes before debugging
