#!/usr/bin/env bash
set -euo pipefail

# bootstrap-msk-local.sh — Provisions an MSK cluster in LocalStack, creates Kafka topics,
# and writes the bootstrap broker address to scripts/msk-env.sh.
#
# Prerequisites:
#   - LocalStack Pro/Ultimate running with SERVICES=msk
#   - awslocal CLI (pip install awscli-local)
#
# Usage:
#   bash scripts/bootstrap-msk-local.sh

# ── Configuration ──────────────────────────────────────────────────────────────
CLUSTER_NAME="${MSK_CLUSTER_NAME:-open-supervisor-local-dev-kafka}"
KAFKA_VERSION="${MSK_KAFKA_VERSION:-3.6.0}"
BROKER_NODES="${MSK_BROKER_NODES:-1}"
INSTANCE_TYPE="${MSK_INSTANCE_TYPE:-kafka.m5.xlarge}"
REGION="${AWS_DEFAULT_REGION:-us-east-1}"
LOCALSTACK_URL="${LOCALSTACK_ENDPOINT:-http://localhost:4566}"
MAX_WAIT_SECONDS="${MSK_MAX_WAIT_SECONDS:-60}"
POLL_INTERVAL=3

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MSK_ENV_FILE="$SCRIPT_DIR/msk-env.sh"

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RESET='\033[0m'
info()  { echo -e "${GREEN}[INFO]${RESET}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${RESET}  $*" >&2; }
error() { echo -e "${RED}[ERROR]${RESET} $*" >&2; }

# ── Prerequisite checks ───────────────────────────────────────────────────────

if ! command -v awslocal >/dev/null 2>&1; then
  error "awslocal is not installed."
  error "Install it with: pip install awscli-local"
  error "Or see: https://github.com/localstack/awscli-local"
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  error "curl is not installed."
  exit 1
fi

# ── Health check ──────────────────────────────────────────────────────────────

info "Checking LocalStack health at $LOCALSTACK_URL ..."

HEALTH_RESPONSE=$(curl -s "$LOCALSTACK_URL/_localstack/health" 2>&1) || true

# Parse MSK status from JSON response.
# Strip any HTTP headers the mock or proxy may prepend (extract last JSON object).
HEALTH_JSON=$(echo "$HEALTH_RESPONSE" | python3 -c "
import sys, json, re
text = sys.stdin.read()
# Find the last JSON object in the output (skip HTTP headers if present)
matches = list(re.finditer(r'\{[^{}]*(\{[^{}]*\}[^{}]*)*\}', text))
if matches:
    try:
        data = json.loads(matches[-1].group())
        services = data.get('services', {})
        status = services.get('msk', 'missing')
        print(status)
    except Exception:
        print('parse_error')
else:
    print('no_json')
" 2>/dev/null || echo "no_json")

case "$HEALTH_JSON" in
  available)
    # MSK is available — proceed
    ;;
  unavailable|disabled|error)
    error "MSK service is not available (status: $HEALTH_JSON)."
    error "MSK requires LocalStack Pro/Ultimate with a valid LOCALSTACK_AUTH_TOKEN."
    exit 1
    ;;
  missing)
    error "MSK service not found in LocalStack health response."
    error "Ensure SERVICES includes 'msk' in docker-compose.localstack.yml."
    error "MSK requires LocalStack Pro/Ultimate with a valid AUTH_TOKEN."
    exit 1
    ;;
  *)
    error "LocalStack is not reachable at $LOCALSTACK_URL"
    error "Start it with: docker compose -f docker-compose.yml -f docker-compose.localstack.yml up -d localstack"
    exit 1
    ;;
esac

info "MSK service is available."

# ── Check for existing cluster (idempotent) ───────────────────────────────────

EXISTING_CLUSTER_ARN=""
CLUSTER_LIST=$(awslocal kafka list-clusters --region "$REGION" 2>&1) || true
if echo "$CLUSTER_LIST" | grep -q "$CLUSTER_NAME"; then
  EXISTING_CLUSTER_ARN=$(echo "$CLUSTER_LIST" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    for c in data.get('ClusterInfoList', []):
        if c.get('ClusterName') == '$CLUSTER_NAME':
            print(c.get('ClusterArn', ''))
            break
except Exception:
    pass
" 2>/dev/null || echo "")
fi

if [ -n "$EXISTING_CLUSTER_ARN" ]; then
  info "Cluster '$CLUSTER_NAME' already exists (ARN: $EXISTING_CLUSTER_ARN). Reusing..."

  # Wait for ACTIVE state on existing cluster
  CLUSTER_STATE=""
  ELAPSED=0
  while [ "$ELAPSED" -lt "$MAX_WAIT_SECONDS" ]; do
    CLUSTER_INFO=$(awslocal kafka describe-cluster --cluster-arn "$EXISTING_CLUSTER_ARN" --region "$REGION" 2>&1) || true
    CLUSTER_STATE=$(echo "$CLUSTER_INFO" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    print(data.get('ClusterInfo', {}).get('State', 'UNKNOWN'))
except Exception:
    print('UNKNOWN')
" 2>/dev/null || echo "UNKNOWN")

    if [ "$CLUSTER_STATE" = "ACTIVE" ]; then
      info "Cluster is ACTIVE."
      break
    fi

    warn "Cluster state is $CLUSTER_STATE. Waiting... ($ELAPSED/${MAX_WAIT_SECONDS}s)"
    sleep "$POLL_INTERVAL"
    ELAPSED=$((ELAPSED + POLL_INTERVAL))
  done

  if [ "$CLUSTER_STATE" != "ACTIVE" ]; then
    error "Cluster did not become ACTIVE within ${MAX_WAIT_SECONDS}s. Current state: $CLUSTER_STATE"
    exit 1
  fi
else
  # ── Create MSK cluster ────────────────────────────────────────────────────────
  info "Creating MSK cluster '$CLUSTER_NAME' (version $KAFKA_VERSION, $BROKER_NODES node(s))..."

  CREATE_OUTPUT=$(awslocal kafka create-cluster \
    --cluster-name "$CLUSTER_NAME" \
    --kafka-version "$KAFKA_VERSION" \
    --number-of-broker-nodes "$BROKER_NODES" \
    --broker-node-group-info "instanceType=$INSTANCE_TYPE,clientSubnets=[subnet-12345678]" \
    --region "$REGION" 2>&1) || {
    error "Failed to create MSK cluster."
    error "Output: $CREATE_OUTPUT"
    exit 1
  }

  CLUSTER_ARN=$(echo "$CREATE_OUTPUT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    print(data.get('ClusterArn', ''))
except Exception:
    print('')
" 2>/dev/null || echo "")

  if [ -z "$CLUSTER_ARN" ]; then
    error "Failed to parse ClusterArn from create-cluster response."
    error "Output: $CREATE_OUTPUT"
    exit 1
  fi

  info "Cluster created: $CLUSTER_ARN"

  # ── Wait for ACTIVE state ──────────────────────────────────────────────────────
  info "Waiting for cluster to become ACTIVE (max ${MAX_WAIT_SECONDS}s)..."

  CLUSTER_STATE=""
  ELAPSED=0
  while [ "$ELAPSED" -lt "$MAX_WAIT_SECONDS" ]; do
    CLUSTER_INFO=$(awslocal kafka describe-cluster --cluster-arn "$CLUSTER_ARN" --region "$REGION" 2>&1) || true
    CLUSTER_STATE=$(echo "$CLUSTER_INFO" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    print(data.get('ClusterInfo', {}).get('State', 'UNKNOWN'))
except Exception:
    print('UNKNOWN')
" 2>/dev/null || echo "UNKNOWN")

    if [ "$CLUSTER_STATE" = "ACTIVE" ]; then
      info "Cluster is ACTIVE."
      break
    fi

    warn "Cluster state: $CLUSTER_STATE ($ELAPSED/${MAX_WAIT_SECONDS}s)"
    sleep "$POLL_INTERVAL"
    ELAPSED=$((ELAPSED + POLL_INTERVAL))
  done

  if [ "$CLUSTER_STATE" != "ACTIVE" ]; then
    error "Cluster did not become ACTIVE within ${MAX_WAIT_SECONDS}s. Current state: $CLUSTER_STATE"
    exit 1
  fi
fi

# ── Get bootstrap brokers ─────────────────────────────────────────────────────
info "Retrieving bootstrap brokers..."

BROKER_OUTPUT=$(awslocal kafka get-bootstrap-brokers --cluster-arn "${EXISTING_CLUSTER_ARN:-$CLUSTER_ARN}" --region "$REGION" 2>&1) || {
  error "Failed to get bootstrap brokers."
  error "Output: $BROKER_OUTPUT"
  exit 1
}

BOOTSTRAP_BROKERS=$(echo "$BROKER_OUTPUT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    print(data.get('BootstrapBrokerString', ''))
except Exception:
    print('')
" 2>/dev/null || echo "")

if [ -z "$BOOTSTRAP_BROKERS" ]; then
  error "Failed to parse BootstrapBrokerString from response."
  error "Output: $BROKER_OUTPUT"
  exit 1
fi

info "Bootstrap brokers: $BOOTSTRAP_BROKERS"

# ── Create topics via awslocal ────────────────────────────────────────────────
# Uses LocalStack's extended kafka API for topic management.
# In real AWS MSK, topics are created directly via Kafka admin client;
# LocalStack provides create-topic/list-topics as convenience commands.
info "Creating Kafka topics..."

# List existing topics first (idempotent check)
EXISTING_TOPICS=""
LIST_OUTPUT=$(awslocal kafka list-topics --cluster-arn "${EXISTING_CLUSTER_ARN:-$CLUSTER_ARN}" --region "$REGION" 2>&1) || true
EXISTING_TOPICS=$(echo "$LIST_OUTPUT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    topics = data.get('topics', data.get('Topics', []))
    if isinstance(topics, list):
        print(','.join(topics))
    else:
        print('')
except Exception:
    print('')
" 2>/dev/null || echo "")

REQUIRED_TOPICS="auth.requests"
for topic in $(echo "$REQUIRED_TOPICS" | tr ',' ' '); do
  if echo "$EXISTING_TOPICS" | grep -q "$topic" 2>/dev/null; then
    info "Topic already exists: $topic"
  else
    CREATE_OUTPUT=$(awslocal kafka create-topic \
      --cluster-arn "${EXISTING_CLUSTER_ARN:-$CLUSTER_ARN}" \
      --topic-name "$topic" \
      --partitions 1 \
      --replication-factor 1 \
      --region "$REGION" 2>&1) || {
      error "Failed to create topic '$topic'."
      error "Output: $CREATE_OUTPUT"
      exit 1
    }
    info "Created topic: $topic"
  fi
done

info "Topics ready."

# ── Write env file ────────────────────────────────────────────────────────────
cat > "$MSK_ENV_FILE" <<EOF
# Generated by bootstrap-msk-local.sh — do not edit manually
# Source this file before starting services or using the injection script:
#   source scripts/msk-env.sh
export KAFKA_BROKERS="$BOOTSTRAP_BROKERS"
EOF

info "Env file written: $MSK_ENV_FILE"
echo ""
info "Bootstrap complete!"
info "  Cluster:   $CLUSTER_NAME"
info "  Brokers:   $BOOTSTRAP_BROKERS"
info "  Env file:  $MSK_ENV_FILE"
echo ""
info "Next: source scripts/msk-env.sh && make services"
