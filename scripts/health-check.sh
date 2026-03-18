#!/usr/bin/env bash
# Usage: health-check.sh <url> [timeout_seconds]
# Polls /api/health until healthy or timeout
set -euo pipefail

URL="${1:?Usage: health-check.sh <url> [timeout_seconds]}"
TIMEOUT="${2:-120}"
INTERVAL=5
ELAPSED=0

echo "Waiting for $URL to become healthy (timeout: ${TIMEOUT}s)..."

while [ "$ELAPSED" -lt "$TIMEOUT" ]; do
  RESPONSE=$(curl -sf "$URL/api/health" 2>/dev/null || echo '{}')
  STATUS=$(echo "$RESPONSE" | node -p 'try{JSON.parse(require("fs").readFileSync(0,"utf8")).status}catch{""}'  2>/dev/null || echo "")

  if [ "$STATUS" = "healthy" ]; then
    VERSION=$(echo "$RESPONSE" | node -p 'try{JSON.parse(require("fs").readFileSync(0,"utf8")).version}catch{"unknown"}' 2>/dev/null || echo "unknown")
    COMMITS=$(echo "$RESPONSE" | node -p 'try{JSON.parse(require("fs").readFileSync(0,"utf8")).commitCount}catch{"?"}' 2>/dev/null || echo "?")
    echo "✓ Healthy — version: $VERSION (build #$COMMITS)"
    exit 0
  fi

  sleep "$INTERVAL"
  ELAPSED=$((ELAPSED + INTERVAL))
  echo "  ... waiting (${ELAPSED}s/${TIMEOUT}s)"
done

echo "✗ Health check failed after ${TIMEOUT}s at $URL"
exit 1
