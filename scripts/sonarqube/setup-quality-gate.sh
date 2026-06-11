#!/usr/bin/env bash
# setup-quality-gate.sh
#
# Aplica la Quality Gate 'open-supervisor-gate' a una instancia SonarQube
# via su Web API. Idempotente: si el gate ya existe, actualiza condiciones
# en lugar de crear un duplicado.
#
# Uso:
#   bash scripts/sonarqube/setup-quality-gate.sh [--host http://localhost:9000] [--token admin] [--password admin]
#
# Variables de entorno:
#   SONAR_HOST     — URL base de SonarQube (default: http://localhost:9000)
#   SONAR_TOKEN    — Token de autenticación (default: admin)
#   SONAR_PASSWORD — Contraseña (default: admin, usado si SONAR_TOKEN no está definido)
#
# Prerrequisito: `make sonar` debe estar corriendo. Este script verifica
# que SonarQube responda antes de ejecutar las operaciones.

set -eo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
JSON_FILE="$REPO_ROOT/scripts/sonarqube/quality-gate.json"

# ── Configuración ───────────────────────────────────────────────────────────
SONAR_HOST="${SONAR_HOST:-http://localhost:9000}"
SONAR_TOKEN="${SONAR_TOKEN:-}"
SONAR_PASSWORD="${SONAR_PASSWORD:-admin}"
GATE_NAME="open-supervisor-gate"
SONAR_USER="admin"

# ── Colores (si aplica) ────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# ── Funciones helper ────────────────────────────────────────────────────────
info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ── Preflight: Verificar que quality-gate.json existe ──────────────────────
if [ ! -f "$JSON_FILE" ]; then
  error "quality-gate.json no encontrado en: $JSON_FILE"
  exit 1
fi

# ── Preflight: Verificar que SonarQube está accesible ─────────────────────
info "Verificando conexión con SonarQube en $SONAR_HOST..."
if ! curl -sf "$SONAR_HOST/api/system/status" > /dev/null 2>&1; then
  error "SonarQube no está accesible en $SONAR_HOST."
  error "Asegúrate de que 'make sonar' esté corriendo antes de ejecutar este script."
  exit 1
fi
info "SonarQube está disponible."

# ── Construir flag de autenticación ────────────────────────────────────────
if [ -n "$SONAR_TOKEN" ]; then
  AUTH_FLAG="--user $SONAR_TOKEN:"
elif [ -n "$SONAR_PASSWORD" ]; then
  AUTH_FLAG="--user $SONAR_USER:$SONAR_PASSWORD"
else
  AUTH_FLAG=""
fi

# ── Verificar si el gate ya existe (idempotencia) ──────────────────────────
info "Verificando si el gate '$GATE_NAME' ya existe..."
EXISTING_GATE_ID=$(curl -sf "$SONAR_HOST/api/qualitygates/show?name=$GATE_NAME" \
  $AUTH_FLAG \
  2>/dev/null | jq -r '.id // empty')

if [ -n "$EXISTING_GATE_ID" ] && [ "$EXISTING_GATE_ID" != "null" ]; then
  warn "El gate '$GATE_NAME' ya existe (ID: $EXISTING_GATE_ID)."
  info "Se actualizarán las condiciones existentes (reemplazando todas)."

  # Eliminar condiciones existentes para recrearlas
  EXISTING_CONDITIONS=$(curl -sf "$SONAR_HOST/api/qualitygates/show?name=$GATE_NAME" \
    $AUTH_FLAG | jq -r '.conditions[]?.id // empty')

  if [ -n "$EXISTING_CONDITIONS" ]; then
    while IFS= read -r COND_ID; do
      [ -z "$COND_ID" ] && continue
      info "Eliminando condición existente ID: $COND_ID"
      curl -sf -X POST "$SONAR_HOST/api/qualitygates/delete_condition" \
        $AUTH_FLAG \
        -d "id=$COND_ID" > /dev/null 2>&1 || warn "No se pudo eliminar condición $COND_ID"
    done <<< "$EXISTING_CONDITIONS"
  fi

  GATE_ID="$EXISTING_GATE_ID"
else
  info "Creando nuevo gate '$GATE_NAME'..."

  CREATE_RESPONSE=$(curl -sf -X POST "$SONAR_HOST/api/qualitygates/create" \
    $AUTH_FLAG \
    -d "name=$GATE_NAME" 2>/dev/null)

  GATE_ID=$(echo "$CREATE_RESPONSE" | jq -r '.id // empty')

  if [ -z "$GATE_ID" ] || [ "$GATE_ID" = "null" ]; then
    error "No se pudo crear el gate '$GATE_NAME'."
    error "Respuesta: $CREATE_RESPONSE"
    exit 1
  fi

  info "Gate creado con ID: $GATE_ID"
fi

# ── Agregar condiciones desde quality-gate.json ────────────────────────────
info "Agregando condiciones desde quality-gate.json..."
CONDITIONS_COUNT=$(jq '.conditions | length' "$JSON_FILE")
ADDED=0
FAILED=0

for i in $(seq 0 $((CONDITIONS_COUNT - 1))); do
  METRIC=$(jq -r ".conditions[$i].metric" "$JSON_FILE")
  OP=$(jq -r ".conditions[$i].op" "$JSON_FILE")
  ERROR=$(jq -r ".conditions[$i].error" "$JSON_FILE")

  COND_RESPONSE=$(curl -sf -X POST "$SONAR_HOST/api/qualitygates/create_condition" \
    $AUTH_FLAG \
    -d "gateId=$GATE_ID" \
    -d "metric=$METRIC" \
    -d "op=$OP" \
    -d "error=$ERROR" 2>/dev/null || true)

  if echo "$COND_RESPONSE" | jq -e '.id' > /dev/null 2>&1; then
    info "  ✅ Condición agregada: $METRIC $OP $ERROR"
    ADDED=$((ADDED + 1))
  else
    warn "  ⚠️  No se pudo agregar condición: $METRIC $OP $ERROR"
    [ -n "$COND_RESPONSE" ] && warn "     Respuesta: $COND_RESPONSE"
    FAILED=$((FAILED + 1))
  fi
done

info "Condiciones: $ADDED agregadas, $FAILED fallidas."

# ── Establecer como default ────────────────────────────────────────────────
info "Estableciendo '$GATE_NAME' como Quality Gate por defecto..."
curl -sf -X POST "$SONAR_HOST/api/qualitygates/set_as_default" \
  $AUTH_FLAG \
  -d "name=$GATE_NAME" > /dev/null 2>&1 || warn "No se pudo establecer como default (puede requerir permisos de admin)"

# ── Verificación final ─────────────────────────────────────────────────────
echo ""
info "=== VERIFICACIÓN ==="
FINAL_RESPONSE=$(curl -sf "$SONAR_HOST/api/qualitygates/show?name=$GATE_NAME" \
  $AUTH_FLAG 2>/dev/null)

FINAL_ID=$(echo "$FINAL_RESPONSE" | jq -r '.id // "unknown"')
FINAL_CONDITIONS=$(echo "$FINAL_RESPONSE" | jq '.conditions | length // 0')

echo ""
info "Quality Gate: $GATE_NAME"
info "ID: $FINAL_ID"
info "Condiciones configuradas: $FINAL_CONDITIONS"
echo ""

if [ "$FINAL_CONDITIONS" -gt 0 ] 2>/dev/null; then
  info "✅ Quality Gate configurado correctamente."
  info "Dashboard: $SONAR_HOST/quality_gates/show/$FINAL_ID"
  exit 0
else
  error "❌ Quality Gate no tiene condiciones configuradas."
  exit 1
fi
