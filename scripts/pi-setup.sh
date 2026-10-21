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
#   6. Creates the show directory (with the demo shows in Documents/PhotonBoard/Démos)
#
# Image-build mode (--image-build, used by build-pi-image.sh): runs inside a
# chroot of a NOT-yet-booted Raspberry Pi OS image to produce a ready-to-flash
# PhotonBoard SD image. Nothing is started/stopped (no systemctl start,
# hostnamectl, timedatectl...); files are written directly instead. It also
# creates the kiosk user (default "photonboard", uid 1000, password
# "photonboard"), disables the Raspberry Pi OS first-boot user wizard, keeps
# SSH disabled and installs the boot-time services that keep the kiosk
# working after a Pi Imager customisation (renamed user, Wi-Fi...).
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
  --version X.Y.Z     PhotonBoard version to install (PB_VERSION, default: latest,
                      pre-releases included when no stable release exists)
  --deb FILE          Install this local .deb instead of downloading (PB_DEB)
  --hostname NAME     Hostname (PB_HOSTNAME). Default: keep the current one,
                      except a stock name (raspberrypi, companionpi...) which
                      becomes "PhotonBoard"
  --timezone TZ       Timezone (PB_TIMEZONE, default: Europe/Paris)
  --user NAME         Kiosk user (PB_USER, default: the user who ran sudo)
  --update-module     Re-install the Companion module even if present
                      (PB_UPDATE_MODULE=1)
  --image-build       Image-build mode, inside a chroot of an unbooted Raspberry
                      Pi OS image (PB_IMAGE_BUILD=1). Requires --deb. Defaults:
                      --user photonboard, --hostname photonboard
  --password PASS     Image-build mode: kiosk user password (PB_PASSWORD,
                      default: photonboard)
  --keyboard LAYOUT   Image-build mode: keyboard layout (PB_KEYBOARD, default: fr)
  -h, --help          Show this help
EOF
}

# ============================================================
# Helpers
# ============================================================

apt_has() { # apt_has PKG -> 0 if PKG has an installation candidate
  # Not "apt-cache ... | grep -q": with pipefail, grep -q exiting early makes
  # apt-cache die of SIGPIPE and the test fail at random.
  local out
  out=$(apt-cache policy "$1" 2>/dev/null) || return 1
  grep -q 'Candidate: [^(]' <<< "$out"
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

# GitHub release lookup. Prints "VERSION URL" for the arm64 .deb of:
#   - release TAG (with or without a leading "v") when given,
#   - else the latest release; when there is none (/releases/latest ignores
#     pre-releases), the newest published release (pre-releases included)
#     that has an *_arm64.deb asset.
# The anonymous API never lists drafts. Release lists are newest first, so
# the first arm64 .deb URL belongs to the newest release that has one; the
# tag is read from that URL (.../releases/download/<tag>/<file>).
release_info() { # release_info [VERSION]
  local api="https://api.github.com/repos/$PB_REPO" json url tag t
  local -a queries=()
  if [[ -n ${1:-} ]]; then
    queries=("$api/releases/tags/v${1#v}" "$api/releases/tags/${1#v}")
  else
    queries=("$api/releases/latest" "$api/releases?per_page=10")
  fi
  for t in "${queries[@]}"; do
    json=$(curl -fsSL --retry 2 "$t" 2>/dev/null) || continue
    url=$(printf '%s\n' "$json" | grep -o '"browser_download_url": *"[^"]*_arm64\.deb"' \
          | sed 's/.*"\(https[^"]*\)"$/\1/' | head -n1)
    [[ -n $url ]] || continue
    tag=${url%/*}; tag=${tag##*/}
    printf '%s %s\n' "${tag#v}" "$url"
    return 0
  done
  return 1
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
    exfatprogs ntfs-3g           # USB sticks: exFAT tools, NTFS fallback (FAT32 / exFAT / NTFS3 are in the kernel)
    zenity                       # native file dialogs for Electron on Linux
    "libgtk-3-0t64|libgtk-3-0"   # GTK runtime used by zenity/Electron dialogs
    # Electron/Chromium runtime libraries not pulled in by GTK (missing on
    # Raspberry Pi OS Lite): NSS, CUPS, accessibility bridge, X extensions.
    libnss3 libnspr4 "libcups2t64|libcups2"
    "libatk-bridge2.0-0t64|libatk-bridge2.0-0" "libatspi2.0-0t64|libatspi2.0-0"
    libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libxss1 libxtst6
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

download_deb() { # download_deb URL... -> prints local path (first URL that works)
  local dir url
  dir=$(mktemp -d /var/tmp/pb-deb.XXXXXX)
  chmod 755 "$dir"     # readable by apt's _apt sandbox user
  for url in "$@"; do
    if curl -fSL --retry 3 -o "$dir/photonboard_arm64.deb" "$url" >&2; then
      chmod 644 "$dir/photonboard_arm64.deb"
      printf '%s\n' "$dir/photonboard_arm64.deb"
      return 0
    fi
  done
  rm -rf "$dir"
  die "Download failed: $*"
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
  local installed want="" deb="" url="" rel=""
  installed=$(installed_version)
  [[ -n $installed ]] && info "PhotonBoard $installed is installed."

  if [[ -n $PB_DEB ]]; then
    [[ -f $PB_DEB ]] || die "--deb $PB_DEB: file not found"
    deb=$(cd "$(dirname "$PB_DEB")" && pwd -P)/$(basename "$PB_DEB")
  elif [[ $PB_VERSION == latest ]]; then
    if rel=$(release_info); then
      want=${rel%% *}
      url=${rel#* }
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
      if rel=$(release_info "$PB_VERSION"); then
        deb=$(download_deb "${rel#* }")
      else
        # API unreachable (rate limit...): try the usual asset URLs, tag with and without "v".
        local base="https://github.com/$PB_REPO/releases/download"
        deb=$(download_deb "$base/v$PB_VERSION/photonboard_${PB_VERSION}_arm64.deb" \
                           "$base/$PB_VERSION/photonboard_${PB_VERSION}_arm64.deb")
      fi
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
  elif (( IMAGE_BUILD )); then
    die "photonboard-map-touch.sh not found next to $PROG (image-build mode needs a full copy of scripts/)."
  else
    # Piped install (curl | sudo bash): fetch the helper from the same place.
    tmp=$(mktemp)
    if curl -fsSL --retry 2 -o "$tmp" "$PB_RAW_BASE/photonboard-map-touch.sh" \
       && [[ $(head -n1 "$tmp") == '#!'* ]] && bash -n "$tmp"; then
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

write_xinitrc() { # write_xinitrc FILE
  cat > "$1" <<'XINITRC'
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
  chmod 0755 "$1"
}

write_profile_block() { # write_profile_block FILE
  replace_block "$1" <<'BASHPROFILE'
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
  (( IMAGE_BUILD )) || systemctl daemon-reload

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
  write_xinitrc "$xinitrc"
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
  write_profile_block "$profile"
  chown "$REAL_USER:" "$profile"
  rm -f "$profile.pb-old"

  info "Auto-login and kiosk mode configured."
}

# Device access for the kiosk: game controllers (Follow spot gamepad) and
# MIDI. Chromium (Electron) reads gamepads on Linux through the joydev node
# /dev/input/jsN (+ evdev/hidraw for extras): the joydev module must be
# loaded and the nodes readable by the kiosk user. The ALSA sequencer
# (/dev/snd/seq) is what Web MIDI opens: loaded at boot so MIDI works (and
# hotplug is seen) even when no MIDI device was plugged at start-up.
step_devices() {
  info "Device access: gamepads (joydev, udev rules) and MIDI (ALSA sequencer)..."
  mkdir -p /etc/modules-load.d /etc/udev/rules.d
  cat > /etc/modules-load.d/photonboard.conf <<'EOF2'
# PhotonBoard (managed by pi-setup.sh)
# Game controllers for the Follow spot: Chromium reads /dev/input/js*
joydev
# Web MIDI (Chromium) opens the ALSA sequencer
snd-seq
snd-seq-midi
EOF2
  cat > /etc/udev/rules.d/70-photonboard-input.rules <<'EOF2'
# PhotonBoard (managed by pi-setup.sh): game controllers readable by the kiosk
# user (member of "input") even without an active logind seat session.
SUBSYSTEM=="input", KERNEL=="js[0-9]*", MODE="0664", GROUP="input", TAG+="uaccess"
SUBSYSTEM=="input", KERNEL=="event[0-9]*", ENV{ID_INPUT_JOYSTICK}=="1", MODE="0660", GROUP="input", TAG+="uaccess"
# Sony (DualShock / DualSense) and Nintendo (Switch Pro / Joy-Con) pads are
# also read through hidraw by Chromium
KERNEL=="hidraw*", SUBSYSTEM=="hidraw", ATTRS{idVendor}=="054c", MODE="0660", GROUP="input", TAG+="uaccess"
KERNEL=="hidraw*", SUBSYSTEM=="hidraw", ATTRS{idVendor}=="057e", MODE="0660", GROUP="input", TAG+="uaccess"
EOF2
  if (( ! IMAGE_BUILD )); then
    modprobe joydev 2>/dev/null || warn "joydev kernel module not available: gamepads may not be seen by PhotonBoard."
    modprobe snd-seq 2>/dev/null || true
    modprobe snd-seq-midi 2>/dev/null || true
    udevadm control --reload-rules 2>/dev/null || true
    udevadm trigger --subsystem-match=input --subsystem-match=hidraw 2>/dev/null || true
  fi
  info "Gamepad / MIDI device access configured."
}

# USB sticks: mounted automatically under /media/photonboard/<LABEL|UUID>
# (owned by the kiosk user, rw, nosuid/nodev/noexec), unmounted when pulled
# out. udev only TAGS the partition; a systemd template service does the
# mount (udev's own mount namespace would hide it) and is bound to the
# device, so removal stops it and unmounts. PhotonBoard lists the shows
# found there and can eject a stick through a sudo rule limited to
# "photonboard-usb-mount eject /media/photonboard/*".
step_usb_automount() {
  info "USB sticks: automount under /media/photonboard..."
  mkdir -p /media/photonboard /etc/udev/rules.d /etc/sudoers.d /usr/local/sbin /etc/photonboard
  chmod 0755 /media/photonboard
  # Owner of the mounted sticks (the image's kiosk guard keeps it up to date)
  [[ -s /etc/photonboard/kiosk-user ]] || printf '%s\n' "$REAL_USER" > /etc/photonboard/kiosk-user
  cat > /usr/local/sbin/photonboard-usb-mount <<'USBMOUNT'
#!/bin/bash
# PhotonBoard USB stick helper (managed by pi-setup.sh)
#   add <kernel name>      mount /dev/<name> under /media/photonboard (systemd, on plug)
#   remove <kernel name>   unmount it (systemd, when the stick is pulled out)
#   eject <mount point>    flush + unmount (the kiosk user, through sudo)
set -u
BASE=/media/photonboard
STATE=/run/photonboard-usb
log() { logger -t photonboard-usb -- "$*" 2>/dev/null || echo "$*" >&2; }
kiosk_user() {
  local u
  u=$(head -n1 /etc/photonboard/kiosk-user 2>/dev/null || true)
  id "$u" >/dev/null 2>&1 || u=$(getent passwd 1000 | cut -d: -f1)
  echo "${u:-root}"
}

do_add() {
  local kn=$1 dev=/dev/$1 type label uuid name dir u uid gid opts rc
  [ -b "$dev" ] || exit 0
  mkdir -p "$BASE" "$STATE"
  if [ -f "$STATE/$kn" ] && mountpoint -q "$(cat "$STATE/$kn")"; then exit 0; fi
  type=$(blkid -p -s TYPE -o value "$dev" 2>/dev/null)
  label=$(blkid -p -s LABEL -o value "$dev" 2>/dev/null)
  uuid=$(blkid -p -s UUID -o value "$dev" 2>/dev/null)
  case $type in
    vfat|exfat|ntfs|ntfs3) ;;
    *) log "$dev: file system '$type' not mounted"; exit 0 ;;
  esac
  name=$(printf '%s' "${label:-${uuid:-$kn}}" | tr -c 'A-Za-z0-9._-' '_' | sed 's/^[._]*//' | cut -c1-48)
  [ -n "$name" ] || name=$kn
  dir=$BASE/$name
  if mountpoint -q "$dir"; then dir=$BASE/$name-$kn; fi
  mkdir -p "$dir"
  u=$(kiosk_user); uid=$(id -u "$u"); gid=$(id -g "$u")
  opts="nosuid,nodev,noexec,noatime,uid=$uid,gid=$gid,fmask=0133,dmask=0022"
  case $type in
    vfat)  mount -t vfat -o "$opts,flush,utf8,shortname=mixed" "$dev" "$dir"; rc=$? ;;
    exfat) mount -t exfat -o "$opts" "$dev" "$dir"; rc=$? ;;
    *)     mount -t ntfs3 -o "$opts" "$dev" "$dir" 2>/dev/null || mount -t ntfs-3g -o "$opts" "$dev" "$dir"; rc=$? ;;
  esac
  if [ "$rc" -ne 0 ]; then
    rmdir "$dir" 2>/dev/null
    log "mounting $dev ($type) failed"
    exit 1
  fi
  printf '%s\n' "$dir" > "$STATE/$kn"
  log "$dev ($type) mounted on $dir"
}

do_remove() {
  local kn=$1 dir
  [ -f "$STATE/$kn" ] || exit 0
  dir=$(cat "$STATE/$kn")
  rm -f "$STATE/$kn"
  case $dir in "$BASE"/*) ;; *) exit 0 ;; esac
  if mountpoint -q "$dir"; then umount -l "$dir" 2>/dev/null; fi
  rmdir "$dir" 2>/dev/null
  log "$dir unmounted"
}

do_eject() {
  local dir f
  dir=$(realpath -m -- "$1")
  case $dir in "$BASE"/*) ;; *) echo "not a PhotonBoard USB mount: $1" >&2; exit 2 ;; esac
  case ${dir#"$BASE"/} in */*|"") echo "not a PhotonBoard USB mount: $1" >&2; exit 2 ;; esac
  mountpoint -q "$dir" || { echo "not mounted: $dir" >&2; exit 3; }
  sync
  if ! umount "$dir"; then
    echo "the stick is busy: close what uses it and try again" >&2
    exit 4
  fi
  rmdir "$dir" 2>/dev/null
  for f in "$STATE"/*; do
    [ -f "$f" ] && [ "$(cat "$f")" = "$dir" ] && rm -f "$f"
  done
  log "$dir ejected"
}

case ${1:-} in
  add)    [ $# -eq 2 ] && do_add "$2" ;;
  remove) [ $# -eq 2 ] && do_remove "$2" ;;
  eject)  [ $# -eq 2 ] && do_eject "$2" ;;
  *) echo "usage: $0 add|remove <kernel name> | eject <mount point>" >&2; exit 2 ;;
esac
USBMOUNT
  chmod 0755 /usr/local/sbin/photonboard-usb-mount

  cat > /etc/systemd/system/photonboard-usb-mount@.service <<'UNIT'
[Unit]
Description=PhotonBoard USB stick /dev/%I
BindsTo=dev-%i.device
After=dev-%i.device

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/sbin/photonboard-usb-mount add %I
ExecStop=/usr/local/sbin/photonboard-usb-mount remove %I
UNIT

  cat > /etc/udev/rules.d/99-photonboard-usb-automount.rules <<'RULES'
# PhotonBoard (managed by pi-setup.sh): USB sticks (FAT32, exFAT, NTFS)
# mounted under /media/photonboard by photonboard-usb-mount@<dev>.service
ACTION=="add", SUBSYSTEM=="block", ENV{ID_BUS}=="usb", ENV{ID_FS_USAGE}=="filesystem", ENV{ID_FS_TYPE}=="vfat|exfat|ntfs", TAG+="systemd", ENV{SYSTEMD_WANTS}+="photonboard-usb-mount@%k.service"
RULES

  local sudoers=/etc/sudoers.d/photonboard-usb
  cat > "$sudoers.tmp" <<'SUDOERS'
# PhotonBoard (managed by pi-setup.sh): the kiosk user (plugdev) may eject
# the USB sticks PhotonBoard mounted — nothing else.
%plugdev ALL=(root) NOPASSWD: /usr/local/sbin/photonboard-usb-mount eject /media/photonboard/*
SUDOERS
  chmod 0440 "$sudoers.tmp"
  if command -v visudo >/dev/null 2>&1 && ! visudo -cf "$sudoers.tmp" >/dev/null; then
    rm -f "$sudoers.tmp"
    warn "sudoers rule for USB eject rejected by visudo: PhotonBoard cannot eject sticks (unplug them when idle)."
  else
    mv -f "$sudoers.tmp" "$sudoers"
  fi

  if (( ! IMAGE_BUILD )); then
    systemctl daemon-reload
    udevadm control --reload-rules 2>/dev/null || true
    udevadm trigger --subsystem-match=block --action=add 2>/dev/null || true
  fi
  info "USB sticks are mounted under /media/photonboard."
}

step_network() {
  info "Step 5/6: Configuring network..."
  local current new
  if (( IMAGE_BUILD )); then
    current=$(cat /etc/hostname 2>/dev/null || true)
  else
    current=$(hostname)
  fi
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

  if (( IMAGE_BUILD )); then
    printf '%s\n' "$new" > /etc/hostname
    info "Hostname set to $new (/etc/hostname)"
  elif [[ $current != "$new" ]]; then
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
    if (( IMAGE_BUILD )); then
      ln -sfn "/usr/share/zoneinfo/$PB_TIMEZONE" /etc/localtime
      printf '%s\n' "$PB_TIMEZONE" > /etc/timezone
      info "Timezone set to $PB_TIMEZONE"
    elif timedatectl set-timezone "$PB_TIMEZONE"; then
      info "Timezone set to $PB_TIMEZONE"
    else
      warn "Could not set timezone $PB_TIMEZONE"
    fi
  else
    warn "Timezone $PB_TIMEZONE not found — leaving system default"
  fi

  if (( IMAGE_BUILD )); then
    systemctl enable avahi-daemon >/dev/null 2>&1 || warn "Could not enable avahi-daemon (mDNS)."
  else
    systemctl enable --now avahi-daemon >/dev/null 2>&1 || warn "Could not enable avahi-daemon (mDNS)."
  fi

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
  install_demos
}

# Demo shows and example import files shipped with the app
# (/opt/PhotonBoard/resources/demos) → ~/Documents/PhotonBoard/Démos, owned
# by the kiosk user. Files already there are never overwritten (a demo the
# operator changed stays theirs); a re-run only adds what is missing.
install_demos() {
  local src=/opt/PhotonBoard/resources/demos
  local dst="$SHOWS_DIR/Démos"
  local group f
  if [[ ! -d $src ]]; then
    warn "No demo files in $src (PhotonBoard older than 1.1.2?) — skipped."
    return 0
  fi
  group=$(id -gn "$REAL_USER")
  install -d -m 0755 -o "$REAL_USER" -g "$group" "$dst"
  for f in "$src"/*.pbshow; do
    [[ -f $f && ! -e $dst/${f##*/} ]] || continue
    install -m 0644 -o "$REAL_USER" -g "$group" "$f" "$dst/${f##*/}"
  done
  if [[ -d $src/formats ]]; then
    install -d -m 0755 -o "$REAL_USER" -g "$group" "$dst/Formats"
    for f in "$src"/formats/*; do
      [[ -f $f && ! -e $dst/Formats/${f##*/} ]] || continue
      install -m 0644 -o "$REAL_USER" -g "$group" "$f" "$dst/Formats/${f##*/}"
    done
  fi
  info "Demos: $dst"
}

# ============================================================
# Image-build mode only
# ============================================================

# Groups of the stock Raspberry Pi OS first user (pi-gen / cloud-init).
IMAGE_USER_GROUPS=(adm dialout cdrom sudo audio video plugdev games users input render netdev gpio i2c spi)

# Creates the kiosk user (uid 1000) in the unbooted image. The stock image
# ships a placeholder first user ("pi", uid 1000, no password) meant to be
# renamed by the first-boot wizard: it is renamed exactly like userconf-pi
# does, so everything that refers to uid 1000 keeps working.
image_create_user() {
  local u=$REAL_USER first firstgroup g
  if id "$u" >/dev/null 2>&1; then
    info "User $u already exists."
  elif first=$(getent passwd 1000 | cut -d: -f1) && [[ -n $first ]]; then
    firstgroup=$(getent group 1000 | cut -d: -f1 || true)
    info "Renaming the stock first user '$first' (uid 1000) to '$u'..."
    usermod -l "$u" "$first"
    usermod -m -d "/home/$u" "$u"
    [[ -n $firstgroup && $firstgroup == "$first" ]] && groupmod -n "$u" "$firstgroup"
    local f
    for f in /etc/subuid /etc/subgid; do
      [[ -f $f ]] && sed -i "s/^$first:/$u:/" "$f"
    done
    if [[ -f /etc/sudoers.d/010_pi-nopasswd ]]; then
      sed -i "s/^$first /$u /" /etc/sudoers.d/010_pi-nopasswd
    fi
  else
    info "Creating user $u (uid 1000)..."
    if getent group 1000 >/dev/null; then
      useradd -m -u 1000 -g "$(getent group 1000 | cut -d: -f1)" -s /bin/bash "$u"
    else
      useradd -m -u 1000 -U -s /bin/bash "$u"
    fi
  fi
  usermod -s /bin/bash -c "PhotonBoard" "$u"
  printf '%s:%s\n' "$u" "$PB_PASSWORD" | chpasswd
  for g in gpio i2c spi input render; do
    getent group "$g" >/dev/null || groupadd -f -r "$g"
  done
  local -a groups=()
  for g in "${IMAGE_USER_GROUPS[@]}"; do
    getent group "$g" >/dev/null && groups+=("$g")
  done
  usermod -a -G "$(IFS=,; echo "${groups[*]}")" "$u"
  info "User $u: password set, groups ${groups[*]}"
}

# Disables the Raspberry Pi OS first-boot "create a user" wizard
# (userconf-pi's userconfig.service, armed in the stock image by
# "rename-user -f -s") the way cancel-rename does, offline.
image_disable_user_wizard() {
  if [[ -f /usr/lib/systemd/system/userconfig.service || -f /lib/systemd/system/userconfig.service ]]; then
    systemctl disable userconfig.service >/dev/null 2>&1 || true
    # Even if something re-enables it later (cloud-init's rename-user, a
    # preset...), only run it for a headless userconf(.txt) file on the boot
    # partition — never the interactive wizard that would block the kiosk.
    mkdir -p /etc/systemd/system/userconfig.service.d
    cat > /etc/systemd/system/userconfig.service.d/photonboard.conf <<'EOF'
# PhotonBoard image: no interactive first-boot user wizard. Runs only when a
# userconf/userconf.txt file was put on the boot partition.
[Unit]
ConditionPathExists=|/boot/firmware/userconf
ConditionPathExists=|/boot/firmware/userconf.txt
ConditionPathExists=|/boot/userconf
ConditionPathExists=|/boot/userconf.txt
EOF
    info "First-boot user wizard (userconfig.service) disabled."
  else
    info "No userconfig.service in this image (nothing to disable)."
  fi
  rm -f /etc/ssh/sshd_config.d/rename_user.conf /etc/xdg/autostart/piwiz.desktop
  # Tells userconf-pi's cancel-rename (run when Pi Imager 1.x renames the
  # user) to keep console AUTOLOGIN for the renamed user (raspi-config B2).
  mkdir -p /var/lib/userconf-pi
  : > /var/lib/userconf-pi/autologin
  systemctl enable getty@tty1.service >/dev/null 2>&1 \
    || ln -sfn /usr/lib/systemd/system/getty@.service /etc/systemd/system/getty.target.wants/getty@tty1.service
  systemctl set-default multi-user.target >/dev/null 2>&1 || true
}

image_disable_ssh() {
  # Off by default; enabled again by an empty "ssh" file on the boot
  # partition (Raspberry Pi OS sshswitch.service) or by Pi Imager.
  systemctl disable ssh.service >/dev/null 2>&1 || true
  systemctl enable sshswitch.service >/dev/null 2>&1 || true
  rm -f /boot/firmware/ssh /boot/firmware/ssh.txt
  info "SSH disabled (create an empty 'ssh' file on the boot partition to enable it)."
}

image_keyboard() {
  [[ -n $PB_KEYBOARD && -f /etc/default/keyboard ]] || return 0
  if grep -q '^XKBLAYOUT=' /etc/default/keyboard; then
    sed -i "s/^XKBLAYOUT=.*/XKBLAYOUT=\"$PB_KEYBOARD\"/" /etc/default/keyboard
  else
    printf 'XKBLAYOUT="%s"\n' "$PB_KEYBOARD" >> /etc/default/keyboard
  fi
  sed -i 's/^XKBVARIANT=.*/XKBVARIANT=""/' /etc/default/keyboard
  command -v setupcon >/dev/null 2>&1 && setupcon --force --save-only >/dev/null 2>&1 || true
  info "Keyboard layout: $PB_KEYBOARD"
}

# Boot-time services shipped in the image.
image_services() {
  # Kiosk files for users created later (Pi Imager, cloud-init, adduser).
  write_xinitrc /etc/skel/.xinitrc
  if [[ ! -f /etc/skel/.bash_profile ]] || ! grep -qF "$KIOSK_BEGIN" /etc/skel/.bash_profile; then
    [[ -f /etc/skel/.bash_profile ]] \
      || printf '%s\n' '# ~/.bash_profile' '[ -f ~/.profile ] && . ~/.profile' > /etc/skel/.bash_profile
    write_profile_block /etc/skel/.bash_profile
  fi
  printf '%s\n' "$REAL_USER" > /etc/photonboard/kiosk-user

  # Raspberry Pi 5: make sure Xorg drives the display controller (vc4), not
  # the render-only GPU, with the modesetting driver.
  mkdir -p /etc/X11/xorg.conf.d
  if [[ ! -f /etc/X11/xorg.conf.d/99-vc4.conf ]]; then
    cat > /etc/X11/xorg.conf.d/99-vc4.conf <<'EOF'
# PhotonBoard image: Raspberry Pi KMS display controller as the primary GPU.
Section "OutputClass"
  Identifier "vc4"
  MatchDriver "vc4"
  Driver "modesetting"
  Option "PrimaryGPU" "true"
EndSection
EOF
  fi

  # --- 1. Kiosk guard: every boot, before the tty1 login. ---
  cat > /usr/local/sbin/photonboard-kiosk-guard <<'GUARD'
#!/bin/bash
# PhotonBoard — keep the tty1 kiosk autologin working (runs at every boot,
# before getty@tty1). If Pi Imager / cloud-init renamed or replaced the
# kiosk user, or disabled the tty1 console, point the autologin at an
# existing user again and give that user the kiosk files.
# Opt out: sudo touch /etc/photonboard/no-kiosk
set -u
[ -e /etc/photonboard/no-kiosk ] && exit 0
CONF=/etc/systemd/system/getty@tty1.service.d/autologin.conf
KIOSK_BEGIN='# >>> PhotonBoard kiosk (managed by pi-setup.sh) >>>'
reload=0

valid_user() { [ -n "$1" ] && id "$1" >/dev/null 2>&1 && [ "$(id -u "$1")" -ge 1000 ]; }

AUTO_USER=""
[ -f "$CONF" ] && AUTO_USER=$(sed -n 's/.*--autologin \([^ ]*\).*/\1/p' "$CONF" | head -n1)
if ! valid_user "$AUTO_USER"; then
  NEW_USER=""
  for U in "$(cat /etc/photonboard/kiosk-user 2>/dev/null)" "$(getent passwd 1000 | cut -d: -f1)"; do
    valid_user "$U" && { NEW_USER=$U; break; }
  done
  [ -n "$NEW_USER" ] || NEW_USER=$(getent passwd | awk -F: '$3>=1000 && $3<60000 && $7 ~ /sh$/ {print $1; exit}')
  if [ -n "$NEW_USER" ]; then
    echo "Autologin user '${AUTO_USER:-none}' invalid — switching to $NEW_USER"
    mkdir -p "${CONF%/*}"
    printf '[Service]\nExecStart=\nExecStart=-/sbin/agetty --autologin %s --noclear %%I $TERM\n' "$NEW_USER" > "$CONF"
    AUTO_USER=$NEW_USER
    reload=1
  else
    echo "No regular user found — kiosk autologin left unchanged."
    exit 0
  fi
fi
echo "$AUTO_USER" > /etc/photonboard/kiosk-user

# Kiosk files, folders and device groups for the autologin user.
H=$(getent passwd "$AUTO_USER" | cut -d: -f6)
if [ -n "$H" ] && [ -d "$H" ]; then
  if [ ! -f "$H/.xinitrc" ] || ! grep -q 'PhotonBoard kiosk' "$H/.xinitrc"; then
    [ -f "$H/.xinitrc" ] && mv -f "$H/.xinitrc" "$H/.xinitrc.pb-backup"
    install -m 0755 -o "$AUTO_USER" -g "$(id -gn "$AUTO_USER")" /etc/skel/.xinitrc "$H/.xinitrc"
  fi
  if [ ! -f "$H/.bash_profile" ]; then
    install -m 0644 -o "$AUTO_USER" -g "$(id -gn "$AUTO_USER")" /etc/skel/.bash_profile "$H/.bash_profile"
  elif ! grep -qF "$KIOSK_BEGIN" "$H/.bash_profile"; then
    sed -n "/^$KIOSK_BEGIN\$/,\$p" /etc/skel/.bash_profile >> "$H/.bash_profile"
  fi
  mkdir -p "$H/Documents/PhotonBoard" "$H/.config/PhotonBoard/config"
  chown "$AUTO_USER:" "$H/Documents" "$H/Documents/PhotonBoard" "$H/.config" \
    "$H/.config/PhotonBoard" "$H/.config/PhotonBoard/config" 2>/dev/null || true
  GROUPS_OK=""
  for G in audio video input render plugdev dialout; do
    getent group "$G" >/dev/null && GROUPS_OK="$GROUPS_OK${GROUPS_OK:+,}$G"
  done
  [ -n "$GROUPS_OK" ] && usermod -a -G "$GROUPS_OK" "$AUTO_USER"
fi

# rename-user (cloud-init) disables the tty1 console: the kiosk needs it.
if ! systemctl -q is-enabled getty@tty1.service 2>/dev/null; then
  echo "getty@tty1 was disabled — enabling it again"
  systemctl -q enable getty@tty1.service
  reload=1
  START_GETTY=1
fi
[ "$reload" = 1 ] && systemctl daemon-reload
[ "${START_GETTY:-0}" = 1 ] && systemctl --no-block start getty@tty1.service
exit 0
GUARD
  chmod 0755 /usr/local/sbin/photonboard-kiosk-guard
  cat > /etc/systemd/system/photonboard-kiosk-guard.service <<'UNIT'
[Unit]
Description=PhotonBoard kiosk guard (tty1 autologin user, kiosk files)
After=systemd-user-sessions.service cloud-init.service cloud-init-network.service
Before=getty@tty1.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/photonboard-kiosk-guard

[Install]
WantedBy=multi-user.target
UNIT
  systemctl enable photonboard-kiosk-guard.service >/dev/null

  # --- 2. First boot: per-unit identity. ---
  cat > /usr/local/sbin/photonboard-first-boot <<'FIRSTBOOT'
#!/bin/bash
# PhotonBoard — first boot of a freshly flashed image (runs once).
# Raspberry Pi OS regenerates the SSH host keys itself on first boot
# (regenerate_ssh_host_keys.service); this is a safety net.
set -u
echo "$(date) — PhotonBoard first boot"
if ! ls /etc/ssh/ssh_host_*_key >/dev/null 2>&1 && command -v ssh-keygen >/dev/null; then
  echo "Generating SSH host keys..."
  ssh-keygen -A
fi
mkdir -p /var/lib/photonboard
touch /var/lib/photonboard/first-boot.done
echo "$(date) — first boot done"
FIRSTBOOT
  chmod 0755 /usr/local/sbin/photonboard-first-boot
  cat > /etc/systemd/system/photonboard-first-boot.service <<'UNIT'
[Unit]
Description=PhotonBoard first boot (per-unit SSH host keys)
After=local-fs.target regenerate_ssh_host_keys.service
Before=ssh.service sshswitch.service
ConditionPathExists=!/var/lib/photonboard/first-boot.done

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/photonboard-first-boot
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
UNIT
  systemctl enable photonboard-first-boot.service >/dev/null
  rm -f /var/lib/photonboard/first-boot.done

  # --- 3. Wi-Fi from a text file on the boot partition. ---
  # Pi Imager 2 offers no customisation for "Use custom" images: this lets a
  # user set the Wi-Fi by editing photonboard-wifi.txt on the card (bootfs).
  cat > /usr/local/sbin/photonboard-wifi <<'WIFI'
#!/bin/bash
# PhotonBoard — apply /boot/firmware/photonboard-wifi.txt (every boot, if set).
set -u
F=/boot/firmware/photonboard-wifi.txt
[ -f "$F" ] || exit 0
get() { # value of KEY="..." / KEY=... (Windows line endings and BOM tolerated)
  sed -e 's/\r$//' -e '1s/^\xEF\xBB\xBF//' "$F" \
    | sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" | tail -n1 \
    | sed -e 's/[[:space:]]*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}
SSID=$(get WIFI_SSID); PSK=$(get WIFI_PASSWORD); COUNTRY=$(get WIFI_COUNTRY)
[ -n "$SSID" ] || exit 0
COUNTRY=$(printf '%s' "${COUNTRY:-FR}" | tr '[:lower:]' '[:upper:]')
echo "Configuring Wi-Fi network '$SSID' (country $COUNTRY)"
raspi-config nonint do_wifi_country "$COUNTRY" 2>/dev/null || rfkill unblock wifi 2>/dev/null || true
nmcli radio wifi on 2>/dev/null || true
nmcli connection delete photonboard-wifi >/dev/null 2>&1 || true
if [ -n "$PSK" ]; then
  nmcli connection add type wifi con-name photonboard-wifi ifname wlan0 ssid "$SSID" \
    wifi-sec.key-mgmt wpa-psk wifi-sec.psk "$PSK" connection.autoconnect yes
else
  nmcli connection add type wifi con-name photonboard-wifi ifname wlan0 ssid "$SSID" connection.autoconnect yes
fi
RC=$?
# Do not keep the password in clear text on the card: blank the file.
cat > "$F" <<EOF
# PhotonBoard — Wi-Fi
# Applied on $(date '+%Y-%m-%d %H:%M') for network "$SSID" (result: $RC).
# To change it, fill in the lines below again and restart the Pi.
WIFI_SSID=""
WIFI_PASSWORD=""
WIFI_COUNTRY="$COUNTRY"
EOF
sync
exit 0
WIFI
  chmod 0755 /usr/local/sbin/photonboard-wifi
  cat > /etc/systemd/system/photonboard-wifi.service <<'UNIT'
[Unit]
Description=PhotonBoard Wi-Fi from photonboard-wifi.txt (boot partition)
After=NetworkManager.service boot-firmware.mount
Wants=NetworkManager.service
ConditionPathExists=/boot/firmware/photonboard-wifi.txt

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/photonboard-wifi

[Install]
WantedBy=multi-user.target
UNIT
  systemctl enable photonboard-wifi.service >/dev/null
  if [[ -d /boot/firmware ]]; then
    # CRLF line endings: readable in Windows Notepad.
    sed 's/$/\r/' > /boot/firmware/photonboard-wifi.txt <<'EOF'
# PhotonBoard - Wi-Fi (optionnel / optional)
#
# FR : pour connecter la console en Wi-Fi, ecrivez le nom du reseau et le mot
#      de passe entre les guillemets, enregistrez, puis demarrez le Pi.
#      Le mot de passe est efface de ce fichier une fois applique.
#      Le cable Ethernet fonctionne sans rien configurer.
# EN : to use Wi-Fi, fill in the network name and password between the
#      quotes, save, then boot the Pi. The password is wiped once applied.
#
WIFI_SSID=""
WIFI_PASSWORD=""
WIFI_COUNTRY="FR"
EOF
  fi
  info "Boot services installed (kiosk guard, first boot, Wi-Fi file)."
}

print_summary() {
  local companion
  if (( IMAGE_BUILD )); then
    echo ""
    info "Image configured: user $REAL_USER, hostname ${NEW_HOSTNAME}, PhotonBoard $(installed_version)"
    return 0
  fi
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
  PB_IMAGE_BUILD="${PB_IMAGE_BUILD:-0}"
  PB_PASSWORD="${PB_PASSWORD:-photonboard}"
  PB_KEYBOARD="${PB_KEYBOARD:-fr}"

  while [[ $# -gt 0 ]]; do
    case $1 in
      --version)       [[ $# -ge 2 ]] || die "--version needs a value"; PB_VERSION=${2#v}; shift 2 ;;
      --deb)           [[ $# -ge 2 ]] || die "--deb needs a value"; PB_DEB=$2; shift 2 ;;
      --hostname)      [[ $# -ge 2 ]] || die "--hostname needs a value"; PB_HOSTNAME=$2; shift 2 ;;
      --timezone)      [[ $# -ge 2 ]] || die "--timezone needs a value"; PB_TIMEZONE=$2; shift 2 ;;
      --user)          [[ $# -ge 2 ]] || die "--user needs a value"; PB_USER=$2; shift 2 ;;
      --password)      [[ $# -ge 2 ]] || die "--password needs a value"; PB_PASSWORD=$2; shift 2 ;;
      --keyboard)      [[ $# -ge 2 ]] || die "--keyboard needs a value"; PB_KEYBOARD=$2; shift 2 ;;
      --update-module) PB_UPDATE_MODULE=1; shift ;;
      --image-build)   PB_IMAGE_BUILD=1; shift ;;
      -h|--help)       usage; exit 0 ;;
      *)               error "Unknown option: $1"; usage >&2; exit 1 ;;
    esac
  done
  IMAGE_BUILD=0
  [[ $PB_IMAGE_BUILD == 1 ]] && IMAGE_BUILD=1

  if [[ $EUID -ne 0 ]]; then
    die "This script must be run as root:
       curl -fsSL $PB_RAW_BASE/pi-setup.sh | sudo bash
       or: sudo ./$PROG"
  fi

  local arch
  arch=$(dpkg --print-architecture)
  [[ $arch == arm64 ]] || die "This script is for arm64 (Raspberry Pi 5). Detected: $arch"

  SCRIPT_DIR=$(script_dir)

  if (( IMAGE_BUILD )); then
    [[ -n $PB_DEB ]] || die "--image-build needs --deb FILE (no download inside the image build)."
    PB_USER=${PB_USER:-photonboard}
    PB_HOSTNAME=${PB_HOSTNAME:-photonboard}
    [[ $PB_USER =~ ^[a-z][-a-z0-9_]*$ ]] || die "Invalid user name: $PB_USER"
    info "Image-build mode (chroot): user $PB_USER, hostname $PB_HOSTNAME"
    REAL_USER=$PB_USER
    image_create_user
  else
    # The kiosk user: --user, else whoever ran sudo, else the first regular user.
    REAL_USER=${PB_USER:-${SUDO_USER:-}}
    if [[ -z $REAL_USER || $REAL_USER == root ]]; then
      REAL_USER=$(getent passwd 1000 | cut -d: -f1 || true)
    fi
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

  if (( IMAGE_BUILD )); then
    NEW_HOSTNAME=$(cat /etc/hostname 2>/dev/null || echo "$PB_HOSTNAME")
  else
    NEW_HOSTNAME=$(hostname)
  fi
  MODULE_DIR="$COMPANION_MODULE_DEV/$MODULE_NAME"
  SHOWS_DIR="$REAL_HOME/Documents/PhotonBoard"

  step_dependencies
  step_photonboard
  step_companion_module
  step_kiosk
  step_devices
  step_usb_automount
  step_network
  step_directories
  if (( IMAGE_BUILD )); then
    image_disable_user_wizard
    image_disable_ssh
    image_keyboard
    image_services
  fi
  print_summary
}

main "$@"
