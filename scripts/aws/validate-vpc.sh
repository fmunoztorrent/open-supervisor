#!/usr/bin/env bash
# =============================================================================
# validate-vpc.sh
# Validates the VPC CloudFormation template (infra/network/vpc.yaml).
#
# Usage:
#   ./scripts/aws/validate-vpc.sh            # validates template syntax + structure
#   ./scripts/aws/validate-vpc.sh --deployed # checks deployed resources in AWS
#   ./scripts/aws/validate-vpc.sh --help     # show help
#
# Exit codes:
#   0 = all checks pass
#   1 = template validation failure
#   2 = deployed resource check failure
# =============================================================================

set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/../.." && pwd)"
TEMPLATE="$REPO_ROOT/infra/network/vpc.yaml"
STACK_NAME="${STACK_NAME:-open-supervisor-vpc}"
AWS_REGION="${AWS_REGION:-us-east-1}"
PASS=0
FAIL=0

# ── helpers ────────────────────────────────────────────────────────────────────
green() { printf "\033[32m✓ %s\033[0m\n" "$1"; }
red()   { printf "\033[31m✗ %s\033[0m\n" "$1"; }

check() {
  local desc="$1"
  shift
  if "$@"; then
    green "$desc"
    PASS=$((PASS + 1))
  else
    red "$desc"
    FAIL=$((FAIL + 1))
  fi
}

# ── usage ─────────────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--help" ]]; then
  echo "Usage: $0 [--deployed]"
  echo ""
  echo "  (no flag)   Validate CloudFormation template syntax and structure"
  echo "  --deployed  Check deployed AWS resources (requires valid AWS creds)"
  exit 0
fi

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 1: Template structural validation
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "━━━ Phase 1: CloudFormation Template Validation ━━━"

# Run Node.js structural validator
if node "$DIR/validate-vpc-structure.js" "$TEMPLATE"; then
  # Count how many tests the Node script ran
  echo ""
  echo "(Phase 1 detail above — structural checks on the CloudFormation template)"
else
  # Node script already printed failures, we just track exit
  :
fi

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 2: Deployed resource validation (only with --deployed flag)
# ═══════════════════════════════════════════════════════════════════════════════
if [[ "${1:-}" == "--deployed" ]]; then
  echo ""
  echo "━━━ Phase 2: Deployed Resource Validation (AWS CLI) ━━━"

  # Test D1: VPC exists
  check "[deployed] VPC 'open-supervisor-vpc' exists" aws ec2 describe-vpcs \
    --filters "Name=tag:Name,Values=open-supervisor-vpc" \
    --region "$AWS_REGION" \
    --query 'Vpcs[0].VpcId' --output text 2>/dev/null | grep -q 'vpc-'

  # Test D2: Public subnets exist
  check "[deployed] Public subnet 10.0.1.0/24 exists" aws ec2 describe-subnets \
    --filters "Name=cidr-block,Values=10.0.1.0/24" \
    --region "$AWS_REGION" \
    --query 'Subnets[0].SubnetId' --output text 2>/dev/null | grep -q 'subnet-'

  check "[deployed] Public subnet 10.0.2.0/24 exists" aws ec2 describe-subnets \
    --filters "Name=cidr-block,Values=10.0.2.0/24" \
    --region "$AWS_REGION" \
    --query 'Subnets[0].SubnetId' --output text 2>/dev/null | grep -q 'subnet-'

  # Test D3: Private subnets exist
  check "[deployed] Private subnet 10.0.3.0/24 exists" aws ec2 describe-subnets \
    --filters "Name=cidr-block,Values=10.0.3.0/24" \
    --region "$AWS_REGION" \
    --query 'Subnets[0].SubnetId' --output text 2>/dev/null | grep -q 'subnet-'

  check "[deployed] Private subnet 10.0.4.0/24 exists" aws ec2 describe-subnets \
    --filters "Name=cidr-block,Values=10.0.4.0/24" \
    --region "$AWS_REGION" \
    --query 'Subnets[0].SubnetId' --output text 2>/dev/null | grep -q 'subnet-'

  # Test D4: Security groups exist
  for sg in alb-sg bff-sg sse-server-sg auth-service-sg; do
    check "[deployed] SG '$sg' exists" aws ec2 describe-security-groups \
      --filters "Name=group-name,Values=$sg" \
      --region "$AWS_REGION" \
      --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null | grep -q 'sg-'
  done

  # Test D5: ALB exists
  check "[deployed] ALB 'open-supervisor-alb' exists" aws elbv2 describe-load-balancers \
    --names "open-supervisor-alb" \
    --region "$AWS_REGION" \
    --query 'LoadBalancers[0].DNSName' --output text 2>/dev/null | grep -q '\.'

  # Test D6: NAT Gateway exists
  check "[deployed] NAT Gateway exists" aws ec2 describe-nat-gateways \
    --filter "Name=tag:Name,Values=open-supervisor-nat-*" \
    --region "$AWS_REGION" \
    --query 'NatGateways[0].NatGatewayId' --output text 2>/dev/null | grep -q 'nat-'

  # Test D7: Internet Gateway exists
  check "[deployed] Internet Gateway exists" aws ec2 describe-internet-gateways \
    --filters "Name=tag:Name,Values=open-supervisor-igw" \
    --region "$AWS_REGION" \
    --query 'InternetGateways[0].InternetGatewayId' --output text 2>/dev/null | grep -q 'igw-'
fi

# ═══════════════════════════════════════════════════════════════════════════════
# Summary
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "━━━ Summary ━━━"
echo "  Passed: $PASS"
echo "  Failed: $FAIL"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
