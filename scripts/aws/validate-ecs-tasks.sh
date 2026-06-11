#!/usr/bin/env bash
# =============================================================================
# validate-ecs-tasks.sh
# US-04: Validate ECS Fargate Task Definitions for open-supervisor backend
# services. Checks JSON structure, required fields, valid Fargate
# CPU+memory combinations, health check config, log config, and SSM params.
#
# Usage:
#   bash scripts/aws/validate-ecs-tasks.sh
#   VALIDATE_ALL=1 bash scripts/aws/validate-ecs-tasks.sh  # full strict mode
#
# Exit codes:
#   0 = all validations pass
#   1 = one or more validations fail
# =============================================================================

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

TASK_DIR="$REPO_ROOT/infra/ecs/task-definitions"
SERVICES_YAML="$REPO_ROOT/infra/ecs/ecs-services.yaml"

AWS_REGION="${AWS_REGION:-us-east-1}"

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
# (service_name port cpu memory log_group)
SERVICES=(
  "authorization-service:3001:512:1024:/ecs/authorization-service"
  "sse-server:3002:256:512:/ecs/sse-server"
  "bff:3000:256:512:/ecs/bff"
)

# Valid Fargate CPU/memory combinations lookup (CPU → space-separated valid memory in MB)
# Uses a function for bash 3.2 compat (macOS default — no associative arrays)
fargate_valid_mems() {
  local cpu="$1"
  case "$cpu" in
    256)  echo "512 1024 2048" ;;
    512)  echo "1024 2048 3072 4096" ;;
    1024) echo "2048 3072 4096 5120 6144 7168 8192" ;;
    2048) echo "4096 8192 12288 16384" ;;
    4096) echo "8192 12288 16384 30720" ;;
    *)    echo "" ;;
  esac
}

# ── Helper: parse service definition ────────────────────────────────────────────
parse_svc() {
  local svc="$1" field="$2"
  case "$field" in
    name)   echo "$svc" | cut -d: -f1 ;;
    port)   echo "$svc" | cut -d: -f2 ;;
    cpu)    echo "$svc" | cut -d: -f3 ;;
    mem)    echo "$svc" | cut -d: -f4 ;;
    log)    echo "$svc" | cut -d: -f5 ;;
  esac
}

# ═════════════════════════════════════════════════════════════════════════════════
echo ""
echo "━━━ US-04: ECS Task Definition Validation ━━━"
echo "  Region: ${AWS_REGION}"
echo "  Task Dir: ${TASK_DIR}"
echo ""

# ── Pre-flight: Check jq availability ───────────────────────────────────────────
if ! command -v jq &>/dev/null; then
  fail "jq is not installed — required for JSON parsing. Install with: brew install jq"
fi

# ═════════════════════════════════════════════════════════════════════════════════
# PHASE 1: File existence
# ═════════════════════════════════════════════════════════════════════════════════
echo "── Phase 1: File Existence ──"
echo ""

for svc_entry in "${SERVICES[@]}"; do
  svc_name=$(parse_svc "$svc_entry" name)
  json_file="$TASK_DIR/${svc_name}.json"

  if [ -f "$json_file" ]; then
    ok "Task definition file exists: ${svc_name}.json"
  else
    fail "Task definition file MISSING: ${svc_name}.json"
  fi
done

if [ -f "$SERVICES_YAML" ]; then
  ok "ECS services YAML exists: ecs-services.yaml"
else
  fail "ECS services YAML MISSING: ecs-services.yaml"
fi

echo ""

# ═════════════════════════════════════════════════════════════════════════════════
# PHASE 2: JSON structure validation
# ═════════════════════════════════════════════════════════════════════════════════
echo "── Phase 2: Task Definition JSON Structure ──"
echo ""

for svc_entry in "${SERVICES[@]}"; do
  svc_name=$(parse_svc "$svc_entry" name)
  svc_port=$(parse_svc "$svc_entry" port)
  svc_cpu=$(parse_svc "$svc_entry" cpu)
  svc_mem=$(parse_svc "$svc_entry" mem)
  svc_log=$(parse_svc "$svc_entry" log)
  json_file="$TASK_DIR/${svc_name}.json"

  if [ ! -f "$json_file" ]; then
    fail "[${svc_name}] File not found — skipping structure checks"
    continue
  fi

  # Validate JSON is parseable
  if jq empty "$json_file" 2>/dev/null; then
    ok "[${svc_name}] Valid JSON"
  else
    fail "[${svc_name}] Invalid JSON — parse error"
    continue
  fi

  # ── Required fields ───────────────────────────────────────────────────────────

  # family
  family=$(jq -r '.family // empty' "$json_file")
  if [ -n "$family" ]; then
    ok "[${svc_name}] family: ${family}"
  else
    fail "[${svc_name}] Missing required field: family"
  fi

  # containerDefinitions
  cd_count=$(jq '.containerDefinitions | length' "$json_file")
  if [ "$cd_count" -ge 1 ]; then
    ok "[${svc_name}] containerDefinitions count: ${cd_count}"
  else
    fail "[${svc_name}] Missing or empty containerDefinitions"
  fi

  # networkMode
  net_mode=$(jq -r '.networkMode // empty' "$json_file")
  if [ "$net_mode" = "awsvpc" ]; then
    ok "[${svc_name}] networkMode: ${net_mode}"
  else
    fail "[${svc_name}] networkMode should be 'awsvpc', got: ${net_mode}"
  fi

  # requiresCompatibilities
  compat=$(jq -r '.requiresCompatibilities[] // empty' "$json_file" 2>/dev/null | tr '\n' ' ')
  if echo "$compat" | grep -q "FARGATE"; then
    ok "[${svc_name}] requiresCompatibilities includes FARGATE: ${compat}"
  else
    fail "[${svc_name}] Missing FARGATE in requiresCompatibilities"
  fi

  # executionRoleArn
  exec_role=$(jq -r '.executionRoleArn // empty' "$json_file")
  if [ -n "$exec_role" ]; then
    ok "[${svc_name}] executionRoleArn defined"
  else
    fail "[${svc_name}] Missing executionRoleArn"
  fi

  # ── CPU (string in task definition) ───────────────────────────────────────────
  cpu_val=$(jq -r '.cpu // empty' "$json_file")
  if [ "$cpu_val" = "$svc_cpu" ]; then
    ok "[${svc_name}] cpu: ${cpu_val}"
  elif [ -n "$cpu_val" ]; then
    fail "[${svc_name}] cpu should be ${svc_cpu}, got: ${cpu_val}"
  else
    fail "[${svc_name}] Missing cpu"
  fi

  # ── Memory (string in task definition) ────────────────────────────────────────
  mem_val=$(jq -r '.memory // empty' "$json_file")
  if [ "$mem_val" = "$svc_mem" ]; then
    ok "[${svc_name}] memory: ${mem_val}"
  elif [ -n "$mem_val" ]; then
    fail "[${svc_name}] memory should be ${svc_mem}, got: ${mem_val}"
  else
    fail "[${svc_name}] Missing memory"
  fi

  # ── Validate Fargate CPU+memory combination ───────────────────────────────────
  valid_mems=$(fargate_valid_mems "$cpu_val")
  if [ -n "$valid_mems" ]; then
    found=false
    for vm in $valid_mems; do
      if [ "$vm" = "$mem_val" ]; then
        found=true
        break
      fi
    done
    if $found; then
      ok "[${svc_name}] CPU+memory ${cpu_val}/${mem_val} is a valid Fargate combination"
    else
      fail "[${svc_name}] CPU+memory ${cpu_val}/${mem_val} is NOT a valid Fargate combination. CPU ${cpu_val} supports: ${valid_mems}"
    fi
  else
    fail "[${svc_name}] CPU ${cpu_val} is not a valid Fargate CPU value (valid: 256, 512, 1024, 2048, 4096)"
  fi

  # ── Port mapping ──────────────────────────────────────────────────────────────
  container_port=$(jq -r '.containerDefinitions[0].portMappings[0].containerPort // empty' "$json_file")
  if [ "$container_port" = "$svc_port" ]; then
    ok "[${svc_name}] containerPort: ${container_port}"
  elif [ -n "$container_port" ]; then
    fail "[${svc_name}] containerPort should be ${svc_port}, got: ${container_port}"
  else
    fail "[${svc_name}] Missing containerPort mapping"
  fi

  # Protocol check
  proto=$(jq -r '.containerDefinitions[0].portMappings[0].protocol // "tcp"' "$json_file")
  if [ "$proto" = "tcp" ]; then
    ok "[${svc_name}] port protocol: ${proto}"
  else
    fail "[${svc_name}] port protocol should be 'tcp', got: ${proto}"
  fi

  # ── Health check ──────────────────────────────────────────────────────────────
  hc_cmd=$(jq -r '.containerDefinitions[0].healthCheck.command // empty' "$json_file" 2>/dev/null)
  if echo "$hc_cmd" | grep -q "CMD-SHELL"; then
    ok "[${svc_name}] healthCheck has CMD-SHELL"
  else
    fail "[${svc_name}] healthCheck missing CMD-SHELL"
  fi

  hc_port=$(python3 -c "
import re, sys
cmd = sys.stdin.read().strip()
m = re.search(r'http://localhost:(\d+)/health', cmd)
print(m.group(1) if m else '')
" <<< "$hc_cmd")
  if [ "$hc_port" = "$svc_port" ]; then
    ok "[${svc_name}] healthCheck targets correct port ${svc_port}"
  else
    fail "[${svc_name}] healthCheck should target port ${svc_port}, got: ${hc_port}"
  fi

  hc_interval=$(jq -r '.containerDefinitions[0].healthCheck.interval // empty' "$json_file")
  if [ "$hc_interval" = "30" ]; then
    ok "[${svc_name}] healthCheck interval: 30"
  else
    fail "[${svc_name}] healthCheck interval should be 30, got: ${hc_interval}"
  fi

  hc_timeout=$(jq -r '.containerDefinitions[0].healthCheck.timeout // empty' "$json_file")
  if [ "$hc_timeout" = "5" ]; then
    ok "[${svc_name}] healthCheck timeout: 5"
  else
    fail "[${svc_name}] healthCheck timeout should be 5, got: ${hc_timeout}"
  fi

  hc_retries=$(jq -r '.containerDefinitions[0].healthCheck.retries // empty' "$json_file")
  if [ "$hc_retries" = "3" ]; then
    ok "[${svc_name}] healthCheck retries: 3"
  else
    fail "[${svc_name}] healthCheck retries should be 3, got: ${hc_retries}"
  fi

  hc_start=$(jq -r '.containerDefinitions[0].healthCheck.startPeriod // empty' "$json_file")
  if [ "$hc_start" = "60" ]; then
    ok "[${svc_name}] healthCheck startPeriod: 60"
  else
    fail "[${svc_name}] healthCheck startPeriod should be 60, got: ${hc_start}"
  fi

  # ── Log configuration ─────────────────────────────────────────────────────────
  log_driver=$(jq -r '.containerDefinitions[0].logConfiguration.logDriver // empty' "$json_file")
  if [ "$log_driver" = "awslogs" ]; then
    ok "[${svc_name}] logDriver: awslogs"
  else
    fail "[${svc_name}] logDriver should be 'awslogs', got: ${log_driver}"
  fi

  log_group=$(jq -r '.containerDefinitions[0].logConfiguration.options["awslogs-group"] // empty' "$json_file")
  if [ "$log_group" = "$svc_log" ]; then
    ok "[${svc_name}] awslogs-group: ${log_group}"
  else
    fail "[${svc_name}] awslogs-group should be ${svc_log}, got: ${log_group}"
  fi

  log_region=$(jq -r '.containerDefinitions[0].logConfiguration.options["awslogs-region"] // empty' "$json_file")
  if [ -n "$log_region" ]; then
    ok "[${svc_name}] awslogs-region: ${log_region}"
  else
    fail "[${svc_name}] Missing awslogs-region"
  fi

  log_stream=$(jq -r '.containerDefinitions[0].logConfiguration.options["awslogs-stream-prefix"] // empty' "$json_file")
  if [ -n "$log_stream" ]; then
    ok "[${svc_name}] awslogs-stream-prefix: ${log_stream}"
  else
    fail "[${svc_name}] Missing awslogs-stream-prefix"
  fi

  # ── Secrets / environment ──────────────────────────────────────────────────────
  secrets_count=$(jq '.containerDefinitions[0].secrets | length' "$json_file" 2>/dev/null || echo "0")
  if [ "$secrets_count" -gt 0 ]; then
    ok "[${svc_name}] secrets count: ${secrets_count}"
  else
    warn "[${svc_name}] No secrets configured (may be intentional)"
  fi

  # Check secrets reference SSM params with correct path prefix
  if [ "$secrets_count" -gt 0 ]; then
    param_issues=0
    while read -r value_from; do
      if [ -z "$value_from" ]; then
        continue
      fi
      if echo "$value_from" | grep -q '/open-supervisor/'; then
        : # OK — contains the expected hierarchy
      else
        fail "[${svc_name}] Secret valueFrom '${value_from}' does not reference /open-supervisor/ hierarchy"
        param_issues=$((param_issues + 1))
      fi
      # Check for hardcoded 12-digit account IDs (avoid grep -P, not on macOS)
      hc_check=$(echo "$value_from" | python3 -c "
import re, sys
val = sys.stdin.read().strip()
if re.match(r'^\d{12}', val):
    print('HARDCODED')
" 2>/dev/null || true)
      if [ "$hc_check" = "HARDCODED" ]; then
        fail "[${svc_name}] Hardcoded AWS account ID in secret valueFrom: ${value_from}"
        param_issues=$((param_issues + 1))
      fi
    done < <(jq -r '.containerDefinitions[0].secrets[].valueFrom' "$json_file" 2>/dev/null)
    if [ "$param_issues" -eq 0 ]; then
      ok "[${svc_name}] SSM/Secrets Manager parameter references look correct"
    fi
  fi

  # ── No hardcoded account IDs ──────────────────────────────────────────────────
  # Use python3 for PCRE-like regex (macOS grep lacks -P)
  raw_json=$(jq -c . "$json_file")
  hc_accounts=$(echo "$raw_json" | python3 -c "
import re, sys
content = sys.stdin.read()
matches = re.findall(r'(?<![<\w])(\d{12})(?![>\w])', content)
filtered = [m for m in matches if m != '000000000000']
if filtered:
    print(','.join(filtered))
" 2>/dev/null || true)
  if [ -z "$hc_accounts" ]; then
    ok "[${svc_name}] No hardcoded AWS account IDs"
  else
    fail "[${svc_name}] Potential hardcoded account IDs: ${hc_accounts}"
  fi

  # ── Container image placeholder ───────────────────────────────────────────────
  image=$(jq -r '.containerDefinitions[0].image // empty' "$json_file")
  if echo "$image" | grep -q '<aws_account_id>'; then
    ok "[${svc_name}] Image uses <aws_account_id> placeholder: ${image}"
  else
    warn "[${svc_name}] Image does not use <aws_account_id> placeholder — verify account ID is not hardcoded"
  fi

  # ── Essential container ───────────────────────────────────────────────────────
  essential=$(jq -r '.containerDefinitions[0].essential // "false"' "$json_file")
  if [ "$essential" = "true" ]; then
    ok "[${svc_name}] Container marked essential: true"
  else
    fail "[${svc_name}] Container NOT marked essential"
  fi

  echo ""
done

# ═════════════════════════════════════════════════════════════════════════════════
# PHASE 3: ECS Services YAML validation
# ═════════════════════════════════════════════════════════════════════════════════
echo "── Phase 3: ECS Services YAML Structure ──"
echo ""

if [ -f "$SERVICES_YAML" ]; then
  # Check basic YAML structure using yq or python3
  if command -v yq &>/dev/null; then
    if yq eval '.' "$SERVICES_YAML" > /dev/null 2>&1; then
      ok "ecs-services.yaml is valid YAML"
    else
      fail "ecs-services.yaml is NOT valid YAML"
    fi
  elif python3 -c "import yaml; yaml.safe_load(open('$SERVICES_YAML'))" 2>/dev/null; then
    ok "ecs-services.yaml is valid YAML"
  else
    fail "ecs-services.yaml is NOT valid YAML — or PyYAML is not installed"
  fi

  # Check cluster name
  cluster=$(yq eval '.cluster // ""' "$SERVICES_YAML" 2>/dev/null || \
           python3 -c "import yaml; print(yaml.safe_load(open('$SERVICES_YAML')).get('cluster',''))" 2>/dev/null || echo "")
  if [ -n "$cluster" ]; then
    ok "ECS cluster defined: ${cluster}"
  else
    fail "Missing cluster field in ecs-services.yaml"
  fi

  # Check services are defined
  svcs=$(yq eval '.services | length' "$SERVICES_YAML" 2>/dev/null || \
         python3 -c "import yaml; d=yaml.safe_load(open('$SERVICES_YAML')); print(len(d.get('services', [])))" 2>/dev/null || echo "0")
  if [ "$svcs" -ge 3 ]; then
    ok "ecs-services.yaml defines ${svcs} services"
  else
    fail "ecs-services.yaml defines ${svcs} services — expected at least 3"
  fi

  # Check each service references the correct task definition and port
  for svc_entry in "${SERVICES[@]}"; do
    svc_name=$(parse_svc "$svc_entry" name)
    svc_port=$(parse_svc "$svc_entry" port)
    family_name="open-supervisor-${svc_name}"

    # Extract service definition from YAML using the full family name
    # The YAML taskDefinition field is the family name (e.g. "open-supervisor-bff")
    svc_def=$(yq eval ".services[] | select(.taskDefinition == \"${family_name}\")" "$SERVICES_YAML" 2>/dev/null || \
              python3 -c "
import yaml
d = yaml.safe_load(open('$SERVICES_YAML'))
for s in d.get('services', []):
    if s.get('taskDefinition') == '${family_name}':
        print(s)
" 2>/dev/null || echo "")

    if [ -n "$svc_def" ]; then
      ok "[${svc_name}] Service defined in ecs-services.yaml (family: ${family_name})"
    else
      fail "[${svc_name}] Service NOT found in ecs-services.yaml (expected family: ${family_name})"
    fi
  done

  # Check private subnets and assignPublicIp: DISABLED
  # The field is nested under awsVpcConfiguration in the YAML
  assign_public=$(yq eval '.networkConfiguration.awsVpcConfiguration.assignPublicIp // ""' "$SERVICES_YAML" 2>/dev/null || \
                  python3 -c "
import yaml
d = yaml.safe_load(open('$SERVICES_YAML'))
nc = d.get('networkConfiguration',{})
awsvpc = nc.get('awsVpcConfiguration',{})
print(awsvpc.get('assignPublicIp',''))
" 2>/dev/null || echo "")
  if [ "$assign_public" = "DISABLED" ] || [ "$assign_public" = "\"DISABLED\"" ]; then
    ok "assignPublicIp: DISABLED"
  else
    warn "assignPublicIp not explicitly DISABLED (found: ${assign_public}) — verify tasks are in private subnets"
  fi

  echo ""
fi

# ═════════════════════════════════════════════════════════════════════════════════
# Summary
# ═════════════════════════════════════════════════════════════════════════════════
echo "━━━ Summary ━━━"
echo ""

if [ "$FAILED" -eq 0 ]; then
  echo -e "${GREEN}All ECS task definition validations passed.${NC}"
  exit 0
else
  echo -e "${RED}${FAILED} validation(s) failed.${NC}"
  exit 1
fi
