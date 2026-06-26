#!/usr/bin/env bash
# setup-aws.sh — AWS prerequisite setup for open-supervisor terraform deploy.
# Configures SSM parameter (DB password) + ACM certificate (DNS validation).
# DNS-agnostic: shows the CNAME to create, verifies with dig.
# Container-agnostic: detects podman → docker → nerdctl → finch → limactl.
#
# Usage:
#   make setup-aws              # defaults to ENV=dev
#   make setup-aws ENV=prod     # production
#   bash scripts/setup-aws.sh dev
#   bash scripts/setup-aws.sh --help

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STATE_FILE="$ROOT_DIR/.opencode/aws-setup-state.json"

GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

# ── Help ────────────────────────────────────────────────────────────────────────

show_help() {
  cat <<EOF
${BOLD}setup-aws.sh${NC} — AWS prerequisite setup for open-supervisor

${BOLD}What it does:${NC}
  1. Verifies required tools (aws, terraform, jq, dig, container engine)
  2. Creates SSM parameter /open-supervisor/<env>/db/password (random 32-char)
  3. Requests an ACM public certificate (DNS validation)
  4. Shows the CNAME record to create in your DNS provider
  5. Polls DNS and ACM until the certificate is issued
  6. Updates infra/terraform/envs/<env>/terraform.tfvars with the cert ARN

${BOLD}Usage:${NC}
  make setup-aws              # defaults to ENV=dev
  make setup-aws ENV=prod     # production environment
  bash scripts/setup-aws.sh dev
  bash scripts/setup-aws.sh --help

${BOLD}Requirements:${NC}
  aws CLI     — brew install awscli
  terraform   — brew install terraform
  jq          — brew install jq
  dig         — brew install bind
  Container engine (one of): podman, docker, nerdctl, finch, limactl

${BOLD}Phases:${NC}
  init           Gather inputs, create SSM + ACM, save state
  awaiting_dns   Poll DNS for CNAME validation (max 3 min)
  awaiting_acm   Poll ACM until ISSUED (max 10 min)
  complete       Update tfvars, print summary

${BOLD}State file:${NC}
  .opencode/aws-setup-state.json — persists progress. Interruptions resume
  from the last phase. Deletion is NOT required after completion.
EOF
  exit 0
}

# ── Argument parsing ────────────────────────────────────────────────────────────

ENV=""
case "${1:-}" in
  --help|-h|help)
    show_help
    ;;
  dev|prod)
    ENV="$1"
    ;;
  "")
    ENV="dev"
    ;;
  *)
    echo -e "${RED}Error:${NC} unknown argument '$1'. Use 'dev', 'prod', or '--help'."
    exit 1
    ;;
esac

# ── Helper functions ────────────────────────────────────────────────────────────

info()  { echo -e "${CYAN}→${NC} $*"; }
ok()    { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
fail()  { echo -e "${RED}✗${NC} $*"; exit 1; }

save_state() {
  local tmp
  tmp="$(mktemp)"
  jq -n \
    --arg phase "$1" \
    --arg started_at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    '{
      version: 1,
      phase: $phase,
      phase_started_at: $started_at,
      created_at: (.created_at // $started_at),
      completed_at: (.completed_at // null),
      environment: (.environment // ""),
      domain: (.domain // ""),
      region: (.region // ""),
      container_engine: (.container_engine // ""),
      acm_certificate_arn: (.acm_certificate_arn // ""),
      cname_name: (.cname_name // ""),
      cname_value: (.cname_value // "")
    }' "$STATE_FILE" 2>/dev/null > "$tmp" 2>/dev/null || echo '{}' > "$tmp"
  mv "$tmp" "$STATE_FILE"
}

read_state() {
  if [[ -f "$STATE_FILE" ]]; then
    jq -r "${1:-.}" "$STATE_FILE" 2>/dev/null || echo ""
  else
    echo ""
  fi
}

merge_state() {
  local tmp
  tmp="$(mktemp)"
  jq -s '.[0] * .[1]' "$STATE_FILE" <(echo "$1") > "$tmp"
  mv "$tmp" "$STATE_FILE"
}

# ── Tool verification ───────────────────────────────────────────────────────────

verify_tools() {
  info "Verificando herramientas requeridas..."

  local missing=""
  for tool in aws terraform jq dig; do
    if ! command -v "$tool" &>/dev/null; then
      missing="$missing $tool"
    fi
  done

  if [[ -n "$missing" ]]; then
    echo ""
    echo -e "${RED}Faltan herramientas:${NC}$missing"
    echo ""
    echo "  Instalá con:"
    echo "    brew install awscli terraform jq bind"
    echo ""
    exit 1
  fi

  ok "aws, terraform, jq, dig — OK"
}

# ── Container engine detection ──────────────────────────────────────────────────

detect_container_engine() {
  local engines=("podman" "docker" "nerdctl" "finch" "limactl")
  local found=()

  for engine in "${engines[@]}"; do
    if command -v "$engine" &>/dev/null; then
      found+=("$engine")
    fi
  done

  if [[ ${#found[@]} -eq 0 ]]; then
    fail "No se encontró ningún container engine (podman, docker, nerdctl, finch, limactl). Instalá uno."
  fi

  if [[ ${#found[@]} -eq 1 ]]; then
    CONTAINER_ENGINE="${found[0]}"
    ok "Container engine detectado: $CONTAINER_ENGINE"
    return
  fi

  # Multiple found — ask user
  echo ""
  echo -e "${YELLOW}Se detectaron múltiples container engines:${NC}"
  for i in "${!found[@]}"; do
    echo "  $((i+1))) ${found[$i]}"
  done
  echo ""
  read -r -p "¿Cuál querés usar? [1-${#found[@]}]: " choice
  if [[ "$choice" =~ ^[0-9]+$ ]] && (( choice >= 1 && choice <= ${#found[@]} )); then
    CONTAINER_ENGINE="${found[$((choice-1))]}"
    ok "Container engine seleccionado: $CONTAINER_ENGINE"
  else
    fail "Selección inválida."
  fi
}

# ── AWS credential validation ───────────────────────────────────────────────────

validate_aws_creds() {
  info "Validando credenciales AWS..."
  if ! aws sts get-caller-identity --region "$REGION" &>/dev/null; then
    echo ""
    echo -e "${RED}Credenciales AWS inválidas o no configuradas.${NC}"
    echo ""
    echo "  Configurá tus credenciales:"
    echo "    aws configure"
    echo "  O setea las variables de entorno:"
    echo "    export AWS_ACCESS_KEY_ID=..."
    echo "    export AWS_SECRET_ACCESS_KEY=..."
    echo ""
    exit 1
  fi
  local identity
  identity="$(aws sts get-caller-identity --region "$REGION" --output json)"
  local account_id
  account_id="$(echo "$identity" | jq -r '.Account')"
  ok "AWS autenticado — Account: $account_id"
}

# ── SSM password ────────────────────────────────────────────────────────────────

ensure_ssm_password() {
  local ssm_path="/open-supervisor/${ENV}/db/password"

  info "Verificando SSM parameter: $ssm_path"

  if aws ssm get-parameter --name "$ssm_path" --with-decryption --region "$REGION" &>/dev/null; then
    ok "SSM parameter ya existe — se saltea"
    return
  fi

  info "Creando SSM SecureString (32 chars aleatorios)..."
  local password
  password="$(openssl rand -base64 32 | tr -d '\n' | head -c 32)"

  if ! aws ssm put-parameter \
    --name "$ssm_path" \
    --value "$password" \
    --type SecureString \
    --overwrite \
    --region "$REGION" &>/dev/null; then
    fail "No se pudo crear el SSM parameter $ssm_path. Verificá los permisos IAM (ssm:PutParameter)."
  fi
  ok "SSM parameter creado: $ssm_path"
}

# ── ACM certificate ─────────────────────────────────────────────────────────────

request_acm_cert() {
  local existing_arn

  info "Buscando certificados ACM existentes para: $DOMAIN"

  # Check for an existing ISSUED certificate
  existing_arn="$(aws acm list-certificates \
    --region "$REGION" \
    --certificate-statuses ISSUED \
    --query "CertificateSummaryList[?DomainName=='$DOMAIN'] | [0].CertificateArn" \
    --output text 2>/dev/null || echo "")"

  if [[ -n "$existing_arn" && "$existing_arn" != "None" ]]; then
    ACM_CERT_ARN="$existing_arn"
    ok "Certificado ISSUED existente: $ACM_CERT_ARN"
    save_state "complete"
    return 1  # signal to skip awaiting phases
  fi

  # Check for an existing PENDING certificate (reuse it)
  existing_arn="$(aws acm list-certificates \
    --region "$REGION" \
    --certificate-statuses PENDING_VALIDATION \
    --query "CertificateSummaryList[?DomainName=='$DOMAIN'] | [0].CertificateArn" \
    --output text 2>/dev/null || echo "")"

  if [[ -n "$existing_arn" && "$existing_arn" != "None" ]]; then
    ACM_CERT_ARN="$existing_arn"
    info "Certificado PENDING_VALIDATION existente — reutilizando: $ACM_CERT_ARN"
  else
    info "Solicitando nuevo certificado ACM para: $DOMAIN"
    local cert_arn
    cert_arn="$(aws acm request-certificate \
      --domain-name "$DOMAIN" \
      --validation-method DNS \
      --region "$REGION" \
      --query 'CertificateArn' \
      --output text 2>/dev/null || echo "")"

    if [[ -z "$cert_arn" || "$cert_arn" == "None" ]]; then
      # Check if TooManyCertificates error
      local cert_count
      cert_count="$(aws acm list-certificates --region "$REGION" --query 'length(CertificateSummaryList)' --output text 2>/dev/null || echo "0")"
      fail "No se pudo crear el certificado ACM. Verificá permisos IAM (acm:RequestCertificate, acm:DescribeCertificate).
  Certificados actuales en la región: $cert_count
  Si llegaste al límite, eliminá certificados no usados en AWS Console → ACM."
    fi
    ACM_CERT_ARN="$cert_arn"
    ok "Certificado solicitado: $ACM_CERT_ARN"
  fi

  return 0  # signal to continue to awaiting phases
}

extract_cname() {
  info "Extrayendo registro CNAME de validación DNS..."

  local cert_desc
  cert_desc="$(aws acm describe-certificate \
    --certificate-arn "$ACM_CERT_ARN" \
    --region "$REGION" \
    --output json 2>/dev/null || echo "{}")"

  CNAME_NAME="$(echo "$cert_desc" | jq -r '.Certificate.DomainValidationOptions[0].ResourceRecord.Name // ""')"
  CNAME_VALUE="$(echo "$cert_desc" | jq -r '.Certificate.DomainValidationOptions[0].ResourceRecord.Value // ""')"

  if [[ -z "$CNAME_NAME" || "$CNAME_NAME" == "null" || -z "$CNAME_VALUE" || "$CNAME_VALUE" == "null" ]]; then
    fail "No se pudo extraer el registro CNAME del certificado. Verificá: aws acm describe-certificate --certificate-arn $ACM_CERT_ARN --region $REGION"
  fi
}

show_cname() {
  echo ""
  echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${YELLOW}  ⚠  Creá este registro CNAME en tu proveedor DNS:${NC}"
  echo ""
  echo -e "  ${BOLD}Tipo:${NC}    CNAME"
  echo -e "  ${BOLD}Nombre:${NC}  ${GREEN}$CNAME_NAME${NC}"
  echo -e "  ${BOLD}Valor:${NC}   ${GREEN}$CNAME_VALUE${NC}"
  echo ""
  echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
}

# ── Phase: init ──────────────────────────────────────────────────────────────────

phase_init() {
  echo ""
  echo -e "${CYAN}═══ Fase: init ═══${NC}"
  echo ""

  # Prompt for inputs
  if [[ -z "$DOMAIN" ]]; then
    read -r -p "Dominio completo (ej: api-supervisor.fmunoz.cl): " DOMAIN
    if [[ -z "$DOMAIN" ]]; then
      fail "Dominio requerido."
    fi
  fi

  if [[ -z "$REGION" ]]; then
    read -r -p "Región AWS [us-east-1]: " input_region
    REGION="${input_region:-us-east-1}"
  fi

  verify_tools
  detect_container_engine
  validate_aws_creds
  ensure_ssm_password

  if ! request_acm_cert; then
    # Already ISSUED — jump to complete
    merge_state "$(jq -n \
      --arg env "$ENV" \
      --arg domain "$DOMAIN" \
      --arg region "$REGION" \
      --arg ce "$CONTAINER_ENGINE" \
      --arg arn "$ACM_CERT_ARN" \
      '{
        environment: $env,
        domain: $domain,
        region: $region,
        container_engine: $ce,
        acm_certificate_arn: $arn,
        phase: "complete",
        phase_started_at: (now | strftime("%Y-%m-%dT%H:%M:%SZ"))
      }')"
    return 2  # signal to go to complete
  fi

  extract_cname
  show_cname

  merge_state "$(jq -n \
    --arg env "$ENV" \
    --arg domain "$DOMAIN" \
    --arg region "$REGION" \
    --arg ce "$CONTAINER_ENGINE" \
    --arg arn "$ACM_CERT_ARN" \
    --arg cname_name "$CNAME_NAME" \
    --arg cname_value "$CNAME_VALUE" \
    --arg phase "awaiting_dns" \
    '{
      environment: $env,
      domain: $domain,
      region: $region,
      container_engine: $ce,
      acm_certificate_arn: $arn,
      cname_name: $cname_name,
      cname_value: $cname_value,
      phase: $phase,
      phase_started_at: (now | strftime("%Y-%m-%dT%H:%M:%SZ"))
    }')"

  echo ""
  info "Estado guardado en $STATE_FILE"
  echo -e "  ${YELLOW}Creá el CNAME arriba y volvé a correr:${NC} make setup-aws ${ENV:+ENV=$ENV}"
  exit 0
}

# ── Phase: awaiting_dns ──────────────────────────────────────────────────────────

phase_awaiting_dns() {
  echo ""
  echo -e "${CYAN}═══ Fase: awaiting_dns ═══${NC}"
  echo ""

  CNAME_NAME="$(read_state '.cname_name')"
  CNAME_VALUE="$(read_state '.cname_value')"

  show_cname

  info "Verificando propagación DNS con dig..."
  echo -e "  ${YELLOW}Backoff: 15s × 4 + 30s × 4 (máx ~3 min)${NC}"
  echo ""

  local intervals=()
  for i in $(seq 1 4); do intervals+=("15"); done
  for i in $(seq 1 4); do intervals+=("30"); done

  for i in "${!intervals[@]}"; do
    local sleep_time="${intervals[$i]}"
    local attempt=$((i + 1))

    # Strip trailing dot for dig if present
    local dig_name="${CNAME_NAME%.}"

    printf "  [%2d/%2d] dig %s ... " "$attempt" "${#intervals[@]}" "$dig_name"

    if dig +short "$dig_name" CNAME 2>/dev/null | grep -qF "${CNAME_VALUE%.}"; then
      echo -e "${GREEN}RESUELTO ✓${NC}"
      merge_state '{"phase": "awaiting_acm", "phase_started_at": "'"$(date -u +"%Y-%m-%dT%H:%M:%SZ")"'"}'
      phase_awaiting_acm
      return
    fi

    echo -e "${YELLOW}pendiente${NC}"

    if (( i < ${#intervals[@]} - 1 )); then
      sleep "$sleep_time"
    fi
  done

  echo ""
  echo -e "${RED}Timeout: el CNAME no se propagó en ~3 minutos.${NC}"
  echo ""
  echo "  Posibles causas:"
  echo "  - El registro CNAME no fue creado en tu proveedor DNS"
  echo "  - El TTL del DNS es muy alto"
  echo "  - Error de tipeo en el nombre/valor del CNAME"
  echo ""
  echo "  Verificá manualmente: dig ${CNAME_NAME%.} CNAME"
  echo "  Y volvé a correr: make setup-aws ${ENV:+ENV=$ENV}"
  exit 1
}

# ── Phase: awaiting_acm ──────────────────────────────────────────────────────────

phase_awaiting_acm() {
  echo ""
  echo -e "${CYAN}═══ Fase: awaiting_acm ═══${NC}"
  echo ""

  ACM_CERT_ARN="$(read_state '.acm_certificate_arn')"

  info "Esperando validación ACM (puede tardar varios minutos)..."
  echo -e "  ${YELLOW}Backoff: 30s × 20 (máx ~10 min)${NC}"
  echo ""

  for i in $(seq 1 20); do
    local status
    status="$(aws acm describe-certificate \
      --certificate-arn "$ACM_CERT_ARN" \
      --region "$REGION" \
      --query 'Certificate.Status' \
      --output text 2>/dev/null || echo "ERROR")"

    printf "  [%2d/20] ACM status: %s" "$i" "$status"

    case "$status" in
      ISSUED)
        echo -e " ${GREEN}✓${NC}"
        merge_state "$(jq -n \
          --arg phase "complete" \
          --arg started_at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
          '{
            phase: $phase,
            phase_started_at: $started_at
          }')"
        phase_complete
        return
        ;;
      PENDING_VALIDATION)
        echo -e " ${YELLOW}→ esperando...${NC}"
        ;;
      *)
        echo -e " ${RED}!${NC}"
        ;;
    esac

    if (( i < 20 )); then
      sleep 30
    fi
  done

  echo ""
  echo -e "${RED}Timeout: el certificado no se validó en ~10 minutos.${NC}"
  echo ""
  echo "  Posibles causas:"
  echo "  - El CNAME DNS todavía no se propagó completamente"
  echo "  - El CNAME se creó con error de tipeo"
  echo "  - La validación ACM requiere más tiempo (poco común)"
  echo ""
  echo "  Verificá: aws acm describe-certificate --certificate-arn $ACM_CERT_ARN --region $REGION"
  echo "  Y volvé a correr: make setup-aws ${ENV:+ENV=$ENV}"
  exit 1
}

# ── Phase: complete ──────────────────────────────────────────────────────────────

phase_complete() {
  echo ""
  echo -e "${CYAN}═══ Fase: complete ═══${NC}"
  echo ""

  ACM_CERT_ARN="$(read_state '.acm_certificate_arn')"
  DOMAIN="$(read_state '.domain')"
  REGION="$(read_state '.region')"

  # Verify certificate is still ISSUED (sanity check for re-runs)
  local cert_status
  cert_status="$(aws acm describe-certificate \
    --certificate-arn "$ACM_CERT_ARN" \
    --region "$REGION" \
    --query 'Certificate.Status' \
    --output text 2>/dev/null || echo "ERROR")"

  if [[ "$cert_status" != "ISSUED" ]]; then
    fail "El certificado no está en estado ISSUED (estado actual: $cert_status).
  Verificá: aws acm describe-certificate --certificate-arn $ACM_CERT_ARN --region $REGION"
  fi

  ok "Certificado ACM verificado: ISSUED"

  # Update terraform.tfvars
  local tfvars_file="$ROOT_DIR/infra/terraform/envs/$ENV/terraform.tfvars"
  if [[ ! -f "$tfvars_file" ]]; then
    fail "No se encontró $tfvars_file. ¿El entorno '$ENV' existe?"
  fi

  info "Actualizando $tfvars_file ..."

  # Check current values
  local current_arn current_region
  current_arn="$(grep 'acm_certificate_arn' "$tfvars_file" | sed 's/.*= *"\(.*\)"/\1/' || echo "")"
  current_region="$(grep 'aws_region' "$tfvars_file" | sed 's/.*= *"\(.*\)"/\1/' || echo "")"

  local tfvars_changed=false

  # Update acm_certificate_arn if it has the placeholder
  if [[ "$current_arn" == *"REPLACE"* ]] || [[ "$current_arn" != "$ACM_CERT_ARN" ]]; then
    # macOS sed requires -i '' 
    sed -i '' "s|acm_certificate_arn *= *\".*\"|acm_certificate_arn = \"$ACM_CERT_ARN\"|" "$tfvars_file"
    ok "acm_certificate_arn actualizado → $ACM_CERT_ARN"
    tfvars_changed=true
  else
    ok "acm_certificate_arn ya configurado — se saltea"
  fi

  # Update aws_region if different
  if [[ "$current_region" != "$REGION" ]]; then
    sed -i '' "s|aws_region *= *\".*\"|aws_region = \"$REGION\"|" "$tfvars_file"
    ok "aws_region actualizado → $REGION"
    tfvars_changed=true
  else
    ok "aws_region coincide ($REGION) — se saltea"
  fi

  # Mark state as complete
  merge_state "$(jq -n \
    --arg completed_at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    --arg phase "complete" \
    '{
      completed_at: $completed_at,
      phase: $phase
    }')"

  # Summary
  echo ""
  echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${GREEN}  ✅  setup-aws completado${NC}"
  echo ""
  echo -e "  ${BOLD}Dominio:${NC}    $DOMAIN"
  echo -e "  ${BOLD}Entorno:${NC}    $ENV"
  echo -e "  ${BOLD}Región:${NC}     $REGION"
  echo -e "  ${BOLD}Container:${NC}  $CONTAINER_ENGINE"
  echo -e "  ${BOLD}ACM ARN:${NC}   $ACM_CERT_ARN"
  echo -e "  ${BOLD}State:${NC}     $STATE_FILE"
  echo ""
  echo -e "  ${YELLOW}Siguiente paso:${NC}  make aws-verify"
  echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
}

# ── Main ─────────────────────────────────────────────────────────────────────────

main() {
  # Trap Ctrl+C — save current state before exiting
  trap 'echo ""; echo -e "${YELLOW}⚠ Interrumpido. El progreso fue guardado en $STATE_FILE.${NC}"; exit 130' INT

  echo ""
  echo -e "${CYAN}╔══════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║     open-supervisor · AWS setup · $ENV                        ║${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════════════════╝${NC}"

  # Load existing state
  local phase
  phase="$(read_state '.phase')"

  if [[ "$phase" == "complete" ]]; then
    echo ""
    info "Setup ya completado anteriormente. Verificando estado..."

    DOMAIN="$(read_state '.domain')"
    REGION="$(read_state '.region')"
    CONTAINER_ENGINE="$(read_state '.container_engine')"
    ENV="$(read_state '.environment')"
    ACM_CERT_ARN="$(read_state '.acm_certificate_arn')"

    if [[ -z "$ENV" ]] || [[ "$ENV" == "null" ]]; then
      ENV="${1:-dev}"
    fi

    verify_tools

    # Verify cert still valid
    local cert_status
    cert_status="$(aws acm describe-certificate \
      --certificate-arn "$ACM_CERT_ARN" \
      --region "$REGION" \
      --query 'Certificate.Status' \
      --output text 2>/dev/null || echo "ERROR")"

    if [[ "$cert_status" == "ISSUED" ]]; then
      ok "Certificado sigue ISSUED."
      phase_complete
    else
      warn "El certificado ya no está ISSUED (estado: $cert_status). Reiniciando setup..."
      rm -f "$STATE_FILE"
      main "$@"
    fi
    return
  fi

  # Restore state for resumability
  if [[ -f "$STATE_FILE" ]]; then
    DOMAIN="$(read_state '.domain')"
    REGION="$(read_state '.region')"
    CONTAINER_ENGINE="$(read_state '.container_engine')"
    ENV="$(read_state '.environment')"
    ACM_CERT_ARN="$(read_state '.acm_certificate_arn')"
    CNAME_NAME="$(read_state '.cname_name')"
    CNAME_VALUE="$(read_state '.cname_value')"

    if [[ -z "$ENV" || "$ENV" == "null" ]]; then
      ENV="${1:-dev}"
    fi
  fi

  # Determine phase and execute
  case "$phase" in
    init|"")
      phase_init
      ;;
    awaiting_dns)
      verify_tools
      phase_awaiting_dns
      ;;
    awaiting_acm)
      verify_tools
      phase_awaiting_acm
      ;;
    *)
      warn "Fase desconocida '$phase' en state file. Iniciando desde init."
      save_state "init"
      phase_init
      ;;
  esac
}

main "$@"
