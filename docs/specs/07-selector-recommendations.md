# Feature Spec: Selector Recommendation Engine

## Overview

Data-driven optimization system that analyzes selector performance metrics (from `SelectorStats` table) and generates automated recommendations to improve the multi-selector fallback strategy.

## Three Recommendation Types

### DISABLE — Remove underperforming selectors
- **Threshold**: ≥70% failure rate AND ≥3 total attempts
- **Example**: If `css-path` fails 90% across 10 attempts → recommend disable
- **Reason format**: `"90% failure rate (9/10 attempts)"`

### ENABLE — Reactivate disabled selectors
- **Trigger**: ALL currently-enabled selectors have <30% success rate
- **Condition**: Disabled selector must have >50% success rate
- **Logic**: When everything is failing, previously-disabled selectors might be better

### MOVE_UP — Reorder selector priority
- **Threshold**: ≥20 percentage point success rate difference vs higher-priority selector
- **Bonus**: Faster response time strengthens recommendation (not required)
- **Skip**: Already-first selector or those marked for disable

## Constants
```
MIN_ATTEMPTS_FOR_DISABLE = 3
FAILURE_RATE_THRESHOLD = 70%
LOW_SUCCESS_RATE_THRESHOLD = 30%
ENABLE_SUCCESS_RATE_THRESHOLD = 50%
MOVE_UP_SUCCESS_RATE_DIFF = 20%
```

## Input/Output

### Input
```typescript
// User-defined selector priority
SelectorConfig { type, enabled, priority }

// Performance statistics (from DB)
SelectorTypeStats {
  selectorType: string;
  totalAttempts: number;
  totalSuccesses: number;
  totalFailures: number;
  successRate: number;       // 0-100%
  avgResponseTimeMs: number | null;
}
```

### Output
```typescript
Map<SelectorType, SelectorRecommendation> {
  type: 'disable' | 'enable' | 'move_up';
  reason: string;
}
```

## Key Files
| File | Purpose |
|------|---------|
| `src/lib/selector-recommendations.ts` (116 lines) | Recommendation engine |
| `src/lib/db/schema.ts` | `SelectorStats` table, `SelectorConfig` interface |

## Tests
- `src/lib/selector-recommendations.test.ts` — 16 tests: all three recommendation types, threshold edge cases, empty inputs
