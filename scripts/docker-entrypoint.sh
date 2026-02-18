#!/bin/sh
set -e

# Create data directories if they don't exist
mkdir -p /app/data
mkdir -p /app/storage/screenshots
mkdir -p /app/storage/baselines
mkdir -p /app/storage/diffs
mkdir -p /app/storage/traces
mkdir -p /app/storage/videos
mkdir -p /app/storage/planned
mkdir -p /app/storage/bug-reports

# Migrate files from old public/ layout to storage/ (idempotent)
for subdir in screenshots baselines diffs traces videos planned bug-reports; do
  src="/app/public/${subdir}"
  dst="/app/storage/${subdir}"
  if [ -d "$src" ] && [ "$(ls -A "$src" 2>/dev/null)" ]; then
    if [ ! "$(ls -A "$dst" 2>/dev/null)" ]; then
      echo "Migrating $src -> $dst ..."
      cp -a "$src"/. "$dst"/
      echo "Migration complete for $subdir"
    fi
  fi
done

# Database will be auto-initialized by Drizzle on first connection
# The app handles schema setup via drizzle-orm

echo "Starting Lastest2..."
echo "Database path: ${DATABASE_PATH:-/app/data/lastest2.db}"

# Check data directory is writable (volume mounts may have wrong ownership)
if ! touch /app/data/.write-test 2>/dev/null; then
  echo "ERROR: /app/data is not writable by user $(id -u). Fix with: docker exec -u 0 <container> chown -R $(id -u):$(id -g) /app/data"
  exit 1
fi
rm -f /app/data/.write-test

# Run database migrations if drizzle-kit is available
if [ -f "/app/drizzle.config.ts" ]; then
  echo "Running database migrations..."
  ./node_modules/.bin/drizzle-kit push --force 2>/dev/null || echo "Migration skipped (may already be current)"
fi

# Execute the main command
exec "$@"
