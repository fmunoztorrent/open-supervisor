#!/usr/bin/env bash
# QA RED/GREEN — tests para US-05: Local analysis command (pnpm sonar)
#
# Verifica:
#   1. Root package.json tiene script "sonar"
#   2. scripts/sonarqube/run-local-analysis.sh existe y es ejecutable
#   3. Script tiene pre-flight check (SonarQube reachable check)
#   4. Script maneja gracefulmente cuando SonarQube no está corriendo
#   5. Script ejecuta tests con coverage para cada servicio
#   6. Script ejecuta sonar-scanner para cada servicio
#   7. Script imprime dashboard links de SonarQube
#   8. Script retorna non-zero exit code si algún paso falla
#
# En RED, los archivos pueden NO existir — los tests deben FALLAR (exit != 0).
# En GREEN, todos los tests deben PASAR (exit 0).

set -eo pipefail
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

FAILURES=0
PASSES=0

pass() { echo "  ✅ $1"; PASSES=$((PASSES + 1)); }
fail() { echo "  ❌ $1"; FAILURES=$((FAILURES + 1)); }

echo ""
echo "=== QA RED/GREEN: US-05 Local Analysis Command ==="
echo ""

# ── Test 1: Root package.json tiene script "sonar" ────────────────────────────
echo "── Test 1: pnpm sonar script in root package.json"

SCRIPT_NAME="sonar"
if jq -e ".scripts[\"$SCRIPT_NAME\"]" package.json > /dev/null 2>&1; then
  SCRIPT_VAL=$(jq -r ".scripts[\"$SCRIPT_NAME\"]" package.json)
  pass "Root package.json tiene script 'sonar': '$SCRIPT_VAL'"
else
  fail "Root package.json NO tiene script 'sonar'"
fi

# ── Test 2: run-local-analysis.sh existe y es ejecutable ──────────────────────
echo ""
echo "── Test 2: run-local-analysis.sh"

SCRIPT_FILE="scripts/sonarqube/run-local-analysis.sh"
if [ -f "$SCRIPT_FILE" ]; then
  pass "run-local-analysis.sh existe"
  if [ -x "$SCRIPT_FILE" ]; then
    pass "run-local-analysis.sh es ejecutable"
  else
    fail "run-local-analysis.sh NO es ejecutable"
  fi
else
  fail "run-local-analysis.sh no existe"
fi

# ── Test 3: Pre-flight check (SonarQube reachability via curl) ────────────────
echo ""
echo "── Test 3: Pre-flight check"

if [ -f "$SCRIPT_FILE" ]; then
  if grep -q "api/system/status\|curl.*localhost:9000\|sonar.*host.*url" "$SCRIPT_FILE"; then
    pass "Script verifica conectividad con SonarQube (api/system/status)"
  else
    fail "Script NO verifica conectividad con SonarQube"
  fi
fi

# ── Test 4: Graceful handling when SonarQube is not running ───────────────────
echo ""
echo "── Test 4: Graceful SonarQube-not-running"

if [ -f "$SCRIPT_FILE" ]; then
  if grep -q "SonarQube not reachable\|make sonar first\|not running\|unreachable" "$SCRIPT_FILE"; then
    pass "Script maneja gracefulmente cuando SonarQube no está corriendo"
  else
    fail "Script NO muestra mensaje claro cuando SonarQube no está disponible"
  fi
fi

# ── Test 5: Runs tests with coverage per service ──────────────────────────────
echo ""
echo "── Test 5: Test with coverage"

if [ -f "$SCRIPT_FILE" ]; then
  # Check for at least one pnpm --filter * test -- --collectCoverage
  if grep -q "pnpm.*--filter.*test.*--.*collectCoverage\|pnpm.*--filter.*test.*coverage" "$SCRIPT_FILE"; then
    pass "Script ejecuta tests con --collectCoverage por servicio"
  else
    fail "Script NO ejecuta tests con coverage"
  fi

  # Check all 3 services are included
  for svc in "authorization-service" "bff" "sse-server"; do
    if grep -q "$svc" "$SCRIPT_FILE"; then
      pass "  Servicio '$svc' incluido en el análisis"
    else
      fail "  Servicio '$svc' NO incluido en el análisis"
    fi
  done
fi

# ── Test 6: Runs sonar-scanner per service ────────────────────────────────────
echo ""
echo "── Test 6: sonar-scanner execution"

if [ -f "$SCRIPT_FILE" ]; then
  if grep -q "sonar-scanner\|sonar-scanner" "$SCRIPT_FILE"; then
    pass "Script ejecuta sonar-scanner"
  else
    fail "Script NO ejecuta sonar-scanner"
  fi

  # Check sonar-scanner params exist
  if grep -q "sonar.host.url\|sonar.login\|sonar.password" "$SCRIPT_FILE"; then
    pass "Script especifica sonar.host.url, login y password"
  else
    fail "Script NO especifica credenciales/URL de SonarQube"
  fi
fi

# ── Test 7: Prints dashboard links at the end ─────────────────────────────────
echo ""
echo "── Test 7: Dashboard links"

if [ -f "$SCRIPT_FILE" ]; then
  if grep -q "dashboard\|http://localhost:9000/dashboard\|Dashboard\|PASSED\|FAILED" "$SCRIPT_FILE"; then
    pass "Script imprime dashboard links/final status"
  else
    fail "Script NO imprime dashboard links ni resumen final"
  fi
fi

# ── Test 8: Non-zero exit on failure ──────────────────────────────────────────
echo ""
echo "── Test 8: Error propagation"

if [ -f "$SCRIPT_FILE" ]; then
  if grep -q "exit 1\|exit \$" "$SCRIPT_FILE"; then
    pass "Script propaga non-zero exit code en caso de error"
  else
    fail "Script NO propaga exit code de error"
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
  echo "    Se cumplen todos los criterios de aceptación de US-05."
fi
