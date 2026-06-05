#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Tests de prevención de hardcodeos (RED phase)
# Estos tests DEBEN fallar antes de la implementación porque:
# 1. El script validate-hardcodes.sh no existe aún
# 2. El pre-commit hook no valida hardcodeos
# 3. El plugin no detecta hardcodeos en tiempo real
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
FAILURES=0
PASSES=0
TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

echo "=== Prevención de hardcodeos — RED Phase ==="
echo ""

# ─── US-01: Script de validación de hardcodeos ────────────────────────────────

echo "--- US-01: Script validate-hardcodes.sh ---"

# Test 1: El script debe existir
echo "Test 1.1: Script validate-hardcodes.sh existe"
if [ -f "$ROOT/scripts/validate-hardcodes.sh" ]; then
  echo "  PASS: El script ya existe (inesperado en RED phase)"
  PASSES=$((PASSES + 1))
else
  echo "  FAIL: El script NO existe aún (esperado en RED — se creará en implementación)"
  FAILURES=$((FAILURES + 1))
fi

# Test 2: El script debe detectar paths absolutos de usuario
echo "Test 1.2: Detección de path absoluto /Users/"
if [ -f "$ROOT/scripts/validate-hardcodes.sh" ]; then
  echo "/Users/test/project/config.ts" > "$TMPDIR/test_hardcode.txt"  # hardcode-ok: test fixture
  if bash "$ROOT/scripts/validate-hardcodes.sh" "$TMPDIR/test_hardcode.txt" 2>/dev/null; then
    echo "  FAIL: El script NO detectó el hardcodeo (debería fallar)"
    FAILURES=$((FAILURES + 1))
  else
    echo "  PASS: Script detecta hardcodeo correctamente"
    PASSES=$((PASSES + 1))
  fi
else
  echo "  SKIP: Script no existe"
fi

# Test 3: Pre-commit hook NO valida hardcodeos actualmente
echo "Test 1.3: Pre-commit hook valida hardcodeos"
if grep -q "validate-hardcodes\|hardcode" "$ROOT/.opencode/pipeline/pre-commit.sh" 2>/dev/null; then
  echo "  PASS: Pre-commit hook ya referencia validación de hardcodeos (inesperado en RED)"
  PASSES=$((PASSES + 1))
else
  echo "  FAIL: Pre-commit hook NO valida hardcodeos (esperado en RED — se agregará)"
  FAILURES=$((FAILURES + 1))
fi

# Test 4: El archivo de patrones hardcode-patterns.json debe existir
echo "Test 1.4: Archivo hardcode-patterns.json existe"
if [ -f "$ROOT/.opencode/pipeline/hardcode-patterns.json" ]; then
  echo "  PASS: hardcode-patterns.json ya existe (inesperado en RED)"
  PASSES=$((PASSES + 1))
else
  echo "  FAIL: hardcode-patterns.json NO existe aún (esperado en RED — se creará)"
  FAILURES=$((FAILURES + 1))
fi

# ─── US-02: Plugin pipeline-enforcer detecta hardcodeos en tiempo real ────────

echo ""
echo "--- US-02: Plugin pipeline-enforcer ---"

# Test 5: Plugin debe contener validación de hardcodeos
echo "Test 2.1: Plugin contiene validación de hardcodeos"
PLUGIN="$ROOT/.opencode/plugins/pipeline-enforcer.js"
if [ -f "$PLUGIN" ]; then
  if grep -q "hardcode\|HARDCODE\|/Users/\|podman.sock" "$PLUGIN" 2>/dev/null; then
    echo "  PASS: Plugin ya tiene validación de hardcodeos (inesperado en RED)"
    PASSES=$((PASSES + 1))
  else
    echo "  FAIL: Plugin NO tiene validación de hardcodeos (esperado en RED)"
    FAILURES=$((FAILURES + 1))
  fi
else
  echo "  FAIL: Plugin pipeline-enforcer.js no encontrado"
  FAILURES=$((FAILURES + 1))
fi

# Test 6: Plugin debe tener allowlist para settings.local.json
echo "Test 2.2: Plugin tiene allowlist"
if [ -f "$PLUGIN" ] && grep -q "allowlist\|settings.local\|ALLOWLIST" "$PLUGIN" 2>/dev/null; then
  echo "  PASS: Plugin ya tiene allowlist (inesperado en RED)"
  PASSES=$((PASSES + 1))
else
  echo "  FAIL: Plugin NO tiene allowlist (esperado en RED)"
  FAILURES=$((FAILURES + 1))
fi

# ─── US-03: CLAUDE.md documenta prevención ────────────────────────────────────

echo ""
echo "--- US-03: CLAUDE.md documenta prevención ---"

# Test 7: CLAUDE.md debe documentar el sistema de prevención
echo "Test 3.1: CLAUDE.md documenta prevención de hardcodeos"
if grep -qi "prevención\|validación automática\|hardcode.*prohibido" "$ROOT/CLAUDE.md" 2>/dev/null; then
  echo "  PASS: CLAUDE.md ya documenta prevención (inesperado en RED)"
  PASSES=$((PASSES + 1))
else
  echo "  FAIL: CLAUDE.md NO documenta el sistema de prevención (esperado en RED)"
  FAILURES=$((FAILURES + 1))
fi

echo ""
echo "=============================================="
echo "  RESULTADO: $PASSES passed, $FAILURES failed"
echo "=============================================="

if [ "$FAILURES" -gt 0 ]; then
  echo ""
  echo "❌ RED PHASE: Los tests fallan como se esperaba."
  echo "   La implementación debe crear estos componentes."
  exit 1
else
  echo ""
  echo "⚠️  Todos los tests pasan (¿ya está implementado?)"
  exit 0
fi
