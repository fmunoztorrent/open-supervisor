#!/usr/bin/env bash
# QA RED — Tests for scripts/aws/create-ssm-params.sh (US-06)
#
# Validates that the script:
# - Creates 9 SSM parameters with correct paths and types
# - Creates 1 Secrets Manager secret for KEYCLOAK_CLIENT_SECRET
# - Is idempotent (uses --overwrite)
# - Has proper bash hygiene (set -euo pipefail, AWS CLI check)
# - Supports --dry-run for local validation
#
# These tests MUST FAIL before the implementation exists (QA RED)
# and MUST PASS after implementation (QA GREEN).
#
# Runner: bash scripts/aws/create-ssm-params.spec.sh

set -euo pipefail
REPO_ROOT="$(git rev-parse --show-toplevel)"
SCRIPT="$REPO_ROOT/scripts/aws/create-ssm-params.sh"

FAILURES=0
PASSES=0

pass() { echo "  PASS  $1"; PASSES=$((PASSES + 1)); }
fail() { echo "  FAIL  $1"; FAILURES=$((FAILURES + 1)); }

echo ""
echo "========================================"
echo "  US-06 QA RED: SSM Parameter Script"
echo "========================================"
echo ""

# ── Test 1: Script file exists ─────────────────────────────────────────────
echo "── File existence"
if [[ -f "$SCRIPT" ]]; then
  pass "create-ssm-params.sh exists"
else
  fail "create-ssm-params.sh does NOT exist"
  echo "  → This failure is expected in RED phase (script not yet implemented)"
fi

# Early abort if script doesn't exist — remaining tests would all fail anyway
# We continue but gate structural tests behind existence check
SCRIPT_EXISTS=false
[[ -f "$SCRIPT" ]] && SCRIPT_EXISTS=true

# ── Test 2: Script is executable ───────────────────────────────────────────
echo ""
echo "── Permissions"
if $SCRIPT_EXISTS && [[ -x "$SCRIPT" ]]; then
  pass "create-ssm-params.sh is executable"
elif $SCRIPT_EXISTS && [[ ! -x "$SCRIPT" ]]; then
  fail "create-ssm-params.sh is NOT executable"
fi

# ── Test 3: Shebang ─────────────────────────────────────────────────────────
echo ""
echo "── Shebang and bash options"
if $SCRIPT_EXISTS; then
  SHEBANG=$(head -1 "$SCRIPT")
  if [[ "$SHEBANG" == "#!/usr/bin/env bash" ]]; then
    pass "Shebang is #!/usr/bin/env bash"
  else
    fail "Shebang must be '#!/usr/bin/env bash', got: '$SHEBANG'"
  fi
fi

# ── Test 4: set -euo pipefail ──────────────────────────────────────────────
if $SCRIPT_EXISTS; then
  if grep -q 'set -euo pipefail' "$SCRIPT"; then
    pass "Script uses 'set -euo pipefail'"
  else
    fail "Script must use 'set -euo pipefail'"
  fi
fi

# ── Test 5: AWS CLI availability check ──────────────────────────────────────
echo ""
echo "── AWS CLI check"
if $SCRIPT_EXISTS; then
  if grep -q 'command.*aws.*--version\|aws --version\|check.*aws.*cli\|AWS CLI' "$SCRIPT"; then
    pass "Script checks for AWS CLI availability"
  else
    fail "Script does NOT check for AWS CLI availability"
  fi
fi

# ── Test 6: Repo root discovery ────────────────────────────────────────────
echo ""
echo "── Repo root discovery"
if $SCRIPT_EXISTS; then
  if grep -q 'git rev-parse --show-toplevel\|SCRIPT_DIR\|REPO_ROOT' "$SCRIPT"; then
    pass "Script discovers repo root"
  else
    fail "Script does NOT discover repo root"
  fi
fi

# ── Test 7: All 9 SSM parameter variable names exist ──────────────────────
echo ""
echo "── SSM parameter variable names (9 required)"
echo "    (look for upsert_ssm_param calls with the parameter suffix)"

# The script constructs paths dynamically using ${PARAM_PREFIX}/<NAME>.
# We check for each variable name suffix as a string argument to upsert_ssm_param.
SSM_PARAM_NAMES=(
  "KAFKA_BROKER"
  "REDIS_HOST"
  "REDIS_PORT"
  "DATABASE_URL"
  "SSE_SERVER_URL"
  "AUTH_SERVICE_URL"
  "KEYCLOAK_URL"
  "KEYCLOAK_REALM"
  "KEYCLOAK_CLIENT_ID"
)

SSM_FOUND=0
for pname in "${SSM_PARAM_NAMES[@]}"; do
  # Look for the parameter name as a suffix in a path or comment (part of the parameter definition)
  if $SCRIPT_EXISTS && grep -qE "${pname}" "$SCRIPT"; then
    pass "SSM parameter variable: ${pname}"
    SSM_FOUND=$((SSM_FOUND + 1))
  else
    fail "SSM parameter variable MISSING: ${pname}"
  fi
done

if [[ "$SSM_FOUND" -ne "${#SSM_PARAM_NAMES[@]}" ]]; then
  echo "  → Only $SSM_FOUND of ${#SSM_PARAM_NAMES[@]} SSM parameter names found"
fi

# ── Test 8: DATABASE_URL uses SecureString (not String) ────────────────────
echo ""
echo "── SSM parameter types"
if $SCRIPT_EXISTS; then
  # Extract the line(s) with DATABASE_URL and check for SecureString
  if grep -q 'DATABASE_URL' "$SCRIPT" && grep -q 'SecureString' "$SCRIPT"; then
    # Verify that DATABASE_URL is associated with SecureString
    DB_URL_TYPE=$(grep -A2 'DATABASE_URL' "$SCRIPT" | grep -o 'SecureString')
    if [[ -n "$DB_URL_TYPE" ]]; then
      pass "DATABASE_URL uses --type SecureString"
    else
      fail "DATABASE_URL must use --type SecureString"
    fi
  else
    fail "DATABASE_URL does NOT use --type SecureString (or missing entirely)"
  fi
fi

# ── Test 9: Other parameters use --type String (not SecureString) ──────────
echo ""
echo "── Non-sensitive parameters use String type"
if $SCRIPT_EXISTS; then
  # Check that common non-sensitive params use String type
  # Exclude DATABASE_URL and KEYCLOAK_URL (those could also be SecureString depending on design)
  # The script passes "String" as the type argument to upsert_ssm_param.
  # It appears as the third argument value in function calls (e.g., \""String"\").
  # Count occurrences of "String" used as SSM type argument (in upsert_ssm_param calls, not comments).
  STRING_COUNT=$(grep -c '^  "String" \\$' "$SCRIPT" || true)
  if [[ "$STRING_COUNT" -ge 2 ]]; then
    pass "Script uses \"String\" as SSM type for non-sensitive parameters ($STRING_COUNT occurrences)"
  else
    fail "Script does NOT use \"String\" as SSM type (found $STRING_COUNT occurrences, expected ≥2)"
  fi
fi

# ── Test 10: KEYCLOAK_CLIENT_SECRET goes to Secrets Manager (not SSM) ─────
echo ""
echo "── Secrets Manager (KEYCLOAK_CLIENT_SECRET)"
if $SCRIPT_EXISTS; then
  # Must have a secretsmanager create-secret command for KEYCLOAK_CLIENT_SECRET
  HAS_SECRETS_MGR_CREATE=$(grep -c 'secretsmanager.*create-secret\|secretsmanager.*create-secret' "$SCRIPT" || true)
  HAS_CLIENT_SECRET=$(grep -c 'KEYCLOAK_CLIENT_SECRET' "$SCRIPT" || true)

  if [[ "$HAS_SECRETS_MGR_CREATE" -gt 0 ]] && [[ "$HAS_CLIENT_SECRET" -gt 0 ]]; then
    pass "KEYCLOAK_CLIENT_SECRET stored in Secrets Manager"
  else
    fail "KEYCLOAK_CLIENT_SECRET NOT stored in Secrets Manager (check for aws secretsmanager create-secret)"
  fi

  # Must NOT also have an SSM put-parameter command for KEYCLOAK_CLIENT_SECRET
  # (it should only be in Secrets Manager)
  HAS_SSM_CLIENT_SECRET=$(grep -c 'put-parameter.*KEYCLOAK_CLIENT_SECRET\|KEYCLOAK_CLIENT_SECRET.*put-parameter' "$SCRIPT" || true)
  if [[ "$HAS_SSM_CLIENT_SECRET" -eq 0 ]]; then
    pass "KEYCLOAK_CLIENT_SECRET does NOT appear as SSM parameter (Secrets Manager only)"
  else
    fail "KEYCLOAK_CLIENT_SECRET appears in put-parameter call (should be Secrets Manager only)"
  fi
fi

# ── Test 11: Idempotent — put-parameter uses --overwrite ──────────────────
echo ""
echo "── Idempotency"
if $SCRIPT_EXISTS; then
  if grep -q 'put-parameter.*--overwrite\|--overwrite.*put-parameter' "$SCRIPT"; then
    pass "put-parameter uses --overwrite flag (idempotent)"
  else
    fail "put-parameter must use --overwrite for idempotency"
  fi
fi

# ── Test 12: Idempotent — create-secret uses --force-overwrite ────────────
if $SCRIPT_EXISTS; then
  if grep -q 'create-secret.*--force-overwrite\|--force-overwrite.*create-secret' "$SCRIPT"; then
    pass "create-secret uses --force-overwrite flag (idempotent)"
  else
    fail "create-secret must use --force-overwrite for idempotency"
  fi
fi

# ── Test 13: Uses placeholder values, not real credentials ─────────────────
echo ""
echo "── Placeholder values"
if $SCRIPT_EXISTS; then
  # Check for obvious placeholder patterns
  PLACEHOLDER_COUNT=$(grep -c 'placeholder\|PLACEHOLDER\|replace-me\|<.*>' "$SCRIPT" || true)
  if [[ "$PLACEHOLDER_COUNT" -gt 0 ]]; then
    pass "Script uses placeholder values with comments"
  else
    fail "Script should use placeholder values (no real credentials hardcoded)"
  fi
fi

# ── Test 14: No hardcoded real values ──────────────────────────────────────
if $SCRIPT_EXISTS; then
  # Check for patterns that look like real credentials (not placeholder comments or var names)
  # Look for long random strings that look like actual API keys/tokens
  # Exclude: KEYCLOAK_CLIENT_SECRET (variable name), placeholder (intentional), replace (comment)
  REAL_TOKENS=$(grep -cE '(sk-[A-Za-z0-9]{10,}|AKIA[A-Z0-9]{16,}|BEGIN RSA|BEGIN OPENSSH)' "$SCRIPT" || true)
  if [[ "$REAL_TOKENS" -eq 0 ]]; then
    pass "No apparent hardcoded real API keys or credentials found"
  else
    fail "Potential hardcoded API keys detected (sk-*, AKIA*, SSH keys)"
  fi
fi

# ── Test 15: --dry-run support ─────────────────────────────────────────────
echo ""
echo "── Dry-run mode"
if $SCRIPT_EXISTS; then
  if grep -q 'dry.run\|--dry-run\|DRY_RUN' "$SCRIPT"; then
    pass "Script supports --dry-run flag"
  else
    fail "Script does NOT support --dry-run flag"
  fi
fi

# ── Test 16: Configurable environment ──────────────────────────────────────
echo ""
echo "── Environment configurability"
if $SCRIPT_EXISTS; then
  if grep -q 'staging\|ENVIRONMENT\|ENV\|environment' "$SCRIPT"; then
    pass "Script allows configurable environment (staging/production)"
  else
    fail "Script does NOT allow configurable environment"
  fi
fi

# ── Test 17: Configurable AWS region ───────────────────────────────────────
echo ""
echo "── Region configurability"
if $SCRIPT_EXISTS; then
  if grep -q 'region\|AWS_REGION\|--region' "$SCRIPT"; then
    pass "Script allows configurable AWS region"
  else
    fail "Script does NOT allow configurable AWS region"
  fi
fi

# ── Resumen ──────────────────────────────────────────────────────────────────
echo ""
echo "========================================"
echo "  Result: $PASSES passed, $FAILURES failed"
echo "========================================"

if [[ "$FAILURES" -gt 0 ]]; then
  echo ""
  echo "⚠️  US-06 QA RED: $FAILURES tests FAILING (expected at RED phase)."
  echo "    Conditions for acceptance NOT met."
  exit 1
else
  echo ""
  echo "✅ US-06 QA GREEN: all $PASSES tests PASSING."
  exit 0
fi
