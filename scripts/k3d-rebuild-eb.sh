#!/usr/bin/env bash
# Rebuild the EB image and import it into the local k3d cluster.
# The host app reads EB_IMAGE from .env.local (typically the stable
# `lastest-embedded-browser:latest` tag), so importing both the SHA tag and
# `:latest` is enough — already-running EB pods keep the old image, but the
# next Job created by the host provisioner uses the freshly imported one.
# To force existing EB pods to rotate, delete them: `kubectl -n lastest delete jobs -l app=lastest-eb`.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

CLUSTER_NAME="${CLUSTER_NAME:-lastest}"
NAMESPACE="lastest"

SHA="$(git rev-parse --short HEAD 2>/dev/null || echo nogit)-$(date +%s | tail -c 7)"
EB_IMAGE="lastest-embedded-browser:${SHA}"

echo "==> Building @lastest/embedded-browser"
pnpm --filter @lastest/embedded-browser build

echo "==> docker build ${EB_IMAGE}"
docker build \
  --label "com.docker.compose.project=lastest" \
  -t "${EB_IMAGE}" \
  -t "lastest-embedded-browser:latest" \
  -f packages/embedded-browser/Dockerfile .

echo "==> k3d image import"
k3d image import "${EB_IMAGE}" "lastest-embedded-browser:latest" -c "${CLUSTER_NAME}"

echo ""
echo "==> Done. To force existing EB pods to rotate onto the new image:"
echo "    kubectl -n ${NAMESPACE} delete jobs -l app=lastest-eb"
