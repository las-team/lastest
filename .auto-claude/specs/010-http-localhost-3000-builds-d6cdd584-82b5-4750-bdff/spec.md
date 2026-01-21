# Specification: Build Detail Page - Clickable Metrics Filter

## Overview

Implement interactive filtering functionality on the build detail page (`/builds/[buildId]`) that allows users to click on the metrics row elements (Tests, Changed, Flaky, Failed) to filter the visual diff list. Currently, the metrics display counts but are not interactive. This feature will enable users to quickly focus on specific categories of test results by clicking on the metric cards.

## Workflow Type

**Type**: feature

**Rationale**: This is a new UI feature that adds interactive filtering capability to an existing page. It requires creating new client-side state management, modifying existing components to accept click handlers, and implementing filter logic to dynamically update the displayed list.

## Task Scope

### Services Involved
- **frontend** (primary) - Next.js 16 App Router application with React 19

### This Task Will:
- [ ] Make the MetricsRow cards clickable with visual feedback (hover/active states)
- [ ] Add filter state management to the build detail page
- [ ] Filter the visual diffs list based on selected metric category
- [ ] Show clear visual indication of active filter
- [ ] Allow clearing filter by clicking the active filter again or clicking "All"

### Out of Scope:
- Server-side filtering (filtering will be client-side on already-loaded data)
- URL persistence of filter state (can be added later)
- Multi-select filtering (single filter at a time)
- Filtering by status icons in the diff list

## Service Context

### Frontend (Next.js Application)

**Tech Stack:**
- Language: TypeScript
- Framework: Next.js 16.1.3 (App Router)
- UI Library: React 19.2.3
- Styling: Tailwind CSS 4
- Component Library: Radix UI primitives
- State Management: React useState (local state)

**Entry Point:** `src/app/builds/[buildId]/page.tsx`

**How to Run:**
```bash
pnpm dev
```

**Port:** 3000

## Files to Modify

| File | Service | What to Change |
|------|---------|---------------|
| `src/components/dashboard/metrics-row.tsx` | frontend | Add onClick handlers, active state styling, cursor pointer |
| `src/app/builds/[buildId]/page.tsx` | frontend | Extract diff list to client component, pass filter state |
| `src/app/builds/[buildId]/build-detail-client.tsx` | frontend | **NEW FILE** - Client component wrapper for filterable diff list |

## Files to Reference

These files show patterns to follow:

| File | Pattern to Copy |
|------|----------------|
| `src/app/builds/[buildId]/build-actions-client.tsx` | Client component pattern with state management |
| `src/components/dashboard/recent-history.tsx` | Client component with prop types |
| `src/components/ui/tabs.tsx` | Active state styling pattern with Radix |
| `src/lib/db/schema.ts` | VisualDiff type definition and DiffStatus type |

## Patterns to Follow

### Client Component Pattern

From `src/app/builds/[buildId]/build-actions-client.tsx`:

```typescript
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface BuildActionsClientProps {
  buildId: string;
  hasPendingDiffs: boolean;
}

export function BuildActionsClient({ buildId, hasPendingDiffs }: BuildActionsClientProps) {
  const router = useRouter();
  const [isApproving, setIsApproving] = useState(false);
  // ...
}
```

**Key Points:**
- Use `'use client'` directive at top
- Define clear interface for props
- Use React hooks for local state
- Keep component focused on single responsibility

### Metrics Card Structure

From `src/components/dashboard/metrics-row.tsx`:

```typescript
const metrics = [
  {
    label: 'Tests',
    value: totalTests,
    icon: FileCheck2,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
  },
  // ...
];
```

**Key Points:**
- Metrics are defined as array for mapping
- Each has label, value, icon, color, and bgColor
- Add `filterKey` property to identify filter type

### Visual Diff Status Types

From `src/lib/db/schema.ts`:

```typescript
export type DiffStatus = 'pending' | 'approved' | 'rejected' | 'auto_approved';
```

**Key Points:**
- Diffs have a `status` field matching DiffStatus type
- Each diff has `pixelDifference` for detecting changes
- Filter categories map to: all, changed (pixelDifference > 0), pending status

## Requirements

### Functional Requirements

1. **Clickable Metrics Cards**
   - Description: Each metric card in the MetricsRow (Tests, Changed, Flaky, Failed) becomes clickable
   - Acceptance: Clicking a card filters the list to show only matching diffs

2. **Active Filter Indication**
   - Description: The currently active filter card shows distinct styling (ring, border, or scale)
   - Acceptance: User can clearly see which filter is active

3. **Filter Clear Mechanism**
   - Description: Clicking the active filter again deselects it (shows all)
   - Acceptance: Toggle behavior works correctly

4. **Correct Filtering Logic**
   - Description: Each filter shows appropriate diffs:
     - Tests: Show all diffs (same as no filter)
     - Changed: Show diffs where `pixelDifference > 0`
     - Failed: Show diffs where `status === 'rejected'`
     - Flaky: Reserved for future (show all for now)
   - Acceptance: Filtered count matches metric card value

### Edge Cases

1. **Empty Filter Results** - Show message "No tests match the current filter" with option to clear
2. **Zero Count Metrics** - Metrics with 0 value should still be clickable but show empty state
3. **Time Metric** - Time metric should NOT be clickable (not a filterable category)

## Implementation Notes

### DO
- Follow the client component pattern from `build-actions-client.tsx`
- Reuse existing `VisualDiff` type from schema
- Add `cursor-pointer` and hover states to clickable metrics
- Use ring or border for active state (consistent with existing UI)
- Keep server component for initial data fetching
- Pass `diffs` array to new client component for filtering

### DON'T
- Don't modify the server-side data fetching logic
- Don't add URL query params (keep it simple for now)
- Don't make the Time metric clickable
- Don't change the sort order logic (keep failed first, then pending)

## Filter Type Mapping

```typescript
type FilterType = 'all' | 'changed' | 'flaky' | 'failed';

const filterDiffs = (diffs: VisualDiff[], filter: FilterType) => {
  switch (filter) {
    case 'all':
      return diffs;
    case 'changed':
      return diffs.filter(d => d.pixelDifference && d.pixelDifference > 0);
    case 'failed':
      return diffs.filter(d => d.status === 'rejected');
    case 'flaky':
      // Future: implement flaky detection
      return diffs;
    default:
      return diffs;
  }
};
```

## Development Environment

### Start Services

```bash
pnpm dev
```

### Service URLs
- Frontend: http://localhost:3000

### Test URL
- Build Detail Page: http://localhost:3000/builds/[buildId]

### Required Environment Variables
- None required for this feature

## Success Criteria

The task is complete when:

1. [ ] Metrics cards (Tests, Changed, Failed) are clickable with visual feedback
2. [ ] Clicking a metric filters the diff list to matching items
3. [ ] Active filter shows clear visual indication (ring/border)
4. [ ] Clicking active filter clears the filter (toggle behavior)
5. [ ] Filter counts match the metric card values
6. [ ] Empty state shown when filter has no results
7. [ ] Time metric is NOT clickable
8. [ ] No console errors
9. [ ] Existing page functionality unchanged (approve all, navigation)

## QA Acceptance Criteria

**CRITICAL**: These criteria must be verified by the QA Agent before sign-off.

### Unit Tests
| Test | File | What to Verify |
|------|------|----------------|
| MetricsRow clickable | `src/components/dashboard/__tests__/metrics-row.test.tsx` | onClick handlers fire with correct filter type |
| Filter logic | `src/app/builds/[buildId]/__tests__/build-detail-client.test.tsx` | Diffs filtered correctly for each filter type |

### Integration Tests
| Test | Services | What to Verify |
|------|----------|----------------|
| Filter state updates | page ↔ metrics-row | Clicking metric updates displayed diffs |

### End-to-End Tests
| Flow | Steps | Expected Outcome |
|------|-------|------------------|
| Filter by Changed | 1. Navigate to build page 2. Click "Changed" metric | Only diffs with pixel changes shown |
| Filter by Failed | 1. Navigate to build page 2. Click "Failed" metric | Only rejected diffs shown |
| Clear Filter | 1. Click "Changed" 2. Click "Changed" again | All diffs shown again |
| Visual Feedback | 1. Hover over metric card | Cursor changes, hover state visible |

### Browser Verification (if frontend)
| Page/Component | URL | Checks |
|----------------|-----|--------|
| Build Detail | `http://localhost:3000/builds/[buildId]` | Metrics clickable, filter works, active state visible |

### Database Verification (if applicable)
| Check | Query/Command | Expected |
|-------|---------------|----------|
| N/A | N/A | No database changes required |

### QA Sign-off Requirements
- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] All E2E tests pass
- [ ] Browser verification complete
- [ ] No regressions in existing functionality
- [ ] Code follows established patterns
- [ ] No security vulnerabilities introduced

## Component Architecture

```
page.tsx (Server Component)
├── BuildSummaryHero
├── MetricsRow (receives onFilterChange, activeFilter)
├── RecentHistory
├── BuildActionsClient
├── Git Info Section
└── BuildDetailClient (NEW - Client Component)
    └── Diff List (filtered based on activeFilter)
```

## Props Interface Updates

### MetricsRow Enhanced Props
```typescript
interface MetricsRowProps {
  totalTests: number;
  changesDetected: number;
  flakyCount: number;
  failedCount: number;
  elapsedMs: number | null;
  // NEW
  activeFilter?: FilterType;
  onFilterChange?: (filter: FilterType) => void;
}
```

### BuildDetailClient Props
```typescript
interface BuildDetailClientProps {
  buildId: string;
  diffs: VisualDiff[];
  metrics: {
    totalTests: number;
    changesDetected: number;
    flakyCount: number;
    failedCount: number;
    elapsedMs: number | null;
  };
  hasPendingDiffs: boolean;
}
```
