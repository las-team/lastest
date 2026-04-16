#!/bin/sh
set -e

# Create storage directories if they don't exist
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

# Persist Claude Code auth across pod restarts (symlink to persistent volume)
if mkdir -p /app/storage/.claude 2>/dev/null; then
  rm -rf /home/nextjs/.claude
  ln -sf /app/storage/.claude /home/nextjs/.claude
fi

echo "Starting Lastest..."
echo "Database: $(echo "${DATABASE_URL:-postgresql://lastest:lastest@localhost:5432/lastest}" | sed 's|://[^:]*:[^@]*@|://***:***@|')"1

# Run database migrations
if [ -f "/app/migrate.js" ]; then
  node /app/migrate.js
elif [ -f "/app/drizzle.config.ts" ]; then
  echo "Running database migrations..."
  ./node_modules/.bin/drizzle-kit push --force 2>&1 || echo "Warning: Migration had issues (app may still work)"
fi

# Execute the main command
exec "$@"
