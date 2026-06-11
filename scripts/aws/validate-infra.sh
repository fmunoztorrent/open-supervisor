#!/usr/bin/env bash
# US-03: Validate ECR infrastructure for open-supervisor backend services.
#
# Checks that all 3 ECR repositories exist with correct configuration:
#   - open-supervisor/authorization-service
#   - open-supervisor/sse-server
#   - open-supervisor/bff
#
# Usage:
#   AWS_REGION=us-east-1 bash scripts/aws/validate-infra.sh
#
# Exit code:
#   0 — all validations pass
#   1 — one or more validations fail

set -euo pipefail

REPOS=(
  "open-supervisor/authorization-service"
  "open-supervisor/sse-server"
  "open-supervisor/bff"
)

AWS_REGION="${AWS_REGION:-us-east-1}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ok()    { echo -e "${GREEN}[PASS]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
fail()  { echo -e "${RED}[FAIL]${NC} $1"; FAILED=1; }

FAILED=0

# ── Pre-flight ──────────────────────────────────────────────────────────────

if ! command -v aws &>/dev/null; then
  fail "AWS CLI (aws) is not installed or not in PATH."
  exit 1
fi

if ! aws sts get-caller-identity &>/dev/null; then
  fail "Unable to validate AWS credentials."
  exit 1
fi

echo ""
echo "=== Validating ECR Infrastructure ==="
echo "  Region: ${AWS_REGION}"
echo ""

# ── Validate each repository ──────────────────────────────────────────────────

for REPO in "${REPOS[@]}"; do
  echo "── Checking repository: ${REPO}"

  # Check repository exists
  REPO_INFO=$(aws ecr describe-repositories \
    --repository-names "${REPO}" \
    --region "${AWS_REGION}" \
    2>/dev/null) || {
    fail "Repository '${REPO}' does not exist."
    continue
  }

  ok "Repository '${REPO}' exists."

  # Check imageTagMutability is IMMUTABLE
  MUTABILITY=$(echo "${REPO_INFO}" | python3 -c "import sys,json; print(json.load(sys.stdin)['repositories'][0].get('imageTagMutability','MISSING'))" 2>/dev/null || echo "PARSE_ERROR")
  if [ "${MUTABILITY}" = "IMMUTABLE" ]; then
    ok "  imageTagMutability: IMMUTABLE ✓"
  else
    fail "  imageTagMutability is '${MUTABILITY}' — expected 'IMMUTABLE'"
  fi

  # Check lifecycle policy exists
  POLICY=$(aws ecr get-lifecycle-policy \
    --repository-name "${REPO}" \
    --region "${AWS_REGION}" \
    2>/dev/null) || {
    fail "  Lifecycle policy NOT configured."
    continue
  }

  ok "  Lifecycle policy configured."

  # Decode and check lifecycle policy rules
  POLICY_TEXT=$(echo "${POLICY}" | python3 -c "import sys,json; print(json.load(sys.stdin)['lifecyclePolicyText'])" 2>/dev/null || echo "PARSE_ERROR")
  if echo "${POLICY_TEXT}" | python3 -c "
import sys, json
try:
    policy = json.load(sys.stdin)
    rules = policy.get('rules', [])
    if len(rules) >= 2:
        sys.exit(0)  # minimal: at least 2 rules (untagged + tagged)
    else:
        sys.exit(1)
except:
    sys.exit(2)
" 2>/dev/null; then
    ok "  Lifecycle policy has sufficient rules (≥2)."
  else
    fail "  Lifecycle policy has fewer than 2 rules."
  fi

  # Check untaged image rule (7 days)
  if echo "${POLICY_TEXT}" | python3 -c "
import sys, json
policy = json.load(sys.stdin)
for rule in policy.get('rules', []):
    sel = rule.get('selection', {})
    if sel.get('tagStatus') == 'untagged' and sel.get('countNumber') == 7:
        sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
    ok "  Untagged image expiration: 7 days ✓"
  else
    fail "  Untagged image expiration rule missing or not 7 days."
  fi

  # Check max 20 images rule
  if echo "${POLICY_TEXT}" | python3 -c "
import sys, json
policy = json.load(sys.stdin)
for rule in policy.get('rules', []):
    sel = rule.get('selection', {})
    if sel.get('tagStatus') == 'any' and sel.get('countNumber') == 20:
        sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
    ok "  Max images retention: 20 ✓"
  else
    fail "  Max image retention rule missing or count is not 20."
  fi

  echo ""
done

# ── Summary ──────────────────────────────────────────────────────────────────
echo "====================================="
if [ "${FAILED}" -eq 0 ]; then
  echo -e "${GREEN}All ECR infrastructure validations passed.${NC}"
  exit 0
else
  echo -e "${RED}${FAILED} validation(s) failed.${NC}"
  exit 1
fi
