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
echo "Database: $(echo "${DATABASE_URL:-postgresql://lastest:lastest@localhost:5432/lastest}" | sed 's|://[^:]*:[^@]*@|://***:***@|')"

# Run database migrations
if [ -f "/app/migrate.js" ]; then
  node /app/migrate.js
elif [ -f "/app/drizzle.config.ts" ]; then
  echo "Running database migrations..."
  ./node_modules/.bin/drizzle-kit push --force 2>&1 || echo "Warning: Migration had issues (app may still work)"
fi

# Start the EB pool service as its own process (single-container deployments:
# Zima/self-host). It owns provisioning, pool caps and the EB reapers; the app
# reaches it on loopback :9500 (EB_POOL_SERVICE_URL). On k8s, prefer running
# it as a dedicated single-replica Deployment and set EB_POOL_SERVICE_DISABLED=1
# here so only that Deployment holds Job-create RBAC.
if [ "${EB_POOL_SERVICE_DISABLED:-0}" != "1" ] && [ -f /app/dist-pool/main.mjs ]; then
  echo "Starting EB pool service..."
  node /app/dist-pool/main.mjs &
fi

# Execute the main command
exec "$@"
