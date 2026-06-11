#!/usr/bin/env bash
# run-local-analysis.sh — US-05: Local SonarQube analysis for all 3 backend services
#
# Usage:
#   bash scripts/sonarqube/run-local-analysis.sh
#
# Prerequisites:
#   - SonarQube running at http://localhost:9000 (run `make sonar` first)
#   - Java runtime for sonar-scanner (brew install openjdk on macOS)
#
# This script:
#   1. Checks SonarQube is reachable /api/system/status → UP
#   2. Runs Jest with coverage for each service (authorization-service, bff, sse-server)
#   3. Runs sonar-scanner for each service
#   4. Prints dashboard links and final status
#   5. Exits non-zero if any step fails

set -eo pipefail
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

FAILURES=0
SERVICES=("authorization-service" "bff" "sse-server")

echo ""
echo "=============================================="
echo "  open-supervisor — Local SonarQube Analysis"
echo "=============================================="
echo ""

# ── Pre-flight check: SonarQube reachable ─────────────────────────────────────
echo -e "${CYAN}[1/4]${NC} Checking SonarQube connectivity..."
echo "       → http://localhost:9000/api/system/status"

SONAR_STATUS=$(curl -sf http://localhost:9000/api/system/status 2>/dev/null || true)

if echo "$SONAR_STATUS" | grep -q '"status":"UP"'; then
  echo -e "       ${GREEN}✅ SonarQube is reachable and UP.${NC}"
  echo ""
else
  echo -e "       ${RED}❌ SonarQube not reachable at http://localhost:9000${NC}"
  echo ""
  echo -e "${YELLOW}   Run 'make sonar' first to start SonarQube.${NC}"
  echo "   (requires Docker/Podman + the sonarqube container definition)"
  echo ""
  exit 1
fi

# ── Step 2: Run tests with coverage per service ───────────────────────────────
echo -e "${CYAN}[2/4]${NC} Running tests with coverage..."
echo ""

for SVC in "${SERVICES[@]}"; do
  echo -e "  ${YELLOW}━━━ $SVC ━━━${NC}"
  if pnpm --filter "$SVC" test -- --collectCoverage; then
    echo -e "  ${GREEN}✅ $SVC tests passed${NC}"
    echo ""
  else
    echo -e "  ${RED}❌ $SVC tests FAILED${NC}"
    echo ""
    FAILURES=$((FAILURES + 1))
  fi
done

# ── Step 3: Run sonar-scanner per service ─────────────────────────────────────
echo -e "${CYAN}[3/4]${NC} Running SonarScanner for each service..."
echo ""

for SVC in "${SERVICES[@]}"; do
  SVC_DIR="apps/$SVC"
  PROJECT_KEY="open-supervisor-$SVC"

  echo -e "  ${YELLOW}━━━ $SVC ($PROJECT_KEY) ━━━${NC}"

  if [ -d "$SVC_DIR" ] && [ -f "$SVC_DIR/sonar-project.properties" ]; then
    if (cd "$SVC_DIR" && npx sonar-scanner \
      -Dsonar.host.url=http://localhost:9000 \
      -Dsonar.login=admin \
      -Dsonar.password=admin); then
      echo -e "  ${GREEN}✅ $SVC SonarScanner completed${NC}"
      echo ""
    else
      echo -e "  ${RED}❌ $SVC SonarScanner FAILED${NC}"
      echo ""
      FAILURES=$((FAILURES + 1))
    fi
  else
    echo -e "  ${RED}❌ $SVC sonar-project.properties not found at $SVC_DIR/${NC}"
    echo ""
    FAILURES=$((FAILURES + 1))
  fi
done

# ── Step 4: Summary ───────────────────────────────────────────────────────────
echo -e "${CYAN}[4/4]${NC} Results"
echo ""
echo "=============================================="
echo "  SonarQube Dashboard Links"
echo "=============================================="

for SVC in "${SERVICES[@]}"; do
  PROJECT_KEY="open-supervisor-$SVC"
  echo "  • $SVC: http://localhost:9000/dashboard?id=$PROJECT_KEY"
done

echo ""
if [ "$FAILURES" -gt 0 ]; then
  echo -e "  ${RED}❌ $FAILURES service(s) had failures.${NC}"
  echo "     Review the dashboard links above for details."
  echo ""
  exit 1
else
  echo -e "  ${GREEN}✅ All 3 services analyzed successfully.${NC}"
  echo ""
  exit 0
fi
