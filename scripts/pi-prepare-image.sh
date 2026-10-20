#!/usr/bin/env bash
# ============================================================
# PhotonBoard — Generalise a Pi system for image distribution
#
# Turns a configured PhotonBoard Pi (the "golden master") into a neutral
# system that can be cloned onto many Pis: removes personal data and the
# per-unit identity, and installs a first-boot service that recreates the
# identity (SSH host keys, machine-id...) on every new Pi.
#
# This is the single source of truth for "what gets removed"; pi-clone.sh
# runs this same script, either on a copy of the image (default, the source
# Pi is left untouched) or on the live Pi (--generalise-live).
#
# Two ways to use it:
#
#   1. ON THE PI — destructive, the Pi itself becomes the master:
#        sudo ./pi-prepare-image.sh
#      The Pi powers off at the end. Do NOT boot that SD card again before
#      cloning it (the first boot would re-personalise it), and do not try to
#      clone it over SSH (its SSH host keys are gone). Put the card in a card
#      reader and run pi-clone.sh on the Mac/Linux machine:
#        ./pi-clone.sh                      # macOS, auto-detects the reader
#        ./pi-clone.sh --device /dev/sdX    # Linux
#      Simpler alternative that leaves the Pi untouched:
#        ./pi-clone.sh --remote user@host   # generalises a copy, not the Pi
#
#   2. ON A MOUNTED COPY (what pi-clone.sh does inside Docker):
#        sudo ./pi-prepare-image.sh --root /mnt/root --boot /mnt/boot --yes
#
# What is removed / reset:
#   - shows (~/Documents/PhotonBoard/*.pbshow, <userData>/shows/*.pbshow),
#     recent-files list, Electron caches
#   - remote.json (Web Remote / Companion PIN): deleted, so the master's PIN
#     is never shared by every unit; the app then uses its defaults (PIN
#     disabled) — set a PIN per unit after installation if needed.
#   - outputs.json (DMX outputs) is KEPT on purpose: units are built from the
#     same hardware, so the master's Art-Net universes / USB-DMX routing are a
#     sane default (a USB adapter's serialNumber will not match on a clone;
#     the app then finds the adapter by its port path).
#     Use --reset-outputs to delete it as well (app defaults: Art-Net 0-2).
#   - shell histories, logs, temp files, apt cache/lists, cloud-init state
#   - saved Wi-Fi networks (wired NetworkManager profiles are kept), DHCP leases
#   - leftover Pi Imager customisation files on the boot partition
#     (they contain the Wi-Fi password and the user's password hash)
#   - hostname -> "PhotonBoard" (written to /etc/hostname + /etc/hosts; takes
#     effect on next boot)
#   - per-unit identity, as the very LAST step (skipped with --keep-identity):
#     SSH host keys, ~/.ssh of every user, /etc/machine-id (emptied, as
#     pi-gen does), systemd random seed / credential secret, NetworkManager
#     secret_key
# What is added:
#   - photonboard-first-boot.service (regenerates SSH host keys before sshd
#     starts, fixes the tty1 autologin user if Pi Imager renamed the user,
#     recreates the PhotonBoard folders)
#   - /etc/skel/.xinitrc + .bash_profile (kiosk config for new users)
#   - <boot>/ssh flag (SSH enabled on first boot)
# ============================================================

set -euo pipefail

PROG=${0##*/}
TAG=Prepare

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
Usage: sudo $PROG [options]

Generalise this Pi (or a mounted copy of a Pi image) so it can be cloned
and distributed. Run without options on the Pi itself: it asks for
confirmation, then powers off. Clone the card with a card reader afterwards.

Options:
  --root DIR        Generalise the system mounted at DIR instead of the live
                    system (offline mode, used by pi-clone.sh). Default: /
  --boot DIR        Boot partition (default: <root>/boot/firmware or <root>/boot)
  --hostname NAME   Generic hostname written to the image (default: PhotonBoard)
  --reset-outputs   Also delete the DMX outputs config (outputs.json)
  --keep-identity   Keep SSH host keys, ~/.ssh and machine-id (pi-clone.sh hides
                    them from the image itself while it reads the live disk)
  --no-zero-fill    Do not zero the free space (live mode only; zeroing makes
                    the compressed image much smaller but takes a while)
  --poweroff        Power off at the end without asking (live mode)
  --no-poweroff     Do not power off at the end (live mode)
  --list-identity   Print the per-unit identity files that exist, then exit
  -y, --yes         Do not ask for confirmation
  -h, --help        Show this help
EOF
}

# ---------------------------------------------------------------- options
ROOT=/
BOOT=""
ASSUME_YES=0
KEEP_IDENTITY=0
RESET_OUTPUTS=0
ZERO_FILL=1
POWEROFF=ask
LIST_IDENTITY=0
GENERIC_HOSTNAME=PhotonBoard

need_arg() { [[ $# -ge 2 && -n $2 ]] || die "Option $1 needs a value (see --help)"; }

while [[ $# -gt 0 ]]; do
  case $1 in
    --root)          need_arg "$@"; ROOT=$2; shift 2 ;;
    --boot)          need_arg "$@"; BOOT=$2; shift 2 ;;
    --hostname)      need_arg "$@"; GENERIC_HOSTNAME=$2; shift 2 ;;
    --reset-outputs) RESET_OUTPUTS=1; shift ;;
    --keep-identity) KEEP_IDENTITY=1; shift ;;
    --no-zero-fill)  ZERO_FILL=0; shift ;;
    --poweroff)      POWEROFF=yes; shift ;;
    --no-poweroff)   POWEROFF=no; shift ;;
    --list-identity) LIST_IDENTITY=1; shift ;;
    -y|--yes)        ASSUME_YES=1; shift ;;
    -h|--help)       usage; exit 0 ;;
    *)               error "Unknown option: $1"; usage >&2; exit 1 ;;
  esac
done

[[ -d $ROOT ]] || die "--root $ROOT is not a directory"
ROOT=$(cd "$ROOT" && pwd -P)
# R is the path prefix for every file we touch: "" for the live system.
if [[ $ROOT == / ]]; then R=""; LIVE=1; else R=$ROOT; LIVE=0; fi

if [[ -z $BOOT ]]; then
  if   [[ -f $R/boot/firmware/config.txt ]]; then BOOT=$R/boot/firmware
  elif [[ -f $R/boot/config.txt ]];          then BOOT=$R/boot
  fi
fi

[[ $GENERIC_HOSTNAME =~ ^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$ ]] \
  || die "Invalid hostname: $GENERIC_HOSTNAME (letters, digits and '-' only)"

shopt -s nullglob

# Delete paths, silently ignoring the ones that do not exist.
del() { (( $# )) || return 0; rm -rf -- "$@"; }

# Per-unit identity files (relative to ROOT). Shared with pi-clone.sh,
# which hides exactly these from the image when reading a live Pi.
identity_paths() {
  local p
  for p in "$R"/etc/ssh/ssh_host_* "$R"/root/.ssh "$R"/home/*/.ssh \
           "$R"/etc/machine-id "$R"/var/lib/dbus/machine-id \
           "$R"/var/lib/systemd/random-seed "$R"/var/lib/systemd/credential.secret \
           "$R"/var/lib/NetworkManager/secret_key \
           "$R"/root/.vnc/private.key "$R"/etc/vnc/updateid; do
    [[ -e $p || -L $p ]] || continue
    # /var/lib/dbus/machine-id is normally a symlink to /etc/machine-id: keep it.
    [[ $p == */var/lib/dbus/machine-id && -L $p ]] && continue
    printf '%s\n' "${p#"$R"}"
  done
}

if (( LIST_IDENTITY )); then
  identity_paths
  exit 0
fi

# ---------------------------------------------------------------- checks
[[ $EUID -eq 0 ]] || die "Run as root: sudo ./$PROG"
[[ -f $R/etc/os-release ]] || die "$ROOT does not look like a Linux root filesystem (no etc/os-release)"
if (( ! LIVE )) && [[ -z $BOOT ]]; then
  warn "No boot partition found/given (--boot): boot-partition cleanup skipped."
fi
if [[ -n $BOOT && ! -d $BOOT ]]; then
  die "Boot partition directory not found: $BOOT"
fi

# ---------------------------------------------------------------- confirm
if (( ! ASSUME_YES )); then
  [[ -t 0 ]] || die "Not running interactively: pass --yes to confirm."
  echo ""
  warn "This will GENERALISE $( (( LIVE )) && echo "THIS Pi ($(hostname))" || echo "the system mounted at $ROOT") for image distribution:"
  echo "    - delete all shows (*.pbshow), recent list, Web Remote settings (PIN)"
  (( RESET_OUTPUTS )) && echo "    - delete the DMX outputs configuration"
  echo "    - delete saved Wi-Fi networks, logs, shell history, apt cache"
  echo "    - rename the host to $GENERIC_HOSTNAME (next boot)"
  (( KEEP_IDENTITY )) || echo "    - delete SSH host keys, ~/.ssh (authorized_keys!) and machine-id"
  if (( LIVE )); then
    echo ""
    echo "  Back up your shows first (e.g. scp user@$(hostname).local:Documents/PhotonBoard/*.pbshow .)"
  fi
  echo ""
  read -rp "Type 'yes' to continue: " CONFIRM
  [[ $CONFIRM == yes ]] || { info "Cancelled."; exit 0; }
fi

# ---------------------------------------------------------------- live: stop writers
if (( LIVE )); then
  # PhotonBoard autosaves and Companion writes its DB: stop them so nothing
  # re-creates what we delete. They are not restarted (we power off at the
  # end); pi-clone.sh stops/restarts them itself in --generalise-live mode.
  info "Stopping PhotonBoard and Companion..."
  systemctl stop companion.service photonboard.service 2>/dev/null || true
  if pgrep -x photonboard >/dev/null 2>&1; then
    pkill -TERM -x photonboard || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      pgrep -x photonboard >/dev/null 2>&1 || break
      sleep 0.5
    done
    pkill -KILL -x photonboard 2>/dev/null || true
  fi
fi

# ---------------------------------------------------------------- 1. personal data
info "Removing shows, recent list, Web Remote settings and caches..."
HOMES=("$R"/home/*/ "$R"/root/)
for h in "${HOMES[@]}"; do
  h=${h%/}
  [[ -d $h ]] || continue
  del "$h"/Documents/PhotonBoard/*.pbshow
  # Electron userData: ~/.config/PhotonBoard (productName). The lowercase
  # variant is what older scripts created / an unpackaged dev build uses.
  for cfg in "$h/.config/PhotonBoard" "$h/.config/photonboard"; do
    [[ -d $cfg ]] || continue
    del "$cfg/config/recent.json" "$cfg"/shows/*.pbshow
    # remote.json holds the access PIN: never ship the master's PIN (the app
    # falls back to its defaults, PIN disabled, when the file is missing).
    del "$cfg/config/remote.json"
    # outputs.json (DMX outputs) is kept unless --reset-outputs: see header.
    (( RESET_OUTPUTS )) && del "$cfg/config/outputs.json"
    del "$cfg/Cache" "$cfg/Code Cache" "$cfg/GPUCache" "$cfg/DawnCache" \
        "$cfg/DawnGraphiteCache" "$cfg/DawnWebGPUCache" "$cfg/Crashpad" \
        "$cfg/blob_storage" "$cfg/Session Storage" "$cfg/logs"
  done
  del "$h/.bash_history" "$h/.lesshst" "$h/.python_history" "$h/.wget-hsts" \
      "$h/.viminfo" "$h/.sudo_as_admin_successful" "$h/.xsession-errors" \
      "$h/.xsession-errors.old" "$h/.local/share/recently-used.xbel" \
      "$h/.local/share/xorg" "$h/.cache"
done

# ---------------------------------------------------------------- 2. logs, temp, caches
info "Cleaning logs, temp files and package caches..."
if (( LIVE )); then
  journalctl --rotate >/dev/null 2>&1 || true
  journalctl --vacuum-time=1s >/dev/null 2>&1 || true
elif [[ -d $R/var/log/journal ]]; then
  find "$R/var/log/journal" -type f -delete
fi
if [[ -d $R/var/log ]]; then
  find "$R/var/log" -type f \( -name '*.gz' -o -name '*.xz' -o -name '*.old' -o -name '*.[0-9]' \) \
    ! -path '*/journal/*' -delete
  # Truncate (not delete) the remaining logs, like pi-gen does.
  find "$R/var/log" -type f ! -path '*/journal/*' -exec truncate -s 0 {} +
fi

[[ -d $R/var/tmp ]] && find "$R/var/tmp" -mindepth 1 -delete
if (( LIVE )); then
  # Live /tmp: skip if it is a tmpfs (not part of the image anyway) and keep
  # the X/ICE sockets and systemd PrivateTmp dirs of running services.
  if ! mountpoint -q /tmp; then
    find /tmp -mindepth 1 -maxdepth 1 ! -name '.*-unix' ! -name 'systemd-private-*' \
      -exec rm -rf {} +
  fi
else
  [[ -d $R/tmp ]] && find "$R/tmp" -mindepth 1 -delete
fi

if (( LIVE )); then
  apt-get clean || warn "apt-get clean failed"
else
  del "$R"/var/cache/apt/archives/*.deb "$R"/var/cache/apt/*.bin
fi
# Package lists are re-downloaded by the next "apt update" (pi-gen does the same).
[[ -d $R/var/lib/apt/lists ]] && find "$R/var/lib/apt/lists" -type f ! -name lock -delete

# cloud-init (Raspberry Pi OS Trixie + Imager 2): forget the master's instance
# so the per-instance settings written by Pi Imager are applied on each clone.
[[ -d $R/var/lib/cloud ]] && find "$R/var/lib/cloud" -mindepth 1 -delete

# ---------------------------------------------------------------- 3. boot partition
if [[ -n $BOOT ]]; then
  info "Cleaning Pi Imager leftovers on the boot partition ($BOOT)..."
  # These contain the Wi-Fi PSK and the user's password hash.
  del "$BOOT/firstrun.sh" "$BOOT/userconf" "$BOOT/userconf.txt" \
      "$BOOT/wpa_supplicant.conf" "$BOOT/custom.toml" \
      "$BOOT/user-data" "$BOOT/network-config" "$BOOT/meta-data"
  # Enable SSH on first boot (consumed by Raspberry Pi OS's sshswitch service).
  : > "$BOOT/ssh"
fi

# ---------------------------------------------------------------- 4. network
info "Removing saved Wi-Fi networks and DHCP leases (wired profiles are kept)..."
for f in "$R"/etc/NetworkManager/system-connections/*; do
  [[ -f $f ]] || continue
  if grep -qiE '^[[:space:]]*type[[:space:]]*=[[:space:]]*(wifi|802-11-wireless)[[:space:]]*$' "$f"; then
    rm -f -- "$f"
  fi
done
for f in "$R"/etc/wpa_supplicant/wpa_supplicant*.conf; do
  grep -q 'network[[:space:]]*=' "$f" && rm -f -- "$f"
done
del "$R"/var/lib/NetworkManager/*.lease "$R"/var/lib/NetworkManager/timestamps \
    "$R"/var/lib/NetworkManager/seen-bssids "$R"/var/lib/dhcp/*.leases \
    "$R"/var/lib/dhcpcd/*.lease "$R"/var/lib/dhcpcd/*.lease6

# ---------------------------------------------------------------- 5. hostname
info "Setting generic hostname '$GENERIC_HOSTNAME' (applies on next boot)..."
printf '%s\n' "$GENERIC_HOSTNAME" > "$R/etc/hostname"
if [[ -f $R/etc/hosts ]] && grep -q '^127\.0\.1\.1[[:space:]]' "$R/etc/hosts"; then
  sed -i "s/^127\.0\.1\.1[[:space:]].*/127.0.1.1\t$GENERIC_HOSTNAME/" "$R/etc/hosts"
else
  printf '127.0.1.1\t%s\n' "$GENERIC_HOSTNAME" >> "$R/etc/hosts"
fi

# ---------------------------------------------------------------- 6. kiosk skeleton
# New users (e.g. created by Pi Imager) get the kiosk config.
for h in "$R"/home/*/; do
  if [[ -f $h.xinitrc ]] && grep -qi photonboard "$h.xinitrc"; then
    install -m 0755 "$h.xinitrc" "$R/etc/skel/.xinitrc"
    [[ -f $h.bash_profile ]] && install -m 0644 "$h.bash_profile" "$R/etc/skel/.bash_profile"
    break
  fi
done

# ---------------------------------------------------------------- 7. first-boot service
info "Installing photonboard-first-boot.service..."
mkdir -p "$R/opt" "$R/etc/systemd/system/multi-user.target.wants"
cat > "$R/opt/photonboard-first-boot.sh" <<'FIRSTBOOT'
#!/bin/bash
# PhotonBoard — first boot of a freshly flashed image (runs once).
# Installed by pi-prepare-image.sh. Recreates the per-unit identity that was
# removed when the image was generalised.
set -u
exec >>/var/log/photonboard-first-boot.log 2>&1
echo "$(date) — PhotonBoard first boot"

# 1. SSH host keys (removed from the image so every unit gets its own).
#    Ordered Before=ssh.service so sshd starts with valid keys.
if ! ls /etc/ssh/ssh_host_*_key >/dev/null 2>&1; then
  echo "Generating SSH host keys..."
  ssh-keygen -A
fi

# 2. machine-id: systemd generates a new one at boot when the file is empty.
[ -s /etc/machine-id ] || systemd-machine-id-setup || true

# 3. tty1 autologin: if Pi Imager renamed/replaced the user, point the
#    autologin at the first regular user so the kiosk still starts.
CONF=/etc/systemd/system/getty@tty1.service.d/autologin.conf
if [ -f "$CONF" ]; then
  AUTO_USER=$(sed -n 's/.*--autologin \([^ ]*\).*/\1/p' "$CONF" | head -n1)
  if [ -n "$AUTO_USER" ] && ! id "$AUTO_USER" >/dev/null 2>&1; then
    NEW_USER=$(getent passwd 1000 | cut -d: -f1)
    if [ -n "$NEW_USER" ]; then
      echo "Autologin user $AUTO_USER missing — switching to $NEW_USER"
      sed -i "s/--autologin $AUTO_USER /--autologin $NEW_USER /" "$CONF"
      systemctl daemon-reload
    fi
  fi
fi

# 4. PhotonBoard folders + kiosk files for every regular user.
getent passwd | while IFS=: read -r U _ UID_ _ _ H _; do
  [ "$UID_" -ge 1000 ] && [ "$UID_" -lt 60000 ] && [ -d "$H" ] || continue
  mkdir -p "$H/Documents/PhotonBoard" "$H/.config/PhotonBoard/config"
  for F in .xinitrc .bash_profile; do
    if [ ! -f "$H/$F" ] && [ -f "/etc/skel/$F" ]; then
      cp "/etc/skel/$F" "$H/$F"
      chown "$U:" "$H/$F"
    fi
  done
  chown -R "$U:" "$H/Documents/PhotonBoard" "$H/.config/PhotonBoard"
done

# 5. Announce the (possibly new) hostname over mDNS.
systemctl restart avahi-daemon 2>/dev/null || true

mkdir -p /var/lib/photonboard
touch /var/lib/photonboard/first-boot.done
systemctl disable photonboard-first-boot.service 2>/dev/null || true
echo "$(date) — first boot done"
FIRSTBOOT
chmod 0755 "$R/opt/photonboard-first-boot.sh"

cat > "$R/etc/systemd/system/photonboard-first-boot.service" <<'UNIT'
[Unit]
Description=PhotonBoard first boot (per-unit SSH keys, autologin user, folders)
After=local-fs.target
Before=ssh.service getty@tty1.service
ConditionPathExists=!/var/lib/photonboard/first-boot.done

[Service]
Type=oneshot
ExecStart=/opt/photonboard-first-boot.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
UNIT
# Enable it by hand (works offline too, unlike systemctl enable).
ln -sfn /etc/systemd/system/photonboard-first-boot.service \
  "$R/etc/systemd/system/multi-user.target.wants/photonboard-first-boot.service"
del "$R/var/lib/photonboard/first-boot.done"
if (( LIVE )); then
  systemctl daemon-reload || true
  systemctl enable ssh.service >/dev/null 2>&1 || true
fi

# ---------------------------------------------------------------- 8. zero free space
if (( LIVE && ZERO_FILL )); then
  info "Zeroing free space for better compression (this can take a while)..."
  # On the root filesystem itself (NOT /tmp, which may be a RAM tmpfs).
  ZERO_FILE=$(mktemp /.pb-zero-fill.XXXXXX)
  trap 'rm -f -- "$ZERO_FILE"' EXIT
  if ! out=$(dd if=/dev/zero of="$ZERO_FILE" bs=4M status=none 2>&1); then
    [[ $out == *"No space left"* ]] || warn "Zero-fill stopped early: $out"
  fi
  sync
  rm -f -- "$ZERO_FILE"
  trap - EXIT
  sync
fi

# ---------------------------------------------------------------- 9. identity (last)
if (( KEEP_IDENTITY )); then
  info "Keeping SSH host keys, ~/.ssh and machine-id (--keep-identity)."
else
  info "Removing per-unit identity (SSH host keys, ~/.ssh, machine-id)..."
  while IFS= read -r p; do
    if [[ $p == /etc/machine-id ]]; then
      : > "$R/etc/machine-id"     # empty = "generate at next boot" (as pi-gen)
    else
      rm -rf -- "$R$p"
    fi
  done < <(identity_paths)
fi
sync

# ---------------------------------------------------------------- done
info "Generalisation complete."
# Offline, or called by pi-clone.sh --generalise-live (identity kept, the
# Pi keeps running): nothing more to do.
if (( ! LIVE || KEEP_IDENTITY )); then
  exit 0
fi

echo ""
info "This Pi is ready to be cloned. Do NOT boot this SD card again before cloning it."
echo "  1. Power off (now), take the SD card out and put it in a card reader."
echo "  2. On the Mac:   ./pi-clone.sh                    (auto-detects the reader)"
echo "     On Linux:     ./pi-clone.sh --device /dev/sdX"
echo "  (Cloning over SSH is not possible any more: the SSH host keys are gone.)"
echo ""

do_poweroff=0
case $POWEROFF in
  yes) do_poweroff=1 ;;
  no)  do_poweroff=0 ;;
  ask)
    if [[ -t 0 ]] && (( ! ASSUME_YES )); then
      read -rp "Power off now? [Y/n] " ans
      [[ $ans =~ ^[Nn] ]] || do_poweroff=1
    fi ;;
esac
if (( do_poweroff )); then
  info "Powering off..."
  systemctl poweroff
else
  warn "Not powering off. Run 'sudo poweroff' before removing the card."
fi
