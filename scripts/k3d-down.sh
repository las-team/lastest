#!/usr/bin/env bash
# Tear down the local k3d cluster. Keeps .k8s-secrets.yaml by default
# (pass --purge to remove it too).
set -euo pipefail

CLUSTER_NAME="${CLUSTER_NAME:-lastest}"
PURGE=0
for arg in "$@"; do
  case "$arg" in
    --purge) PURGE=1 ;;
    -h|--help)
      echo "Usage: $0 [--purge]"
      echo "  --purge  also delete .k8s-secrets.yaml"
      exit 0
      ;;
  esac
done

if k3d cluster list 2>/dev/null | awk 'NR>1 {print $1}' | grep -qx "${CLUSTER_NAME}"; then
  echo "==> Deleting cluster '${CLUSTER_NAME}'"
  k3d cluster delete "${CLUSTER_NAME}"
else
  echo "==> Cluster '${CLUSTER_NAME}' not found, skipping"
fi

if [ "$PURGE" = 1 ] && [ -f .k8s-secrets.yaml ]; then
  rm -f .k8s-secrets.yaml
  echo "==> Removed .k8s-secrets.yaml"
fi
