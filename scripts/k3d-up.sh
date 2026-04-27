#!/usr/bin/env bash
# Bring up the local k3d cluster used for dynamic Embedded Browser provisioning.
#
# Architecture:
#   - The app runs on the host via `pnpm dev` (NOT inside the cluster).
#   - Postgres runs on the host (e.g. a `docker run` postgres:17-alpine).
#   - This cluster exists only to host short-lived EB Job pods that the host
#     provisioner creates via the host kubeconfig fallback in
#     `src/lib/eb/provisioner.ts:127-168`.
#   - EB pods reach the host app via `host.k3d.internal:3000` (CoreDNS pin
#     installed below).
#
# Idempotent: re-run after EB code changes and it will rebuild + import the
# image. Use `pnpm stack:refresh:eb` for the fast path.
#
# Requirements: docker, k3d >=5.6, kubectl, pnpm, openssl.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

CLUSTER_NAME="${CLUSTER_NAME:-lastest}"
NAMESPACE="lastest"

# Content-hash tag so every rebuild produces a fresh image.
SHA="$(git rev-parse --short HEAD 2>/dev/null || echo nogit)-$(date +%s | tail -c 7)"
export EB_IMAGE="lastest-embedded-browser:${SHA}"

echo "==> EB image tag: ${SHA}"

# 1. Cluster
if k3d cluster list 2>/dev/null | awk 'NR>1 {print $1}' | grep -qx "${CLUSTER_NAME}"; then
  echo "==> Cluster '${CLUSTER_NAME}' already exists"
else
  echo "==> Creating cluster '${CLUSTER_NAME}'"
  k3d cluster create "${CLUSTER_NAME}" \
    --agents 0 --servers 1 \
    --k3s-arg "--disable=traefik@server:*" \
    --volume "${REPO_ROOT}/storage:/host-storage@server:*" \
    --runtime-label "com.docker.compose.project=lastest@server:*" \
    --runtime-label "com.docker.compose.project=lastest@loadbalancer" \
    --wait
fi

kubectl config use-context "k3d-${CLUSTER_NAME}" >/dev/null

# 1b. host.k3d.internal → Docker bridge gateway.
#     k3d's auto-injection is unreliable across versions/host OSes (especially
#     Linux without Docker Desktop). We install a CoreDNS override so EB pods
#     can always resolve the host (used by LASTEST_URL=host.k3d.internal:3000
#     when the host is running `pnpm dev`).
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
  echo "==> WARN: could not read k3d network gateway — EB pods may fail to reach host.k3d.internal"
fi

# 2. Namespace + RBAC. EB Jobs spawned by the host provisioner inherit the
#    default ServiceAccount; the RBAC file is applied for parity with the
#    Olares deployment topology and to keep the namespace shape consistent.
#    No in-cluster Secrets are needed — the host provisioner inlines
#    SYSTEM_EB_TOKEN / LASTEST_URL into each Job's env directly.
echo "==> Applying namespace + RBAC"
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/embedded-browser-rbac.yaml

# 3. Build the EB image
echo "==> Building @lastest/embedded-browser"
pnpm --filter @lastest/embedded-browser build

echo "==> docker build ${EB_IMAGE}"
docker build \
  --label "com.docker.compose.project=lastest" \
  -t "${EB_IMAGE}" \
  -t "lastest-embedded-browser:latest" \
  -f packages/embedded-browser/Dockerfile .

# 4. Import into k3d nodes (skips the registry roundtrip).
#    Both SHA tag and `:latest` are imported — the host provisioner reads
#    EB_IMAGE from .env.local (typically the stable `:latest` tag), so the
#    cluster needs that tag available.
echo "==> Importing EB image into k3d"
k3d image import \
  "${EB_IMAGE}" "lastest-embedded-browser:latest" \
  -c "${CLUSTER_NAME}"

cat <<EOF

==> Ready.

  Host app:   pnpm dev   (Next.js on http://localhost:3000)
  Host db:    docker run postgres:17-alpine on localhost:5432
  Cluster:    k3d-${CLUSTER_NAME} (EB Jobs only)
  Namespace:  ${NAMESPACE}
  EB image:   ${EB_IMAGE}

  Make sure .env.local sets:
    EB_PROVISIONER=kubernetes
    EB_NAMESPACE=${NAMESPACE}
    EB_IMAGE=lastest-embedded-browser:latest
    LASTEST_URL=http://host.k3d.internal:3000

  Watch EB provisioning:
    kubectl -n ${NAMESPACE} get jobs -w
    kubectl -n ${NAMESPACE} get pods -l app=lastest-eb -w

  Tail EB logs (all pods):
    pnpm stack:logs:eb

  Refresh EB image after editing packages/embedded-browser:
    pnpm stack:refresh:eb

  Teardown:  pnpm stack:stop
EOF
