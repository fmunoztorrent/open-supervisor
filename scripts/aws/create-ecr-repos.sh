#!/usr/bin/env bash
set -euo pipefail

# US-03: Create ECR repositories for open-supervisor backend services.
#
# Idempotent script that creates 3 ECR repositories:
#   - open-supervisor/authorization-service
#   - open-supervisor/sse-server
#   - open-supervisor/bff
#
# Each repo uses IMMUTABLE image tags and a lifecycle policy:
#   - Keep max 20 tagged images
#   - Expire untagged images after 7 days
#
# Usage:
#   AWS_REGION=us-east-1 bash scripts/aws/create-ecr-repos.sh
#
# Requirements:
#   - AWS CLI installed (aws)
#   - AWS credentials configured (env vars, ~/.aws/credentials, or IAM role)
#   - Permissions: ecr:DescribeRepositories, ecr:CreateRepository,
#     ecr:PutLifecyclePolicy, sts:GetCallerIdentity

set -euo pipefail

REPOS=(
  "open-supervisor/authorization-service"
  "open-supervisor/sse-server"
  "open-supervisor/bff"
)

AWS_REGION="${AWS_REGION:-us-east-1}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ── Pre-flight checks ─────────────────────────────────────────────────────────

# Check AWS CLI availability
if ! command -v aws &>/dev/null; then
  error "AWS CLI (aws) is not installed or not in PATH."
  echo "  Install it: https://aws.amazon.com/cli/"
  exit 1
fi

# Check AWS credentials by calling sts get-caller-identity
if ! aws sts get-caller-identity &>/dev/null; then
  error "Unable to validate AWS credentials."
  echo "  Configure credentials via one of:"
  echo "    - AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY env vars"
  echo "    - ~/.aws/credentials file"
  echo "    - IAM role (EC2, ECS, or OIDC)"
  exit 1
fi

info "AWS credentials validated successfully."
info "Using region: ${AWS_REGION}"

# ── Create repositories ──────────────────────────────────────────────────────

# Lifecycle policy JSON template
read -r -d '' LIFECYCLE_POLICY <<'POLICY' || true
{
  "rules": [
    {
      "rulePriority": 1,
      "description": "Expire untagged images after 7 days",
      "selection": {
        "tagStatus": "untagged",
        "countType": "sinceImagePushed",
        "countUnit": "days",
        "countNumber": 7
      },
      "action": {
        "type": "expire"
      }
    },
    {
      "rulePriority": 2,
      "description": "Keep only the last 20 tagged images",
      "selection": {
        "tagStatus": "any",
        "countType": "imageCountMoreThan",
        "countNumber": 20
      },
      "action": {
        "type": "expire"
      }
    }
  ]
}
POLICY

CREATED_COUNT=0
SKIPPED_COUNT=0

for REPO in "${REPOS[@]}"; do
  echo ""
  info "Processing repository: ${REPO}"

  # Check if repository already exists (idempotent)
  if aws ecr describe-repositories \
    --repository-names "${REPO}" \
    --region "${AWS_REGION}" \
    &>/dev/null; then
    warn "Repository '${REPO}' already exists — skipping creation."
    SKIPPED_COUNT=$((SKIPPED_COUNT + 1))
  else
    info "Creating repository '${REPO}' with IMMUTABLE tag mutability..."
    if aws ecr create-repository \
      --repository-name "${REPO}" \
      --image-tag-mutability IMMUTABLE \
      --image-scanning-configuration scanOnPush=true \
      --region "${AWS_REGION}" \
      &>/dev/null; then
      info "Repository '${REPO}' created successfully."
      CREATED_COUNT=$((CREATED_COUNT + 1))
    else
      error "Failed to create repository '${REPO}'."
      exit 1
    fi
  fi

  # Apply lifecycle policy (idempotent — put-lifecycle-policy overwrites)
  info "Applying lifecycle policy to '${REPO}'..."
  if aws ecr put-lifecycle-policy \
    --repository-name "${REPO}" \
    --lifecycle-policy-text "${LIFECYCLE_POLICY}" \
    --region "${AWS_REGION}" \
    &>/dev/null; then
    info "Lifecycle policy applied to '${REPO}'."
  else
    error "Failed to apply lifecycle policy to '${REPO}'."
    exit 1
  fi
done

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "====================================="
info "Summary:"
info "  Created:     ${CREATED_COUNT} repository(ies)"
info "  Already existed: ${SKIPPED_COUNT} repository(ies)"
echo ""
if [ "${CREATED_COUNT}" -gt 0 ] || [ "${SKIPPED_COUNT}" -gt 0 ]; then
  info "ECR repositories are ready."
  exit 0
else
  error "No repositories were processed. Something went wrong."
  exit 1
fi
