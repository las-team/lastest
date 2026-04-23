#!/usr/bin/env bash
# Wait for a Deployment to become Available and, on failure, dump enough
# diagnostics that the next person doesn't debug blind.
#
# Usage: bash scripts/_rollout-wait.sh <namespace> <deployment> [timeout]
# Default timeout: 600s (matches app startupProbe budget).
set -euo pipefail

NS="${1:?namespace required}"
DEPLOY="${2:?deployment required}"
TIMEOUT="${3:-600s}"

if kubectl -n "${NS}" rollout status "deploy/${DEPLOY}" --timeout="${TIMEOUT}"; then
  exit 0
fi

RC=$?
echo ""
echo "==> Rollout FAILED for deploy/${DEPLOY} — dumping diagnostics"
echo ""
echo "---- deployment ----"
kubectl -n "${NS}" describe "deploy/${DEPLOY}" 2>&1 | tail -40 || true
echo ""
echo "---- pods ----"
kubectl -n "${NS}" get pods -l "app=${DEPLOY}" -o wide 2>&1 || true
echo ""
echo "---- pod describe (latest) ----"
POD="$(kubectl -n "${NS}" get pods -l "app=${DEPLOY}" --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1:].metadata.name}' 2>/dev/null || true)"
if [ -n "${POD}" ]; then
  kubectl -n "${NS}" describe "pod/${POD}" 2>&1 | tail -60 || true
  echo ""
  echo "---- pod logs (last 100 lines) ----"
  kubectl -n "${NS}" logs "pod/${POD}" --tail=100 2>&1 || true
  echo ""
  echo "---- previous container logs (if crashed) ----"
  kubectl -n "${NS}" logs "pod/${POD}" --previous --tail=100 2>&1 || true
fi
echo ""
echo "---- recent events ----"
kubectl -n "${NS}" get events --sort-by=.lastTimestamp 2>&1 | tail -30 || true

exit "${RC}"
