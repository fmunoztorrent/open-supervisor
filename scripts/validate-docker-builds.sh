#!/usr/bin/env bash
# scripts/validate-docker-builds.sh
# Validates that Docker images can be built for all 3 backend services.
# Intended for CI and local verification.
# Usage: bash scripts/validate-docker-builds.sh [--no-cache]
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

REPO_ROOT="$(git rev-parse --show-toplevel)"
CACHE_FLAG="${1:-}"
SUMMARY_FILE=$(mktemp)
trap 'rm -f "$SUMMARY_FILE"' EXIT

# Auto-detect container engine (docker or podman)
DOCKER_CMD=""
if command -v docker &>/dev/null; then
    DOCKER_CMD="docker"
elif command -v podman &>/dev/null; then
    DOCKER_CMD="podman"
else
    echo -e "${RED}[FATAL]${NC} Neither docker nor podman found. Install one and try again."
    exit 2
fi

echo "======================================"
echo " Validating Docker image builds"
echo " Container engine: $DOCKER_CMD"
echo " Repo root: $REPO_ROOT"
echo "======================================"

# Services and their ports (bash 3.2 compatible)
SERVICES=("authorization-service" "sse-server" "bff")
PORTS=("3001" "3002" "3000")

BUILD_FAILED=0
IDX=0

for SERVICE in "${SERVICES[@]}"; do
    PORT="${PORTS[$IDX]}"
    IDX=$((IDX + 1))
    DOCKERFILE="$REPO_ROOT/apps/$SERVICE/Dockerfile"
    TAG="open-supervisor/$SERVICE:test"

    echo ""
    echo "--- Building $SERVICE (port $PORT) ---"

    # Check Dockerfile exists
    if [ ! -f "$DOCKERFILE" ]; then
        echo -e "${RED}[FAIL]${NC} Dockerfile not found: $DOCKERFILE"
        BUILD_FAILED=1
        continue
    fi

    # Build the image
    BUILD_CMD="$DOCKER_CMD build $CACHE_FLAG -f \"$DOCKERFILE\" -t \"$TAG\" \"$REPO_ROOT\""
    echo "  Running: $BUILD_CMD"
    if ! eval "$BUILD_CMD"; then
        echo -e "${RED}[FAIL]${NC} Build failed for $SERVICE"
        BUILD_FAILED=1
        continue
    fi

    echo -e "${GREEN}[PASS]${NC} Build successful for $SERVICE"
    echo "$SERVICE:$TAG" >> "$SUMMARY_FILE"

    # Check image size
    IMAGE_SIZE=$($DOCKER_CMD image inspect "$TAG" --format '{{.Size}}' 2>/dev/null || echo "0")
    IMAGE_SIZE_MB=$((IMAGE_SIZE / 1024 / 1024))

    case "$SERVICE" in
        authorization-service) MAX_SIZE_MB=300 ;;
        bff) MAX_SIZE_MB=250 ;;
        sse-server) MAX_SIZE_MB=200 ;;
    esac

    if [ "$IMAGE_SIZE_MB" -gt "$MAX_SIZE_MB" ]; then
        echo -e "${YELLOW}[WARN]${NC} $SERVICE image is ${IMAGE_SIZE_MB}MB (limit: ${MAX_SIZE_MB}MB)"
    else
        echo -e "  Image size: ${IMAGE_SIZE_MB}MB (limit: ${MAX_SIZE_MB}MB)"
    fi

    # Verify shared packages are resolvable inside the container
    case "$SERVICE" in
        authorization-service)
            CHECK_PACKAGES=("@open-supervisor/shared-types" "@open-supervisor/shared-messaging")
            ;;
        sse-server)
            CHECK_PACKAGES=("@open-supervisor/shared-messaging")
            ;;
        bff)
            CHECK_PACKAGES=("@open-supervisor/shared-types")
            ;;
    esac

    for PKG in "${CHECK_PACKAGES[@]}"; do
        echo "  Verifying $PKG is resolvable..."
        if $DOCKER_CMD run --rm "$TAG" node -e "require('$PKG')" 2>/dev/null; then
            echo -e "    ${GREEN}[PASS]${NC} $PKG resolved"
        else
            echo -e "    ${RED}[FAIL]${NC} $PKG failed to resolve"
            BUILD_FAILED=1
        fi
    done
done

echo ""
echo "======================================"
echo " Summary"
echo "======================================"

if [ "$BUILD_FAILED" -eq 0 ]; then
    echo -e "${GREEN}All 3 images built and validated successfully.${NC}"
    exit 0
else
    echo -e "${RED}One or more builds failed.${NC}"
    exit 1
fi
