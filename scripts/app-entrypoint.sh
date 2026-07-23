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

exec "$@"
