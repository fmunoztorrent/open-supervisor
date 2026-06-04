#!/bin/bash
# scripts/validate-decomposition.sh
#
# Valida que el orquestador multi-scope pobló state.json correctamente
# después de procesar spec/2026-06-04-test-decomposition-fixture.spec.md.
#
# Estado RED: este script debe fallar antes de que se aplique el fix del plugin
# (US-00 del spec principal). Después del fix + procesamiento del spec de
# prueba, debe pasar.
#
# Uso: bash scripts/validate-decomposition.sh
# Exit: 0 = todos los checks pasan, 1 = al menos un check falla

set -u

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STATE="$REPO_ROOT/.opencode/pipeline/state.json"
TMP="$REPO_ROOT/tmp"

EXPECTED_SCOPES=(
  "feature-test-us-01"
  "feature-test-us-02"
  "feature-test-us-03"
  "feature-test-us-04"
)

# Capa 1: scopes independientes
LAYER1=("feature-test-us-01" "feature-test-us-02")
# Capa 2: scopes dependientes
LAYER2_DEPS=("feature-test-us-03:feature-test-us-01" "feature-test-us-04:feature-test-us-02")

PASS=0
FAIL=0
ERRORS=()

note_pass() { PASS=$((PASS+1)); echo "  PASS: $1"; }
note_fail() { FAIL=$((FAIL+1)); ERRORS+=("$1"); echo "  FAIL: $1"; }

echo "── validate-decomposition.sh ─────────────────────────────"
echo ""

# ── Check 1: state.json existe ────────────────────────────────
if [ ! -f "$STATE" ]; then
  note_fail "state.json no existe en $STATE"
  echo ""
  echo "RESUMEN: $PASS pass, $FAIL fail"
  echo "Script en estado RED — esto es esperado antes de aplicar el fix del plugin"
  exit 1
fi
note_pass "state.json existe"

# ── Check 2: jq disponible ────────────────────────────────────
if ! command -v jq >/dev/null 2>&1; then
  note_fail "jq no está instalado (requerido para parsear state.json)"
  echo ""
  echo "RESUMEN: $PASS pass, $FAIL fail"
  exit 1
fi
note_pass "jq disponible"

# ── Check 3: los 4 scopes están en state.json ─────────────────
for scope in "${EXPECTED_SCOPES[@]}"; do
  exists=$(jq --arg s "$scope" '.scopes[$s] // empty' "$STATE")
  if [ -z "$exists" ]; then
    note_fail "scope '$scope' no encontrado en state.json"
  else
    note_pass "scope '$scope' existe en state.json"
  fi
done

# ── Check 4: cada scope tiene started_at y completed_at ──────
for scope in "${EXPECTED_SCOPES[@]}"; do
  started=$(jq -r --arg s "$scope" '.scopes[$s].started_at // "null"' "$STATE")
  completed=$(jq -r --arg s "$scope" '.scopes[$s].completed_at // "null"' "$STATE")

  if [ "$started" = "null" ]; then
    note_fail "scope '$scope' no tiene started_at"
  else
    note_pass "scope '$scope' tiene started_at = $started"
  fi

  if [ "$completed" = "null" ]; then
    note_fail "scope '$scope' no tiene completed_at (no terminó)"
  else
    note_pass "scope '$scope' tiene completed_at = $completed"
  fi
done

# ── Check 5: scopes de capa 1 arrancan casi en paralelo (<2s) ─
LAYER1_STARTED=()
for scope in "${LAYER1[@]}"; do
  ts=$(jq -r --arg s "$scope" '.scopes[$s].started_at // "null"' "$STATE")
  LAYER1_STARTED+=("$ts")
done

# Solo comparar si todos los scopes tienen timestamp
all_present=true
for ts in "${LAYER1_STARTED[@]}"; do
  if [ "$ts" = "null" ]; then all_present=false; fi
done

if [ "$all_present" = "true" ]; then
  # Calcular diferencia en segundos
  t1=$(date -j -f "%Y-%m-%dT%H:%M:%S" "${LAYER1_STARTED[0]%.*}" "+%s" 2>/dev/null || echo 0)
  t2=$(date -j -f "%Y-%m-%dT%H:%M:%S" "${LAYER1_STARTED[1]%.*}" "+%s" 2>/dev/null || echo 0)
  diff=$((t2 - t1))
  abs_diff=${diff#-}  # absolute value

  if [ "$abs_diff" -le 2 ]; then
    note_pass "capa 1 arrancó en paralelo (diferencia: ${abs_diff}s <= 2s)"
  else
    note_fail "capa 1 NO arrancó en paralelo (diferencia: ${abs_diff}s > 2s)"
  fi
else
  note_fail "no se puede comparar capa 1 (faltan started_at)"
fi

# ── Check 6: scopes de capa 2 arrancan DESPUÉS de sus deps ────
for entry in "${LAYER2_DEPS[@]}"; do
  scope="${entry%%:*}"
  dep="${entry##*:}"

  scope_started=$(jq -r --arg s "$scope" '.scopes[$s].started_at // "null"' "$STATE")
  dep_completed=$(jq -r --arg s "$dep" '.scopes[$s].completed_at // "null"' "$STATE")

  if [ "$scope_started" = "null" ] || [ "$dep_completed" = "null" ]; then
    note_fail "no se puede verificar '$scope' depende de '$dep' (faltan timestamps)"
    continue
  fi

  ts_scope=$(date -j -f "%Y-%m-%dT%H:%M:%S" "${scope_started%.*}" "+%s" 2>/dev/null || echo 0)
  ts_dep=$(date -j -f "%Y-%m-%dT%H:%M:%S" "${dep_completed%.*}" "+%s" 2>/dev/null || echo 0)

  if [ "$ts_scope" -gt "$ts_dep" ]; then
    note_pass "'$scope'.started_at > '$dep'.completed_at (dependencia respetada)"
  else
    note_fail "'$scope'.started_at ($scope_started) NO es posterior a '$dep'.completed_at ($dep_completed)"
  fi
done

# ── Check 7: marker files existen en tmp/ ─────────────────────
if [ ! -d "$TMP" ]; then
  note_fail "directorio tmp/ no existe"
else
  for i in 01 02 03 04; do
    marker="$TMP/.decomposition-test-marker-us-$i"
    if [ -f "$marker" ]; then
      note_pass "marker file existe: $marker"
    else
      note_fail "marker file NO existe: $marker"
    fi
  done
fi

# ── Resumen ───────────────────────────────────────────────────
echo ""
echo "── RESUMEN ────────────────────────────────────────────────"
echo "  Pass: $PASS"
echo "  Fail: $FAIL"

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "  Fallas:"
  for err in "${ERRORS[@]}"; do
    echo "    - $err"
  done
  echo ""
  echo "  Si esto corre antes de que US-00 (fix del plugin) esté aplicado,"
  echo "  el estado RED es esperado. Después del fix + procesamiento del"
  echo "  spec de prueba, todos los checks deben pasar."
  exit 1
fi

echo ""
echo "  Todos los checks pasaron. La descomposición + paralelización"
echo "  funciona end-to-end. El spec de prueba puede limpiarse con:"
echo "    rm tmp/.decomposition-test-marker-*"
exit 0
