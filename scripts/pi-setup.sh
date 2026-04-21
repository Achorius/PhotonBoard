#!/usr/bin/env bash
# ============================================================
# PhotonBoard — Raspberry Pi Setup Script
# Transforms a fresh CompanionPi image into a complete
# PhotonBoard + Companion lighting station.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/Achorius/PhotonBoard/main/scripts/pi-setup.sh | bash
#   # or copy to Pi and run:
#   chmod +x pi-setup.sh && sudo ./pi-setup.sh
#
# Prerequisites:
#   - Raspberry Pi 5 (4GB+ recommended)
#   - CompanionPi image flashed to SD card
#   - Internet connection for package downloads
#
# What this script does:
#   1. Installs system dependencies (X11, openbox, unclutter)
#   2. Installs PhotonBoard .deb package
#   3. Installs companion-module-photonboard
#   4. Configures auto-login + auto-start (X11 + kiosk mode)
#   5. Configures network (hostname, mDNS)
#   6. Creates default show directory
# ============================================================

set -euo pipefail

# ---- Colors ----
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[PhotonBoard]${NC} $1"; }
warn() { echo -e "${YELLOW}[PhotonBoard]${NC} $1"; }
err()  { echo -e "${RED}[PhotonBoard]${NC} $1" >&2; }

# ---- Checks ----

if [[ $EUID -ne 0 ]]; then
  err "This script must be run as root (sudo ./pi-setup.sh)"
  exit 1
fi

ARCH=$(dpkg --print-architecture)
if [[ "$ARCH" != "arm64" ]]; then
  err "This script is for arm64 (Raspberry Pi 5). Detected: $ARCH"
  exit 1
fi

# Detect the real user (when run with sudo)
REAL_USER="${SUDO_USER:-$(logname 2>/dev/null || echo pi)}"
REAL_HOME=$(eval echo "~$REAL_USER")

log "Setting up PhotonBoard for user: $REAL_USER ($REAL_HOME)"

# Grant ALSA / MIDI / DMX-USB access without root. These group memberships
# are required for Web MIDI (Chromium) to see USB MIDI controllers like the
# Akai APC Mini, and for serialport access to USB-DMX adapters.
usermod -a -G audio,plugdev,dialout "$REAL_USER" 2>/dev/null || true
log "Added $REAL_USER to groups: audio, plugdev, dialout"

# ---- Configuration ----

# PhotonBoard version and download URL
PB_VERSION="${PB_VERSION:-latest}"
PB_REPO="Achorius/PhotonBoard"
PB_DEB_NAME="photonboard_*_arm64.deb"

# Companion module
COMPANION_MODULE_DEV="/opt/companion-module-dev"
MODULE_NAME="companion-module-photonboard"

# Hostname
NEW_HOSTNAME="${PB_HOSTNAME:-PhotonBoard}"

# ============================================================
# Step 1: System dependencies
# ============================================================

log "Step 1/6: Installing system dependencies..."

apt-get update -qq

# X11 + window manager for kiosk mode
DEPS=(
  xserver-xorg
  xserver-xorg-core
  xinit
  openbox
  unclutter
  libusb-1.0-0
  libgbm1
  libasound2t64      # ALSA runtime — required for Web MIDI (Chromium)
  alsa-utils         # amidi / aplay -l for MIDI troubleshooting
  zenity             # Native file-open/save dialogs for Electron on Linux
  libgtk-3-0         # GTK runtime used by zenity/Electron dialogs
  avahi-daemon       # mDNS for .local resolution
  avahi-utils
)

apt-get install -y -qq "${DEPS[@]}" 2>/dev/null
log "System dependencies installed."

# ============================================================
# Step 2: Install PhotonBoard
# ============================================================

log "Step 2/6: Installing PhotonBoard..."

# Check if already installed
if dpkg -l photonboard &>/dev/null; then
  INSTALLED_VER=$(dpkg -s photonboard | grep '^Version:' | awk '{print $2}')
  warn "PhotonBoard $INSTALLED_VER already installed."

  if [[ "$PB_VERSION" == "latest" || "$PB_VERSION" == "$INSTALLED_VER" ]]; then
    log "Skipping PhotonBoard install (already up to date)."
  else
    log "Upgrading PhotonBoard to $PB_VERSION..."
  fi
fi

# Download latest .deb from GitHub releases (if not already present)
if [[ "$PB_VERSION" == "latest" ]] && ! dpkg -l photonboard &>/dev/null; then
  log "Downloading PhotonBoard from GitHub..."
  DEB_URL=$(curl -fsSL "https://api.github.com/repos/$PB_REPO/releases/latest" \
    | grep -o "https://.*arm64\.deb" | head -1)

  if [[ -z "$DEB_URL" ]]; then
    # Fallback: check if .deb is in current directory
    DEB_FILE=$(ls ./$PB_DEB_NAME 2>/dev/null | head -1)
    if [[ -z "$DEB_FILE" ]]; then
      err "Could not find PhotonBoard .deb package."
      err "Either place the .deb in the current directory or publish a GitHub release."
      err "To build: npm run package:linux  (on the dev machine)"
      exit 1
    fi
  else
    DEB_FILE="/tmp/photonboard_arm64.deb"
    curl -fsSL -o "$DEB_FILE" "$DEB_URL"
  fi

  dpkg -i "$DEB_FILE" || apt-get install -f -y -qq
  log "PhotonBoard installed."
elif [[ ! "$PB_VERSION" == "latest" ]]; then
  # Specific version requested — download from GitHub
  DEB_FILE="/tmp/photonboard_arm64.deb"
  curl -fsSL -o "$DEB_FILE" \
    "https://github.com/$PB_REPO/releases/download/v$PB_VERSION/photonboard_${PB_VERSION}_arm64.deb"
  dpkg -i "$DEB_FILE" || apt-get install -f -y -qq
  log "PhotonBoard $PB_VERSION installed."
fi

# Verify installation
if ! command -v photonboard &>/dev/null; then
  # Check common install paths
  if [[ -x /opt/PhotonBoard/photonboard ]]; then
    ln -sf /opt/PhotonBoard/photonboard /usr/local/bin/photonboard
    log "Symlinked PhotonBoard to /usr/local/bin/"
  else
    err "PhotonBoard binary not found after install!"
    exit 1
  fi
fi

log "PhotonBoard ready: $(which photonboard)"

# ============================================================
# Step 3: Companion module
# ============================================================

log "Step 3/6: Installing companion-module-photonboard..."

mkdir -p "$COMPANION_MODULE_DEV"

MODULE_DIR="$COMPANION_MODULE_DEV/$MODULE_NAME"

if [[ -d "$MODULE_DIR" ]]; then
  warn "Companion module already installed at $MODULE_DIR"
else
  # Clone or copy the module
  if [[ -d "/tmp/$MODULE_NAME" ]]; then
    cp -r "/tmp/$MODULE_NAME" "$MODULE_DIR"
  elif command -v git &>/dev/null; then
    # Try to clone from the repo's subdirectory
    TMP_REPO="/tmp/pb-repo-$$"
    git clone --depth 1 "https://github.com/$PB_REPO.git" "$TMP_REPO" 2>/dev/null || true
    if [[ -d "$TMP_REPO/$MODULE_NAME" ]]; then
      cp -r "$TMP_REPO/$MODULE_NAME" "$MODULE_DIR"
      rm -rf "$TMP_REPO"
    else
      rm -rf "$TMP_REPO"
      err "Could not find companion module. Place it at /tmp/$MODULE_NAME and re-run."
      exit 1
    fi
  fi
fi

# Install module dependencies
if [[ -f "$MODULE_DIR/package.json" ]]; then
  log "Installing module dependencies..."
  # Use fnm's node if available, otherwise system node
  NODE_BIN=""
  if [[ -d /opt/fnm/node-versions ]]; then
    NODE_BIN=$(find /opt/fnm/node-versions -name node -type f | head -1)
    NODE_DIR=$(dirname "$NODE_BIN")
    export PATH="$NODE_DIR:$PATH"
  fi

  cd "$MODULE_DIR"
  npm install --omit=dev 2>/dev/null || warn "npm install failed — module may still work if node_modules exists"
  cd - >/dev/null
fi

# Set ownership
chown -R "$REAL_USER:$REAL_USER" "$MODULE_DIR" 2>/dev/null || true

log "Companion module installed at $MODULE_DIR"

# ============================================================
# Step 4: Auto-login + X11 auto-start
# ============================================================

log "Step 4/6: Configuring auto-login and auto-start..."

# Auto-login on tty1
mkdir -p /etc/systemd/system/getty@tty1.service.d/
cat > /etc/systemd/system/getty@tty1.service.d/autologin.conf << EOF
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin $REAL_USER --noclear %I \$TERM
EOF

# Install touchscreen mapping script (maps wch.cn touchscreens to HDMI outputs
# by stable USB port path — survives reboots regardless of xinput enumeration).
SCRIPT_SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_SRC_DIR/photonboard-map-touch.sh" ]; then
  install -m 0755 "$SCRIPT_SRC_DIR/photonboard-map-touch.sh" /usr/local/bin/photonboard-map-touch
  log "Installed /usr/local/bin/photonboard-map-touch"
else
  warn "photonboard-map-touch.sh not found alongside pi-setup.sh — touch mapping may be wrong"
fi

# Optional touch mapping config (SWAP=1 to invert left/right)
mkdir -p /etc/photonboard
if [ ! -f /etc/photonboard/touch-map.conf ]; then
  cat > /etc/photonboard/touch-map.conf << 'TOUCHCONF'
# PhotonBoard touchscreen mapping
# Set SWAP=1 if the left/right touchscreens are inverted.
SWAP=0
TOUCHCONF
fi

# .xinitrc — kiosk mode with PhotonBoard
cat > "$REAL_HOME/.xinitrc" << 'XINITRC'
#!/bin/bash
# PhotonBoard kiosk mode

# Hide mouse cursor after 3s idle
unclutter -idle 3 -root &

# Disable screen blanking / power management
xset s off
xset -dpms
xset s noblank

# Minimal window manager (needed for fullscreen)
openbox --sm-disable &
sleep 0.5

# Map touchscreens to their physical HDMI outputs (background — script waits for X)
[ -x /usr/local/bin/photonboard-map-touch ] && /usr/local/bin/photonboard-map-touch &

# Launch PhotonBoard
exec photonboard --no-sandbox --ignore-gpu-blocklist --use-gl=egl --start-fullscreen
XINITRC
chmod +x "$REAL_HOME/.xinitrc"
chown "$REAL_USER:$REAL_USER" "$REAL_HOME/.xinitrc"

# .bash_profile — auto-start X on tty1 if display connected
cat > "$REAL_HOME/.bash_profile" << 'BASHPROFILE'
# Auto-start X and PhotonBoard on console login (tty1 only)
if [ -z "$DISPLAY" ] && [ "$(tty)" = "/dev/tty1" ]; then
  # Only start X if a display is connected
  if ls /sys/class/drm/card*-*/status 2>/dev/null | xargs grep -l "connected" >/dev/null 2>&1; then
    startx -- -keeptty 2>/tmp/startx.log
  else
    echo "No display connected — skipping PhotonBoard GUI."
    echo "PhotonBoard web server will still be available on port 9091."
    echo "Plug a screen and run: startx"
  fi
fi
BASHPROFILE
chown "$REAL_USER:$REAL_USER" "$REAL_HOME/.bash_profile"

log "Auto-login and kiosk mode configured."

# ============================================================
# Step 5: Network configuration
# ============================================================

log "Step 5/6: Configuring network..."

# Set hostname
CURRENT_HOSTNAME=$(hostname)
if [[ "$CURRENT_HOSTNAME" != "$NEW_HOSTNAME" ]]; then
  hostnamectl set-hostname "$NEW_HOSTNAME"
  sed -i "s/$CURRENT_HOSTNAME/$NEW_HOSTNAME/g" /etc/hosts 2>/dev/null || true
  log "Hostname set to $NEW_HOSTNAME (was: $CURRENT_HOSTNAME)"
else
  log "Hostname already set to $NEW_HOSTNAME"
fi

# Set timezone (default: Europe/Paris — override with PB_TIMEZONE env var)
PB_TIMEZONE="${PB_TIMEZONE:-Europe/Paris}"
if [ -f "/usr/share/zoneinfo/$PB_TIMEZONE" ]; then
  timedatectl set-timezone "$PB_TIMEZONE" 2>/dev/null || true
  log "Timezone set to $PB_TIMEZONE"
else
  warn "Timezone $PB_TIMEZONE not found — leaving system default"
fi

# Enable and start avahi (mDNS — makes <hostname>.local work)
systemctl enable avahi-daemon 2>/dev/null || true
systemctl start avahi-daemon 2>/dev/null || true

# Ensure Companion and PhotonBoard ports are accessible
# (no firewall by default on Raspberry Pi OS, but just in case)
if command -v ufw &>/dev/null; then
  ufw allow 9090/tcp comment "PhotonBoard API (Companion)" 2>/dev/null || true
  ufw allow 9091/tcp comment "PhotonBoard Web Remote"       2>/dev/null || true
  ufw allow 8000/tcp comment "Companion Web UI"             2>/dev/null || true
fi

log "Network configured. Device will be accessible at ${NEW_HOSTNAME}.local"

# ============================================================
# Step 6: Show files directory + defaults
# ============================================================

log "Step 6/6: Setting up default directories..."

# Create show files directory
SHOWS_DIR="$REAL_HOME/Documents/PhotonBoard"
mkdir -p "$SHOWS_DIR"
chown -R "$REAL_USER:$REAL_USER" "$SHOWS_DIR"

# Create PhotonBoard config directory
PB_CONFIG="$REAL_HOME/.config/photonboard"
mkdir -p "$PB_CONFIG/config"
chown -R "$REAL_USER:$REAL_USER" "$PB_CONFIG"

log "Show directory: $SHOWS_DIR"

# ============================================================
# Done!
# ============================================================

echo ""
echo -e "${CYAN}============================================================${NC}"
echo -e "${CYAN}  PhotonBoard installation complete!${NC}"
echo -e "${CYAN}============================================================${NC}"
echo ""
echo -e "  ${GREEN}PhotonBoard:${NC}  $(which photonboard)"
echo -e "  ${GREEN}Companion:${NC}    $(systemctl is-active companion 2>/dev/null || echo 'not found')"
echo -e "  ${GREEN}Module:${NC}       $MODULE_DIR"
echo -e "  ${GREEN}Hostname:${NC}     ${NEW_HOSTNAME}.local"
echo -e "  ${GREEN}Shows:${NC}        $SHOWS_DIR"
echo ""
echo -e "  ${YELLOW}Ports:${NC}"
echo -e "    9090  PhotonBoard API (Companion module)"
echo -e "    9091  PhotonBoard Web Remote (3D preview)"
echo -e "    8000  Companion Web UI"
echo ""
echo -e "  ${YELLOW}Access:${NC}"
echo -e "    Mac browser:  http://${NEW_HOSTNAME}.local:9091"
echo -e "    Companion:    http://${NEW_HOSTNAME}.local:8000"
echo -e "    SSH:          ssh $REAL_USER@${NEW_HOSTNAME}.local"
echo ""
echo -e "  ${YELLOW}Reboot to start PhotonBoard automatically:${NC}"
echo -e "    sudo reboot"
echo ""
