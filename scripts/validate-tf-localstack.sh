#!/usr/bin/env bash
set -euo pipefail

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RESET='\033[0m'
pass() { echo -e "${GREEN}[PASS]${RESET} $*"; }
fail() { echo -e "${RED}[FAIL]${RESET} $*"; }
info() { echo -e "${YELLOW}[INFO]${RESET} $*"; }

# ── Flags ─────────────────────────────────────────────────────────────────────
CLEAN=false
for arg in "$@"; do [[ "$arg" == "--clean" ]] && CLEAN=true; done

# ── Bootstrap (portable — no absolute paths) ──────────────────────────────────
REPO_ROOT="$(git rev-parse --show-toplevel)"

if command -v podman >/dev/null 2>&1; then
  ENGINE=podman
  if [ -z "${DOCKER_HOST:-}" ] && podman machine inspect >/dev/null 2>&1; then
    SOCK="$(podman machine inspect --format '{{.ConnectionInfo.PodmanSocket.Path}}' 2>/dev/null)"
    [ -n "$SOCK" ] && export DOCKER_HOST="unix://$SOCK"
  fi
elif command -v docker >/dev/null 2>&1; then
  ENGINE=docker
else
  fail "Neither podman nor docker found in PATH"
  exit 1
fi
COMPOSE="$ENGINE compose"

TF_DIR="$REPO_ROOT/infra/terraform/localstack"
LOCALSTACK_URL="http://localhost:4566"
LOCALSTACK_HEALTH="$LOCALSTACK_URL/_localstack/health"

# ── Ensure LocalStack is running ───────────────────────────────────────────────
info "Checking LocalStack at $LOCALSTACK_URL ..."
if ! curl -sf "$LOCALSTACK_HEALTH" >/dev/null 2>&1; then
  info "LocalStack not running — starting it..."
  cd "$REPO_ROOT"
  $COMPOSE -f docker-compose.yml -f docker-compose.localstack.yml up -d localstack

  info "Waiting for LocalStack to be ready (up to 60s)..."
  for i in $(seq 1 30); do
    if curl -sf "$LOCALSTACK_HEALTH" >/dev/null 2>&1; then
      pass "LocalStack is ready"
      break
    fi
    [ "$i" -eq 30 ] && { fail "LocalStack did not become ready in time"; exit 1; }
    sleep 2
  done
else
  pass "LocalStack is already running"
fi

# ── Terraform validate + plan ─────────────────────────────────────────────────
cd "$TF_DIR"

info "terraform init..."
terraform init -reconfigure -input=false -no-color 2>&1 | tail -5

info "terraform validate..."
if terraform validate -no-color; then
  pass "terraform validate — configuration is valid"
else
  fail "terraform validate failed"
  exit 1
fi

info "terraform plan (modules: network, ecr)..."
if terraform plan -input=false -no-color -out=localstack.tfplan 2>&1; then
  pass "terraform plan completed successfully"
else
  fail "terraform plan failed"
  exit 1
fi

# ── Optional cleanup ──────────────────────────────────────────────────────────
if $CLEAN; then
  info "Destroying LocalStack state (--clean)..."
  terraform destroy -auto-approve -input=false -no-color 2>&1 | tail -10
  rm -f localstack.tfplan
  pass "Cleanup complete"
fi

echo ""
pass "Validation complete — modules network and ecr passed against LocalStack."
echo "  Plan saved: $TF_DIR/localstack.tfplan"
echo "  To destroy:  bash scripts/validate-tf-localstack.sh --clean"
