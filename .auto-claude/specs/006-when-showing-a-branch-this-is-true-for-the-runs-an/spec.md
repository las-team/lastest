# Specification: Branch View Enhancement with Test Visibility and Timeline Details

## Overview

Enhance the branch visualization across the runs page and compare page to provide a more comprehensive view of test coverage. This feature will ensure uniform header sizing, display ALL available tests for a branch (including non-executed tests with grey icons), and implement an expandable timeline view for tests with multiple steps, assertions, and screenshots.

## Workflow Type

**Type**: feature

**Rationale**: This is a UI enhancement that requires new component development (expandable timeline), data fetching modifications (all tests vs. run tests), and styling changes (header uniformity, grey icons). It's a cohesive feature set that extends existing functionality without fundamentally changing the architecture.

## Task Scope

### Services Involved
- **frontend** (primary) - Next.js app with React components for runs and compare pages
- **database** (integration) - SQLite via Drizzle ORM for test and test result queries

### This Task Will:
- [ ] Standardize header sizes in BranchColumn component to be uniform across views
- [ ] Modify test display logic to show ALL tests for a branch, not just executed ones
- [ ] Add grey icon styling for tests that haven't been executed
- [ ] Implement expandable/collapsible test items for multi-step tests
- [ ] Create timeline-style visualization for test steps, assertions, and screenshots
- [ ] Ensure consistent behavior across both runs and compare pages

### Out of Scope:
- Modifying the actual test execution logic
- Adding new database tables or migrations
- Changing the test recording functionality
- Backend API changes beyond query modifications

## Service Context

### Frontend (Next.js App)

**Tech Stack:**
- Language: TypeScript
- Framework: Next.js 16 (App Router)
- UI Library: React 19
- Component Library: Radix UI + shadcn/ui patterns
- Styling: Tailwind CSS 4
- State Management: React hooks + React Query

**Entry Point:** `src/app/` (App Router pages)

**How to Run:**
```bash
pnpm dev
```

**Port:** 3000

### Database (Drizzle + SQLite)

**Tech Stack:**
- ORM: Drizzle ORM 0.45
- Database: SQLite (better-sqlite3)
- Schema: `src/lib/db/schema.ts`
- Queries: `src/lib/db/queries.ts`

## Files to Modify

| File | Service | What to Change |
|------|---------|---------------|
| `src/app/compare/compare-client.tsx` | frontend | Add all-tests display, expandable timeline, header sizing |
| `src/app/run/run-dashboard-client.tsx` | frontend | Add all-tests display, expandable timeline (if branch view exists) |
| `src/server/actions/compare.ts` | frontend | Extend BranchRunInfo to include all available tests |
| `src/lib/db/queries.ts` | database | Add query to get all tests for a branch/repository |

## Files to Reference

These files show patterns to follow:

| File | Pattern to Copy |
|------|----------------|
| `src/components/test-browser/tree-view.tsx` | Expand/collapse toggle with ChevronRight/ChevronDown icons, StatusIcon component |
| `src/app/tests/[id]/test-detail-client.tsx` | Screenshot Timeline card layout |
| `src/components/layout/header.tsx` | Fixed header height pattern (h-14) |
| `src/lib/db/queries.ts` | Test query patterns with joins |

## Patterns to Follow

### Expand/Collapse Pattern

From `src/components/test-browser/tree-view.tsx`:

```typescript
const [expandedAreas, setExpandedAreas] = useState<Set<string>>(new Set());

const toggleArea = (areaId: string) => {
  const newExpanded = new Set(expandedAreas);
  if (newExpanded.has(areaId)) {
    newExpanded.delete(areaId);
  } else {
    newExpanded.add(areaId);
  }
  setExpandedAreas(newExpanded);
};

// Usage in JSX
<button onClick={() => toggleArea(area.id)}>
  {isExpanded ? (
    <ChevronDown className="h-4 w-4" />
  ) : (
    <ChevronRight className="h-4 w-4" />
  )}
</button>
```

**Key Points:**
- Use `Set` for tracking expanded items
- Toggle function that creates new Set to trigger re-render
- ChevronRight for collapsed, ChevronDown for expanded

### Status Icon Pattern

From `src/components/test-browser/tree-view.tsx`:

```typescript
function StatusIcon({ status }: { status: string | null }) {
  switch (status) {
    case 'passed':
      return <Check className="h-3 w-3 text-green-500" />;
    case 'failed':
      return <X className="h-3 w-3 text-destructive" />;
    case 'running':
      return <Pause className="h-3 w-3 text-yellow-500" />;
    default:
      return <div className="h-3 w-3 rounded-full bg-muted" />;
  }
}
```

**Key Points:**
- Grey/muted icon for non-executed tests (default case)
- Consistent icon sizing (h-3 w-3)
- Use semantic colors (green-500, destructive, yellow-500)

### Card Header Sizing Pattern

From `src/app/compare/compare-client.tsx`:

```typescript
<Card className="flex-1">
  <CardHeader className="pb-3">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <GitBranch className="h-4 w-4" />
        <CardTitle className="text-base">{branch}</CardTitle>
      </div>
    </div>
  </CardHeader>
</Card>
```

**Key Points:**
- Use fixed padding (`pb-3`) for consistent spacing
- Fixed text size (`text-base`) for uniform header appearance
- Consistent min-height may be needed for uniformity

## Requirements

### Functional Requirements

1. **Uniform Header Sizing**
   - Description: Ensure BranchColumn headers are the same height regardless of content
   - Acceptance: Header sections have consistent minimum height, branch name and badge aligned the same way across columns

2. **Display All Tests for Branch**
   - Description: Show all tests available for the repository/branch, not just tests that have results
   - Acceptance: Tests without run results appear in the list with grey icons

3. **Grey Icon for Non-Run Tests**
   - Description: Tests that haven't been executed should display with a grey/muted status icon
   - Acceptance: Non-executed tests show a grey circular icon or similar muted indicator

4. **Expandable Test Details**
   - Description: Clicking a test with multiple steps/assertions/screenshots expands to show details
   - Acceptance: Tests can be clicked to expand, showing steps/assertions/screenshots in chronological order

5. **Timeline Visualization**
   - Description: Expanded test details display in a timeline-style layout showing sequence
   - Acceptance: Steps appear vertically with visual connection, timestamps/order visible

### Edge Cases

1. **Test with no steps/assertions** - Don't show expand toggle, display as simple row
2. **Branch with no tests** - Show "No tests available" message
3. **All tests run** - No grey icons shown, all have pass/fail status
4. **No tests run** - All tests show grey icons
5. **Large number of tests** - Maintain scroll performance, possibly virtualize

## Implementation Notes

### DO
- Follow the expand/collapse pattern in `tree-view.tsx` using Set for tracking
- Reuse the `StatusIcon` component pattern for consistent icon display
- Use Radix Collapsible component if available, otherwise simple conditional rendering
- Keep the CardHeader padding consistent (`pb-3` or similar)
- Add `min-h-[value]` to CardHeader for uniformity across columns
- Query all tests for repository then filter/merge with results

### DON'T
- Create new database tables for this feature
- Modify the test execution flow
- Add complex animations that affect performance
- Break existing test result click-through functionality

## Development Environment

### Start Services

```bash
# Start the development server
pnpm dev
```

### Service URLs
- Frontend: http://localhost:3000
- Compare Page: http://localhost:3000/compare
- Runs Page: http://localhost:3000/run

### Required Environment Variables
- None specific to this feature (uses existing SQLite database)

## Success Criteria

The task is complete when:

1. [ ] BranchColumn headers are visually uniform in height across compare page
2. [ ] All tests for a branch appear in the test list, not just executed ones
3. [ ] Non-executed tests display with grey/muted status icons
4. [ ] Tests can be clicked to expand and show steps/assertions/screenshots
5. [ ] Expanded test details display in a timeline/sequential format
6. [ ] No console errors in browser
7. [ ] Existing tests still pass
8. [ ] Feature works on both runs page (if applicable) and compare page

## QA Acceptance Criteria

**CRITICAL**: These criteria must be verified by the QA Agent before sign-off.

### Unit Tests
| Test | File | What to Verify |
|------|------|----------------|
| StatusIcon renders grey for null status | `src/components/test-browser/tree-view.test.tsx` | Grey icon shown when status is null |
| Expand/collapse state management | `src/app/compare/compare-client.test.tsx` | Set-based expansion tracking works correctly |

### Integration Tests
| Test | Services | What to Verify |
|------|----------|----------------|
| All tests query returns complete list | frontend ↔ database | Query returns all tests regardless of run status |
| BranchRunInfo includes available tests | server actions ↔ queries | Extended interface includes test list |

### End-to-End Tests
| Flow | Steps | Expected Outcome |
|------|-------|------------------|
| View non-run tests | 1. Navigate to /compare 2. Select branch with unrun tests 3. Observe test list | Grey icons visible for non-run tests |
| Expand test details | 1. Navigate to /compare 2. Select branch 3. Click on test with steps | Timeline expands showing steps/screenshots |
| Header uniformity | 1. Navigate to /compare 2. Select two branches 3. Compare headers | Both column headers same height |

### Browser Verification (if frontend)
| Page/Component | URL | Checks |
|----------------|-----|--------|
| Compare Page | `http://localhost:3000/compare` | Branch columns have uniform headers |
| Compare Page | `http://localhost:3000/compare` | All tests visible including non-run |
| Compare Page | `http://localhost:3000/compare` | Tests expand to show timeline |
| Runs Page | `http://localhost:3000/run` | Consistent display if branch view exists |

### Database Verification (if applicable)
| Check | Query/Command | Expected |
|-------|---------------|----------|
| Tests exist for repo | `SELECT * FROM tests WHERE repository_id = ?` | Returns all tests |
| Test results join | `SELECT t.*, tr.status FROM tests t LEFT JOIN test_results tr` | All tests with nullable status |

### QA Sign-off Requirements
- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] All E2E tests pass
- [ ] Browser verification complete (if applicable)
- [ ] Database state verified (if applicable)
- [ ] No regressions in existing functionality
- [ ] Code follows established patterns
- [ ] No security vulnerabilities introduced
