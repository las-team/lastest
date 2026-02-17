#!/bin/sh
set -e

# Create data directories if they don't exist
mkdir -p /app/data
mkdir -p /app/public/screenshots
mkdir -p /app/public/baselines

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
  npx drizzle-kit push --force 2>/dev/null || echo "Migration skipped (may already be current)"
fi

# Execute the main command
exec "$@"
