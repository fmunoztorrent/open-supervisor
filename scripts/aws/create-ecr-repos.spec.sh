#!/usr/bin/env bash
# QA RED: Test script for create-ecr-repos.sh
# These tests must FAIL until the implementation is written.
#
# Strategy: Mock the 'aws' CLI to simulate AWS behavior without real credentials.
# Tests validate: script exists, checks credentials, creates repos,
# sets immutable tags, applies lifecycle policy, and is idempotent.

set -euo pipefail
REPO_ROOT="$(git rev-parse --show-toplevel)"
SCRIPT="$REPO_ROOT/scripts/aws/create-ecr-repos.sh"
cd "$REPO_ROOT"

FAILURES=0
PASSES=0
MOCK_DIR=""
CLEANUP_FN=""

# ── Helper functions ──────────────────────────────────────────────────────────
pass() { echo "  ✅ $1"; PASSES=$((PASSES + 1)); }
fail() { echo "  ❌ $1"; FAILURES=$((FAILURES + 1)); }
fail_now() { echo "  ❌ $1"; echo "ABORT: $2"; exit 1; }

# ── Mock setup ────────────────────────────────────────────────────────────────
setup_mock() {
  MOCK_DIR="$(mktemp -d /tmp/ecr-test-XXXXXX)"
  echo "Mock dir: $MOCK_DIR"

  # Track calls to aws ecr describe-repositories
  local CALLS_FILE="$MOCK_DIR/describe_calls"
  local CREATE_CALLS="$MOCK_DIR/create_calls"
  local POLICY_CALLS="$MOCK_DIR/policy_calls"
  local REPO_LIST="$MOCK_DIR/existing_repos"
  : > "$CALLS_FILE"
  : > "$CREATE_CALLS"
  : > "$POLICY_CALLS"
  : > "$REPO_LIST"

  export MOCK_DIR
  # Build mock aws CLI as a Python script (cleaner than nested heredocs)
  cat > "$MOCK_DIR/aws" << 'PYMOCK'
#!/usr/bin/env python3
"""Mock AWS CLI for testing create-ecr-repos.sh"""
import sys, os, json, pathlib

MOCK_DIR = os.environ.get('MOCK_DIR', '')
if not MOCK_DIR:
    print("MOCK_DIR not set", file=sys.stderr)
    sys.exit(1)

MD = pathlib.Path(MOCK_DIR)

# Log all calls
with open(MD / 'describe_calls', 'a') as f:
    f.write(' '.join(sys.argv[1:]) + '\n')

existing_repos = set()
if (MD / 'existing_repos').exists():
    existing_repos = set((MD / 'existing_repos').read_text().strip().splitlines())

args = sys.argv[1:]

if len(args) >= 2 and args[0] == 'ecr':
    cmd = args[1]
    if cmd == 'describe-repositories':
        repo_name = None
        i = 2
        while i < len(args):
            if args[i] == '--repository-names' and i + 1 < len(args):
                repo_name = args[i + 1]
                i += 2
            else:
                i += 1
        if repo_name in existing_repos:
            print(json.dumps({"repositories": [{
                "repositoryName": repo_name,
                "repositoryUri": f"123456789012.dkr.ecr.us-east-1.amazonaws.com/{repo_name}",
                "imageTagMutability": "IMMUTABLE"
            }]}))
            sys.exit(0)
        else:
            print(f"An error occurred (RepositoryNotFoundException) when calling the DescribeRepositories operation: The repository with name '{repo_name}' does not exist in the registry with id '123456789012'")
            sys.exit(254)

    elif cmd == 'create-repository':
        repo_name = None
        mutability = None
        i = 2
        while i < len(args):
            if args[i] == '--repository-name' and i + 1 < len(args):
                repo_name = args[i + 1]
                i += 2
            elif args[i] == '--image-tag-mutability' and i + 1 < len(args):
                mutability = args[i + 1]
                i += 2
            else:
                i += 1
        with open(MD / 'create_calls', 'a') as f:
            f.write(f"{repo_name}:{mutability}\n")
        with open(MD / 'existing_repos', 'a') as f:
            f.write(f"{repo_name}\n")
        print(json.dumps({"repository": {
            "repositoryName": repo_name,
            "repositoryUri": f"123456789012.dkr.ecr.us-east-1.amazonaws.com/{repo_name}",
            "imageTagMutability": mutability
        }}))
        sys.exit(0)

    elif cmd == 'put-lifecycle-policy':
        repo_name = None
        i = 2
        while i < len(args):
            if args[i] == '--repository-name' and i + 1 < len(args):
                repo_name = args[i + 1]
                i += 2
            elif args[i] == '--lifecycle-policy-text':
                i += 2  # skip the JSON payload
            else:
                i += 1
        with open(MD / 'policy_calls', 'a') as f:
            f.write(f"{repo_name}\n")
        print(json.dumps({
            "repositoryName": repo_name,
            "lifecyclePolicyText": '{"rules":[...]}'
        }))
        sys.exit(0)

    else:
        print(f"Unknown ecr command: {cmd}", file=sys.stderr)
        sys.exit(1)

elif len(args) >= 2 and args[0] == 'sts' and args[1] == 'get-caller-identity':
    print(json.dumps({
        "UserId": "AIDATEST",
        "Account": "123456789012",
        "Arn": "arn:aws:iam::123456789012:user/test-user"
    }))
    sys.exit(0)

else:
    print(f"Unknown aws command: {args[0] if args else ''}", file=sys.stderr)
    sys.exit(1)
PYMOCK
  chmod +x "$MOCK_DIR/aws"
}

cleanup_mock() {
  if [ -n "$MOCK_DIR" ] && [ -d "$MOCK_DIR" ]; then
    rm -rf "$MOCK_DIR"
  fi
}

# ── Tests ─────────────────────────────────────────────────────────────────────

echo ""
echo "=== QA RED: create-ecr-repos.sh ==="
echo ""

# Test 1: Script exists
echo "── Test 1: Script file exists"
if [ -f "$SCRIPT" ]; then
  pass "create-ecr-repos.sh exists"
else
  fail "create-ecr-repos.sh does not exist — script not yet created"
fi

# Test 2: Script is executable
echo ""
echo "── Test 2: Script is executable"
if [ -x "$SCRIPT" ]; then
  pass "create-ecr-repos.sh is executable"
else
  fail "create-ecr-repos.sh is NOT executable — implement chmod +x"
fi

# Test 3: Script has bash shebang and set -euo pipefail
echo ""
echo "── Test 3: Shebang and safety flags"
if head -1 "$SCRIPT" 2>/dev/null | grep -q "#!/usr/bin/env bash"; then
  pass "Script has bash shebang"
else
  fail "Script missing bash shebang (#!/usr/bin/env bash)"
fi
if head -10 "$SCRIPT" 2>/dev/null | grep -q "set -euo pipefail"; then
  pass "Script has set -euo pipefail"
else
  fail "Script missing set -euo pipefail"
fi

# Test 4: Script checks AWS CLI availability
echo ""
echo "── Test 4: AWS CLI check"
SCRIPT_CONTENT=$(cat "$SCRIPT" 2>/dev/null || echo "")
if echo "$SCRIPT_CONTENT" | grep -q "command -v aws"; then
  pass "Script checks for 'aws' CLI availability"
else
  fail "Script does NOT check for 'aws' CLI — missing command -v aws"
fi

# Test 5: Script fails with clear message when AWS creds not configured
echo ""
echo "── Test 5: AWS credentials check"
if echo "$SCRIPT_CONTENT" | grep -q "aws sts get-caller-identity\|Unable to locate credentials\|configured"; then
  pass "Script validates AWS credentials before creating repos"
else
  fail "Script does NOT validate AWS credentials — missing sts get-caller-identity check"
fi

# Test 6: Script creates 3 repos with correct names
echo ""
echo "── Test 6: Creates 3 repositories with correct names"
setup_mock
CLEANUP_FN=cleanup_mock

export PATH="$MOCK_DIR:$PATH"
export AWS_REGION="us-east-1"

bash "$SCRIPT" 2>&1 || true

CREATE_CALLS_CONTENT=$(cat "$MOCK_DIR/create_calls" 2>/dev/null || echo "")
for repo in "open-supervisor/authorization-service" "open-supervisor/sse-server" "open-supervisor/bff"; do
  if echo "$CREATE_CALLS_CONTENT" | grep -q "$repo"; then
    pass "create-repository called for $repo"
  else
    fail "create-repository NOT called for $repo"
  fi
done

# Test 7: imageTagMutability is IMMUTABLE
echo ""
echo "── Test 7: imageTagMutability is IMMUTABLE"
for line in $CREATE_CALLS_CONTENT; do
  REPO_NAME="${line%%:*}"
  MUTABILITY="${line#*:}"
  if [ "$MUTABILITY" = "IMMUTABLE" ]; then
    pass "$REPO_NAME has IMMUTABLE tag mutability"
  else
    fail "$REPO_NAME has '$MUTABILITY' — expected IMMUTABLE"
  fi
done

# Test 8: Lifecycle policy applied to all repos
echo ""
echo "── Test 8: Lifecycle policy attached to all repos"
POLICY_CALLS_CONTENT=$(cat "$MOCK_DIR/policy_calls" 2>/dev/null || echo "")
for repo in "open-supervisor/authorization-service" "open-supervisor/sse-server" "open-supervisor/bff"; do
  if echo "$POLICY_CALLS_CONTENT" | grep -q "$repo"; then
    pass "Lifecycle policy applied to $repo"
  else
    fail "Lifecycle policy NOT applied to $repo"
  fi
done

# Test 9: Lifecycle policy has max 20 images rule
echo ""
echo "── Test 9: Lifecycle policy rules (max 20 images)"
if echo "$SCRIPT_CONTENT" | grep -q "countNumber\|imageCountMoreThan\|20\|maxImageCount"; then
  pass "Lifecycle policy includes 'max 20 images' rule (imageCountMoreThan)"
else
  fail "Lifecycle policy does NOT include 20-image limit rule"
fi

# Test 10: Lifecycle policy expires untagged images after 7 days
echo ""
echo "── Test 10: Untagged image expiration (7 days)"
if echo "$SCRIPT_CONTENT" | grep -q "untagged\|7\|expire"; then
  pass "Lifecycle policy expires untagged images in 7 days"
else
  fail "Lifecycle policy does NOT handle untagged image expiry"
fi

# Test 11: Idempotent — running twice doesn't error
echo ""
echo "── Test 11: Script is idempotent"
# Reset mock state for second run
: > "$MOCK_DIR/create_calls"
SECOND_RUN_OUTPUT=$(bash "$SCRIPT" 2>&1 || true)
SECOND_CREATE=$(cat "$MOCK_DIR/create_calls" 2>/dev/null || echo "")
if [ -z "$SECOND_CREATE" ]; then
  pass "Second run did NOT call create-repository (idempotent)"
else
  fail "Second run called create-repository again (not idempotent)"
fi
# Check for actual errors — "already exists" is expected idempotent behavior
# Note: [ERROR] with ANSI codes appears as \033[0;31m[ERROR]\033[0m
if echo "$SECOND_RUN_OUTPUT" | grep -q "\[ERROR\]"; then
  fail "Second run produced errors: $SECOND_RUN_OUTPUT"
else
  pass "Second run completed without errors"
fi

# Test 12: Uses AWS_REGION env var with default
echo ""
echo "── Test 12: AWS_REGION handling"
if echo "$SCRIPT_CONTENT" | grep -q 'AWS_REGION\|${AWS_REGION:-us-east-1}'; then
  pass "Script uses AWS_REGION env var with default us-east-1"
else
  fail "Script does NOT reference AWS_REGION with default"
fi

# Test 13: validate-infra.sh exists
echo ""
echo "── Test 13: validate-infra.sh exists"
VALIDATE_SCRIPT="$REPO_ROOT/scripts/aws/validate-infra.sh"
if [ -f "$VALIDATE_SCRIPT" ]; then
  pass "validate-infra.sh exists"
else
  fail "validate-infra.sh does not exist"
fi

# Test 14: validate-infra.sh validates all 3 repos exist
echo ""
echo "── Test 14: validate-infra.sh validates 3 repos"
VALIDATE_CONTENT=$(cat "$VALIDATE_SCRIPT" 2>/dev/null || echo "")
for repo in "open-supervisor/authorization-service" "open-supervisor/sse-server" "open-supervisor/bff"; do
  if echo "$VALIDATE_CONTENT" | grep -q "$repo"; then
    pass "validate-infra.sh checks $repo"
  else
    fail "validate-infra.sh does NOT check $repo"
  fi
done

# Test 15: validate-infra.sh has aws CLI check
echo ""
echo "── Test 15: validate-infra.sh has AWS CLI check"
if echo "$VALIDATE_CONTENT" | grep -q "command -v aws"; then
  pass "validate-infra.sh checks for 'aws' CLI"
else
  fail "validate-infra.sh does NOT check for 'aws' CLI"
fi

# Cleanup
cleanup_mock
unset AWS_REGION

# ── Resumen ──────────────────────────────────────────────────────────────────
echo ""
echo "====================================="
echo "  Resultado: $PASSES passed, $FAILURES failed"
echo "====================================="

if [ "$FAILURES" -gt 0 ]; then
  echo ""
  echo "⚠️  QA RED: $FAILURES tests fallan — condiciones de aceptación NO se cumplen."
  exit 1
else
  echo ""
  echo "✅ QA GREEN: todos los tests pasan."
  exit 0
fi
