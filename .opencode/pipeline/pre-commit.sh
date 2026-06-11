#!/bin/bash
# Pre-commit hook for git (multi-scope)
# Blocks commits if any scope's pipeline is still in progress.
# Install: ln -sf ../../.opencode/pipeline/pre-commit.sh .git/hooks/pre-commit
# Or:     git config core.hooksPath .opencode/pipeline

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STATE_FILE="$SCRIPT_DIR/state.json"

if [ ! -f "$STATE_FILE" ]; then
  echo "ERROR: Pipeline state file not found at $STATE_FILE"
  echo "Run the pipeline first (todowrite) before committing."
  exit 1
fi

PIPELINE_STATUS=$(python3 -c "
import json
state = json.load(open('$STATE_FILE'))
scopes = state.get('scopes', {})
# Block commit if any scope is still active (not completed)
active_scopes = [name for name, s in scopes.items() if s.get('active', False)]
if active_scopes:
    print('active:' + ','.join(active_scopes))
else:
    print('inactive')
" 2>/dev/null)

if [[ "$PIPELINE_STATUS" == active:* ]]; then
  ACTIVE_SCOPES="${PIPELINE_STATUS#active:}"
  echo ""
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║  COMMIT BLOQUEADO: Pipeline(s) en progreso                 ║"
  echo "║  Scopes activos: $ACTIVE_SCOPES"
  echo "║                                                              ║"
  echo "║  Completa TODOS los pipelines antes de commitear.           ║"
  echo "║  Si terminaste, marca los todos como 'completed'            ║"
  echo "║  en todowrite para cerrar cada scope.                       ║"
  echo "╚══════════════════════════════════════════════════════════════╝"
  echo ""
  exit 1
fi

echo "✓ Pipeline check: OK"

# ── Validación de hardcodeos ─────────────────────────────────────────────────
# Escanea archivos staged en busca de paths absolutos, sockets hardcodeados,
# y nombres de contenedor con prefijo de proyecto.
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
HARDCODE_SCRIPT="$ROOT/scripts/validate-hardcodes.sh"

if [ -x "$HARDCODE_SCRIPT" ]; then
  STAGED_FILES=$(git diff --cached --name-only)
  if [ -n "$STAGED_FILES" ]; then
    echo ""
    echo "--- Hardcode validation ---"
    # Pasar archivos staged al script de validación
    HARDCODE_OUTPUT=$(echo "$STAGED_FILES" | xargs "$HARDCODE_SCRIPT" 2>&1) || {
      echo "$HARDCODE_OUTPUT"
      echo ""
      echo "╔══════════════════════════════════════════════════════════════╗"
      echo "║  COMMIT BLOQUEADO: Hardcodeos detectados                   ║"
      echo "║                                                              ║"
      echo "║  Corregí los hardcodeos antes de commitear.                 ║"
      echo "║  Si un hardcodeo es legítimo, agregá:                       ║"
      echo "║    # hardcode-ok: <razón>                                   ║"
      echo "║  en el archivo afectado.                                    ║"
      echo "║  Archivos en allowlist: .claude/settings.local.json         ║"
      echo "╚══════════════════════════════════════════════════════════════╝"
      exit 1
    }
    echo "$HARDCODE_OUTPUT"
  fi
fi

# ── Validación de tests ───────────────────────────────────────────────────────
# Determina qué packages del monorepo están afectados por los archivos staged,
# ejecuta sus tests, y bloquea el commit si alguno falla.
#
# Mapeo de paths → filter de pnpm:
#   apps/authorization-service/**  → authorization-service
#   apps/bff/**                    → bff
#   apps/sse-server/**             → sse-server
#   apps/mobile/**                 → @open-supervisor/mobile
#   packages/shared-types/**       → todos los consumers
#   packages/shared-messaging/**   → backends
#   scripts/**                     → script tests (tsx --test)
#
# Bypass: SKIP_TESTS=1 git commit ...

if [ "${SKIP_TESTS:-}" = "1" ]; then
  echo "--- Test validation: SKIPPED (SKIP_TESTS=1) ---"
fi

if [ "${SKIP_TESTS:-}" != "1" ]; then
  STAGED_FILES=$(git diff --cached --name-only)

if [ -n "$STAGED_FILES" ]; then
  declare -A AFFECTED=()
  HAS_SHARED_TYPES=false
  HAS_SHARED_MESSAGING=false
  HAS_SCRIPTS=false

  while IFS= read -r file; do
    case "$file" in
      apps/authorization-service/*) AFFECTED["authorization-service"]=1 ;;
      apps/bff/*)                   AFFECTED["bff"]=1 ;;
      apps/sse-server/*)            AFFECTED["sse-server"]=1 ;;
      apps/mobile/*)                AFFECTED["@open-supervisor/mobile"]=1 ;;
      packages/shared-types/*)      HAS_SHARED_TYPES=true ;;
      packages/shared-messaging/*)  HAS_SHARED_MESSAGING=true ;;
      scripts/*)                    HAS_SCRIPTS=true ;;
      *) ;; # configuración, .opencode, .claude — sin tests
    esac
  done <<< "$STAGED_FILES"

  # Shared-types change → all consumers need testing
  if $HAS_SHARED_TYPES; then
    AFFECTED["authorization-service"]=1
    AFFECTED["bff"]=1
    AFFECTED["sse-server"]=1
    AFFECTED["@open-supervisor/mobile"]=1
  fi

  # Shared-messaging change → backend consumers need testing
  if $HAS_SHARED_MESSAGING; then
    AFFECTED["authorization-service"]=1
    AFFECTED["bff"]=1
    AFFECTED["sse-server"]=1
  fi

  if [ ${#AFFECTED[@]} -gt 0 ] || $HAS_SCRIPTS; then
    echo ""
    echo "--- Test validation ---"

    # Collect affected packages
    AFFECTED_LIST=""
    for pkg in "${!AFFECTED[@]}"; do
      AFFECTED_LIST="$AFFECTED_LIST $pkg"
    done
    AFFECTED_LIST=$(echo "$AFFECTED_LIST" | xargs -n1 | sort -u | xargs)

    echo "Packages affected by staged changes: $AFFECTED_LIST"

    FAILED_PKGS=""
    for pkg in $AFFECTED_LIST; do
      echo "  → Running tests: $pkg"
      if ! (cd "$ROOT" && pnpm --filter "$pkg" test --passWithNoTests 2>&1); then
        FAILED_PKGS="$FAILED_PKGS $pkg"
      fi
    done

    # Script tests (tsx --test)
    if $HAS_SCRIPTS; then
      echo "  → Running tests: scripts"
      if ! (cd "$ROOT" && npx tsx --test scripts/inject-request.spec.ts 2>&1); then
        FAILED_PKGS="$FAILED_PKGS scripts"
      fi
    fi

    if [ -n "$FAILED_PKGS" ]; then
      echo ""
      echo "╔══════════════════════════════════════════════════════════════╗"
      echo "║  COMMIT BLOQUEADO: Tests fallaron                          ║"
      echo "║  Packages con fallos: $FAILED_PKGS"
      echo "║                                                              ║"
      echo "║  Corregí los tests antes de commitear.                      ║"
      echo "║  Para bypass temporal (no recomendado):                     ║"
      echo "║    SKIP_TESTS=1 git commit ...                              ║"
      echo "╚══════════════════════════════════════════════════════════════╝"
      exit 1
    fi
    echo "✓ All tests passed"
  fi
fi
fi

exit 0
