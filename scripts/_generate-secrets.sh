#!/usr/bin/env bash
# Generates / refreshes .k8s-secrets.yaml at the repo root.
#
# - Cluster-owned randoms (POSTGRES_PASSWORD, SYSTEM_EB_TOKEN, and
#   BETTER_AUTH_SECRET when not set in .env.local) are generated on first
#   run and PRESERVED across re-runs so sessions / DB auth don't break.
# - Every other key (OAuth, Resend, Twenty, bug-report, BETTER_AUTH_SECRET
#   when it IS set in .env.local) is re-merged from .env.local on every run,
#   so editing .env.local + re-running `pnpm stack` / `pnpm stack:refresh`
#   propagates changes into the cluster.
# - Gitignored. Safe to persist.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-${REPO_ROOT}/.k8s-secrets.yaml}"

# Extract a `  KEY: value` line's value from an existing secrets file.
# Returns empty if the key isn't present.
existing() {
  local key="$1"
  [ -f "$OUT" ] || { echo ""; return; }
  awk -v k="  ${key}:" '$0 ~ "^"k" " { sub("^"k" ", ""); print; exit }' "$OUT"
}

PREV_BETTER_AUTH_SECRET=$(existing BETTER_AUTH_SECRET)
PREV_SYSTEM_EB_TOKEN=$(existing SYSTEM_EB_TOKEN)
PREV_POSTGRES_PASSWORD=$(existing POSTGRES_PASSWORD)

# Pull optional keys from .env.local. DATABASE_URL, when set, overrides the
# in-cluster default so you can point at an external postgres (e.g. a
# host-side container reachable at host.k3d.internal:5432).
ENV_LOCAL="${REPO_ROOT}/.env.local"
MERGE_KEYS=(
  DATABASE_URL
  BETTER_AUTH_SECRET
  BETTER_AUTH_BASE_URL BETTER_AUTH_TRUSTED_ORIGINS
  NEXT_PUBLIC_APP_URL
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

# BETTER_AUTH_SECRET precedence: .env.local > existing file > fresh random.
if [ -n "${EXTRA[BETTER_AUTH_SECRET]:-}" ]; then
  BETTER_AUTH_SECRET="${EXTRA[BETTER_AUTH_SECRET]}"
  unset 'EXTRA[BETTER_AUTH_SECRET]'  # don't also emit it below
elif [ -n "$PREV_BETTER_AUTH_SECRET" ]; then
  BETTER_AUTH_SECRET="$PREV_BETTER_AUTH_SECRET"
else
  BETTER_AUTH_SECRET="$(openssl rand -hex 32)"
fi

# SYSTEM_EB_TOKEN + POSTGRES_PASSWORD: preserve across re-runs, generate on first.
SYSTEM_EB_TOKEN="${PREV_SYSTEM_EB_TOKEN:-$(openssl rand -hex 32)}"
POSTGRES_PASSWORD="${PREV_POSTGRES_PASSWORD:-$(openssl rand -hex 16)}"

# DATABASE_URL precedence: .env.local > in-cluster default.
# localhost/127.0.0.1 in .env.local is rewritten to host.k3d.internal so
# the same URL works for both host-side `pnpm dev` and in-cluster pods.
if [ -n "${EXTRA[DATABASE_URL]:-}" ]; then
  DATABASE_URL="${EXTRA[DATABASE_URL]}"
  DATABASE_URL="${DATABASE_URL//@localhost:/@host.k3d.internal:}"
  DATABASE_URL="${DATABASE_URL//@127.0.0.1:/@host.k3d.internal:}"
  unset 'EXTRA[DATABASE_URL]'  # don't emit it twice
else
  DATABASE_URL="postgresql://lastest:${POSTGRES_PASSWORD}@postgres.lastest.svc.cluster.local:5432/lastest"
fi

TMP="${OUT}.tmp"
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
  DATABASE_URL: ${DATABASE_URL}
EOF
  for k in "${!EXTRA[@]}"; do
    # stringData values are raw strings; %q survives special chars.
    printf '  %s: %q\n' "$k" "${EXTRA[$k]}"
  done
} > "$TMP"

mv "$TMP" "$OUT"
chmod 600 "$OUT"

if [ -n "$PREV_POSTGRES_PASSWORD" ]; then
  echo "Refreshed $OUT (preserved cluster-owned randoms)"
else
  echo "Wrote $OUT"
fi
if [ "${#EXTRA[@]}" -gt 0 ]; then
  echo "Merged ${#EXTRA[@]} keys from .env.local: ${!EXTRA[*]}"
fi
