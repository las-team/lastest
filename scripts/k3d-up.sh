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
    --port "3001:3000@loadbalancer" \
    --k3s-arg "--disable=traefik@server:*" \
    --volume "${REPO_ROOT}/storage:/host-storage@server:*" \
    --runtime-label "com.docker.compose.project=lastest@server:*" \
    --runtime-label "com.docker.compose.project=lastest@loadbalancer" \
    --wait
fi

kubectl config use-context "k3d-${CLUSTER_NAME}" >/dev/null

# 1b. host.k3d.internal → Docker bridge gateway.
#     k3d's auto-injection is unreliable across versions/host OSes (especially
#     Linux without Docker Desktop). We install a CoreDNS override so pods can
#     always resolve the host (used by DATABASE_URL for the host-side postgres
#     and by any other .env setting that points at host.k3d.internal).
#     Must be a `.server` (own server block) — a `.override` would try to add a
#     second `hosts{}` plugin to the main block, which CoreDNS rejects.
HOST_GATEWAY_IP="$(docker network inspect "k3d-${CLUSTER_NAME}" -f '{{(index .IPAM.Config 0).Gateway}}' 2>/dev/null || true)"
if [ -n "${HOST_GATEWAY_IP}" ]; then
  echo "==> Pinning host.k3d.internal → ${HOST_GATEWAY_IP} in CoreDNS"
  kubectl apply -f - <<YAML >/dev/null
apiVersion: v1
kind: ConfigMap
metadata:
  name: coredns-custom
  namespace: kube-system
data:
  host-k3d-internal.server: |
    host.k3d.internal:53 {
      hosts {
        ${HOST_GATEWAY_IP} host.k3d.internal
      }
    }
YAML
  kubectl -n kube-system rollout restart deploy/coredns >/dev/null 2>&1 || true
  kubectl -n kube-system rollout status deploy/coredns --timeout=60s >/dev/null 2>&1 || true
else
  echo "==> WARN: could not read k3d network gateway — pods may fail to resolve host.k3d.internal"
fi

# 2. Namespace + RBAC + Secrets. Done BEFORE the expensive docker builds so
#    .env.local edits propagate even if a later build step fails.
echo "==> Applying namespace + RBAC"
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/embedded-browser-rbac.yaml

echo "==> Refreshing .k8s-secrets.yaml from .env.local"
bash scripts/_generate-secrets.sh .k8s-secrets.yaml
kubectl apply -f .k8s-secrets.yaml

# 3. Build images (EB first — its Dockerfile copies pre-built dist/)
echo "==> Building @lastest/embedded-browser"
pnpm --filter @lastest/embedded-browser build

echo "==> docker build ${EB_IMAGE}"
docker build \
  --label "com.docker.compose.project=lastest" \
  -t "${EB_IMAGE}" \
  -t "lastest-embedded-browser:latest" \
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
  -t "lastest-app:latest" \
  -f Dockerfile .

# 4. Import into k3d nodes (skips the registry roundtrip).
#    Also import `:latest` tags so host `pnpm dev` (which hardcodes
#    EB_IMAGE=lastest-embedded-browser:latest in .env.local) can launch EB Jobs
#    that reference that stable tag rather than the per-build SHA tag.
echo "==> Importing images into k3d"
k3d image import \
  "${APP_IMAGE}" "${EB_IMAGE}" \
  "lastest-app:latest" "lastest-embedded-browser:latest" \
  -c "${CLUSTER_NAME}"

# 5. Postgres (skip if .env.local points DATABASE_URL at an external DB)
EXTERNAL_DB_URL="$(grep -E '^DATABASE_URL=' .env.local 2>/dev/null | tail -1 | cut -d= -f2- || true)"
if [ -n "${EXTERNAL_DB_URL}" ]; then
  echo "==> External DATABASE_URL detected — skipping in-cluster postgres"
  kubectl -n "${NAMESPACE}" delete deploy postgres --ignore-not-found >/dev/null
  kubectl -n "${NAMESPACE}" delete svc postgres --ignore-not-found >/dev/null
else
  echo "==> Applying postgres"
  kubectl apply -f k8s/postgres.yaml
  kubectl -n "${NAMESPACE}" rollout status deploy/postgres --timeout=120s
fi

# 6. App (with per-build image tags). If the image tag didn't change (no-op
#    build) but secrets did, force a rollout so pods pick up new env.
echo "==> Applying app deployment"
envsubst '${APP_IMAGE} ${EB_IMAGE}' < k8s/app-deployment.yaml | kubectl apply -f -
kubectl -n "${NAMESPACE}" rollout restart deploy/lastest-app >/dev/null 2>&1 || true
bash scripts/_rollout-wait.sh "${NAMESPACE}" lastest-app 600s

# 8. Schema is auto-pushed by the app's docker-entrypoint (drizzle-kit push --force).
#    No manual db:push needed.

cat <<EOF

==> Ready.

  UI:         http://localhost:3001   (k3d loadbalancer → in-cluster app)
              http://localhost:3000   (reserved for \`pnpm dev\` on host)
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
