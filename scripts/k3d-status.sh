#!/usr/bin/env bash
# Quick status dump for the local k3d stack.
set -euo pipefail

CLUSTER_NAME="${CLUSTER_NAME:-lastest}"
NAMESPACE="lastest"

echo "=== cluster ==="
if k3d cluster list 2>/dev/null | awk 'NR>1 {print $1}' | grep -qx "${CLUSTER_NAME}"; then
  k3d cluster list | head -1
  k3d cluster list | awk -v n="${CLUSTER_NAME}" '$1==n'
else
  echo "cluster '${CLUSTER_NAME}' not running"
  exit 0
fi

echo ""
echo "=== workloads ==="
kubectl -n "${NAMESPACE}" get deploy,svc -o wide 2>/dev/null

echo ""
echo "=== EB jobs / pods ==="
kubectl -n "${NAMESPACE}" get jobs,pods -l app=lastest-eb 2>/dev/null \
  || echo "(none yet)"

echo ""
echo "=== app readiness ==="
if curl -fsS -o /dev/null -w "  /api/health -> %{http_code} (%{time_total}s)\n" \
     http://localhost:3000/api/health; then :; else
  echo "  app unreachable at http://localhost:3000"
fi
