#!/usr/bin/env bash
# Generates .k8s-secrets.yaml at the repo root with random values.
# Also merges OAuth / integration keys from .env.local when present so
# that google/github sign-in, email, and CRM wiring survive fresh clusters.
# Gitignored — safe to persist across cluster recreates.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-${REPO_ROOT}/.k8s-secrets.yaml}"

if [ -f "$OUT" ]; then
  echo "$OUT already exists — leaving it alone. Delete it to regenerate." >&2
  exit 0
fi

BETTER_AUTH_SECRET=$(openssl rand -hex 32)
SYSTEM_EB_TOKEN=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 16)

# Pull optional keys from .env.local. We deliberately skip DATABASE_URL,
# BETTER_AUTH_SECRET, and SYSTEM_EB_TOKEN from .env.local because the k8s
# stack owns those (in-cluster postgres DSN, fresh secrets).
ENV_LOCAL="${REPO_ROOT}/.env.local"
MERGE_KEYS=(
  GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET
  GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET
  BUG_REPORT_GITHUB_TOKEN BUG_REPORT_GITHUB_REPO BUG_REPORT_DISCORD_WEBHOOK_URL
  RESEND_API_KEY EMAIL_FROM
  TWENTY_API_URL TWENTY_API_KEY TWENTY_COMPANY_ID
)
declare -A EXTRA=()
if [ -f "$ENV_LOCAL" ]; then
  # shellcheck disable=SC1090
  set -a; source "$ENV_LOCAL"; set +a
  for k in "${MERGE_KEYS[@]}"; do
    v="${!k:-}"
    [ -n "$v" ] && EXTRA["$k"]="$v"
  done
fi

{
  cat <<EOF
---
apiVersion: v1
kind: Secret
metadata:
  name: postgres-creds
  namespace: lastest
type: Opaque
stringData:
  POSTGRES_USER: lastest
  POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
  POSTGRES_DB: lastest
---
apiVersion: v1
kind: Secret
metadata:
  name: lastest-app-secrets
  namespace: lastest
type: Opaque
stringData:
  BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET}
  SYSTEM_EB_TOKEN: ${SYSTEM_EB_TOKEN}
  DATABASE_URL: postgresql://lastest:${POSTGRES_PASSWORD}@postgres.lastest.svc.cluster.local:5432/lastest
EOF
  for k in "${!EXTRA[@]}"; do
    # stringData values are raw strings; quote to survive special chars.
    printf '  %s: %q\n' "$k" "${EXTRA[$k]}"
  done
} > "$OUT"

chmod 600 "$OUT"
echo "Wrote $OUT"
if [ "${#EXTRA[@]}" -gt 0 ]; then
  echo "Merged ${#EXTRA[@]} keys from .env.local: ${!EXTRA[*]}"
fi
