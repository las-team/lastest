# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Critical Rules

- **ALWAYS use `pnpm`** — never `npm` or `npx`
- **NEVER delete `lastest2.db`** without asking the user first (includes `pnpm db:reset`)

## Commands

```bash
pnpm dev                        # Dev server on localhost:3000
pnpm build                      # Production build
pnpm lint                       # ESLint
pnpm test                       # Unit tests (vitest)
pnpm test -- src/lib/diff       # Tests in specific directory
pnpm db:push                    # Push schema changes to DB
pnpm db:studio                  # Drizzle Studio
```

## Architecture

Visual regression testing platform: Next.js 16 App Router, SQLite (Drizzle ORM), Playwright.

**Core flow:** Record browser interactions → Run tests → Diff screenshots (pixelmatch) → Review/approve baselines

**Key paths:**
- `src/lib/db/schema.ts` — all tables (~3800 lines, use offset/limit)
- `src/lib/db/queries.ts` — all queries (~1900 lines, use offset/limit)
- `src/lib/execution/executor.ts` — test executor (~14k lines, use offset/limit)
- `src/lib/playwright/` — recorder, runner, server manager, OCR
- `src/lib/diff/` — pixelmatch diffing + SHA256 baseline hashing
- `src/lib/ai/` — 4 providers: claude-cli, openrouter, claude-agent-sdk, anthropic-direct
- `src/server/actions/` — server actions for all domain ops
- `src/lib/ws/` — WebSocket protocol for remote runners
- `packages/runner/` — remote runner CLI (npm package via tsup)
- `packages/vscode-extension/` — VS Code extension (esbuild)

## Schema Changes

1. Edit `src/lib/db/schema.ts`
2. Update `DEFAULT_*` constants at top of schema for new settings fields
3. Run `pnpm db:push`
4. Update queries in `src/lib/db/queries.ts`

## Conventions

- **UI:** shadcn/ui (New York) + Tailwind CSS v4 (CSS-first, OKLCH colors, `@theme inline` in `globals.css`) + lucide-react icons + sonner toasts
- **Imports:** always `@/` alias, never relative
- **Client components:** named `*-client.tsx`
- **Server actions:** call `revalidatePath()` after mutations; use `requireRepoAccess()` / `requireTeamAccess()` for auth
- **Auth guards:** `requireAuth()`, `requireTeamAccess()`, `requireRepoAccess()`, `requireAdmin()` in `src/lib/auth/`
- **Auth:** Clerk for UI; DB-backed session tokens (`verifyBearerToken()`) for programmatic API access
- **Image processing:** `pngjs` + `pixelmatch` — do NOT use `sharp`
- **Password hashing:** `@node-rs/argon2` (not bcrypt)
- **Settings auto-save:** 500ms debounce — when adding fields, update `originalValues`, `hasChanges`, `doSave`, and `useEffect` deps
- **AI settings:** `getAISettings()` returns `DEFAULT_AI_SETTINGS` when no DB record — all new fields must be in the default
- **Schema types:** use `$inferSelect` / `$inferInsert` patterns
- **Monorepo:** pnpm workspaces, pnpm 10.x

## Gotchas

- `VisualDiffWithTestStatus` type must stay in sync with `getVisualDiffsWithTestStatus` query select
- Pre-existing lint warnings (~119) — new code should pass clean
- `pnpm build` may have a pre-existing type error in `ai-settings-card.tsx` (Ollama fields) — verify errors are from your changes
- Test code signature: `export async function test(page, baseUrl, screenshotPath, stepLogger)` — runner strips TS annotations
- Docker entrypoint runs `drizzle-kit push --force` on startup
