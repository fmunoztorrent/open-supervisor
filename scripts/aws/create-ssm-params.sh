#!/usr/bin/env bash
# create-ssm-params.sh — US-06: Create AWS SSM Parameter Store parameters
# and Secrets Manager secrets for the open-supervisor staging environment.
#
# Usage:
#   bash scripts/aws/create-ssm-params.sh             # Dry-run (show commands, no execution)
#   bash scripts/aws/create-ssm-params.sh --execute    # Actually create parameters
#   bash scripts/aws/create-ssm-params.sh --region us-west-2 --execute
#
# Idempotent: uses put-parameter --overwrite and create-secret --force-overwrite.
# Safe to run multiple times — will update existing parameters with the same values.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# ─── Configuration ───────────────────────────────────────────────────────────
# Defaults — override with --region and --environment flags
AWS_REGION="${AWS_REGION:-us-east-1}"
ENVIRONMENT="${ENVIRONMENT:-staging}"
DRY_RUN=true  # Default to dry-run (use --execute to actually run)

# ─── Parse arguments ─────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --execute)
      DRY_RUN=false
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --region)
      AWS_REGION="$2"
      shift 2
      ;;
    --environment|--env)
      ENVIRONMENT="$2"
      shift 2
      ;;
    --help|-h)
      echo "Usage: bash scripts/aws/create-ssm-params.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --execute              Actually create/update parameters (default: dry-run)"
      echo "  --dry-run              Show commands without executing (default)"
      echo "  --region <region>      AWS region (default: us-east-1)"
      echo "  --environment|--env    Environment name e.g. staging, production (default: staging)"
      echo "  --help, -h             Show this help message"
      echo ""
      echo "Examples:"
      echo "  bash scripts/aws/create-ssm-params.sh                             # Dry-run"
      echo "  bash scripts/aws/create-ssm-params.sh --execute                    # Create params"
      echo "  bash scripts/aws/create-ssm-params.sh --region us-west-2 --execute # Custom region"
      exit 0
      ;;
    *)
      echo "ERROR: Unknown option: $1"
      echo "Usage: bash scripts/aws/create-ssm-params.sh [--execute] [--region <region>] [--environment <env>]"
      exit 1
      ;;
  esac
done

PARAM_PREFIX="/open-supervisor/${ENVIRONMENT}"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  open-supervisor SSM Parameter Setup"
echo "  Environment: ${ENVIRONMENT}"
echo "  AWS Region:  ${AWS_REGION}"
echo "  Mode:        $( $DRY_RUN && echo 'DRY-RUN (use --execute to apply)' || echo 'LIVE' )"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ─── Prerequisites check (skip in dry-run mode) ─────────────────────────────
if ! $DRY_RUN; then
  if ! command -v aws &>/dev/null; then
    echo "ERROR: AWS CLI is not installed. Please install it first."
    echo "  https://aws.amazon.com/cli/"
    exit 1
  fi

  # Verify AWS CLI is minimally functional
  if ! aws --version &>/dev/null; then
    echo "ERROR: AWS CLI is installed but not functioning correctly."
    echo "  Try: aws --version"
    exit 1
  fi
fi

# ─── Helper function: create or update SSM parameter ─────────────────────────
# Idempotent: uses --overwrite to update existing parameters.
upsert_ssm_param() {
  local name="$1"
  local value="$2"
  local type="$3"   # String or SecureString
  local description="$4"

  echo "  SSM: ${name} (${type})"

  if $DRY_RUN; then
    echo "    → [DRY-RUN] aws ssm put-parameter \\"
    echo "        --name \"${name}\" \\"
    echo "        --value \"${value:0:30}...\" \\"
    echo "        --type \"${type}\" \\"
    echo "        --overwrite \\"
    echo "        --region \"${AWS_REGION}\""
    echo "        --description \"${description}\""
    return
  fi

  aws ssm put-parameter \
    --name "${name}" \
    --value "${value}" \
    --type "${type}" \
    --overwrite \
    --region "${AWS_REGION}" \
    --description "${description}"

  echo "    ✓ Created/Updated"
}

# ─── Helper function: create or update Secrets Manager secret ────────────────
# Idempotent: uses --force-overwrite to update existing secrets.
upsert_secret() {
  local name="$1"
  local value="$2"
  local description="$3"

  echo "  SECRETS MGR: ${name}"

  if $DRY_RUN; then
    echo "    → [DRY-RUN] aws secretsmanager create-secret \\"
    echo "        --name \"${name}\" \\"
    echo "        --secret-string \"${value:0:30}...\" \\"
    echo "        --force-overwrite \\"
    echo "        --region \"${AWS_REGION}\" \\"
    echo "        --description \"${description}\""
    return
  fi

  # create-secret will succeed if secret doesn't exist; --force-overwrite handles updates
  aws secretsmanager create-secret \
    --name "${name}" \
    --secret-string "${value}" \
    --force-overwrite \
    --region "${AWS_REGION}" \
    --description "${description}"

  echo "    ✓ Created/Updated"
}

# ─── SSM Parameters: Store Configuration ─────────────────────────────────────
echo "── SSM Parameters (Parameter Store)"
echo ""

# KAFKA_BROKER — Kafka bootstrap broker connection string
# REQUIRED: Replace with actual MSK/self-managed Kafka broker endpoint after provisioning.
upsert_ssm_param \
  "${PARAM_PREFIX}/KAFKA_BROKER" \
  "bootstrap.kafka.example.com:9092" \
  "String" \
  "Kafka bootstrap broker for open-supervisor. REPLACE with actual MSK or self-managed Kafka endpoint."

# REDIS_HOST — Redis / ElastiCache host
# REQUIRED: Replace with actual ElastiCache endpoint after provisioning.
upsert_ssm_param \
  "${PARAM_PREFIX}/REDIS_HOST" \
  "redis-cluster.example.com" \
  "String" \
  "Redis/ElastiCache host for pub/sub and caching. REPLACE with actual endpoint."

# REDIS_PORT — Redis connection port (default 6379)
upsert_ssm_param \
  "${PARAM_PREFIX}/REDIS_PORT" \
  "6379" \
  "String" \
  "Redis connection port (default: 6379)."

# DATABASE_URL — Postgres/RDS connection string (SecureString — sensitive)
# REQUIRED: Replace with actual RDS endpoint, user, password, and database name.
upsert_ssm_param \
  "${PARAM_PREFIX}/DATABASE_URL" \
  "postgresql://user:password@database-host.example.com:5432/open_supervisor" \
  "SecureString" \
  "Postgres/RDS connection URL. REPLACE with actual RDS credentials. Stored as SecureString (encrypted)."

# SSE_SERVER_URL — Internal URL for SSE server (used by BFF for streaming)
upsert_ssm_param \
  "${PARAM_PREFIX}/SSE_SERVER_URL" \
  "http://sse-server.open-supervisor.local:3002" \
  "String" \
  "Internal URL for the SSE server service. Used by BFF to proxy SSE events."

# AUTH_SERVICE_URL — Internal URL for authorization service (used by BFF for REST calls)
upsert_ssm_param \
  "${PARAM_PREFIX}/AUTH_SERVICE_URL" \
  "http://authorization-service.open-supervisor.local:3001" \
  "String" \
  "Internal URL for the authorization-service. Used by BFF for REST API calls."

# KEYCLOAK_URL — Keycloak / IAM server base URL
# REQUIRED: Replace with actual Keycloak or IAM endpoint.
upsert_ssm_param \
  "${PARAM_PREFIX}/KEYCLOAK_URL" \
  "https://keycloak.example.com" \
  "String" \
  "Keycloak/IAM server base URL for authentication. REPLACE with actual endpoint."

# KEYCLOAK_REALM — Keycloak realm name
# REQUIRED: Replace with actual realm name.
upsert_ssm_param \
  "${PARAM_PREFIX}/KEYCLOAK_REALM" \
  "open-supervisor" \
  "String" \
  "Keycloak realm name. REPLACE with actual realm if different from default."

# KEYCLOAK_CLIENT_ID — Keycloak client ID for backend services
# REQUIRED: Replace with actual client ID.
upsert_ssm_param \
  "${PARAM_PREFIX}/KEYCLOAK_CLIENT_ID" \
  "open-supervisor-backend" \
  "String" \
  "Keycloak client ID for backend service authentication. REPLACE with actual client ID."

echo ""

# ─── Secrets Manager: Sensitive Credentials ──────────────────────────────────
echo "── Secrets Manager"
echo ""

# KEYCLOAK_CLIENT_SECRET — Sensitive credential, stored in Secrets Manager (not SSM)
# REQUIRED: Replace with the actual Keycloak client secret after provisioning.
# This is stored in Secrets Manager (not SSM Parameter Store) because it is a
# credential that requires rotation support and independent access auditing.
upsert_secret \
  "${PARAM_PREFIX}/KEYCLOAK_CLIENT_SECRET" \
  "placeholder-client-secret-replace-with-real-value" \
  "Keycloak client secret for backend service authentication. Stored in Secrets Manager for rotation support. REPLACE with actual secret."

echo ""

# ─── Summary ─────────────────────────────────────────────────────────────────
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  SSM Parameters: 9 (${PARAM_PREFIX}/*)"
echo "    • KAFKA_BROKER        (String)"
echo "    • REDIS_HOST           (String)"
echo "    • REDIS_PORT           (String)"
echo "    • DATABASE_URL         (SecureString)"
echo "    • SSE_SERVER_URL       (String)"
echo "    • AUTH_SERVICE_URL     (String)"
echo "    • KEYCLOAK_URL         (String)"
echo "    • KEYCLOAK_REALM       (String)"
echo "    • KEYCLOAK_CLIENT_ID   (String)"
echo "  Secrets Manager: 1"
echo "    • KEYCLOAK_CLIENT_SECRET"
echo ""
echo "  Hierarcy: /open-supervisor/${ENVIRONMENT}/<variable>"
echo "  Region:   ${AWS_REGION}"
echo ""

if $DRY_RUN; then
  echo "  ⚠️  DRY-RUN mode — no parameters were created."
  echo "     Re-run with --execute to create/update parameters in AWS."
  echo ""
  echo "  Next steps:"
  echo "    1. Provision Kafka (MSK) and update KAFKA_BROKER"
  echo "    2. Provision Redis (ElastiCache) and update REDIS_HOST"
  echo "    3. Provision RDS Postgres and update DATABASE_URL"
  echo "    4. Configure Keycloak and update KEYCLOAK_* values"
  echo "    5. Run with --execute to create all parameters"
  echo ""
  exit 0
fi

echo "  ✅ All parameters have been created/updated successfully."
echo ""
