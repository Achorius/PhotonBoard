#!/usr/bin/env bash
# ============================================================
# PhotonBoard — Raspberry Pi Setup Script
# Transforms a fresh CompanionPi / Raspberry Pi OS (arm64) image into a
# complete PhotonBoard + Companion lighting station.
#
# Usage (as the user that will run the kiosk, e.g. "aula"):
#   curl -fsSL https://raw.githubusercontent.com/Achorius/PhotonBoard/main/scripts/pi-setup.sh | sudo bash
#   curl -fsSL .../pi-setup.sh | sudo bash -s -- --hostname Salle1 --version 0.2.0
#   # or from a copy / checkout of the repository:
#   sudo ./pi-setup.sh [options]
#
# Safe to re-run (idempotent): it upgrades PhotonBoard when a newer release
# exists and refreshes its own config without duplicating anything.
#
# Prerequisites:
#   - Raspberry Pi 5 (4GB+ recommended), Raspberry Pi OS / CompanionPi arm64
#   - Internet connection
#
# What this script does:
#   1. Installs system dependencies (X11, openbox, unclutter, ALSA, zenity...)
#   2. Installs/updates the PhotonBoard .deb (GitHub release or local file)
#   3. Installs companion-module-photonboard
#   4. Configures tty1 auto-login + X11 kiosk (+ touchscreen mapping helper)
#   5. Configures network (hostname, mDNS, timezone, firewall ports)
#   6. Creates the show directory
# ============================================================

set -euo pipefail

PROG=pi-setup.sh
TAG=PhotonBoard
PB_REPO="Achorius/PhotonBoard"
PB_REF="${PB_REF:-main}"
PB_RAW_BASE="${PB_RAW_BASE:-https://raw.githubusercontent.com/$PB_REPO/$PB_REF/scripts}"
MODULE_NAME="companion-module-photonboard"
COMPANION_MODULE_DEV="/opt/companion-module-dev"
KIOSK_BEGIN="# >>> PhotonBoard kiosk (managed by pi-setup.sh) >>>"
KIOSK_END="# <<< PhotonBoard kiosk (managed by pi-setup.sh) <<<"

_say() { # _say FD COLOUR MESSAGE...
  local fd=$1 colour=$2
  shift 2
  if [[ -t $fd ]]; then
    printf '\033[%sm[%s]\033[0m %s\n' "$colour" "$TAG" "$*" >&"$fd"
  else
    printf '[%s] %s\n' "$TAG" "$*" >&"$fd"
  fi
}
info()  { _say 1 '0;32' "$@"; }
warn()  { _say 2 '1;33' "WARNING: $*"; }
error() { _say 2 '0;31' "ERROR: $*"; }
die()   { error "$@"; exit 1; }

usage() {
  cat <<EOF
Usage:
  curl -fsSL $PB_RAW_BASE/pi-setup.sh | sudo bash [-s -- options]
  sudo ./$PROG [options]

Options (each also settable as an environment variable after "sudo"):
  --version X.Y.Z     PhotonBoard version to install (PB_VERSION, default: latest)
  --deb FILE          Install this local .deb instead of downloading (PB_DEB)
  --hostname NAME     Hostname (PB_HOSTNAME). Default: keep the current one,
                      except a stock name (raspberrypi, companionpi...) which
                      becomes "PhotonBoard"
  --timezone TZ       Timezone (PB_TIMEZONE, default: Europe/Paris)
  --user NAME         Kiosk user (PB_USER, default: the user who ran sudo)
  --update-module     Re-install the Companion module even if present
                      (PB_UPDATE_MODULE=1)
  -h, --help          Show this help
EOF
}

# ============================================================
# Helpers
# ============================================================

apt_has() { # apt_has PKG -> 0 if PKG has an installation candidate
  apt-cache policy "$1" 2>/dev/null | grep -q 'Candidate: [^(]'
}

pick_pkg() { # pick_pkg ALT1 ALT2... -> prints the first installable one
  local p
  for p in "$@"; do
    if apt_has "$p"; then printf '%s\n' "$p"; return 0; fi
  done
  return 1
}

installed_version() { # installed PhotonBoard version, empty if not installed
  dpkg-query -W -f='${Status} ${Version}\n' photonboard 2>/dev/null \
    | awk '$1=="install" && $3=="installed" {print $4}' || true
}

# Writes stdin into FILE between the KIOSK markers (replacing a previous
# block, keeping everything else). Idempotent.
replace_block() { # replace_block FILE  (block content on stdin)
  local file=$1 tmp
  tmp=$(mktemp)
  if [[ -f $file ]]; then
    awk -v b="$KIOSK_BEGIN" -v e="$KIOSK_END" '
      $0 == b {skip=1; next}
      $0 == e {skip=0; next}
      !skip {print}' "$file" > "$tmp"
  fi
  {
    printf '%s\n' "$KIOSK_BEGIN"
    cat
    printf '%s\n' "$KIOSK_END"
  } >> "$tmp"
  cat "$tmp" > "$file"
  rm -f "$tmp"
}

# Location of this script when run from a file (empty when piped: curl | bash).
script_dir() {
  # Piped into bash, BASH_SOURCE[0] is unset at top level and "main" in functions.
  local src=${BASH_SOURCE[0]:-}
  if [[ -n $src && $src != main && -f $src ]]; then
    (cd "$(dirname "$src")" && pwd -P)
  fi
}

# ============================================================
# Steps
# ============================================================

step_dependencies() {
  info "Step 1/6: Installing system dependencies..."
  apt-get update -q

  # "a|b" = first available (package names differ between Bookworm and Trixie,
  # e.g. libasound2 -> libasound2t64, libgtk-3-0 -> libgtk-3-0t64).
  local -a wanted=(
    xserver-xorg xserver-xorg-core xinit x11-xserver-utils xinput openbox
    "unclutter|unclutter-xfixes"
    libusb-1.0-0 libgbm1
    "libasound2t64|libasound2"   # ALSA runtime — required for Web MIDI (Chromium)
    alsa-utils                   # amidi / aplay -l for MIDI troubleshooting
    zenity                       # native file dialogs for Electron on Linux
    "libgtk-3-0t64|libgtk-3-0"   # GTK runtime used by zenity/Electron dialogs
    avahi-daemon avahi-utils     # mDNS: <hostname>.local
    curl ca-certificates git
  )
  local -a pkgs=() alts
  local w p
  for w in "${wanted[@]}"; do
    IFS='|' read -r -a alts <<< "$w"
    if p=$(pick_pkg "${alts[@]}"); then
      pkgs+=("$p")
    else
      die "No installable package for: ${w//|/ or } (apt sources broken? try: sudo apt-get update)"
    fi
  done
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q "${pkgs[@]}" </dev/null
  info "System dependencies installed."
}

download_deb() { # download_deb URL -> prints local path
  local url=$1 dir
  dir=$(mktemp -d /var/tmp/pb-deb.XXXXXX)
  chmod 755 "$dir"     # readable by apt's _apt sandbox user
  curl -fSL --retry 3 -o "$dir/photonboard_arm64.deb" "$url" >&2 \
    || die "Download failed: $url"
  chmod 644 "$dir/photonboard_arm64.deb"
  printf '%s\n' "$dir/photonboard_arm64.deb"
}

find_local_deb() { # first photonboard_*_arm64.deb in CWD or next to the script
  local d f
  for d in "$PWD" "${SCRIPT_DIR:-}"; do
    [[ -n $d ]] || continue
    for f in "$d"/photonboard_*_arm64.deb; do
      [[ -f $f ]] && { printf '%s\n' "$f"; return 0; }
    done
  done
  return 1
}

step_photonboard() {
  info "Step 2/6: Installing PhotonBoard..."
  local installed want="" deb="" json url=""
  installed=$(installed_version)
  [[ -n $installed ]] && info "PhotonBoard $installed is installed."

  if [[ -n $PB_DEB ]]; then
    [[ -f $PB_DEB ]] || die "--deb $PB_DEB: file not found"
    deb=$(cd "$(dirname "$PB_DEB")" && pwd -P)/$(basename "$PB_DEB")
  elif [[ $PB_VERSION == latest ]]; then
    if json=$(curl -fsSL --retry 2 "https://api.github.com/repos/$PB_REPO/releases/latest" 2>/dev/null); then
      want=$(printf '%s\n' "$json" | sed -n 's/.*"tag_name": *"v\{0,1\}\([^"]*\)".*/\1/p' | head -n1)
      url=$(printf '%s\n' "$json" | grep -o '"browser_download_url": *"[^"]*_arm64\.deb"' \
            | sed 's/.*"\(https[^"]*\)"$/\1/' | head -n1)
    fi
    if [[ -n $url ]]; then
      if [[ -n $installed && $installed == "$want" ]]; then
        info "PhotonBoard is up to date ($installed)."
      else
        info "Downloading PhotonBoard ${want:-latest}..."
        deb=$(download_deb "$url")
      fi
    elif [[ -n $installed ]]; then
      warn "Could not reach the GitHub release — keeping PhotonBoard $installed."
    elif deb=$(find_local_deb); then
      info "No GitHub release reachable — using local $deb"
    else
      die "Could not find a PhotonBoard .deb: no GitHub release reachable and no photonboard_*_arm64.deb in $PWD.
       Build one on the dev machine with: npm run package:linux   (then: --deb path/to/file.deb)"
    fi
  else
    if [[ $installed == "$PB_VERSION" ]]; then
      info "PhotonBoard $PB_VERSION already installed."
    else
      info "Downloading PhotonBoard $PB_VERSION..."
      deb=$(download_deb "https://github.com/$PB_REPO/releases/download/v$PB_VERSION/photonboard_${PB_VERSION}_arm64.deb")
    fi
  fi

  if [[ -n $deb ]]; then
    # apt (not dpkg -i) resolves the package's dependencies.
    DEBIAN_FRONTEND=noninteractive apt-get install -y -q --allow-downgrades "$deb" </dev/null
    case $deb in /var/tmp/pb-deb.*) rm -rf "$(dirname "$deb")" ;; esac
    info "PhotonBoard $(installed_version) installed."
  fi

  if ! command -v photonboard >/dev/null 2>&1; then
    if [[ -x /opt/PhotonBoard/photonboard ]]; then
      ln -sf /opt/PhotonBoard/photonboard /usr/local/bin/photonboard
      info "Symlinked /opt/PhotonBoard/photonboard to /usr/local/bin/"
    else
      die "PhotonBoard binary not found after install!"
    fi
  fi
  info "PhotonBoard ready: $(command -v photonboard)"
}

step_companion_module() {
  info "Step 3/6: Installing $MODULE_NAME..."
  local module_dir="$COMPANION_MODULE_DEV/$MODULE_NAME" src="" tmp=""
  mkdir -p "$COMPANION_MODULE_DEV"

  if [[ -d $module_dir && $PB_UPDATE_MODULE != 1 ]]; then
    info "Companion module already installed at $module_dir (--update-module to refresh)."
  else
    if [[ -d /tmp/$MODULE_NAME ]]; then
      src=/tmp/$MODULE_NAME
    elif [[ -n $SCRIPT_DIR && -d $SCRIPT_DIR/../$MODULE_NAME ]]; then
      src=$SCRIPT_DIR/../$MODULE_NAME
    else
      tmp=$(mktemp -d /var/tmp/pb-repo.XXXXXX)
      info "Fetching the module from github.com/$PB_REPO ($PB_REF)..."
      git clone --quiet --depth 1 --branch "$PB_REF" "https://github.com/$PB_REPO.git" "$tmp/repo" </dev/null \
        || { rm -rf "$tmp"; die "git clone failed. Copy $MODULE_NAME to /tmp/$MODULE_NAME and re-run."; }
      src=$tmp/repo/$MODULE_NAME
    fi
    [[ -d $src ]] || { [[ -n $tmp ]] && rm -rf "$tmp"; die "Companion module not found in $src"; }
    rm -rf "$module_dir.new"
    cp -r "$src" "$module_dir.new"
    rm -rf "$module_dir"
    mv "$module_dir.new" "$module_dir"
    [[ -n $tmp ]] && rm -rf "$tmp"
  fi

  if [[ -f $module_dir/package.json ]]; then
    # Prefer CompanionPi's fnm node if present, otherwise the system node.
    local node_bin
    if [[ -d /opt/fnm/node-versions ]]; then
      node_bin=$(find /opt/fnm/node-versions -name node -type f -perm -u+x 2>/dev/null | sort -V | tail -n1 || true)
      [[ -n $node_bin ]] && PATH="$(dirname "$node_bin"):$PATH"
    fi
    if command -v npm >/dev/null 2>&1; then
      info "Installing module dependencies (npm)..."
      (cd "$module_dir" && npm install --omit=dev --no-audit --no-fund </dev/null) \
        || warn "npm install failed — the module may still work if node_modules exists."
    elif [[ ! -d $module_dir/node_modules ]]; then
      warn "npm not found: module dependencies not installed ($module_dir/node_modules missing)."
    fi
  fi
  chown -R "$REAL_USER:" "$module_dir"
  info "Companion module installed at $module_dir"
  MODULE_DIR=$module_dir
}

install_touch_helper() {
  local dst=/usr/local/bin/photonboard-map-touch tmp
  if [[ -n $SCRIPT_DIR && -f $SCRIPT_DIR/photonboard-map-touch.sh ]]; then
    install -m 0755 "$SCRIPT_DIR/photonboard-map-touch.sh" "$dst"
  else
    # Piped install (curl | sudo bash): fetch the helper from the same place.
    tmp=$(mktemp)
    if curl -fsSL --retry 2 -o "$tmp" "$PB_RAW_BASE/photonboard-map-touch.sh" \
       && head -n1 "$tmp" | grep -q '^#!' && bash -n "$tmp"; then
      install -m 0755 "$tmp" "$dst"
    else
      rm -f "$tmp"
      warn "Could not install the touchscreen mapping helper ($PB_RAW_BASE/photonboard-map-touch.sh)."
      warn "Touchscreens may be mapped to the wrong screen. Re-run pi-setup.sh later to retry."
      return 0
    fi
    rm -f "$tmp"
  fi
  info "Installed $dst"
}

step_kiosk() {
  info "Step 4/6: Configuring auto-login and kiosk mode..."

  if systemctl is-enabled --quiet display-manager.service 2>/dev/null; then
    warn "A desktop display manager is enabled: it will conflict with the tty1 kiosk."
    warn "Disable it with: sudo systemctl disable display-manager.service (or raspi-config > Boot > Console Autologin)."
  fi

  mkdir -p /etc/systemd/system/getty@tty1.service.d
  cat > /etc/systemd/system/getty@tty1.service.d/autologin.conf <<EOF
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin $REAL_USER --noclear %I \$TERM
EOF
  systemctl daemon-reload

  # Touchscreen mapping helper (maps the wch.cn touchscreens to their HDMI
  # output by stable USB port path).
  install_touch_helper
  mkdir -p /etc/photonboard
  if [[ ! -f /etc/photonboard/touch-map.conf ]]; then
    cat > /etc/photonboard/touch-map.conf <<'TOUCHCONF'
# PhotonBoard touchscreen mapping (see photonboard-map-touch --help)
# Set SWAP=1 if the left/right touchscreens are inverted.
SWAP=0
# Optional overrides:
#TOUCH_NAME='wch.cn TouchScreen'
#OUTPUTS="HDMI-1 HDMI-2"
#PORT_MAP="1-1=HDMI-1 1-2=HDMI-2"
TOUCHCONF
  fi

  # .xinitrc — fully managed by this script (previous custom file backed up once).
  local xinitrc="$REAL_HOME/.xinitrc"
  if [[ -f $xinitrc ]] && ! grep -q 'PhotonBoard kiosk' "$xinitrc"; then
    cp -p "$xinitrc" "$xinitrc.pb-backup"
    warn "Existing $xinitrc saved as $xinitrc.pb-backup"
  fi
  cat > "$xinitrc" <<'XINITRC'
#!/bin/bash
# PhotonBoard kiosk mode (managed by pi-setup.sh — re-running it overwrites this file)

# Hide mouse cursor after 3s idle
unclutter -idle 3 -root &

# Disable screen blanking / power management
xset s off
xset -dpms
xset s noblank

# Minimal window manager (needed for fullscreen)
openbox --sm-disable &
sleep 0.5

# Map touchscreens to their HDMI outputs (background — never blocks X)
if [ -x /usr/local/bin/photonboard-map-touch ]; then
  /usr/local/bin/photonboard-map-touch &
fi

# Launch PhotonBoard
exec photonboard --no-sandbox --ignore-gpu-blocklist --use-gl=egl --start-fullscreen
XINITRC
  chmod 0755 "$xinitrc"
  chown "$REAL_USER:" "$xinitrc"

  # .bash_profile — only our marked block is managed; the rest is preserved.
  local profile="$REAL_HOME/.bash_profile"
  if [[ -f $profile ]] && grep -q '^# Auto-start X and PhotonBoard on console login' "$profile" \
     && ! grep -qF "$KIOSK_BEGIN" "$profile"; then
    # File entirely written by an older pi-setup.sh: replace it.
    mv "$profile" "$profile.pb-old"
  fi
  if [[ ! -f $profile ]]; then
    # bash skips ~/.profile when ~/.bash_profile exists: keep loading it.
    printf '%s\n' '# ~/.bash_profile' '[ -f ~/.profile ] && . ~/.profile' > "$profile"
  fi
  replace_block "$profile" <<'BASHPROFILE'
# Auto-start X and PhotonBoard on console login (tty1 only)
if [ -z "$DISPLAY" ] && [ "$(tty)" = "/dev/tty1" ]; then
  # Only start X if a display is connected (exact "connected" status)
  if grep -qsx connected /sys/class/drm/card*-*/status; then
    startx -- -keeptty 2>/tmp/startx.log
  else
    echo "No display connected — skipping PhotonBoard GUI."
    echo "PhotonBoard web server will still be available on port 9091."
    echo "Plug a screen and run: startx"
  fi
fi
BASHPROFILE
  chown "$REAL_USER:" "$profile"
  rm -f "$profile.pb-old"

  info "Auto-login and kiosk mode configured."
}

step_network() {
  info "Step 5/6: Configuring network..."
  local current new
  current=$(hostname)
  if [[ -n $PB_HOSTNAME ]]; then
    new=$PB_HOSTNAME
  else
    case ${current,,} in
      raspberrypi|companionpi|localhost|"") new=PhotonBoard ;;
      *) new=$current ;;
    esac
  fi
  [[ $new =~ ^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$ ]] \
    || die "Invalid hostname '$new' (letters, digits and '-' only, max 63)."

  if [[ $current != "$new" ]]; then
    hostnamectl set-hostname "$new"
    info "Hostname set to $new (was: $current)"
  else
    info "Hostname: $new (unchanged; use --hostname to change it)"
  fi
  # Only the 127.0.1.1 line maps the hostname (never touch other entries).
  if grep -q '^127\.0\.1\.1[[:space:]]' /etc/hosts; then
    sed -i "s/^127\.0\.1\.1[[:space:]].*/127.0.1.1\t$new/" /etc/hosts
  else
    printf '127.0.1.1\t%s\n' "$new" >> /etc/hosts
  fi
  NEW_HOSTNAME=$new

  if [[ -f /usr/share/zoneinfo/$PB_TIMEZONE ]]; then
    if timedatectl set-timezone "$PB_TIMEZONE"; then
      info "Timezone set to $PB_TIMEZONE"
    else
      warn "Could not set timezone $PB_TIMEZONE"
    fi
  else
    warn "Timezone $PB_TIMEZONE not found — leaving system default"
  fi

  systemctl enable --now avahi-daemon >/dev/null 2>&1 || warn "Could not enable avahi-daemon (mDNS)."

  # No firewall by default on Raspberry Pi OS, but just in case
  if command -v ufw >/dev/null 2>&1; then
    ufw allow 9090/tcp comment "PhotonBoard API (Companion)" >/dev/null || true
    ufw allow 9091/tcp comment "PhotonBoard Web Remote"       >/dev/null || true
    ufw allow 8000/tcp comment "Companion Web UI"             >/dev/null || true
  fi
  info "Network configured. Device will be reachable at ${NEW_HOSTNAME}.local"
}

step_directories() {
  info "Step 6/6: Setting up default directories..."
  SHOWS_DIR="$REAL_HOME/Documents/PhotonBoard"
  # Electron userData on Linux = ~/.config/<productName>
  local cfg="$REAL_HOME/.config/PhotonBoard"
  mkdir -p "$SHOWS_DIR" "$cfg/config"
  chown "$REAL_USER:" "$REAL_HOME/Documents" "$SHOWS_DIR" "$REAL_HOME/.config" "$cfg" "$cfg/config"
  info "Show directory: $SHOWS_DIR"
}

print_summary() {
  local companion
  companion=$(systemctl is-active companion 2>/dev/null || true)
  echo ""
  echo "============================================================"
  echo "  PhotonBoard installation complete!"
  echo "============================================================"
  echo ""
  echo "  PhotonBoard:  $(command -v photonboard) ($(installed_version))"
  echo "  Companion:    ${companion:-not found}"
  echo "  Module:       $MODULE_DIR"
  echo "  Hostname:     ${NEW_HOSTNAME}.local"
  echo "  Shows:        $SHOWS_DIR"
  echo ""
  echo "  Ports:"
  echo "    9090  PhotonBoard API (Companion module)"
  echo "    9091  PhotonBoard Web Remote (3D preview)"
  echo "    8000  Companion Web UI"
  echo ""
  echo "  Access:"
  echo "    Mac browser:  http://${NEW_HOSTNAME}.local:9091"
  echo "    Companion:    http://${NEW_HOSTNAME}.local:8000"
  echo "    SSH:          ssh $REAL_USER@${NEW_HOSTNAME}.local"
  echo ""
  echo "  Reboot to start PhotonBoard automatically:"
  echo "    sudo reboot"
  echo ""
}

# ============================================================
# Main (everything is inside functions so that "curl | sudo bash" reads the
# whole script before running anything)
# ============================================================

main() {
  PB_VERSION="${PB_VERSION:-latest}"
  PB_DEB="${PB_DEB:-}"
  PB_HOSTNAME="${PB_HOSTNAME:-}"
  PB_TIMEZONE="${PB_TIMEZONE:-Europe/Paris}"
  PB_USER="${PB_USER:-}"
  PB_UPDATE_MODULE="${PB_UPDATE_MODULE:-0}"

  while [[ $# -gt 0 ]]; do
    case $1 in
      --version)       [[ $# -ge 2 ]] || die "--version needs a value"; PB_VERSION=${2#v}; shift 2 ;;
      --deb)           [[ $# -ge 2 ]] || die "--deb needs a value"; PB_DEB=$2; shift 2 ;;
      --hostname)      [[ $# -ge 2 ]] || die "--hostname needs a value"; PB_HOSTNAME=$2; shift 2 ;;
      --timezone)      [[ $# -ge 2 ]] || die "--timezone needs a value"; PB_TIMEZONE=$2; shift 2 ;;
      --user)          [[ $# -ge 2 ]] || die "--user needs a value"; PB_USER=$2; shift 2 ;;
      --update-module) PB_UPDATE_MODULE=1; shift ;;
      -h|--help)       usage; exit 0 ;;
      *)               error "Unknown option: $1"; usage >&2; exit 1 ;;
    esac
  done

  if [[ $EUID -ne 0 ]]; then
    die "This script must be run as root:
       curl -fsSL $PB_RAW_BASE/pi-setup.sh | sudo bash
       or: sudo ./$PROG"
  fi

  local arch
  arch=$(dpkg --print-architecture)
  [[ $arch == arm64 ]] || die "This script is for arm64 (Raspberry Pi 5). Detected: $arch"

  SCRIPT_DIR=$(script_dir)

  # The kiosk user: --user, else whoever ran sudo, else the first regular user.
  REAL_USER=${PB_USER:-${SUDO_USER:-}}
  if [[ -z $REAL_USER || $REAL_USER == root ]]; then
    REAL_USER=$(getent passwd 1000 | cut -d: -f1 || true)
  fi
  if [[ -z $REAL_USER ]] || ! id "$REAL_USER" >/dev/null 2>&1; then
    die "Cannot determine the kiosk user: run with sudo from that user, or pass --user NAME."
  fi
  REAL_HOME=$(getent passwd "$REAL_USER" | cut -d: -f6)
  [[ -d $REAL_HOME ]] || die "Home directory of $REAL_USER not found ($REAL_HOME)."
  info "Setting up PhotonBoard for user: $REAL_USER ($REAL_HOME)"

  # ALSA / MIDI / DMX-USB / touchscreen access without root. Required for Web
  # MIDI (Chromium) to see USB MIDI controllers like the Akai APC Mini, and
  # for serialport access to USB-DMX adapters.
  local g groups=()
  for g in audio plugdev dialout video render input; do
    getent group "$g" >/dev/null && groups+=("$g")
  done
  usermod -a -G "$(IFS=,; echo "${groups[*]}")" "$REAL_USER"
  info "Added $REAL_USER to groups: ${groups[*]}"

  NEW_HOSTNAME=$(hostname)
  MODULE_DIR="$COMPANION_MODULE_DEV/$MODULE_NAME"
  SHOWS_DIR="$REAL_HOME/Documents/PhotonBoard"

  step_dependencies
  step_photonboard
  step_companion_module
  step_kiosk
  step_network
  step_directories
  print_summary
}

main "$@"
