# Feature Spec: Docker & CI/CD Changes

## Docker

### Base Image Change
- **Old**: `node:24-slim` (Debian-based)
- **New**: `node:20-alpine` (Alpine-based, smaller) + Playwright image for runtime

### Build Simplification
| Aspect | Old | New |
|--------|-----|-----|
| Build deps | apt-get (python, make, g++) | apk (libc6-compat) |
| Build args | `GIT_HASH`, `GIT_COMMIT_COUNT` | Removed |
| Env vars | `NEXT_PUBLIC_GIT_*` | Removed |
| Playwright symlinks | Complex pnpm linking | Removed |

### Volume Structure
```
Old:                               New:
  /app/storage/screenshots           /app/public/screenshots
  /app/storage/baselines             /app/public/baselines
  /app/storage/diffs                 (removed)
  /app/storage/traces                (removed)
  /app/storage/videos                (removed)
  /app/storage/planned               (removed)
  /app/storage/bug-reports           (removed)
```

### Docker Compose (`docker-compose.yml`)
```yaml
# Old
image: ewyc/lastest:latest
volumes:
  - lastest2-storage:/app/storage

# New
image: lastest2:latest
volumes:
  - lastest2-screenshots:/app/public/screenshots
  - lastest2-baselines:/app/public/baselines
```

### Dev Compose (`docker-compose.dev.yml`)
```yaml
# BETTER_AUTH_SECRET now has default for dev
BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET:-dev-secret-change-in-production}
```

## GitHub Actions (`regression.yml`)

### Old: Remote runner dispatch
```yaml
visual-regression:
  - uses: ./action
    with:
      server-url: ${{ secrets.LASTEST_SERVER_URL }}
      runner-token: ${{ secrets.LASTEST_RUNNER_TOKEN }}
```

### New: Local mode (default)
```yaml
regression:
  - pnpm install --frozen-lockfile
  - pnpm exec playwright install chromium
  - pnpm db:push
  - pnpm build
```

Remote mode available as commented template requiring `repo-id`, `team-id`, `runner-id` inputs.

## GitHub Action (`action/action.yml`)

### New Required Inputs
```yaml
repo-id: Repository ID in Lastest (required)
team-id: Team ID in Lastest (required)
runner-id: Remote runner ID (required)
```

### Removed
- Pre-flight server health checks
- Dynamic repository resolution from `GITHUB_REPOSITORY`
- Verbose HTTP error handling with jq parsing
- Fallback timeout defaults

### Simplified Flow
```bash
Create build (direct IDs, no lookup)
Poll status endpoint
Determine overall status
Output results
```
