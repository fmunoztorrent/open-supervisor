#!/usr/bin/env bash
# =============================================================================
# validate-deploy-workflow.sh
# US-07: Validate GitHub Actions CI/CD deploy workflow for open-supervisor.
# Checks YAML structure, triggers, matrix strategy, OIDC auth, docker buildx,
# image tagging, deploy order, and absence of hardcoded secrets.
#
# Usage:
#   bash scripts/aws/validate-deploy-workflow.sh
#
# Exit codes:
#   0 = all validations pass
#   1 = one or more validations fail
# =============================================================================

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
WORKFLOW_FILE="$REPO_ROOT/.github/workflows/deploy.yml"

# ── Colors ──────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ok()    { echo -e "${GREEN}[PASS]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
fail()  { echo -e "${RED}[FAIL]${NC} $1"; FAILED=1; }
FAILED=0

# ── Service definitions ─────────────────────────────────────────────────────────
SERVICES=("authorization-service" "sse-server" "bff")
DEPLOY_ORDER=("bff" "sse-server" "authorization-service")

# ═════════════════════════════════════════════════════════════════════════════════
echo ""
echo "━━━ US-07: CI/CD Deploy Workflow Validation ━━━"
echo "  Workflow: ${WORKFLOW_FILE}"
echo ""

# ── Pre-flight: Check yq or python3 (for YAML parsing) ─────────────────────────
HAS_YQ=false
HAS_PY_YAML=false

if command -v yq &>/dev/null; then
  HAS_YQ=true
  ok "yq available for YAML parsing"
elif python3 -c "import yaml" 2>/dev/null; then
  HAS_PY_YAML=true
  ok "python3 + PyYAML available for YAML parsing"
else
  warn "Neither yq nor PyYAML available — using grep-based checks (limited)"
fi

# ═════════════════════════════════════════════════════════════════════════════════
# PHASE 1: File existence
# ═════════════════════════════════════════════════════════════════════════════════
echo ""
echo "── Phase 1: File Existence ──"

if [ -f "$WORKFLOW_FILE" ]; then
  ok "Workflow file exists: deploy.yml"
else
  fail "Workflow file MISSING: ${WORKFLOW_FILE}"
  echo ""
  echo "━━━ Summary ━━━"
  echo -e "${RED}File not found — cannot validate.${NC}"
  exit 1
fi

# ═════════════════════════════════════════════════════════════════════════════════
# PHASE 2: Raw content checks (always available)
# ═════════════════════════════════════════════════════════════════════════════════
echo ""
echo "── Phase 2: Content Checks ──"

RAW=$(cat "$WORKFLOW_FILE")

# Name
if echo "$RAW" | grep -q "^name:"; then
  ok "Workflow has a name field"
else
  fail "Missing name field"
fi

# On push to main
if echo "$RAW" | grep -q "push:"; then
  ok "Push trigger defined"
  if echo "$RAW" | grep -A5 "push:" | grep -q "main"; then
    ok "  Push targets main branch"
  else
    fail "  Push trigger does not target main branch"
  fi
else
  fail "Missing push trigger"
fi

# workflow_dispatch
if echo "$RAW" | grep -q "workflow_dispatch"; then
  ok "workflow_dispatch trigger defined (manual deploy)"
else
  fail "Missing workflow_dispatch trigger"
fi

# Jobs: build-and-push
if echo "$RAW" | grep -q "build-and-push:"; then
  ok "build-and-push job defined"
else
  fail "Missing build-and-push job"
fi

# Jobs: deploy
if echo "$RAW" | grep -q "^  deploy:"; then
  ok "deploy job defined"
else
  fail "Missing deploy job"
fi

# Timeout
TIMEOUT_COUNT=$(echo "$RAW" | grep -c "timeout-minutes: 20" || true)
if [ "$TIMEOUT_COUNT" -ge 2 ]; then
  ok "Both jobs have timeout-minutes: 20"
elif [ "$TIMEOUT_COUNT" -eq 1 ]; then
  fail "Only 1 job has timeout-minutes: 20 (expected both)"
else
  fail "Missing timeout-minutes: 20 on both jobs"
fi

# Matrix strategy: 3 services
MATCHES=0
for svc in "${SERVICES[@]}"; do
  if echo "$RAW" | grep -q "\"$svc\"" || echo "$RAW" | grep -q "'$svc'" || echo "$RAW" | grep -q " $svc$" || echo "$RAW" | grep -q " $svc "; then
    MATCHES=$((MATCHES + 1))
  fi
done
# More precise: check matrix definition
if echo "$RAW" | grep -q "matrix:" && echo "$RAW" | grep -q "service:"; then
  ok "Matrix strategy defined with service dimension"
else
  fail "Missing matrix strategy with service dimension"
fi

# OIDC authentication
if echo "$RAW" | grep -q "configure-aws-credentials"; then
  ok "AWS credentials configuration step found"
  if echo "$RAW" | grep -q "role-to-assume"; then
    ok "  Uses OIDC role-to-assume"
    if echo "$RAW" | grep -q "<aws_account_id>"; then
      ok "  role-to-assume uses <aws_account_id> placeholder"
    else
      warn "  role-to-assume may not use placeholder — verify account ID is not hardcoded"
    fi
  else
    fail "  Missing role-to-assume for OIDC"
  fi
else
  fail "Missing AWS credentials configuration"
fi

# No hardcoded access keys
if echo "$RAW" | grep -qE "(aws_access_key_id|aws_secret_access_key|AKIA)"; then
  fail "Workflow contains hardcoded AWS credentials!"
else
  ok "No hardcoded AWS credentials found (OIDC only)"
fi

# No hardcoded 12-digit account IDs
HC_IDS=$(echo "$RAW" | python3 -c "
import re, sys
content = sys.stdin.read()
matches = re.findall(r'(?<![<\w])(\d{12})(?![>\w])', content)
filtered = [m for m in matches if m != '000000000000']
if filtered:
    print(','.join(filtered))
" 2>/dev/null || true)
if [ -z "$HC_IDS" ]; then
  ok "No hardcoded AWS account IDs"
else
  fail "Potential hardcoded account IDs: ${HC_IDS}"
fi

# Docker buildx
if echo "$RAW" | grep -q "setup-buildx-action"; then
  ok "Docker buildx setup configured"
else
  fail "Missing docker buildx setup"
fi

# Docker login to ECR (amazon-ecr-login or docker/login-action)
if echo "$RAW" | grep -qE "(amazon-ecr-login|login-action)"; then
  ok "Docker login action configured for ECR (amazon-ecr-login)"
else
  fail "Missing ECR login action (amazon-ecr-login or docker/login-action)"
fi

# docker/build-push-action
if echo "$RAW" | grep -q "build-push-action"; then
  ok "Docker build-push action configured"
else
  fail "Missing docker build-push action"
fi

# Multi-arch platforms
if echo "$RAW" | grep -q "linux/amd64,linux/arm64"; then
  ok "Multi-arch build platforms: linux/amd64,linux/arm64"
else
  fail "Multi-arch platforms not configured"
fi

# Cache type=gha
if echo "$RAW" | grep -q "type=gha"; then
  ok "Docker layer caching with type=gha configured"
else
  fail "Missing type=gha cache configuration"
fi

# Image tags: sha and latest
if echo "$RAW" | grep -q "sha-"; then
  ok "Image tagged with sha-<commit> for traceability"
else
  fail "Missing sha-<commit> image tag"
fi
if echo "$RAW" | grep -q "latest"; then
  ok "Image tagged with latest"
else
  fail "Missing latest image tag"
fi

# ECR URI pattern
if echo "$RAW" | grep -q "amazonaws.com"; then
  ok "ECR URI references amazonaws.com"
else
  fail "Missing ECR URI"
fi
if echo "$RAW" | grep -q "open-supervisor"; then
  ok "ECR URI includes open-supervisor repository prefix"
else
  fail "ECR URI missing open-supervisor prefix"
fi

# Deploy order: bff → sse-server → authorization-service
# Scope check to only lines within the deploy job (after "# ── Deploy bff")
DEPLOY_SECTION=$(echo "$RAW" | awk '/# ── Deploy bff/,0' 2>/dev/null || \
                  echo "$RAW" | sed -n '/Deploy bff/,$p' 2>/dev/null || \
                  echo "$RAW")
if [ -n "$DEPLOY_SECTION" ]; then
  ORDER_OK=true
  PREV_INDEX=-1
  for svc in "${DEPLOY_ORDER[@]}"; do
    LINE_NUM=$(echo "$DEPLOY_SECTION" | grep -n "$svc" | head -1 | cut -d: -f1 || echo "0")
    if [ "$LINE_NUM" = "0" ]; then
      fail "Deploy step missing reference to ${svc}"
      ORDER_OK=false
    elif [ "$LINE_NUM" -le "$PREV_INDEX" ]; then
      fail "Deploy order violation: ${svc} should come after previous service"
      ORDER_OK=false
    fi
    PREV_INDEX=$LINE_NUM
  done
  if [ "$ORDER_OK" = true ]; then
    ok "Deploy order is correct: bff → sse-server → authorization-service"
  fi
else
  fail "Cannot find deploy section to validate order"
fi

# --force-new-deployment
if echo "$RAW" | grep -q "force-new-deployment"; then
  ok "ECS update uses --force-new-deployment flag"
else
  fail "Missing --force-new-deployment flag"
fi

# ECS cluster open-supervisor
if echo "$RAW" | grep -q "open-supervisor"; then
  ok "References ECS cluster: open-supervisor"
else
  fail "Missing reference to ECS cluster"
fi

# Task definition family names
ALL_TASKS_FOUND=true
for svc in "${SERVICES[@]}"; do
  family="open-supervisor-${svc}"
  if echo "$RAW" | grep -q "$family"; then
    ok "  References task definition family: ${family}"
  else
    fail "  Missing task definition family: ${family}"
    ALL_TASKS_FOUND=false
  fi
done

# pnpm setup (follows ci.yml pattern)
if echo "$RAW" | grep -q "pnpm/action-setup@v4"; then
  ok "Uses pnpm/action-setup@v4"
else
  fail "Missing pnpm/action-setup@v4"
fi
if echo "$RAW" | grep -q "version: 11"; then
  ok "pnpm version: 11"
else
  fail "Missing pnpm version 11"
fi

# Node setup
if echo "$RAW" | grep -q "actions/setup-node@v4"; then
  ok "Uses actions/setup-node@v4"
else
  fail "Missing actions/setup-node@v4"
fi
if echo "$RAW" | grep -q "node-version: 24"; then
  ok "Node version: 24"
else
  fail "Missing node version 24"
fi

# No secrets in build-args
BUILD_ARG_LINES=$(echo "$RAW" | grep "build-arg" || true)
if [ -n "$BUILD_ARG_LINES" ]; then
  if echo "$BUILD_ARG_LINES" | grep -qE "(password|secret|token|key)"; then
    fail "build-args may expose sensitive values:"
    echo "$BUILD_ARG_LINES" | while read -r line; do
      echo "  → ${line}"
    done
  else
    ok "No sensitive values in build-args"
  fi
else
  ok "No build-args used (secrets not exposed)"
fi

echo ""

# ═════════════════════════════════════════════════════════════════════════════════
# PHASE 3: YAML structural checks (if yq available)
# ═════════════════════════════════════════════════════════════════════════════════
echo "── Phase 3: YAML Structure ──"
echo ""

if [ "$HAS_YQ" = true ]; then
  # Valid YAML
  if yq eval '.' "$WORKFLOW_FILE" > /dev/null 2>&1; then
    ok "deploy.yml is valid YAML"
  else
    fail "deploy.yml is NOT valid YAML"
  fi

  # Job count
  JOB_COUNT=$(yq eval '.jobs | keys | length' "$WORKFLOW_FILE")
  if [ "$JOB_COUNT" -eq 2 ]; then
    ok "Exactly 2 jobs defined (build-and-push, deploy): ${JOB_COUNT}"
  else
    fail "Expected 2 jobs, found ${JOB_COUNT}"
  fi

  # Matrix service count
  MATRIX_COUNT=$(yq eval '.jobs.build-and-push.strategy.matrix.service | length' "$WORKFLOW_FILE" 2>/dev/null || echo "0")
  if [ "$MATRIX_COUNT" -eq 3 ]; then
    ok "Matrix iterates 3 services: ${MATRIX_COUNT}"
  else
    fail "Expected 3 services in matrix, found ${MATRIX_COUNT}"
  fi

  # Deploy needs
  DEPLOY_NEEDS=$(yq eval '.jobs.deploy.needs // ""' "$WORKFLOW_FILE")
  if echo "$DEPLOY_NEEDS" | grep -q "build-and-push"; then
    ok "deploy job needs: build-and-push"
  else
    fail "deploy job does not depend on build-and-push"
  fi

  # Push branches
  PUSH_BRANCHES=$(yq eval '.on.push.branches[]' "$WORKFLOW_FILE" 2>/dev/null | tr '\n' ' ')
  if echo "$PUSH_BRANCHES" | grep -q "main"; then
    ok "Push trigger targets main branch"
  else
    fail "Push trigger missing main branch"
  fi

  # No extra branches
  BRANCH_COUNT=$(yq eval '.on.push.branches | length' "$WORKFLOW_FILE" 2>/dev/null || echo "0")
  if [ "$BRANCH_COUNT" -eq 1 ]; then
    ok "Push trigger only targets main (${BRANCH_COUNT} branch)"
  elif [ "$BRANCH_COUNT" -gt 1 ]; then
    warn "Push trigger targets ${BRANCH_COUNT} branches — verify this is intentional"
  fi

elif [ "$HAS_PY_YAML" = true ]; then
  # Python-based YAML validation
  PY_SCRIPT=$(cat << 'PYEOF'
import sys, json, yaml
with open(sys.argv[1], 'r') as f:
    data = yaml.safe_load(f)

results = {}

# Valid YAML
results['valid'] = data is not None

# Job count
jobs = data.get('jobs', {})
results['job_count'] = len(jobs)

# Matrix services
try:
    services = jobs['build-and-push']['strategy']['matrix']['service']
    results['matrix_services'] = len(services)
    results['matrix_list'] = services
except:
    results['matrix_services'] = 0
    results['matrix_list'] = []

# Deploy needs
try:
    needs = jobs['deploy']['needs']
    results['deploy_needs'] = needs if isinstance(needs, list) else [needs]
except:
    results['deploy_needs'] = []

# Push branches
try:
    branches = data['on']['push']['branches']
    results['push_branches'] = branches if isinstance(branches, list) else [branches]
except:
    results['push_branches'] = []

# Has workflow_dispatch
results['has_dispatch'] = 'workflow_dispatch' in data.get('on', {})

print(json.dumps(results))
PYEOF
  )

  PY_RESULT=$(python3 -c "$PY_SCRIPT" "$WORKFLOW_FILE" 2>/dev/null || echo "{}")

  if echo "$PY_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('valid')" 2>/dev/null; then
    ok "deploy.yml is valid YAML"
  else
    fail "deploy.yml is NOT valid YAML"
  fi

  JOB_COUNT=$(echo "$PY_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('job_count', 0))" 2>/dev/null || echo "0")
  if [ "$JOB_COUNT" -eq 2 ]; then
    ok "Exactly 2 jobs defined"
  else
    fail "Expected 2 jobs, found ${JOB_COUNT}"
  fi

  MATRIX_COUNT=$(echo "$PY_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('matrix_services', 0))" 2>/dev/null || echo "0")
  if [ "$MATRIX_COUNT" -eq 3 ]; then
    ok "Matrix iterates 3 services"
  fi

  if echo "$PY_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'build-and-push' in d.get('deploy_needs', [])" 2>/dev/null; then
    ok "deploy job needs build-and-push"
  else
    fail "deploy job needs does not include build-and-push"
  fi

  if echo "$PY_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'main' in d.get('push_branches', [])" 2>/dev/null; then
    ok "Push trigger targets main branch"
  else
    fail "Push trigger missing main branch"
  fi

  if echo "$PY_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('has_dispatch')" 2>/dev/null; then
    ok "workflow_dispatch trigger present"
  else
    fail "Missing workflow_dispatch trigger"
  fi
else
  warn "yq not available — skipping YAML structural checks"
fi

echo ""

# ═════════════════════════════════════════════════════════════════════════════════
# Summary
# ═════════════════════════════════════════════════════════════════════════════════
echo "━━━ Summary ━━━"
echo ""

if [ "$FAILED" -eq 0 ]; then
  echo -e "${GREEN}All CI/CD workflow validations passed.${NC}"
  exit 0
else
  echo -e "${RED}${FAILED} validation(s) failed.${NC}"
  exit 1
fi
