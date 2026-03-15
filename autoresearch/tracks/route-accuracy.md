# Track A: Route Accuracy

## Goal
Ensure generated tests navigate ONLY to routes that exist in the application.

## Current Problem
85% of Play Agent failures are 404s from hallucinated routes. The AI invents URLs that don't exist.

## Scope — What You Can Modify
- `createBranchAwareTestPrompt()` in `src/lib/ai/prompts.ts` — specifically the `availableRoutes` constraint section
- `createTestPrompt()` — the route constraint wording
- Route presentation format in both functions

## Experiments

### A1: Stricter constraint phrasing
Change the available routes section to use FATAL/CRITICAL language:
```
FATAL CONSTRAINT: You MUST ONLY navigate to URLs from this exact list. Navigating to ANY other URL will crash the test and fail the entire suite:
```

### A2: Pre-match routes to ACs
Before presenting routes, add a "best matching route" suggestion:
```
Based on the acceptance criteria, the most likely route is: /settings
Available routes (use ONLY these): [...]
```

### A3: Route descriptions
Instead of bare paths, include descriptions:
```
Available routes:
- / → Dashboard home page
- /settings → Application settings
- /tests → Test list and management
```

### A4: Group routes by functional area
Present routes organized by area to help AI pick the right one:
```
Routes by area:
  Testing: /tests, /run, /record, /review
  Configuration: /settings
  Organization: /suites, /areas
```

### A5: Fallback instruction
Add: "If no route exactly matches the acceptance criteria, use the closest parent route (e.g., /settings instead of /settings/notifications)"

### A6: Route validation reminder
Add at the END of the prompt: "BEFORE writing page.goto(), verify the URL is in the available routes list above."

### A7: Negative examples
Add: "WRONG: page.goto(`${baseUrl}/settings/integrations`) — this route does NOT exist. RIGHT: page.goto(`${baseUrl}/settings`) — this is in the available routes list."

## Metric
- Primary: `route_accuracy` from metrics.ts (target ≥ 0.95)
- Fast eval: `evalRouteAccuracy` — regenerates 404-failed tests, checks if goto URLs match routes table
