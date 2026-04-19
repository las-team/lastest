#!/usr/bin/env bash
# Tail logs from the local k3d stack.
#   scripts/k3d-logs.sh          -> app pod
#   scripts/k3d-logs.sh eb       -> all EB pods
#   scripts/k3d-logs.sh postgres -> postgres pod
#   scripts/k3d-logs.sh all      -> app + EB interleaved
set -euo pipefail

TARGET="${1:-app}"
NAMESPACE="lastest"
KUBECTL="kubectl -n ${NAMESPACE}"

case "$TARGET" in
  app)
    exec $KUBECTL logs -f deploy/lastest-app --tail=100
    ;;
  eb)
    exec $KUBECTL logs -f -l app=lastest-eb --max-log-requests 10 --tail=100 --prefix
    ;;
  postgres|db)
    exec $KUBECTL logs -f deploy/postgres --tail=100
    ;;
  all)
    exec $KUBECTL logs -f -l 'app in (lastest-app,lastest-eb)' --max-log-requests 10 --tail=100 --prefix
    ;;
  *)
    echo "Usage: $0 [app|eb|postgres|all]" >&2
    exit 2
    ;;
esac
