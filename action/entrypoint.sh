#!/bin/bash
set -e

# Input parameters (set via environment by GitHub Actions)
SERVER_URL="${INPUT_SERVER_URL}"
TOKEN="${INPUT_RUNNER_TOKEN}"
REPO_ID="${INPUT_REPO_ID}"
RUNNER_ID="${INPUT_RUNNER_ID}"
TEAM_ID="${INPUT_TEAM_ID}"
TIMEOUT_SECONDS="${INPUT_TIMEOUT:-300}"
FAIL_ON_CHANGES="${INPUT_FAIL_ON_CHANGES:-false}"

# Calculate timeout in milliseconds
TIMEOUT_MS=$((TIMEOUT_SECONDS * 1000))

echo "=== Lastest2 Visual Regression Tests ==="
echo "Server: ${SERVER_URL}"
echo "Repository ID: ${REPO_ID}"
echo "Runner ID: ${RUNNER_ID}"
echo ""

# Create build
echo "Creating build..."
CREATE_RESPONSE=$(curl -s -X POST "${SERVER_URL}/api/builds/create" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d "{
    \"repositoryId\": \"${REPO_ID}\",
    \"runnerId\": \"${RUNNER_ID}\",
    \"teamId\": \"${TEAM_ID}\",
    \"triggerType\": \"ci\",
    \"gitBranch\": \"${GITHUB_HEAD_REF:-${GITHUB_REF_NAME:-unknown}}\",
    \"gitCommit\": \"${GITHUB_SHA:-unknown}\"
  }")

BUILD_ID=$(echo "$CREATE_RESPONSE" | jq -r '.buildId // empty')
if [ -z "$BUILD_ID" ]; then
  echo "Error: Failed to create build"
  echo "$CREATE_RESPONSE"
  exit 1
fi

TEST_COUNT=$(echo "$CREATE_RESPONSE" | jq -r '.testCount // 0')
echo "Build created: ${BUILD_ID}"
echo "Tests to run: ${TEST_COUNT}"
echo ""

# Poll for completion
echo "Waiting for build completion..."
START_TIME=$(date +%s)
TIMEOUT_SEC=$((TIMEOUT_MS / 1000))
LAST_PROGRESS=""

while true; do
  CURRENT_TIME=$(date +%s)
  ELAPSED=$((CURRENT_TIME - START_TIME))

  if [ $ELAPSED -gt $TIMEOUT_SEC ]; then
    echo "Error: Build timed out after ${TIMEOUT_SEC}s"
    exit 1
  fi

  STATUS_RESPONSE=$(curl -s "${SERVER_URL}/api/builds/${BUILD_ID}/status" \
    -H "Authorization: Bearer ${TOKEN}")

  COMPLETED_AT=$(echo "$STATUS_RESPONSE" | jq -r '.completedAt // empty')
  PASSED_COUNT=$(echo "$STATUS_RESPONSE" | jq -r '.passedCount // 0')
  FAILED_COUNT=$(echo "$STATUS_RESPONSE" | jq -r '.failedCount // 0')
  TOTAL_TESTS=$(echo "$STATUS_RESPONSE" | jq -r '.totalTests // 0')

  PROGRESS="Progress: $((PASSED_COUNT + FAILED_COUNT))/${TOTAL_TESTS} tests"
  if [ "$PROGRESS" != "$LAST_PROGRESS" ]; then
    echo "  $PROGRESS"
    LAST_PROGRESS="$PROGRESS"
  fi

  if [ -n "$COMPLETED_AT" ] && [ "$COMPLETED_AT" != "null" ]; then
    break
  fi

  sleep 3
done

# Extract final results
OVERALL_STATUS=$(echo "$STATUS_RESPONSE" | jq -r '.overallStatus // "unknown"')
CHANGES_DETECTED=$(echo "$STATUS_RESPONSE" | jq -r '.changesDetected // 0')
FLAKY_COUNT=$(echo "$STATUS_RESPONSE" | jq -r '.flakyCount // 0')
ELAPSED_MS=$(echo "$STATUS_RESPONSE" | jq -r '.elapsedMs // 0')

echo ""
echo "=== Build Results ==="
echo "Status: ${OVERALL_STATUS}"
echo "Total Tests: ${TOTAL_TESTS}"
echo "Passed: ${PASSED_COUNT}"
echo "Failed: ${FAILED_COUNT}"
echo "Changes Detected: ${CHANGES_DETECTED}"
echo "Flaky: ${FLAKY_COUNT}"
if [ "$ELAPSED_MS" != "null" ] && [ "$ELAPSED_MS" != "0" ]; then
  DURATION_SEC=$(echo "scale=1; $ELAPSED_MS / 1000" | bc)
  echo "Duration: ${DURATION_SEC}s"
fi
echo ""
echo "View results: ${SERVER_URL}/builds/${BUILD_ID}"

# Set outputs (GitHub Actions format)
if [ -n "$GITHUB_OUTPUT" ]; then
  echo "status=${OVERALL_STATUS}" >> $GITHUB_OUTPUT
  echo "build-url=${SERVER_URL}/builds/${BUILD_ID}" >> $GITHUB_OUTPUT
  echo "changed-count=${CHANGES_DETECTED}" >> $GITHUB_OUTPUT
  echo "passed-count=${PASSED_COUNT}" >> $GITHUB_OUTPUT
  echo "failed-count=${FAILED_COUNT}" >> $GITHUB_OUTPUT
  echo "total-tests=${TOTAL_TESTS}" >> $GITHUB_OUTPUT
fi

# Determine exit code
if [ "$OVERALL_STATUS" = "passed" ] || [ "$OVERALL_STATUS" = "safe_to_merge" ]; then
  exit 0
elif [ "$OVERALL_STATUS" = "review_required" ]; then
  if [ "$FAIL_ON_CHANGES" = "true" ]; then
    echo ""
    echo "Visual changes detected and fail-on-changes is enabled"
    exit 1
  fi
  exit 0
else
  exit 1
fi
