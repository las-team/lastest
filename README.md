# Lastest2

Visual regression testing platform built with Next.js 16 App Router.

## Features

- **Record** browser interactions via Playwright → generates test code
- **Run** tests individually or as builds
- **Diff** screenshots against baselines using pixelmatch
- **Review** visual diffs with approval workflow

## Getting Started

```bash
pnpm install
pnpm dev          # Start development server on localhost:3000
```

Open [http://localhost:3000](http://localhost:3000)

## Commands

```bash
pnpm dev          # Start development server
pnpm build        # Production build
pnpm lint         # Run ESLint
pnpm db:studio    # Open Drizzle Studio for database inspection
pnpm db:reset     # Reset database (removes SQLite DB + screenshots/baselines)
pnpm db:push      # Push schema changes to database
pnpm db:generate  # Generate Drizzle migrations
```

## Environment Variables

```
GITHUB_CLIENT_ID      # GitHub OAuth app client ID
GITHUB_CLIENT_SECRET  # GitHub OAuth app secret
```

## Database

SQLite with WAL mode. Database file: `./lastest2.db`

Reset to empty state:
```bash
pnpm db:reset
```
Tables are recreated on next app start.
