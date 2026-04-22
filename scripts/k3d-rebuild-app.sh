#!/usr/bin/env bash
# Rebuild + roll out just the app image (no EB rebuild, no cluster changes).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

CLUSTER_NAME="${CLUSTER_NAME:-lastest}"
NAMESPACE="lastest"

SHA="$(git rev-parse --short HEAD 2>/dev/null || echo nogit)-$(date +%s | tail -c 7)"
APP_IMAGE="lastest-app:${SHA}"

echo "==> Building ${APP_IMAGE}"
pnpm build
GIT_HASH="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
GIT_COMMIT_COUNT="$(git rev-list --count HEAD 2>/dev/null || echo 0)"
docker build \
  --build-arg GIT_HASH="${GIT_HASH}" \
  --build-arg GIT_COMMIT_COUNT="${GIT_COMMIT_COUNT}" \
  --label "com.docker.compose.project=lastest" \
  -t "${APP_IMAGE}" \
  -t "lastest-app:latest" \
  -f Dockerfile .

echo "==> k3d image import"
k3d image import "${APP_IMAGE}" "lastest-app:latest" -c "${CLUSTER_NAME}"

# Re-merge .env.local into the secrets so rebuilds pick up edited OAuth /
# BETTER_AUTH_* / Resend keys. Cluster-owned randoms are preserved.
echo "==> Refreshing .k8s-secrets.yaml from .env.local"
bash scripts/_generate-secrets.sh .k8s-secrets.yaml
kubectl apply -f .k8s-secrets.yaml

echo "==> kubectl set image"
kubectl -n "${NAMESPACE}" set image deploy/lastest-app app="${APP_IMAGE}"
kubectl -n "${NAMESPACE}" rollout status deploy/lastest-app --timeout=300s

echo "==> Done: ${APP_IMAGE}"
