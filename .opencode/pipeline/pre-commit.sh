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
exit 0
