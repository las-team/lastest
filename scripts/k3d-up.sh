#!/usr/bin/env bash
# Bring up the full Lastest dev stack on a local k3d cluster.
#
# Idempotent: re-run after code changes and it will rebuild + roll out.
# Does NOT touch postgres data (emptyDir; wiped only on cluster delete).
#
# Requirements: docker, k3d >=5.6, kubectl, pnpm, openssl, envsubst.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

CLUSTER_NAME="${CLUSTER_NAME:-lastest}"
NAMESPACE="lastest"

# Content-hash tag so every rebuild triggers a rollout.
SHA="$(git rev-parse --short HEAD 2>/dev/null || echo nogit)-$(date +%s | tail -c 7)"
export APP_IMAGE="lastest-app:${SHA}"
export EB_IMAGE="lastest-embedded-browser:${SHA}"

echo "==> Image tag: ${SHA}"

# 1. Cluster
if k3d cluster list 2>/dev/null | awk 'NR>1 {print $1}' | grep -qx "${CLUSTER_NAME}"; then
  echo "==> Cluster '${CLUSTER_NAME}' already exists"
else
  echo "==> Creating cluster '${CLUSTER_NAME}'"
  k3d cluster create "${CLUSTER_NAME}" \
    --agents 0 --servers 1 \
    --port "3000:3000@loadbalancer" \
    --k3s-arg "--disable=traefik@server:*" \
    --runtime-label "com.docker.compose.project=lastest@server:*" \
    --runtime-label "com.docker.compose.project=lastest@loadbalancer" \
    --wait
fi

kubectl config use-context "k3d-${CLUSTER_NAME}" >/dev/null

# 2. Build images (EB first — its Dockerfile copies pre-built dist/)
echo "==> Building @lastest/embedded-browser"
pnpm --filter @lastest/embedded-browser build

echo "==> docker build ${EB_IMAGE}"
docker build \
  --label "com.docker.compose.project=lastest" \
  -t "${EB_IMAGE}" \
  -f packages/embedded-browser/Dockerfile .

echo "==> pnpm build (app)"
pnpm build

echo "==> docker build ${APP_IMAGE}"
GIT_HASH="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
GIT_COMMIT_COUNT="$(git rev-list --count HEAD 2>/dev/null || echo 0)"
docker build \
  --build-arg GIT_HASH="${GIT_HASH}" \
  --build-arg GIT_COMMIT_COUNT="${GIT_COMMIT_COUNT}" \
  --label "com.docker.compose.project=lastest" \
  -t "${APP_IMAGE}" \
  -f Dockerfile .

# 3. Import into k3d nodes (skips the registry roundtrip)
echo "==> Importing images into k3d"
k3d image import "${APP_IMAGE}" "${EB_IMAGE}" -c "${CLUSTER_NAME}"

# 4. Namespace + RBAC
echo "==> Applying namespace + RBAC"
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/embedded-browser-rbac.yaml

# 5. Secrets — always re-merge .env.local so edits propagate. Cluster-owned
#    randoms (POSTGRES_PASSWORD, SYSTEM_EB_TOKEN, BETTER_AUTH_SECRET when
#    absent from .env.local) are preserved across re-runs.
echo "==> Refreshing .k8s-secrets.yaml from .env.local"
bash scripts/_generate-secrets.sh .k8s-secrets.yaml
kubectl apply -f .k8s-secrets.yaml

# 6. Postgres
echo "==> Applying postgres"
kubectl apply -f k8s/postgres.yaml
kubectl -n "${NAMESPACE}" rollout status deploy/postgres --timeout=120s

# 7. App (with per-build image tags)
echo "==> Applying app deployment"
envsubst '${APP_IMAGE} ${EB_IMAGE}' < k8s/app-deployment.yaml | kubectl apply -f -
kubectl -n "${NAMESPACE}" rollout status deploy/lastest-app --timeout=300s

# 8. Schema is auto-pushed by the app's docker-entrypoint (drizzle-kit push --force).
#    No manual db:push needed.

cat <<EOF

==> Ready.

  UI:         http://localhost:3000
  Namespace:  ${NAMESPACE}
  App image:  ${APP_IMAGE}
  EB image:   ${EB_IMAGE}

  Watch EB provisioning:
    kubectl -n ${NAMESPACE} get jobs -w
    kubectl -n ${NAMESPACE} get pods -l app=lastest-eb -w

  Tail EB logs (all pods):
    kubectl -n ${NAMESPACE} logs -l app=lastest-eb -f --max-log-requests 10 --prefix

  Teardown:  scripts/k3d-down.sh
EOF
