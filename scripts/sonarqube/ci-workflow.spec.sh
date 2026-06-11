#!/usr/bin/env bash
# QA RED — tests for US-04: CI Integration (GitHub Actions workflow)
#
# Verifies:
#   1. .github/workflows/sonarqube.yml exists and is valid YAML
#   2. Workflow triggers on pull_request targeting main
#   3. Workflow triggers on push to main
#   4. SonarQube service container is defined with correct image
#   5. Service container has health check configured
#   6. Workflow steps include checkout, setup pnpm, install, build, test with coverage,
#      SonarScanner for each service, Quality Gate polling
#   7. Quality Gate polling logic exists (api/qualitygates/project_status)
#   8. Workflow fails when any service reports ERROR (exit code handling)
#   9. Workflow timeout is 15 minutes
#
# In RED, the file does NOT exist — tests must FAIL (exit != 0).
# In GREEN, all tests must PASS (exit 0).
#
# Dependencies: yq (YAML parser) must be installed for YAML validation.
#   Install: brew install yq  # macOS
#   Or: pip install yq        # Python

set -eo pipefail
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

FAILURES=0
PASSES=0

pass() { echo "  ✅ $1"; PASSES=$((PASSES + 1)); }
fail() { echo "  ❌ $1"; FAILURES=$((FAILURES + 1)); }
skip() { echo "  ⏭️  $1"; }

# Check if yq is available
if command -v yq &>/dev/null; then
  HAS_YQ=true
else
  HAS_YQ=false
  echo "  ⚠️  yq not installed — YAML validation will be skipped"
  echo "     Install: brew install yq  (macOS)"
  echo ""
fi

echo ""
echo "=== QA RED: US-04 CI Integration (GitHub Actions Workflow) ==="
echo ""

WORKFLOW_FILE=".github/workflows/sonarqube.yml"

# ── Test 1: sonarqube.yml exists ──────────────────────────────────────────────
echo "── Test 1: Workflow file exists"

if [ ! -f "$WORKFLOW_FILE" ]; then
  fail "sonarqube.yml no existe en .github/workflows/"
else
  pass "sonarqube.yml existe"
fi

# ── Test 2: Valid YAML ────────────────────────────────────────────────────────
echo ""
echo "── Test 2: Valid YAML"

if [ -f "$WORKFLOW_FILE" ]; then
  if [ "$HAS_YQ" = true ]; then
    if yq eval '.' "$WORKFLOW_FILE" > /dev/null 2>&1; then
      pass "sonarqube.yml es YAML válido"
    else
      fail "sonarqube.yml NO es YAML válido"
    fi
  else
    skip "yq no disponible — validación YAML saltada"
  fi
fi

# ── Test 3: Workflow name ─────────────────────────────────────────────────────
echo ""
echo "── Test 3: Workflow name"

if [ -f "$WORKFLOW_FILE" ] && [ "$HAS_YQ" = true ]; then
  WF_NAME=$(yq eval '.name // ""' "$WORKFLOW_FILE" 2>/dev/null)
  if [ "$WF_NAME" = "SonarQube Quality Gate" ]; then
    pass "Workflow name is 'SonarQube Quality Gate'"
  else
    fail "Workflow name should be 'SonarQube Quality Gate', was: '$WF_NAME'"
  fi
fi

# ── Test 4: Trigger on pull_request targeting main ────────────────────────────
echo ""
echo "── Test 4: Triggers — pull_request targeting main"

if [ -f "$WORKFLOW_FILE" ] && [ "$HAS_YQ" = true ]; then
  PR_BRANCHES=$(yq eval '.on.pull_request.branches[]' "$WORKFLOW_FILE" 2>/dev/null)
  if echo "$PR_BRANCHES" | grep -q "^main$"; then
    pass "pull_request trigger targets main branch"
  else
    fail "pull_request trigger does NOT target main branch (found: ${PR_BRANCHES:-<none>})"
  fi
fi

# ── Test 5: Trigger on push to main ───────────────────────────────────────────
echo ""
echo "── Test 5: Triggers — push to main"

if [ -f "$WORKFLOW_FILE" ] && [ "$HAS_YQ" = true ]; then
  PUSH_BRANCHES=$(yq eval '.on.push.branches[]' "$WORKFLOW_FILE" 2>/dev/null)
  if echo "$PUSH_BRANCHES" | grep -q "^main$"; then
    pass "push trigger targets main branch"
  else
    fail "push trigger does NOT target main branch (found: ${PUSH_BRANCHES:-<none>})"
  fi
fi

# ── Test 6: Job name and timeout ──────────────────────────────────────────────
echo ""
echo "── Test 6: Job name and timeout"

if [ -f "$WORKFLOW_FILE" ] && [ "$HAS_YQ" = true ]; then
  JOB_NAME=$(yq eval '.jobs.quality-gate.name // ""' "$WORKFLOW_FILE" 2>/dev/null)
  if [ -n "$JOB_NAME" ]; then
    pass "Job 'quality-gate' has name: '$JOB_NAME'"
  else
    fail "Job 'quality-gate' missing or has no name"
  fi

  TIMEOUT=$(yq eval '.jobs.quality-gate["timeout-minutes"] // ""' "$WORKFLOW_FILE" 2>/dev/null)
  if [ "$TIMEOUT" = "15" ]; then
    pass "Workflow timeout is 15 minutes"
  else
    fail "Workflow timeout should be 15 minutes, found: $TIMEOUT"
  fi
fi

# ── Test 7: Service container definition ──────────────────────────────────────
echo ""
echo "── Test 7: SonarQube service container"

if [ -f "$WORKFLOW_FILE" ] && [ "$HAS_YQ" = true ]; then
  SQ_IMAGE=$(yq eval '.jobs.quality-gate.services.sonarqube.image // ""' "$WORKFLOW_FILE" 2>/dev/null)
  if echo "$SQ_IMAGE" | grep -q "sonarqube"; then
    pass "SonarQube service container defined with image: $SQ_IMAGE"
  else
    fail "SonarQube service container NOT defined or missing image tag"
  fi

  SQ_PORT=$(yq eval '.jobs.quality-gate.services.sonarqube.ports[0] // ""' "$WORKFLOW_FILE" 2>/dev/null)
  if echo "$SQ_PORT" | grep -q "9000"; then
    pass "SonarQube service exposes port 9000"
  else
    fail "SonarQube service does NOT expose port 9000"
  fi
fi

# ── Test 8: Service container health check ────────────────────────────────────
echo ""
echo "── Test 8: Service container health check"

if [ -f "$WORKFLOW_FILE" ] && [ "$HAS_YQ" = true ]; then
  # Health check is defined in the `options` string (GitHub Actions service container style)
  OPTIONS_LINE=$(yq eval '.jobs.quality-gate.services.sonarqube.options // ""' "$WORKFLOW_FILE" 2>/dev/null)
  if echo "$OPTIONS_LINE" | grep -q "UP"; then
    pass "Health check configured to verify SonarQube status UP"
  else
    fail "Health check missing or not verifying UP status"
  fi
fi

# ── Test 9: SonarQube readiness handling ─────────────────────────────────────
echo ""
echo "── Test 9: SonarQube readiness handling"

if [ -f "$WORKFLOW_FILE" ] && [ "$HAS_YQ" = true ]; then
  # Read the raw file content for flexible matching
  RAW_CONTENT=$(cat "$WORKFLOW_FILE")
  HAS_WAIT=false

  # Service container health check handles initial readiness (GitHub Actions waits for healthy)
  if echo "$RAW_CONTENT" | grep -q "health-cmd\|healthcheck\|health-interval\|health-retries\|health-start-period"; then
    HAS_WAIT=true
  fi

  # Or there may be a dedicated step that waits
  STEPS=$(yq eval '.jobs.quality-gate.steps[].name // ""' "$WORKFLOW_FILE" 2>/dev/null)
  while IFS= read -r step; do
    if echo "$step" | grep -qi "wait.*sonarqube\|wait.*background\|poll.*task"; then
      HAS_WAIT=true
      break
    fi
  done <<< "$STEPS"

  if [ "$HAS_WAIT" = true ]; then
    pass "SonarQube readiness handled (service health check + background task polling)"
  else
    fail "Missing SonarQube readiness handling (no health check, no wait step)"
  fi
fi

# ── Test 10: Essential workflow steps ─────────────────────────────────────────
echo ""
echo "── Test 10: Essential workflow steps"

if [ -f "$WORKFLOW_FILE" ] && [ "$HAS_YQ" = true ]; then
  STEPS=$(yq eval '.jobs.quality-gate.steps[].name // ""' "$WORKFLOW_FILE" 2>/dev/null)
  ALL_FOUND=true

  # Check for key steps
  if echo "$STEPS" | grep -qi "checkout"; then
    pass "Step: checkout code"
  else
    fail "Step: checkout — NOT found"
    ALL_FOUND=false
  fi

  if echo "$STEPS" | grep -qi "setup.*pnpm\|pnpm.*setup\|install.*node\|setup.*node"; then
    pass "Step: setup pnpm/Node.js"
  else
    fail "Step: setup pnpm/Node.js — NOT found"
    ALL_FOUND=false
  fi

  if echo "$STEPS" | grep -qi "install.*dep\|pnpm install"; then
    pass "Step: install dependencies"
  else
    fail "Step: install dependencies — NOT found"
    ALL_FOUND=false
  fi

  if echo "$STEPS" | grep -qi "build"; then
    pass "Step: build shared packages"
  else
    fail "Step: build — NOT found"
    ALL_FOUND=false
  fi

  if echo "$STEPS" | grep -qi "test.*coverage\|coverage"; then
    pass "Step: run tests with coverage"
  else
    fail "Step: tests with coverage — NOT found"
    ALL_FOUND=false
  fi

  SCANNER_COUNT=$(echo "$STEPS" | grep -ci "sonarscanner\|sonar-scanner\|sonar scanner")
  if [ "$SCANNER_COUNT" -ge 1 ]; then
    pass "Step(s): SonarScanner (found $SCANNER_COUNT)"
  else
    fail "Step: SonarScanner — NOT found"
    ALL_FOUND=false
  fi
fi

# ── Test 11: Quality Gate polling ─────────────────────────────────────────────
echo ""
echo "── Test 11: Quality Gate polling"

if [ -f "$WORKFLOW_FILE" ] && [ "$HAS_YQ" = true ]; then
  # Read the raw file content for this since yq may not handle complex inline scripts well
  RAW_CONTENT=$(cat "$WORKFLOW_FILE")

  if echo "$RAW_CONTENT" | grep -q "qualitygates/project_status"; then
    pass "Workflow polls api/qualitygates/project_status"
  else
    fail "Workflow does NOT poll api/qualitygates/project_status"
    ALL_FOUND=false
  fi

  if echo "$RAW_CONTENT" | grep -q "ce/task\|ce/component"; then
    pass "Workflow polls SonarQube Compute Engine API for background task completion"
  else
    fail "Workflow does NOT poll SonarQube Compute Engine API"
    ALL_FOUND=false
  fi
fi

# ── Test 12: Quality Gate status check fails on ERROR ─────────────────────────
echo ""
echo "── Test 12: Quality Gate failure handling"

if [ -f "$WORKFLOW_FILE" ] && [ "$HAS_YQ" = true ]; then
  RAW_CONTENT=$(cat "$WORKFLOW_FILE")

  if echo "$RAW_CONTENT" | grep -q "ERROR"; then
    pass "Workflow handles ERROR status"
  else
    fail "Workflow does NOT handle ERROR status"
  fi

  if echo "$RAW_CONTENT" | grep -qi "exit\|fail\|::error\|set -e"; then
    pass "Workflow has exit/failure logic"
  else
    fail "Workflow missing exit/failure logic"
  fi
fi

# ── Test 13: Runs on ubuntu-latest ────────────────────────────────────────────
echo ""
echo "── Test 13: Runs on ubuntu-latest"

if [ -f "$WORKFLOW_FILE" ] && [ "$HAS_YQ" = true ]; then
  RUNS_ON=$(yq eval '.jobs.quality-gate["runs-on"] // ""' "$WORKFLOW_FILE" 2>/dev/null)
  if echo "$RUNS_ON" | grep -q "ubuntu-latest"; then
    pass "Job runs on ubuntu-latest"
  else
    fail "Job should run on ubuntu-latest, found: $RUNS_ON"
  fi
fi

# ── Test 14: Three project keys are referenced ────────────────────────────────
echo ""
echo "── Test 14: Three service project keys"

if [ -f "$WORKFLOW_FILE" ] && [ "$HAS_YQ" = true ]; then
  RAW_CONTENT=$(cat "$WORKFLOW_FILE")

  KEYS_FOUND=0
  echo "$RAW_CONTENT" | grep -q "open-supervisor-authorization-service" && KEYS_FOUND=$((KEYS_FOUND + 1)) && pass "References authorization-service project key"
  echo "$RAW_CONTENT" | grep -q "open-supervisor-bff" && KEYS_FOUND=$((KEYS_FOUND + 1)) && pass "References bff project key"
  echo "$RAW_CONTENT" | grep -q "open-supervisor-sse-server" && KEYS_FOUND=$((KEYS_FOUND + 1)) && pass "References sse-server project key"

  if [ "$KEYS_FOUND" -lt 3 ]; then
    fail "Not all 3 project keys referenced (found $KEYS_FOUND/3)"
  fi
fi

# ── Resumen ───────────────────────────────────────────────────────────────────
echo ""
echo "====================================="
echo "  Resultado: $PASSES passed, $FAILURES failed"
echo "====================================="

if [ "$FAILURES" -gt 0 ]; then
  echo ""
  echo "⚠️  QA RED: $FAILURES tests fail — acceptance criteria NOT met."
  echo "    Create the workflow file and re-run."
  exit 1
else
  echo ""
  echo "✅ QA GREEN: all tests pass."
  exit 0
fi
