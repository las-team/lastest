# Feature Spec: Early Adopter Mode

## Overview

Team-level feature flag that gates experimental features (Compose, Suites, Compare) behind a toggle in Settings.

## Database

- **Table**: `teams`
- **Column**: `earlyAdopterMode` (boolean, default: `false`)

## Server Action

```typescript
async function updateEarlyAdopterMode(enabled: boolean): Promise<void>;
```

- Requires team access (`requireTeamAccess()`)
- Updates team record
- Revalidates `/settings` and `/` paths

## UI

### Settings Toggle

- **File**: `src/components/settings/early-adopter-toggle.tsx`
- Switch control with optimistic updates
- Toast feedback on success/error
- Located in Settings → Features card

### Server-side Gates

Not every gated feature is a nav item. Server components read
`session.team.earlyAdopterMode` through a small flag module and pass a boolean
down, so the gated code degrades by omission rather than by branching:

- `isInteractivePlaybackEnabled()` (`src/lib/playback/feature-flag.ts`) — the
  spec-28 annotated player. Env override: `INTERACTIVE_PLAYBACK_ENABLED=1`.

### Sidebar Filtering

- **File**: `src/components/layout/sidebar.tsx`
- `EARLY_ADOPTER_ITEMS = new Set(['Compose', 'Suites', 'Compare'])`
- Navigation items in this set are hidden unless `team.earlyAdopterMode === true`
- Non-early-adopter features always visible

## Gated Features

| Feature              | Purpose                                                          |
| -------------------- | ---------------------------------------------------------------- |
| Compose              | Build composition with test selection per branch                  |
| Suites               | Ordered test suite management                                 |
| Compare              | Side-by-side branch comparison                                |
| Interactive playback | Spec-28 annotated player (step scrubber, playback↔evidence sync) |
