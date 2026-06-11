#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Tests de infraestructura SonarQube (RED phase → GREEN phase)
# US-01: SonarQube container infrastructure
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
FAILURES=0
PASSES=0
TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

echo "=== SonarQube Infra — $( [ "${1:-}" = "green" ] && echo "GREEN Phase" || echo "RED Phase" ) ==="
echo ""

PHASE="${1:-red}"
GREEN_MODE=false
[ "$PHASE" = "green" ] && GREEN_MODE=true

# ─── US-01: SonarQube service in docker-compose.yml ──────────────────────────

echo "--- US-01: SonarQube container infrastructure ---"

# Test 1: docker-compose.yml defines a sonarqube service
echo "Test 1.1: docker-compose.yml defines sonarqube service on port 9000"
if grep -qE "^\s+sonarqube:" "$ROOT/docker-compose.yml" 2>/dev/null; then
  echo "  PASS: sonarqube service defined in docker-compose.yml"
  PASSES=$((PASSES + 1))
else
  if $GREEN_MODE; then
    echo "  FAIL: sonarqube service NOT found (expected in GREEN)"
    FAILURES=$((FAILURES + 1))
  else
    echo "  FAIL: sonarqube service NOT found yet (expected RED — will be created)"
    FAILURES=$((FAILURES + 1))
  fi
fi

# Test 2: SonarQube uses correct image tag
echo "Test 1.2: SonarQube uses sonarqube:26.6.0.123539-community image"
if grep -q "sonarqube:26.6.0.123539-community" "$ROOT/docker-compose.yml" 2>/dev/null; then
  echo "  PASS: Correct image tag found"
  PASSES=$((PASSES + 1))
else
  if $GREEN_MODE; then
    echo "  FAIL: Image tag not found or incorrect"
    FAILURES=$((FAILURES + 1))
  else
    echo "  FAIL: Image tag not found yet (expected RED)"
    FAILURES=$((FAILURES + 1))
  fi
fi

# Test 3: SonarQube exposes port 9000
echo "Test 1.3: SonarQube exposes port 9000"
if grep -qE '"9000:9000"|9000:9000' "$ROOT/docker-compose.yml" 2>/dev/null; then
  echo "  PASS: Port 9000 exposed"
  PASSES=$((PASSES + 1))
else
  if $GREEN_MODE; then
    echo "  FAIL: Port 9000 not found"
    FAILURES=$((FAILURES + 1))
  else
    echo "  FAIL: Port 9000 not yet exposed (expected RED)"
    FAILURES=$((FAILURES + 1))
  fi
fi

# Test 4: SonarQube has a health check
echo "Test 1.4: SonarQube has health check defined"
if grep -A5 "healthcheck:" "$ROOT/docker-compose.yml" | grep -q "sonarqube" 2>/dev/null || \
   grep -B1 "healthcheck" "$ROOT/docker-compose.yml" | grep -q "sonarqube" 2>/dev/null || \
   awk '/sonarqube:/{found=1} found && /healthcheck:/{print "OK"; exit}' "$ROOT/docker-compose.yml" | grep -q "OK" 2>/dev/null; then
  echo "  PASS: Health check defined for sonarqube"
  PASSES=$((PASSES + 1))
else
  if $GREEN_MODE; then
    echo "  FAIL: Health check not found for sonarqube"
    FAILURES=$((FAILURES + 1))
  else
    echo "  FAIL: Health check not yet defined (expected RED)"
    FAILURES=$((FAILURES + 1))
  fi
fi

# Test 5: Named volume sonarqube_data exists
echo "Test 1.5: Named volume sonarqube_data exists"
if grep -q "sonarqube_data" "$ROOT/docker-compose.yml" 2>/dev/null; then
  echo "  PASS: sonarqube_data volume defined"
  PASSES=$((PASSES + 1))
else
  if $GREEN_MODE; then
    echo "  FAIL: sonarqube_data volume not found"
    FAILURES=$((FAILURES + 1))
  else
    echo "  FAIL: sonarqube_data volume not yet defined (expected RED)"
    FAILURES=$((FAILURES + 1))
  fi
fi

# ─── US-01-MAKE: make sonar target ───────────────────────────────────────────

echo ""
echo "--- US-01-MAKE: make sonar target ---"

# Test 6: make sonar target exists
echo "Test 2.1: Makefile has 'sonar' target"
if grep -qE "^sonar:" "$ROOT/Makefile" 2>/dev/null; then
  echo "  PASS: sonar target found in Makefile"
  PASSES=$((PASSES + 1))
else
  if $GREEN_MODE; then
    echo "  FAIL: sonar target NOT found in Makefile"
    FAILURES=$((FAILURES + 1))
  else
    echo "  FAIL: sonar target NOT found yet (expected RED)"
    FAILURES=$((FAILURES + 1))
  fi
fi

# Test 7: sonar is listed in .PHONY
echo "Test 2.2: sonar is listed in .PHONY"
if grep -qE "^\.PHONY:.*\bsonar\b" "$ROOT/Makefile" 2>/dev/null; then
  echo "  PASS: sonar in .PHONY"
  PASSES=$((PASSES + 1))
else
  if $GREEN_MODE; then
    echo "  FAIL: sonar NOT in .PHONY"
    FAILURES=$((FAILURES + 1))
  else
    echo "  FAIL: sonar NOT yet in .PHONY (expected RED)"
    FAILURES=$((FAILURES + 1))
  fi
fi

# Test 8: sonar target uses $(COMPOSE) up -d sonarqube
echo 'Test 2.3: sonar target references $(COMPOSE) up -d sonarqube'
if grep -A5 "^sonar:" "$ROOT/Makefile" 2>/dev/null | grep -qE 'COMPOSE.*up.*-d.*sonarqube|up.*-d.*sonarqube'; then
  echo "  PASS: sonar target uses \$(COMPOSE) up -d sonarqube"
  PASSES=$((PASSES + 1))
else
  if $GREEN_MODE; then
    echo "  FAIL: sonar target doesn't reference COMPOSE up -d sonarqube"
    FAILURES=$((FAILURES + 1))
  else
    echo "  FAIL: sonar target not yet implemented (expected RED)"
    FAILURES=$((FAILURES + 1))
  fi
fi

# Test 9: sonar target prints URL and default credentials
echo "Test 2.4: sonar target prints URL (http://localhost:9000)"
if grep -A10 "^sonar:" "$ROOT/Makefile" 2>/dev/null | grep -q "localhost:9000"; then
  echo "  PASS: sonar target prints URL"
  PASSES=$((PASSES + 1))
else
  if $GREEN_MODE; then
    echo "  FAIL: sonar target doesn't print URL"
    FAILURES=$((FAILURES + 1))
  else
    echo "  FAIL: sonar target not yet printing URL (expected RED)"
    FAILURES=$((FAILURES + 1))
  fi
fi

echo ""
echo "=============================================="
echo "  RESULTADO: $PASSES passed, $FAILURES failed"
echo "=============================================="

if [ "$FAILURES" -gt 0 ]; then
  if $GREEN_MODE; then
    echo ""
    echo "❌ GREEN PHASE: Tests fallan — implementación incompleta."
    exit 1
  else
    echo ""
    echo "❌ RED PHASE: Tests fallan como se esperaba."
    echo "   La implementación debe crear/configurar estos componentes."
    exit 1
  fi
else
  if $GREEN_MODE; then
    echo ""
    echo "✅ GREEN PHASE: Todos los tests pasan."
    exit 0
  else
    echo ""
    echo "⚠️  Todos los tests pasan en RED (¿ya está implementado?)"
    exit 0
  fi
fi
