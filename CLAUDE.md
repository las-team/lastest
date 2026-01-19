# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev          # Start development server on localhost:3000
pnpm build        # Production build
pnpm lint         # Run ESLint
```

## Architecture

This is a visual regression testing platform built with Next.js 16 App Router.

### Core Flow
1. **Record**: User records browser interactions via Playwright (`/record`) → generates test code
2. **Test**: Tests are stored in SQLite and can be run individually or as builds
3. **Diff**: Screenshots are compared against baselines using pixelmatch
4. **Review**: Visual diffs require approval before becoming new baselines

### Key Directories

- `src/lib/playwright/` - Browser automation core
  - `recorder.ts` - Captures user interactions, generates Playwright code
  - `runner.ts` - Executes tests, captures screenshots
  - `differ.ts` - Visual comparison with pixelmatch
- `src/lib/db/` - Drizzle ORM schema and queries (SQLite with WAL mode)
- `src/server/actions/` - Server actions for tests, runs, builds, diffs, recording
- `src/components/ui/` - Radix UI + shadcn component library

### Data Model

- **Tests** → belong to FunctionalAreas, have code and path type (happy/unhappy)
- **TestRuns** → grouped executions with git branch/commit
- **Builds** → aggregated runs linked to PRs, have approval status
- **VisualDiffs** → comparison results with approval workflow
- **Baselines** → approved screenshots used for future comparisons

### Environment Variables

```
GITHUB_CLIENT_ID      # GitHub OAuth app client ID
GITHUB_CLIENT_SECRET  # GitHub OAuth app secret
```

Screenshots are stored in `public/screenshots/`, baselines in `public/baselines/`.
