# Feature Spec: Early Adopter Mode

## Overview

Team-level feature flag that gates experimental features (Compose, Suites, Compare) behind a toggle in Settings.

## Database
- **Table**: `teams`
- **Column**: `earlyAdopterMode` (boolean, default: `false`)

## Server Action
```typescript
async function updateEarlyAdopterMode(enabled: boolean): Promise<void>
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

### Sidebar Filtering
- **File**: `src/components/layout/sidebar.tsx`
- `EARLY_ADOPTER_ITEMS = new Set(['Compose', 'Suites', 'Compare'])`
- Navigation items in this set are hidden unless `team.earlyAdopterMode === true`
- Non-early-adopter features always visible

## Gated Features
| Feature | Purpose |
|---------|---------|
| Compose | Build composition with test selection per branch |
| Suites | Ordered test suite management |
| Compare | Side-by-side branch comparison |
