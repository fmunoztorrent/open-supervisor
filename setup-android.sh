#!/bin/bash
set -euo pipefail

# ─── Colores ──────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

log()  { echo -e "\n${GREEN}▶${NC} ${BOLD}$1${NC}"; }
ok()   { echo -e "  ${GREEN}✓${NC}  $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC}  $1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANDROID_HOME="$HOME/Library/Android/sdk"
ARCH=$(uname -m)

# Detectar RC del shell activo
if [[ "$SHELL" == *"zsh"* ]]; then
  SHELL_RC="$HOME/.zshrc"
elif [[ "$SHELL" == *"bash"* ]]; then
  SHELL_RC="$HOME/.bashrc"
else
  SHELL_RC="$HOME/.profile"
fi

# ─── 1. Homebrew ──────────────────────────────────────────────────────────────
log "1. Homebrew"
if ! command -v brew &>/dev/null; then
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi
# Apple Silicon: asegurar que brew esté en PATH para esta sesión
if [[ "$ARCH" == "arm64" ]] && [[ -f /opt/homebrew/bin/brew ]]; then
  eval "$(/opt/homebrew/bin/brew shellenv)"
fi
ok "$(brew --version | head -1)"

# ─── 2. nvm + Node (versión fijada en .nvmrc) ─────────────────────────────────
log "2. nvm + Node"
if [[ ! -d "$HOME/.nvm" ]]; then
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
fi
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

NODE_VERSION=$(cat "$SCRIPT_DIR/.nvmrc")
nvm install "$NODE_VERSION"
nvm use "$NODE_VERSION"
ok "Node $(node --version)"

# ─── 3. pnpm ──────────────────────────────────────────────────────────────────
log "3. pnpm"
if ! command -v pnpm &>/dev/null; then
  npm install -g pnpm
fi
ok "pnpm $(pnpm --version)"

# ─── 4. Watchman ──────────────────────────────────────────────────────────────
log "4. Watchman"
if ! command -v watchman &>/dev/null; then
  brew install watchman
fi
ok "watchman $(watchman --version)"

# ─── 5. Java 17 (Temurin) ─────────────────────────────────────────────────────
log "5. Java 17 (Temurin)"
if ! /usr/libexec/java_home -v 17 &>/dev/null 2>&1; then
  brew install --cask temurin@17
fi
JAVA_HOME_PATH=$(/usr/libexec/java_home -v 17)
ok "Java $("$JAVA_HOME_PATH/bin/java" -version 2>&1 | awk -F '"' '/version/{print $2}')"

# ─── 6. Android Command Line Tools ────────────────────────────────────────────
log "6. Android Command Line Tools"
if ! brew list --cask android-commandlinetools &>/dev/null 2>&1; then
  brew install --cask android-commandlinetools
fi

BREW_PREFIX=$(brew --prefix)
SDKMANAGER="$BREW_PREFIX/share/android-commandlinetools/cmdline-tools/latest/bin/sdkmanager"

if [[ ! -f "$SDKMANAGER" ]]; then
  SDKMANAGER=$(command -v sdkmanager 2>/dev/null || true)
fi

if [[ -z "$SDKMANAGER" ]] || [[ ! -f "$SDKMANAGER" ]]; then
  echo "No se encontró sdkmanager. Instalá Android Studio manualmente."
  exit 1
fi
ok "sdkmanager: $SDKMANAGER"

# ─── 7. Android SDK Components ────────────────────────────────────────────────
log "7. Android SDK components → $ANDROID_HOME"
mkdir -p "$ANDROID_HOME"

if [[ "$ARCH" == "arm64" ]]; then
  SYSTEM_IMAGE="system-images;android-35;google_apis;arm64-v8a"
else
  SYSTEM_IMAGE="system-images;android-35;google_apis;x86_64"
fi

# Pre-aceptar licencias con hashes oficiales de Google — evita el prompt interactivo
mkdir -p "$ANDROID_HOME/licenses"
printf '\n8933bad161af4178b1185d1a37fbf41ea5269c55\nd56f5187479451eabf01fb78af6dfcb131a6481e\n24333f8a63b6825ea9c5514f83c2829b004d1fee' \
  > "$ANDROID_HOME/licenses/android-sdk-license"
printf '\n84831b9409646a918e30573bab4c9c91346d8abd' \
  > "$ANDROID_HOME/licenses/android-sdk-preview-license"
printf '\n33b6a2b64607f11b759f320ef9dff4ae5c47d97a' \
  > "$ANDROID_HOME/licenses/google-gdk-license"
printf '\n859f317696f67ef3d7f30a50a5560e7834b43903' \
  > "$ANDROID_HOME/licenses/android-sdk-arm-dbt-license"

"$SDKMANAGER" --sdk_root="$ANDROID_HOME" \
  "cmdline-tools;latest" \
  "platform-tools" \
  "platforms;android-35" \
  "build-tools;35.0.0" \
  "emulator" \
  "$SYSTEM_IMAGE" 2>&1 | grep -Ev "^(Warning|Deprecated|INFO:)"

ok "SDK instalado en $ANDROID_HOME"

# ─── 8. Android Studio ────────────────────────────────────────────────────────
log "8. Android Studio"
if [[ ! -d "/Applications/Android Studio.app" ]]; then
  brew install --cask android-studio
  ok "Android Studio instalado"
else
  ok "Android Studio ya instalado"
fi

# ─── 9. Variables de entorno ──────────────────────────────────────────────────
log "9. Variables de entorno → $SHELL_RC"

if ! grep -q "# Android SDK — open-supervisor" "$SHELL_RC" 2>/dev/null; then
  cat >> "$SHELL_RC" << 'EOF'

# Android SDK — open-supervisor
export JAVA_HOME=$(/usr/libexec/java_home -v 17)
export ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=$PATH:$ANDROID_HOME/emulator
export PATH=$PATH:$ANDROID_HOME/platform-tools
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin
EOF
  ok "Variables agregadas a $SHELL_RC"
else
  warn "Variables ya presentes en $SHELL_RC — sin cambios"
fi

# Exportar para esta sesión de shell
export JAVA_HOME="$JAVA_HOME_PATH"
export PATH="$PATH:$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin"

# ─── 10. local.properties (generado localmente, no va al repo) ────────────────
log "10. android/local.properties"
LOCAL_PROPS="$SCRIPT_DIR/apps/mobile/android/local.properties"
if [[ ! -f "$LOCAL_PROPS" ]]; then
  echo "sdk.dir=$ANDROID_HOME" > "$LOCAL_PROPS"
  ok "Creado: $LOCAL_PROPS"
else
  warn "Ya existe — sin cambios"
fi

# ─── 11. AVD (Emulador) ───────────────────────────────────────────────────────
log "11. AVD — Pixel 8 API 35"
AVDMANAGER="$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager"

if [[ -f "$AVDMANAGER" ]]; then
  if ! "$AVDMANAGER" list avd 2>/dev/null | grep -q "open_supervisor"; then
    echo "no" | "$AVDMANAGER" create avd \
      --name "open_supervisor" \
      --package "$SYSTEM_IMAGE" \
      --device "pixel_8" \
      --force 2>&1 | grep -Ev "^(Warning|INFO:)"
    ok "AVD 'open_supervisor' creado"
  else
    ok "AVD 'open_supervisor' ya existe"
  fi
else
  warn "avdmanager no encontrado — creá el AVD desde Android Studio (Virtual Device Manager)"
fi

# ─── 12. Dependencias del proyecto ────────────────────────────────────────────
log "12. pnpm install"
cd "$SCRIPT_DIR"
pnpm install
ok "Dependencias instaladas"

# ─── Listo ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}✓ Setup completo${NC}"
echo ""
echo "  1. Recargá el shell:"
echo "       source $SHELL_RC"
echo ""
echo "  2. Arrancá el emulador (la primera vez tarda ~30 seg):"
echo "       emulator -avd open_supervisor &"
echo ""
echo "  3. Verificá que el dispositivo aparece como 'device' (no 'offline'):"
echo "       adb devices"
echo ""
echo "  4. Corré la app (dos terminales separadas):"
echo "       Terminal 1:  cd apps/mobile && pnpm start"
echo "       Terminal 2:  cd apps/mobile && pnpm android"
echo ""
