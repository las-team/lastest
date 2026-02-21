# Feature Spec: Review Todos

## Overview

Per-diff review task tracking linked to builds and branches. Allows reviewers to flag visual diffs as needing follow-up work with structured, actionable items.

## Database: `reviewTodos` Table

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | text PK | UUID | Primary key |
| `repositoryId` | text | required | Repository reference |
| `diffId` | text | required | Visual diff reference |
| `buildId` | text | required | Build reference |
| `testId` | text | required | Test reference |
| `branch` | text | required | Branch where todo was created |
| `description` | text | required | Human-readable action item |
| `status` | text | `'open'` | `'open'` or `'resolved'` |
| `createdBy` | text | nullable | User who created |
| `resolvedBy` | text | nullable | User who resolved |
| `resolvedAt` | text | nullable | Resolution timestamp |
| `createdAt` | text | now | Creation timestamp |

## Query Functions

| Function | Description |
|----------|-------------|
| `getReviewTodo(id)` | Single todo by ID |
| `getReviewTodosByBuild(buildId)` | All todos for a build with joined test/area names |
| `getReviewTodosByBranch(repositoryId, branch)` | All todos for branch with joined metadata |
| `createReviewTodo(data)` | Create review action item |
| `updateReviewTodo(id, data)` | Update status/description |
| `deleteReviewTodo(id)` | Delete todo |

## Integration Points
- Linked to `visualDiffs` table via `diffId`
- Linked to `builds` table via `buildId`
- Linked to `tests` table via `testId`
- Scoped by `branch` for per-branch review workflows

## Key Files
| File | Purpose |
|------|---------|
| `src/lib/db/schema.ts` | Table definition |
| `src/lib/db/queries.ts` | 6 query functions |
