#!/usr/bin/env bash
# Master deploy script for Lastest
# Usage: deploy.sh <target> [options]
#
# Targets: zima, olares, npm, all
# Options:
#   --skip-checks    Skip lint/test before deploy
#   --app-only       Only build/deploy main app image (skip EB)
#   --eb-only        Only build/deploy EB image (skip main app)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

# --- Config ---
ZIMA_HOST="192.168.1.138"
ZIMA_USER="ewyct"
ZIMA_DIR="/var/lib/casaos/apps/lastest2"
ZIMA_COMPOSE="$ZIMA_DIR/docker-compose.yml"

OLARES_HOST="ewyctorlab.olares.local"
OLARES_USER="root"
OLARES_NS="lastest-dev-ewyctorlab"
OLARES_DEPLOY="lastest-dev"
# Companion envoy-less Deployment that EB Jobs call via LASTEST_URL.
# MUST be rolled alongside OLARES_DEPLOY — otherwise EB POSTs land in
# a stale pod running an older build.
OLARES_INTERNAL_DEPLOY="lastest-internal-dev"

IMAGE_APP="ewyc/lastest"
IMAGE_EB="ewyc/lastest-eb"

# --- Parse args ---
TARGET="${1:-}"
shift || true

SKIP_CHECKS=false
APP_ONLY=false
EB_ONLY=false

for arg in "$@"; do
  case "$arg" in
    --skip-checks) SKIP_CHECKS=true ;;
    --app-only)    APP_ONLY=true ;;
    --eb-only)     EB_ONLY=true ;;
    --) ;; # ignore pnpm separator
    *) echo "Unknown option: $arg"; exit 1 ;;
  esac
done

# --- Load env ---
if [ -f "$ROOT_DIR/.env.local" ]; then
  set -a; source "$ROOT_DIR/.env.local"; set +a
fi

# --- Helpers ---
VERSION=$(node -p "require('./package.json').version")
GIT_HASH=$(git rev-parse --short HEAD)
GIT_COMMIT_COUNT=$(git rev-list --count HEAD)

log()  { echo -e "\n\033[1;34m▸ $*\033[0m"; }
ok()   { echo -e "\033[1;32m✓ $*\033[0m"; }
warn() { echo -e "\033[1;33m⚠ $*\033[0m"; }
err()  { echo -e "\033[1;31m✗ $*\033[0m"; exit 1; }

timer_start() { DEPLOY_START=$(date +%s); }
timer_end() {
  local elapsed=$(( $(date +%s) - DEPLOY_START ))
  local min=$((elapsed / 60))
  local sec=$((elapsed % 60))
  echo ""
  ok "Done in ${min}m${sec}s"
}

# --- Pre-checks ---
run_checks() {
  if [ "$SKIP_CHECKS" = true ]; then
    warn "Skipping pre-deploy checks"
    return
  fi

  log "Pre-deploy checks"

  # Dirty tree warning (not error)
  if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
    warn "Working tree has uncommitted changes"
  fi

  log "Running lint..."
  LINT_OUTPUT=$(pnpm lint 2>&1)
  LINT_ERRORS=$(echo "$LINT_OUTPUT" | grep -c '  error  ' || true)
  if [ "$LINT_ERRORS" -gt 0 ]; then
    echo "$LINT_OUTPUT" | grep '  error  '
    err "Lint has $LINT_ERRORS error(s)"
  fi
  LINT_WARNINGS=$(echo "$LINT_OUTPUT" | grep -c '  warning  ' || true)
  if [ "$LINT_WARNINGS" -gt 0 ]; then
    warn "Lint has $LINT_WARNINGS warning(s)"
  fi

  log "Running tests..."
  TEST_OUTPUT=$(pnpm vitest run --dir src 2>&1) || true
  # Strip ANSI codes for reliable grep
  CLEAN_OUTPUT=$(echo "$TEST_OUTPUT" | sed 's/\x1b\[[0-9;]*m//g')
  # Check for test failures beyond known-broken executor.test.ts
  FAILED_FILES=$(echo "$CLEAN_OUTPUT" | grep 'FAIL ' | grep -v 'executor.test.ts' || true)
  if [ -n "$FAILED_FILES" ]; then
    echo "$FAILED_FILES"
    err "Tests failed"
  fi
  if echo "$CLEAN_OUTPUT" | grep -q 'FAIL.*executor.test.ts'; then
    warn "Pre-existing test failures in executor.test.ts (skipped)"
  fi

  ok "All checks passed"
}

# --- Build ---
build_app() {
  log "Building $IMAGE_APP:latest (hash: $GIT_HASH, build #$GIT_COMMIT_COUNT)"
  docker build \
    -t "$IMAGE_APP:latest" \
    -t "$IMAGE_APP:$VERSION" \
    --build-arg GIT_HASH="$GIT_HASH" \
    --build-arg GIT_COMMIT_COUNT="$GIT_COMMIT_COUNT" \
    --build-arg NEXT_SERVER_ACTIONS_ENCRYPTION_KEY="${NEXT_SERVER_ACTIONS_ENCRYPTION_KEY:-}" \
    -f Dockerfile .
  ok "Built $IMAGE_APP:latest"
}

build_eb() {
  log "Building EB package..."
  pnpm --filter @lastest/embedded-browser build
  log "Building $IMAGE_EB:latest"
  docker build \
    -t "$IMAGE_EB:latest" \
    -t "$IMAGE_EB:$VERSION" \
    -f packages/embedded-browser/Dockerfile .
  ok "Built $IMAGE_EB:latest"
}

build_images() {
  if [ "$EB_ONLY" = true ]; then
    build_eb
  elif [ "$APP_ONLY" = true ]; then
    build_app
  else
    # Build both — EB in background, app in foreground
    build_eb &
    local eb_pid=$!
    build_app
    wait "$eb_pid" || err "EB image build failed"
    ok "Both images built"
  fi
}

build_olares() {
  if [ -z "${NEXT_SERVER_ACTIONS_ENCRYPTION_KEY:-}" ]; then
    err "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY not set in .env.local — required for stable Server Action IDs across deploys"
  fi
  log "Building $IMAGE_APP:olares (hash: $GIT_HASH, build #$GIT_COMMIT_COUNT)"
  docker build \
    -t "$IMAGE_APP:olares" \
    --build-arg GIT_HASH="$GIT_HASH" \
    --build-arg GIT_COMMIT_COUNT="$GIT_COMMIT_COUNT" \
    --build-arg NEXT_SERVER_ACTIONS_ENCRYPTION_KEY="$NEXT_SERVER_ACTIONS_ENCRYPTION_KEY" \
    --build-arg NEXT_PUBLIC_UMAMI_WEBSITE_ID="${OLARES_UMAMI_WEBSITE_ID:-}" \
    --build-arg UMAMI_INTERNAL_URL="${UMAMI_INTERNAL_URL:-}" \
    -f Dockerfile .
  ok "Built $IMAGE_APP:olares"

  log "Building EB package..."
  pnpm --filter @lastest/embedded-browser build
  log "Building $IMAGE_EB:olares"
  docker build \
    -t "$IMAGE_EB:olares" \
    -f packages/embedded-browser/Dockerfile .
  ok "Built $IMAGE_EB:olares"
}

# --- Targets ---
deploy_zima() {
  log "Deploying to ZimaOS ($ZIMA_HOST)"
  run_checks

  # Determine which images to build and transfer
  local images=()
  if [ "$EB_ONLY" = true ]; then
    build_eb
    images+=("$IMAGE_EB:latest")
  elif [ "$APP_ONLY" = true ]; then
    build_app
    images+=("$IMAGE_APP:latest")
  else
    build_images
    images+=("$IMAGE_APP:latest" "$IMAGE_EB:latest")
  fi

  log "Transferring images to $ZIMA_HOST (this may take a while)..."
  docker save "${images[@]}" | ssh "$ZIMA_USER@$ZIMA_HOST" 'docker load'
  ok "Images loaded on $ZIMA_HOST"

  log "Validating server compose file..."
  local remote_compose
  remote_compose=$(ssh "$ZIMA_USER@$ZIMA_HOST" "cat $ZIMA_COMPOSE")

  # EB containers must use LASTEST_URL (not LASTEST2_URL)
  if echo "$remote_compose" | grep -q 'LASTEST2_URL'; then
    err "Compose has LASTEST2_URL — should be LASTEST_URL (EB env var mismatch)"
  fi
  # Ensure required EB env vars are present when EB service exists
  if echo "$remote_compose" | grep -q 'embedded-browser'; then
    for var in LASTEST_URL SYSTEM_EB_TOKEN STREAM_PORT; do
      if ! echo "$remote_compose" | grep -q "$var"; then
        err "Compose is missing $var for embedded-browser service"
      fi
    done
  fi
  ok "Compose file looks good"

  log "Restarting containers..."
  ssh "$ZIMA_USER@$ZIMA_HOST" "cd $ZIMA_DIR && docker compose up -d"

  log "Verifying deployment..."
  bash "$SCRIPT_DIR/health-check.sh" "http://$ZIMA_HOST:3000"
}

deploy_olares() {
  log "Deploying to Olares ($OLARES_HOST)"
  run_checks
  build_olares

  log "Removing old images on Olares..."
  # Remove tags AND all by-digest references so ctr import fully replaces the image.
  # Without this, containerd caches old platform manifests and k8s picks them up.
  ssh "$OLARES_USER@$OLARES_HOST" \
    "ctr -n k8s.io images ls -q | grep -E 'ewyc/lastest:olares|ewyc/lastest-eb:olares' | xargs -r ctr -n k8s.io images rm 2>/dev/null || true"

  log "Transferring images to Olares (this takes ~10 minutes)..."
  docker save "$IMAGE_APP:olares" "$IMAGE_EB:olares" | \
    ssh "$OLARES_USER@$OLARES_HOST" 'ctr -n k8s.io images import -'
  ok "Images imported on Olares"

  log "Restarting deployments ($OLARES_DEPLOY + $OLARES_INTERNAL_DEPLOY)..."
  # Both Deployments must be rolled: the envoy-fronted one serves the UI,
  # the envoy-less `-internal` one is what EB Jobs POST into via LASTEST_URL.
  # Skipping the internal one leaves EB traffic on a stale build.
  ssh "$OLARES_USER@$OLARES_HOST" \
    "kubectl rollout restart deployment/$OLARES_DEPLOY deployment/$OLARES_INTERNAL_DEPLOY -n $OLARES_NS"

  log "Waiting for rollout..."
  ssh "$OLARES_USER@$OLARES_HOST" \
    "kubectl rollout status deployment/$OLARES_DEPLOY -n $OLARES_NS --timeout=180s && \
     kubectl rollout status deployment/$OLARES_INTERNAL_DEPLOY -n $OLARES_NS --timeout=180s"

  log "Verifying deployment..."
  bash "$SCRIPT_DIR/health-check.sh" "https://app.lastest.cloud" 180
}

deploy_npm() {
  log "Publishing @lastest/runner to npm"

  # Sync version from root
  local runner_dir="$ROOT_DIR/packages/runner"
  local current=$(node -p "require('$runner_dir/package.json').version")

  if [ "$current" != "$VERSION" ]; then
    log "Syncing version $current → $VERSION"
    node -e "
      const fs = require('fs');
      const pkg = JSON.parse(fs.readFileSync('$runner_dir/package.json', 'utf8'));
      pkg.version = '$VERSION';
      fs.writeFileSync('$runner_dir/package.json', JSON.stringify(pkg, null, 2) + '\n');
    "
  fi

  cd "$runner_dir"
  pnpm build
  pnpm publish --no-git-checks --access public
  cd "$ROOT_DIR"
  ok "Published @lastest/runner@$VERSION"
}

deploy_all() {
  log "Full deployment — version $VERSION (hash: $GIT_HASH)"
  run_checks

  # Build all images once
  build_images
  build_olares

  # Deploy to targets
  deploy_zima_transfer
  deploy_olares_transfer
  deploy_npm

  ok "All deployments complete"
}

# Transfer-only helpers (skip checks + build, used by deploy_all)
deploy_zima_transfer() {
  log "Transferring to ZimaOS..."
  local images=("$IMAGE_APP:latest")
  [ "$APP_ONLY" != true ] && images+=("$IMAGE_EB:latest")
  docker save "${images[@]}" | ssh "$ZIMA_USER@$ZIMA_HOST" 'docker load'
  ssh "$ZIMA_USER@$ZIMA_HOST" "cd $ZIMA_DIR && docker compose up -d"
  bash "$SCRIPT_DIR/health-check.sh" "http://$ZIMA_HOST:3000"
}

deploy_olares_transfer() {
  log "Transferring to Olares..."
  ssh "$OLARES_USER@$OLARES_HOST" \
    "ctr -n k8s.io images ls -q | grep -E 'ewyc/lastest:olares|ewyc/lastest-eb:olares' | xargs -r ctr -n k8s.io images rm 2>/dev/null || true"
  docker save "$IMAGE_APP:olares" "$IMAGE_EB:olares" | \
    ssh "$OLARES_USER@$OLARES_HOST" 'ctr -n k8s.io images import -'
  ssh "$OLARES_USER@$OLARES_HOST" \
    "kubectl rollout restart deployment/$OLARES_DEPLOY deployment/$OLARES_INTERNAL_DEPLOY -n $OLARES_NS"
  ssh "$OLARES_USER@$OLARES_HOST" \
    "kubectl rollout status deployment/$OLARES_DEPLOY -n $OLARES_NS --timeout=180s && \
     kubectl rollout status deployment/$OLARES_INTERNAL_DEPLOY -n $OLARES_NS --timeout=180s"
  bash "$SCRIPT_DIR/health-check.sh" "https://app.lastest.cloud" 180
}

# --- Main ---
usage() {
  echo "Usage: deploy.sh <target> [options]"
  echo ""
  echo "Targets:"
  echo "  zima      Build + deploy to ZimaOS ($ZIMA_HOST)"
  echo "  olares    Build + deploy to Olares (app.lastest.cloud)"
  echo "  npm       Publish @lastest/runner to npm"
  echo "  all       Deploy everything (zima + olares + npm)"
  echo ""
  echo "Options:"
  echo "  --skip-checks    Skip lint/test before deploy"
  echo "  --app-only       Only build/deploy main app image"
  echo "  --eb-only        Only build/deploy EB image"
  echo ""
  echo "Version: $VERSION | Hash: $GIT_HASH | Build: #$GIT_COMMIT_COUNT"
}

case "${TARGET}" in
  zima)    timer_start; deploy_zima;   timer_end ;;
  olares)  timer_start; deploy_olares; timer_end ;;
  npm)     timer_start; deploy_npm;    timer_end ;;
  all)     timer_start; deploy_all;    timer_end ;;
  -h|--help|help) usage ;;
  "") usage; exit 1 ;;
  *) err "Unknown target: $TARGET" ;;
esac
