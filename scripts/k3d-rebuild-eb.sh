#!/usr/bin/env bash
# Rebuild the EB image and point the app at it (via EB_IMAGE env).
# The app pod rolls so that subsequent Jobs reference the new tag.
# Already-running EB pods keep the old image — delete jobs to force rotation.
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

echo "==> kubectl set env EB_IMAGE=${EB_IMAGE}"
kubectl -n "${NAMESPACE}" set env deploy/lastest-app EB_IMAGE="${EB_IMAGE}"
bash scripts/_rollout-wait.sh "${NAMESPACE}" lastest-app 600s

echo ""
echo "==> Done. To force existing EB pods to rotate onto the new image:"
echo "    kubectl -n ${NAMESPACE} delete jobs -l app=lastest-eb"
