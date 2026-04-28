#!/usr/bin/env bash
# Tail logs from EB pods in the local k3d cluster.
#   scripts/k3d-logs.sh         -> all EB pods (default)
#   scripts/k3d-logs.sh eb      -> all EB pods (explicit)
set -euo pipefail

TARGET="${1:-eb}"
NAMESPACE="lastest"
KUBECTL="kubectl -n ${NAMESPACE}"

case "$TARGET" in
  eb)
    exec $KUBECTL logs -f -l app=lastest-eb --max-log-requests 10 --tail=100 --prefix
    ;;
  *)
    echo "Usage: $0 [eb]" >&2
    echo "(app and postgres run on the host, not in the cluster)" >&2
    exit 2
    ;;
esac
