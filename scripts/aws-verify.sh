#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# aws-verify.sh — Deploy open-supervisor to AWS, verify it works, then destroy
#
# Usage:
#   bash scripts/aws-verify.sh [dev|prod]
#   make aws-verify ENV=dev
#
# Pre-requisites (must be done BEFORE running this script):
#   1. AWS CLI v2 configured:  aws configure
#   2. Terraform >= 1.6:       brew install terraform
#   3. Docker or Podman:       docker --version
#   4. jq:                     brew install jq
#   5. ACM certificate ARN set in envs/<env>/terraform.tfvars
#   6. DB password in SSM:     aws ssm put-parameter --name "/open-supervisor/<env>/db/password" ...
#
# What this script does:
#   Phase 1 — terraform apply (VPC, ALB, RDS, ElastiCache, MSK, ECR)
#   Phase 2 — retrieve MSK brokers, update tfvars, re-apply (ECS services)
#   Phase 3 — build & push Docker images to ECR
#   Phase 4 — force ECS deployments, wait for healthy tasks
#   Phase 5 — show ALB URL, prompt for confirmation
#   Phase 6 — terraform destroy
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Config ───────────────────────────────────────────────────────────────────
ENV="${1:-dev}"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TF_DIR="${ROOT_DIR}/infra/terraform"
TF_VARS="${TF_DIR}/envs/${ENV}/terraform.tfvars"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()  { echo -e "${GREEN}[$(date +%H:%M:%S)]${NC} $*"; }
warn() { echo -e "${YELLOW}[$(date +%H:%M:%S)] WARN${NC} $*"; }
err()  { echo -e "${RED}[$(date +%H:%M:%S)] ERROR${NC} $*"; }
step() { echo -e "\n${CYAN}${BOLD}── Step $1${NC} ${CYAN}$2${NC}"; }

cleanup() {
  local exit_code=$?
  if [ $exit_code -ne 0 ]; then
    echo ""
    err "Script failed at step ${CURRENT_STEP:-?} with exit code ${exit_code}"
    err "Resources MAY still be running in AWS — verify manually:"
    echo "  cd ${TF_DIR} && terraform destroy -var-file=envs/${ENV}/terraform.tfvars"
  fi
  exit $exit_code
}
trap cleanup EXIT
CURRENT_STEP="0"

# ── Prerequisite checks ─────────────────────────────────────────────────────
step "1" "Checking prerequisites"

command -v terraform >/dev/null 2>&1 || { err "terraform not found — install: brew install terraform"; exit 1; }
command -v aws >/dev/null 2>&1        || { err "aws CLI not found — install: brew install awscli"; exit 1; }
command -v jq >/dev/null 2>&1          || { err "jq not found — install: brew install jq"; exit 1; }

# Detect container engine
if command -v podman >/dev/null 2>&1; then
  CONTAINER_CMD="podman"
elif command -v docker >/dev/null 2>&1; then
  CONTAINER_CMD="docker"
else
  err "Neither docker nor podman found — install one to push images to ECR"
  exit 1
fi
log "Container engine: ${CONTAINER_CMD}"

# Verify AWS credentials
if ! aws sts get-caller-identity --query Account --output text >/dev/null 2>&1; then
  err "AWS credentials not configured — run: aws configure"
  exit 1
fi
AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
AWS_REGION=$(grep 'aws_region' "${TF_VARS}" | grep -o '"[^"]*"' | tr -d '"' | head -1)
AWS_REGION="${AWS_REGION:-us-east-1}"
log "AWS account: ${AWS_ACCOUNT} | region: ${AWS_REGION}"

# ── Validate tfvars ─────────────────────────────────────────────────────────
CURRENT_STEP="1b"
step "1b" "Validating terraform.tfvars"

if ! grep -q 'acm_certificate_arn.*arn:aws:acm:' "${TF_VARS}"; then
  err "acm_certificate_arn is not set with a real ARN in ${TF_VARS}"
  err "Request a certificate: aws acm request-certificate --domain-name api.yourdomain.com --region ${AWS_REGION}"
  exit 1
fi
log "ACM certificate ARN: OK"

if ! grep -q 'kafka_bootstrap_brokers.*PLACEHOLDER' "${TF_VARS}"; then
  warn "kafka_bootstrap_brokers already has a non-placeholder value — will be overwritten after MSK creation"
fi
log "tfvars validation: OK"

# ── Phase 1: terraform apply (infrastructure) ───────────────────────────────
CURRENT_STEP="2"
step "2" "Terraform init & apply — Phase 1 (infrastructure)"

cd "${TF_DIR}"

log "Running terraform init..."
terraform init -input=false

log "Running terraform plan..."
terraform plan -var-file="envs/${ENV}/terraform.tfvars" -out="plan-${TIMESTAMP}.tfplan"

log "Running terraform apply..."
terraform apply -auto-approve "plan-${TIMESTAMP}.tfplan"

# ── Retrieve outputs ────────────────────────────────────────────────────────
CURRENT_STEP="3"
step "3" "Retrieving Terraform outputs"

ECR_URLS_JSON=$(terraform output -json ecr_repository_urls)
ECR_BFF=$(echo "${ECR_URLS_JSON}" | jq -r '.bff')
ECR_SSE=$(echo "${ECR_URLS_JSON}" | jq -r '."sse-server"')
ECR_AUTH=$(echo "${ECR_URLS_JSON}" | jq -r '."authorization-service"')
ECS_CLUSTER=$(terraform output -raw ecs_cluster_name)
ALB_DNS=$(terraform output -raw alb_dns_name)
MSK_ARN=$(terraform output -raw msk_cluster_arn)

log "ECR BFF:   ${ECR_BFF}"
log "ECR SSE:   ${ECR_SSE}"
log "ECR AUTH:  ${ECR_AUTH}"
log "ECS cluster: ${ECS_CLUSTER}"
log "ALB DNS:   ${ALB_DNS}"

# ── Phase 2: MSK bootstrap brokers + re-apply ───────────────────────────────
CURRENT_STEP="4"
step "4" "Retrieving MSK bootstrap brokers"

log "Waiting for MSK cluster to become ACTIVE (may take several minutes)..."
aws kafka get-bootstrap-brokers --cluster-arn "${MSK_ARN}" --region "${AWS_REGION}" >/dev/null 2>&1 || {
  warn "MSK not ready yet, waiting 60s..."
  sleep 60
}

MSK_BROKERS=$(aws kafka get-bootstrap-brokers --cluster-arn "${MSK_ARN}" --region "${AWS_REGION}" --query 'BootstrapBrokerString' --output text)
log "MSK bootstrap brokers: ${MSK_BROKERS}"

# Update tfvars with real brokers
if [[ "$(uname)" == "Darwin" ]]; then
  sed -i '' "s|kafka_bootstrap_brokers = .*|kafka_bootstrap_brokers = \"${MSK_BROKERS}\"|" "envs/${ENV}/terraform.tfvars"
else
  sed -i "s|kafka_bootstrap_brokers = .*|kafka_bootstrap_brokers = \"${MSK_BROKERS}\"|" "envs/${ENV}/terraform.tfvars"
fi
log "Updated kafka_bootstrap_brokers in tfvars"

log "Re-applying terraform with correct MSK brokers..."
terraform apply -auto-approve -var-file="envs/${ENV}/terraform.tfvars"

# ── Phase 3: Build & push Docker images ─────────────────────────────────────
CURRENT_STEP="5"
step "5" "Building & pushing Docker images to ECR"

log "Authenticating with ECR..."
aws ecr get-login-password --region "${AWS_REGION}" | \
  ${CONTAINER_CMD} login --username AWS --password-stdin "${AWS_ACCOUNT}.dkr.ecr.${AWS_REGION}.amazonaws.com"

SERVICES=(
  "bff:${ECR_BFF}:apps/bff"
  "sse-server:${ECR_SSE}:apps/sse-server"
  "authorization-service:${ECR_AUTH}:apps/authorization-service"
)

for svc in "${SERVICES[@]}"; do
  IFS=':' read -r name ecr_url dockerfile_dir <<< "${svc}"
  log "Building ${name} image..."
  ${CONTAINER_CMD} build \
    -f "${ROOT_DIR}/${dockerfile_dir}/Dockerfile" \
    -t "${ecr_url}:latest" \
    "${ROOT_DIR}"

  log "Pushing ${name} to ECR..."
  ${CONTAINER_CMD} push "${ecr_url}:latest"
done

log "All images pushed to ECR"

# ── Phase 4: Force ECS deployments + wait for healthy ───────────────────────
CURRENT_STEP="6"
step "6" "Forcing ECS deployments and waiting for healthy tasks"

ECS_SERVICES=(
  "${ECS_CLUSTER}-bff"
  "${ECS_CLUSTER}-sse-server"
  "${ECS_CLUSTER}-authorization-service"
)

for ecs_svc in "${ECS_SERVICES[@]}"; do
  log "Forcing new deployment for ${ecs_svc}..."
  aws ecs update-service \
    --cluster "${ECS_CLUSTER}" \
    --service "${ecs_svc}" \
    --force-new-deployment \
    --region "${AWS_REGION}" \
    >/dev/null
done

log "Waiting for ECS services to become stable (max 5 minutes)..."
for ecs_svc in "${ECS_SERVICES[@]}"; do
  log "Waiting for ${ecs_svc}..."
  aws ecs wait services-stable \
    --cluster "${ECS_CLUSTER}" \
    --services "${ecs_svc}" \
    --region "${AWS_REGION}"
  log "  ${ecs_svc}: STABLE"
done

# ── Phase 5: Show results & prompt ──────────────────────────────────────────
CURRENT_STEP="7"
step "7" "Verification — stack is running"

echo ""
log "═══════════════════════════════════════════════════════════════════════════"
log "  open-supervisor is LIVE on AWS (${ENV})"
log "═══════════════════════════════════════════════════════════════════════════"
log "  ALB URL:    https://${ALB_DNS}"
log "  Health:     curl https://${ALB_DNS}/health"
log "  Stream SSE: curl -N https://${ALB_DNS}/stream/store/store-1"
log ""
log "  ECS cluster:  ${ECS_CLUSTER}"
log "  AWS region:   ${AWS_REGION}"
log "  Environment:  ${ENV}"
log "═══════════════════════════════════════════════════════════════════════════"

echo ""
echo -e "${YELLOW}${BOLD}⚠  Resources are running and incurring AWS costs.${NC}"
echo -e "${YELLOW}Press ENTER to DESTROY everything, or Ctrl+C to keep resources running.${NC}"
read -r _

# ── Phase 6: Destroy ────────────────────────────────────────────────────────
CURRENT_STEP="8"
step "8" "Destroying all AWS resources"

cd "${TF_DIR}"
terraform destroy -auto-approve -var-file="envs/${ENV}/terraform.tfvars"

# Restore placeholder in tfvars so it's clean for next run
CURRENT_STEP="cleanup"
if [[ "$(uname)" == "Darwin" ]]; then
  sed -i '' 's|kafka_bootstrap_brokers = .*|kafka_bootstrap_brokers = "PLACEHOLDER_UPDATE_AFTER_MSK_CREATION:9098"|' "envs/${ENV}/terraform.tfvars"
else
  sed -i 's|kafka_bootstrap_brokers = .*|kafka_bootstrap_brokers = "PLACEHOLDER_UPDATE_AFTER_MSK_CREATION:9098"|' "envs/${ENV}/terraform.tfvars"
fi
log "Restored placeholder in tfvars"

log ""
log "═══════════════════════════════════════════════════════════════════════════"
log "  ✅ All AWS resources destroyed"
log "  Total cost: ~\$1-2 (depending on how long resources were running)"
log "═══════════════════════════════════════════════════════════════════════════"

trap - EXIT
