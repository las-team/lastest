#!/bin/sh
# Slim entrypoint for the split-services app image (Dockerfile.app).
#
# Unlike scripts/docker-entrypoint.sh (the single-container root image), this
# does NOT run database migrations or spawn the EB pool service:
#   - migrations run once per deploy as a separate k8s Job (Dockerfile.migrate,
#     k8s/migrate-job.yaml) — never on every app-pod boot.
#   - the pool service is its own Deployment (packages/pool-service/Dockerfile,
#     k8s/pool-service.yaml); this image reaches it over EB_POOL_SERVICE_URL.
#
# Its only job is to ensure the storage tree exists on the mounted volume
# (the build-time mkdir is shadowed once /app/storage is a volume mount) and
# then exec the app.
set -e

mkdir -p \
  /app/storage/screenshots \
  /app/storage/baselines \
  /app/storage/diffs \
  /app/storage/traces \
  /app/storage/videos \
  /app/storage/planned \
  /app/storage/bug-reports

# The Claude Agent SDK keeps its state (credentials cache, session files) under
# $HOME/.claude. Redirect that onto the storage volume so it survives pod
# restarts. Strictly an optimization: with no volume mounted, /app/storage is a
# writable image-layer dir and this still works (state is just ephemeral), and
# the SDK authenticates from ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN rather
# than from anything cached here.
#
# Test writability rather than mkdir's exit status — `mkdir -p` succeeds on an
# existing directory, so a volume carrying a root-owned .claude (PVC created
# without a matching fsGroup) would otherwise leave $HOME/.claude pointing at a
# directory the app user cannot write. Falling back to the untouched home dir
# keeps the SDK working; symlinking to an unwritable target would break it.
if mkdir -p /app/storage/.claude 2>/dev/null && [ -w /app/storage/.claude ]; then
  rm -rf /home/nextjs/.claude
  ln -sf /app/storage/.claude /home/nextjs/.claude
fi

exec "$@"
