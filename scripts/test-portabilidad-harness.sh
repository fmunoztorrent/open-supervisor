#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Tests de portabilidad del harness (RED phase)
# Estos tests DEBEN fallar antes de la implementación (US-01, US-02).
# Después de la implementación, deben pasar en verde.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
FAILURES=0
PASSES=0

check() {
  local desc="$1"
  local result="$2"
  if [ "$result" -eq 0 ]; then
    echo "  PASS: $desc"
    PASSES=$((PASSES + 1))
  else
    echo "  FAIL: $desc"
    FAILURES=$((FAILURES + 1))
  fi
}

echo "=== US-01: Comandos portables en documentación del harness ==="
echo ""

# Test 1: CLAUDE.md no debe contener rutas hardcodeadas a /Users/
echo "--- Test 1.1: CLAUDE.md sin rutas hardcodeadas ---"
if grep -q "/Users/" "$ROOT/CLAUDE.md" 2>/dev/null; then
  echo "  FAIL: CLAUDE.md contiene rutas hardcodeadas a /Users/"
  grep -n "/Users/" "$ROOT/CLAUDE.md" || true
  FAILURES=$((FAILURES + 1))
else
  echo "  PASS: CLAUDE.md no contiene rutas hardcodeadas"
  PASSES=$((PASSES + 1))
fi

# Test 2: CLAUDE.md no debe contener hardcodeo de socket Podman específico
echo "--- Test 1.2: CLAUDE.md sin hardcodeo de socket Podman ---"
if grep -q "podman.sock" "$ROOT/CLAUDE.md" 2>/dev/null; then
  echo "  FAIL: CLAUDE.md contiene hardcodeo de socket Podman"
  grep -n "podman.sock" "$ROOT/CLAUDE.md" || true
  FAILURES=$((FAILURES + 1))
else
  echo "  PASS: CLAUDE.md no hardcodea socket Podman"
  PASSES=$((PASSES + 1))
fi

# Test 3: CLAUDE.md debe referenciar make infra como método canónico
echo "--- Test 1.3: CLAUDE.md referencia 'make infra' ---"
if grep -q "make infra\|make dev" "$ROOT/CLAUDE.md" 2>/dev/null; then
  echo "  PASS: CLAUDE.md referencia make para infraestructura"
  PASSES=$((PASSES + 1))
else
  echo "  FAIL: CLAUDE.md NO referencia make para infraestructura"
  FAILURES=$((FAILURES + 1))
fi

# Test 4: LEARNINGS.md no debe contener comandos hardcodeados con DOCKER_HOST
echo "--- Test 1.4: LEARNINGS.md sin comandos hardcodeados ---"
# Busca patrón de comando hardcodeado (DOCKER_HOST con ruta de socket)
# Las menciones históricas en "Qué pasó"/"Contexto" son OK; lo crítico es que
# ningún "Cómo aplicar" contenga comandos no portables.
if grep -q "DOCKER_HOST=unix://" "$ROOT/.claude/LEARNINGS.md" 2>/dev/null; then
  echo "  FAIL: LEARNINGS.md contiene comando hardcodeado con DOCKER_HOST"
  grep -n "DOCKER_HOST=unix://" "$ROOT/.claude/LEARNINGS.md" || true
  FAILURES=$((FAILURES + 1))
else
  echo "  PASS: LEARNINGS.md no contiene comandos hardcodeados"
  PASSES=$((PASSES + 1))
fi

# Test 5: settings.json no debe tener rutas absolutas a /Users/ en reglas allow
echo "--- Test 1.5: settings.json sin rutas absolutas ---"
if grep -q "/Users/" "$ROOT/.claude/settings.json" 2>/dev/null; then
  echo "  FAIL: settings.json contiene rutas absolutas a /Users/"
  grep -n "/Users/" "$ROOT/.claude/settings.json" || true
  FAILURES=$((FAILURES + 1))
else
  echo "  PASS: settings.json no contiene rutas absolutas"
  PASSES=$((PASSES + 1))
fi

# Test 6: .gitignore debe incluir settings.local.json
echo "--- Test 1.6: .gitignore incluye settings.local.json ---"
if grep -q "settings.local.json" "$ROOT/.gitignore" 2>/dev/null; then
  echo "  PASS: .gitignore incluye settings.local.json"
  PASSES=$((PASSES + 1))
else
  echo "  FAIL: .gitignore NO incluye settings.local.json"
  FAILURES=$((FAILURES + 1))
fi

echo ""
echo "=== US-02: Portabilidad de archivos de infraestructura ==="
echo ""

# Test 7: docker-compose.localstack.yml no debe hardcodear /var/run/docker.sock
echo "--- Test 2.1: localstack compose sin socket hardcodeado ---"
LOCALSTACK_FILE="$ROOT/docker-compose.localstack.yml"
if [ -f "$LOCALSTACK_FILE" ]; then
  # Debe usar variable DOCKER_SOCK con fallback, no hardcode directo
  if grep -q 'DOCKER_SOCK' "$LOCALSTACK_FILE" 2>/dev/null; then
    echo "  PASS: docker-compose.localstack.yml usa variable DOCKER_SOCK"
    PASSES=$((PASSES + 1))
  elif grep -q '"/var/run/docker.sock:/var/run/docker.sock"' "$LOCALSTACK_FILE" 2>/dev/null; then
    echo "  FAIL: docker-compose.localstack.yml hardcodea /var/run/docker.sock"
    FAILURES=$((FAILURES + 1))
  else
    echo "  PASS: docker-compose.localstack.yml no tiene socket hardcodeado"
    PASSES=$((PASSES + 1))
  fi
else
  echo "  SKIP: docker-compose.localstack.yml no existe"
  PASSES=$((PASSES + 1))
fi

# Test 8: infra/terraform/README.md debe tener nota de compatibilidad Podman
echo "--- Test 2.2: terraform README con nota Podman ---"
TF_README="$ROOT/infra/terraform/README.md"
if [ -f "$TF_README" ]; then
  if grep -qi "podman\|alias docker=podman\|compatibilidad" "$TF_README" 2>/dev/null; then
    echo "  PASS: terraform README menciona compatibilidad Podman"
    PASSES=$((PASSES + 1))
  else
    echo "  FAIL: terraform README NO menciona compatibilidad Podman"
    FAILURES=$((FAILURES + 1))
  fi
else
  echo "  SKIP: infra/terraform/README.md no existe"
  PASSES=$((PASSES + 1))
fi

# Test 9: settings.local.json (si existe) no debe hardcodear nombres de contenedor con prefijo
echo "--- Test 2.3: settings.local.json sin nombres de contenedor con prefijo ---"
LOCAL_SETTINGS="$ROOT/.claude/settings.local.json"
if [ -f "$LOCAL_SETTINGS" ]; then
  if grep -q "open-supervisor-\w\+-[0-9]" "$LOCAL_SETTINGS" 2>/dev/null; then
    echo "  FAIL: settings.local.json contiene nombres de contenedor con prefijo"
    grep -n "open-supervisor-\w\+-[0-9]" "$LOCAL_SETTINGS" || true
    FAILURES=$((FAILURES + 1))
  else
    echo "  PASS: settings.local.json no hardcodea nombres de contenedor"
    PASSES=$((PASSES + 1))
  fi
else
  echo "  SKIP: settings.local.json no existe (no hay nada que verificar)"
  PASSES=$((PASSES + 1))
fi

echo ""
echo "=============================================="
echo "  RESULTADO: $PASSES passed, $FAILURES failed"
echo "=============================================="

if [ "$FAILURES" -gt 0 ]; then
  echo ""
  echo "❌ RED PHASE: Los tests fallan como se esperaba."
  echo "   Estos hardcodeos deben corregirse en el paso de implementación."
  exit 1
else
  echo ""
  echo "✅ GREEN PHASE: Todos los tests pasan."
  exit 0
fi
