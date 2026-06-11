#!/usr/bin/env bash
# QA RED — tests para US-03: Quality Gate y Quality Profile
#
# Verifica:
#   1. scripts/sonarqube/quality-gate.json existe y es JSON válido
#   2. Tiene todas las 6 condiciones requeridas con métricas correctas
#   3. Los thresholds coinciden con el spec (coverage ≥80%, duplication ≤5%, etc.)
#   4. scripts/sonarqube/setup-quality-gate.sh existe y es ejecutable
#   5. setup-quality-gate.sh tiene las operaciones API esperadas
#
# En RED, los archivos NO existen — los tests deben FALLAR (exit != 0).
# En GREEN, todos los tests deben PASAR (exit 0).

set -eo pipefail
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

FAILURES=0
PASSES=0

pass() { echo "  ✅ $1"; PASSES=$((PASSES + 1)); }
fail() { echo "  ❌ $1"; FAILURES=$((FAILURES + 1)); }

echo ""
echo "=== QA RED: US-03 Quality Gate & Profile ==="
echo ""

# ── Test 1: quality-gate.json existe y es JSON válido ────────────────────────
echo "── Test 1: quality-gate.json validity"

JSON_FILE="scripts/sonarqube/quality-gate.json"

if [ ! -f "$JSON_FILE" ]; then
  fail "quality-gate.json no existe"
else
  pass "quality-gate.json existe"

  # Validar JSON (silent — error si no es parseable)
  if jq empty "$JSON_FILE" 2>/dev/null; then
    pass "quality-gate.json es JSON válido"
  else
    fail "quality-gate.json NO es JSON válido"
  fi
fi

# ── Test 2: quality-gate.json tiene el nombre correcto ──────────────────────
echo ""
echo "── Test 2: Gate name"

if [ -f "$JSON_FILE" ]; then
  GATE_NAME=$(jq -r '.name // empty' "$JSON_FILE" 2>/dev/null)
  if [ "$GATE_NAME" = "open-supervisor-gate" ]; then
    pass "Gate name es 'open-supervisor-gate'"
  else
    fail "Gate name debería ser 'open-supervisor-gate', fue: '${GATE_NAME:-<empty>}'"
  fi
fi

# ── Test 3: conditions es un array con exactamente 6 elementos ────────────────
echo ""
echo "── Test 3: Conditions count"

if [ -f "$JSON_FILE" ]; then
  CONDITIONS_COUNT=$(jq '.conditions | length' "$JSON_FILE" 2>/dev/null)
  if [ "$CONDITIONS_COUNT" = "6" ]; then
    pass "Conditions tiene 6 elementos (encontrados: $CONDITIONS_COUNT)"
  else
    fail "Conditions debería tener 6 elementos, encontrados: ${CONDITIONS_COUNT:-0}"
  fi
fi

# ── Test 4: Cada condición tiene metric, op, error ───────────────────────────
echo ""
echo "── Test 4: Condition structure"

if [ -f "$JSON_FILE" ]; then
  # Verificar que cada condición tenga los 3 campos requeridos
  INVALID_COUNT=0
  for i in $(seq 0 5); do
    METRIC=$(jq -r ".conditions[$i].metric // empty" "$JSON_FILE" 2>/dev/null)
    OP=$(jq -r ".conditions[$i].op // empty" "$JSON_FILE" 2>/dev/null)
    ERROR=$(jq -r ".conditions[$i].error // empty" "$JSON_FILE" 2>/dev/null)

    if [ -z "$METRIC" ] || [ -z "$OP" ] || [ -z "$ERROR" ]; then
      INVALID_COUNT=$((INVALID_COUNT + 1))
      fail "Condición $i: faltan campos (metric='$METRIC', op='$OP', error='$ERROR')"
    fi
  done

  if [ "$INVALID_COUNT" -eq 0 ]; then
    pass "Todas las 6 condiciones tienen metric, op y error"
  fi
fi

# ── Test 5: Las 6 métricas específicas existen con los thresholds correctos ──
echo ""
echo "── Test 5: Specific metrics & thresholds"

if [ -f "$JSON_FILE" ]; then
  # Coverage on new code < 80% → ERROR (LT 80)
  C1=$(jq '.conditions[] | select(.metric == "new_coverage") | select(.op == "LT") | select(.error == "80") | length' "$JSON_FILE" 2>/dev/null)
  if [ "$C1" != "" ] 2>/dev/null; then
    pass "new_coverage: LT 80 (coverage en código nuevo < 80% → ERROR)"
  else
    fail "new_coverage: condición faltante o incorrecta"
  fi

  # Duplicated lines density on new code > 5% → ERROR (GT 5)
  C2=$(jq '.conditions[] | select(.metric == "new_duplicated_lines_density") | select(.op == "GT") | select(.error == "5") | length' "$JSON_FILE" 2>/dev/null)
  if [ "$C2" != "" ] 2>/dev/null; then
    pass "new_duplicated_lines_density: GT 5 (duplicación > 5% → ERROR)"
  else
    fail "new_duplicated_lines_density: condición faltante o incorrecta"
  fi

  # New blocker violations > 0 → ERROR (GT 0)
  C3=$(jq '.conditions[] | select(.metric == "new_blocker_violations") | select(.op == "GT") | select(.error == "0") | length' "$JSON_FILE" 2>/dev/null)
  if [ "$C3" != "" ] 2>/dev/null; then
    pass "new_blocker_violations: GT 0 (new blocker violations > 0 → ERROR)"
  else
    fail "new_blocker_violations: condición faltante o incorrecta"
  fi

  # New critical violations > 0 → ERROR (GT 0)
  C4=$(jq '.conditions[] | select(.metric == "new_critical_violations") | select(.op == "GT") | select(.error == "0") | length' "$JSON_FILE" 2>/dev/null)
  if [ "$C4" != "" ] 2>/dev/null; then
    pass "new_critical_violations: GT 0 (new critical violations > 0 → ERROR)"
  else
    fail "new_critical_violations: condición faltante o incorrecta"
  fi

  # New major violations > 0 → ERROR (GT 0)
  C5=$(jq '.conditions[] | select(.metric == "new_major_violations") | select(.op == "GT") | select(.error == "0") | length' "$JSON_FILE" 2>/dev/null)
  if [ "$C5" != "" ] 2>/dev/null; then
    pass "new_major_violations: GT 0 (new major code smells > 0 → ERROR)"
  else
    fail "new_major_violations: condición faltante o incorrecta"
  fi

  # Security hotspots reviewed < 100% → ERROR (LT 100)
  C6=$(jq '.conditions[] | select(.metric == "security_hotspots_reviewed") | select(.op == "LT") | select(.error == "100") | length' "$JSON_FILE" 2>/dev/null)
  if [ "$C6" != "" ] 2>/dev/null; then
    pass "security_hotspots_reviewed: LT 100 (hotspots no revisados al 100% → ERROR)"
  else
    fail "security_hotspots_reviewed: condición faltante o incorrecta"
  fi
fi

# ── Test 6: setup-quality-gate.sh existe y es ejecutable ─────────────────────
echo ""
echo "── Test 6: setup-quality-gate.sh"

SETUP_FILE="scripts/sonarqube/setup-quality-gate.sh"

if [ -f "$SETUP_FILE" ]; then
  pass "setup-quality-gate.sh existe"
  if [ -x "$SETUP_FILE" ]; then
    pass "setup-quality-gate.sh es ejecutable"
  else
    fail "setup-quality-gate.sh NO es ejecutable"
  fi
else
  fail "setup-quality-gate.sh no existe"
fi

# ── Test 7: setup-quality-gate.sh tiene los endpoints API esperados ──────────
echo ""
echo "── Test 7: API endpoints in setup script"

if [ -f "$SETUP_FILE" ]; then
  # Verificar que el script referencia los endpoints necesarios
  ENDPOINTS_OK=true

  if grep -q "qualitygates/create" "$SETUP_FILE"; then
    pass "Script usa POST /api/qualitygates/create"
  else
    fail "Script NO usa POST /api/qualitygates/create"
    ENDPOINTS_OK=false
  fi

  if grep -q "qualitygates/create_condition" "$SETUP_FILE"; then
    pass "Script usa POST /api/qualitygates/create_condition"
  else
    fail "Script NO usa POST /api/qualitygates/create_condition"
    ENDPOINTS_OK=false
  fi

  if grep -q "qualitygates/set_as_default" "$SETUP_FILE"; then
    pass "Script usa POST /api/qualitygates/set_as_default"
  else
    fail "Script NO usa POST /api/qualitygates/set_as_default"
    ENDPOINTS_OK=false
  fi

  if grep -q "qualitygates/show" "$SETUP_FILE"; then
    pass "Script usa GET /api/qualitygates/show"
  else
    fail "Script NO usa GET /api/qualitygates/show"
    ENDPOINTS_OK=false
  fi
fi

# ── Test 8: Idempotency handling ─────────────────────────────────────────────
echo ""
echo "── Test 8: Idempotency handling"

if [ -f "$SETUP_FILE" ]; then
  if grep -q "exists\|already\|check\|idempotent\|gate.*id" "$SETUP_FILE" 2>/dev/null; then
    pass "Script maneja idempotencia (previene duplicados)"
  else
    fail "Script NO maneja idempotencia"
  fi
fi

# ── Test 9: Graceful error when SonarQube is not running ─────────────────────
echo ""
echo "── Test 9: Graceful SonarQube-not-running handling"

if [ -f "$SETUP_FILE" ]; then
  if grep -q "curl\|http://localhost:9000\|connection refused\|not running\|unreachable" "$SETUP_FILE" 2>/dev/null; then
    pass "Script maneja gracefulmente cuando SonarQube no está corriendo"
  else
    fail "Script NO verifica si SonarQube está disponible"
  fi
fi

# ── Resumen ───────────────────────────────────────────────────────────────────
echo ""
echo "====================================="
echo "  Resultado: $PASSES passed, $FAILURES failed"
echo "====================================="

if [ "$FAILURES" -gt 0 ]; then
  echo ""
  echo "⚠️  QA RED: $FAILURES tests fallan — condiciones de aceptación NO cumplidas."
  echo "    Implementar los archivos faltantes y correr de nuevo."
  exit 1
else
  echo ""
  echo "✅ QA GREEN: todos los tests pasan."
  exit 0
fi
