#!/usr/bin/env bash
# ============================================================
# PhotonBoard — SD card image creator (runs on macOS or Linux)
#
# Produces <output>/PhotonBoard-v<version>-<date>.img.gz, ready for
# Raspberry Pi Imager ("Use custom").
#
#   ./pi-clone.sh --remote aula@PhotonBoard.local   # over SSH, from a running Pi
#   ./pi-clone.sh                                    # SD card in a reader (macOS)
#   ./pi-clone.sh --device /dev/sdX                  # SD card in a reader (Linux)
#
# Pipeline:
#   1. read the whole SD card (over SSH, or from a card reader) into a sparse
#      .img on this machine (zero blocks cost no disk space);
#   2. GENERALISE THE COPY (default): pi-prepare-image.sh runs on the mounted
#      image inside Docker — shows, Wi-Fi, logs, SSH host keys, machine-id...
#      are removed from the image only. The source Pi is NOT modified.
#   3. SHRINK with PiShrink (in Docker, on this machine — nothing is installed
#      on the Pi) so the image fits any SD card >= 16 GB and grows back to the
#      card's size on first boot; then gzip.
#
# Remote mode details: PhotonBoard, Companion and rsyslog are stopped on the
# Pi, journald is moved to RAM, free space is zeroed (optional), and the
# filesystems are frozen (fsfreeze) while the disk is read, so the image is
# consistent. Everything is restarted afterwards, also on error/Ctrl-C (and
# a systemd timer on the Pi thaws the filesystems if the connection dies).
#
# --generalise-live (opt-in, DESTRUCTIVE) instead generalises the source Pi
# itself before reading it (for machines without Docker); the source's shows,
# Wi-Fi and config are first backed up to a .tar.gz next to the image.
#
# SSH authentication: use an SSH key (recommended):
#   ssh-copy-id aula@PhotonBoard.local
# or put the password in the SSHPASS environment variable (needs sshpass):
#   SSHPASS='secret' ./pi-clone.sh --remote aula@PhotonBoard.local
# ============================================================

set -euo pipefail

PROG=${0##*/}
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
PREPARE_SCRIPT="$SCRIPT_DIR/pi-prepare-image.sh"
TAG=PhotonBoard

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
  $PROG --remote USER@HOST [options]   clone a running Pi over SSH
  $PROG [--device DEV] [options]       clone an SD card in a card reader
                                       (macOS: auto-detected; Linux: --device /dev/sdX)

Generalisation (what ends up in the image):
  (default)            Generalise the COPY in Docker: the source Pi/card is not
                       modified. Requires Docker.
  --generalise-live    (remote only, DESTRUCTIVE) generalise the source Pi itself
                       before reading it: its shows, Wi-Fi networks, logs and
                       Web Remote settings are DELETED and it is renamed on next
                       boot. A backup .tar.gz is saved next to the image first.
                       Its SSH keys/machine-id are kept (only hidden from the image).
  --raw                No generalisation at all: a private backup of this exact
                       unit (contains shows, Wi-Fi passwords, SSH keys). Do not
                       distribute.
  --reset-outputs      Also remove the DMX outputs config (kept by default).
  --hostname NAME      Generic hostname of the image (default: PhotonBoard)

Other options:
  --output DIR         Output directory (default: current directory)
  --version X.Y.Z      Version in the file name (default: from package.json)
  --no-shrink          Do not run PiShrink (image = full SD card size)
  --no-zero-fill       (remote) do not zero the Pi's free space first (faster,
                       less SD wear, but bigger transfer and image)
  -y, --yes            Do not ask for confirmation
  -h, --help           Show this help

Environment:
  SSHPASS              SSH/sudo password (used with 'sshpass -e'; prefer SSH keys:
                       ssh-copy-id USER@HOST)
  PISHRINK_URL         PiShrink script URL (default: upstream master)
  DOCKER_IMAGE         Container used for generalise/shrink (default: ubuntu:24.04)

Requirements on this machine: ssh, python3, gzip, base64; Docker (unless
--raw/--generalise-live together with --no-shrink); pv (optional, progress).
EOF
}

# ---------------------------------------------------------------- options
DATE=$(date +%Y%m%d)
OUTPUT_DIR=${OUTPUT_DIR:-.}
VERSION=""
REMOTE_HOST=""
DEVICE=""
GEN_MODE=copy          # copy | live | none
SHRINK=1
ZERO_FILL=1
ASSUME_YES=0
RESET_OUTPUTS=0
IMAGE_HOSTNAME=""
PISHRINK_URL=${PISHRINK_URL:-https://raw.githubusercontent.com/Drewsif/PiShrink/master/pishrink.sh}
DOCKER_IMAGE=${DOCKER_IMAGE:-ubuntu:24.04}

need_arg() { [[ $# -ge 2 && -n $2 ]] || die "Option $1 needs a value (see --help)"; }

while [[ $# -gt 0 ]]; do
  case $1 in
    --remote)           need_arg "$@"; REMOTE_HOST=$2; shift 2 ;;
    --device)           need_arg "$@"; DEVICE=$2; shift 2 ;;
    --output)           need_arg "$@"; OUTPUT_DIR=$2; shift 2 ;;
    --version)          need_arg "$@"; VERSION=$2; shift 2 ;;
    --hostname)         need_arg "$@"; IMAGE_HOSTNAME=$2; shift 2 ;;
    --generalise-live|--generalize-live) GEN_MODE=live; shift ;;
    --raw)              GEN_MODE=none; shift ;;
    --reset-outputs)    RESET_OUTPUTS=1; shift ;;
    --no-shrink)        SHRINK=0; shift ;;
    --no-zero-fill)     ZERO_FILL=0; shift ;;
    -y|--yes)           ASSUME_YES=1; shift ;;
    --password)
      need_arg "$@"
      warn "--password is deprecated (visible in the process list): use an SSH key or SSHPASS=... instead."
      export SSHPASS=$2; shift 2 ;;
    -h|--help)          usage; exit 0 ;;
    *)                  error "Unknown option: $1"; usage >&2; exit 1 ;;
  esac
done

if [[ -z $VERSION ]]; then
  VERSION=$(sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$SCRIPT_DIR/../package.json" 2>/dev/null | head -n1 || true)
  VERSION=${VERSION:-0.0.0}
fi
IMG_NAME="PhotonBoard-v${VERSION}-${DATE}"

[[ -n $REMOTE_HOST && -n $DEVICE ]] && die "--remote and --device are mutually exclusive."
[[ $GEN_MODE == live && -z $REMOTE_HOST ]] && die "--generalise-live only makes sense with --remote (for a card, run pi-prepare-image.sh on the Pi first)."
if [[ $GEN_MODE == none ]] && (( RESET_OUTPUTS )); then die "--reset-outputs has no effect with --raw."; fi

# ---------------------------------------------------------------- local state + cleanup
# The raw image and the backup contain Wi-Fi passwords and SSH keys until
# they are generalised: create everything private.
umask 077
CTL_DIR=""
SPARSE_PY=""
WORK_IMG=""
SUCCESS=0

cleanup() {
  local rc=$?
  set +e
  if [[ -n $CTL_DIR ]]; then
    ssh -o "ControlPath=$CTL_DIR/%C" -O exit "$REMOTE_HOST" >/dev/null 2>&1
    rm -rf "$CTL_DIR"
  fi
  [[ -n $SPARSE_PY ]] && rm -f "$SPARSE_PY"
  if (( ! SUCCESS )) && [[ -n $WORK_IMG ]]; then
    rm -f "$WORK_IMG"
    (( rc )) && warn "Partial image removed."
  fi
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

have() { command -v "$1" >/dev/null 2>&1; }

need_cmd() { # need_cmd CMD HINT
  have "$1" || die "'$1' is required. $2"
}

ask_yes() { # ask_yes PROMPT  -> 0 if confirmed
  (( ASSUME_YES )) && return 0
  [[ -t 0 ]] || die "Not running interactively: pass --yes to confirm."
  local ans
  read -rp "$1 [y/N] " ans
  [[ $ans == y || $ans == Y || $ans == yes ]]
}

needs_docker() { [[ $GEN_MODE == copy ]] || (( SHRINK )); }

# ---------------------------------------------------------------- preflight
preflight() {
  if [[ $(uname -s) == Darwin ]]; then
    INSTALL_HINT="brew install"
  else
    INSTALL_HINT="sudo apt-get install"
  fi
  need_cmd python3 "Install Python 3 (macOS: xcode-select --install)."
  need_cmd gzip    "$INSTALL_HINT gzip"
  need_cmd base64  "$INSTALL_HINT coreutils"
  if [[ -n $REMOTE_HOST ]]; then
    need_cmd ssh "$INSTALL_HINT openssh-client"
    if [[ -n ${SSHPASS:-} ]] && ! have sshpass; then
      die "SSHPASS is set but 'sshpass' is not installed (macOS: brew install esolitos/ipa/sshpass, Linux: sudo apt-get install sshpass). Or use an SSH key: ssh-copy-id $REMOTE_HOST"
    fi
  fi
  [[ -f $PREPARE_SCRIPT ]] || die "Missing $PREPARE_SCRIPT (run $PROG from the PhotonBoard repository)."
  bash -n "$PREPARE_SCRIPT" || die "$PREPARE_SCRIPT has a syntax error."

  if needs_docker; then
    local why="to shrink the image"
    [[ $GEN_MODE == copy ]] && why="to generalise the copy and shrink it"
    have docker || die "Docker is required $why. Install Docker Desktop (macOS) / docker.io (Linux) and start it.
       Without Docker: --generalise-live --no-shrink (modifies the source Pi) or --raw --no-shrink (private backup)."
    docker info >/dev/null 2>&1 || die "Docker is installed but not running (or you lack permission). Start Docker Desktop / 'sudo systemctl start docker', or add yourself to the 'docker' group."
  fi
  have pv || info "Tip: install 'pv' to see transfer progress ($INSTALL_HINT pv)."

  mkdir -p "$OUTPUT_DIR"
  OUTPUT_DIR=$(cd "$OUTPUT_DIR" && pwd -P)   # Docker needs an absolute path
  FINAL_IMG="$OUTPUT_DIR/$IMG_NAME.img.gz"
  if [[ -e $FINAL_IMG || -e $OUTPUT_DIR/$IMG_NAME.img ]]; then
    ask_yes "$IMG_NAME.img(.gz) already exists in $OUTPUT_DIR. Overwrite?" || { info "Cancelled."; exit 0; }
    rm -f "$FINAL_IMG" "$OUTPUT_DIR/$IMG_NAME.img"
  fi
}

# ---------------------------------------------------------------- sparse writer
# Writes stdin to a sparse file: all-zero blocks become holes, so a 128 GB
# card only uses the space of its actual data. Verifies the expected size.
make_sparse_writer() {
  SPARSE_PY=$(mktemp "${TMPDIR:-/tmp}/pb-sparse.XXXXXX")
  cat > "$SPARSE_PY" <<'PY'
import os, sys
path = sys.argv[1]
expected = int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2] else -1
CHUNK = 4 << 20
BLOCK = 64 << 10
ZERO_CHUNK = bytes(CHUNK)
ZERO_BLOCK = bytes(BLOCK)
src = sys.stdin.buffer
total = 0
with open(path, 'wb') as out:
    while True:
        data = src.read(CHUNK)
        if not data:
            break
        n = len(data)
        if n == CHUNK and data == ZERO_CHUNK:
            out.seek(n, os.SEEK_CUR)
        else:
            mv = memoryview(data)
            for off in range(0, n, BLOCK):
                blk = mv[off:off + BLOCK]
                if blk == ZERO_BLOCK[:len(blk)]:
                    out.seek(len(blk), os.SEEK_CUR)
                else:
                    out.write(blk)
        total += n
    out.truncate(total)
if expected >= 0 and total != expected:
    sys.stderr.write("image is %d bytes, expected %d: the read was incomplete\n" % (total, expected))
    sys.exit(3)
sys.stderr.write("received %d bytes\n" % total)
PY
}

# progress: pv if available, else a plain pass-through
progress() { # progress SIZE_BYTES
  if have pv; then pv -s "$1"; else cat; fi
}

human_size() { du -h "$1" | awk '{print $1}'; }

# ============================================================
# Remote side (functions shipped to the Pi and run there as root)
# ============================================================
# These run under bash on the Pi via "sudo bash -c <script>". stdout of
# pb_remote_clone is the gzip-compressed disk image, all logs go to stderr.

pbc_log() { printf '[pi] %s\n' "$*" >&2 2>/dev/null || true; }

pb_remote_info() {
  set -euo pipefail
  exec </dev/null
  local src disk t
  src=$(findmnt -no SOURCE / || true)
  disk=$(lsblk -no PKNAME "$src" 2>/dev/null | head -n1 || true)
  if [[ -z $disk ]]; then
    echo "ERR=cannot find the disk that holds / (source: ${src:-?})"
    return 0
  fi
  echo "HOST=$(hostname)"
  echo "DEV=/dev/$disk"
  echo "SIZE=$(blockdev --getsize64 "/dev/$disk")"
  for t in fsfreeze dd gzip base64 lsblk blockdev; do
    command -v "$t" >/dev/null 2>&1 || echo "MISSING=$t"
  done
}

pb_remote_backup() {
  # tar.gz (stdout) of what --generalise-live is about to delete.
  set -euo pipefail
  exec </dev/null
  shopt -s nullglob
  local -a paths=()
  local p
  for p in /home/*/Documents/PhotonBoard /home/*/.config/PhotonBoard /home/*/.config/photonboard \
           /etc/NetworkManager/system-connections /etc/wpa_supplicant /etc/hostname /etc/hosts; do
    [[ -e $p ]] && paths+=("${p#/}")
  done
  if (( ${#paths[@]} == 0 )); then
    tar -czf - -T /dev/null
  else
    tar -C / -czf - --exclude='Cache' --exclude='Code Cache' --exclude='GPUCache' \
      --exclude='Dawn*Cache' --exclude='Crashpad' "${paths[@]}"
  fi
}

pbc_stop_services() {
  local s sid
  for s in companion.service photonboard.service rsyslog.service; do
    if systemctl is-active --quiet "$s"; then
      pbc_log "Stopping $s"
      systemctl stop "$s" && PBC_SERVICES+=("$s")
    fi
  done
  # Kiosk: PhotonBoard runs in the tty1 autologin X session (startx). Stop
  # getty@tty1 first so autologin does not respawn it, then end the session.
  if systemctl is-active --quiet getty@tty1.service; then
    systemctl stop getty@tty1.service && PBC_GETTY=1
  fi
  for sid in $(loginctl list-sessions --no-legend 2>/dev/null | awk '{print $1}'); do
    if [[ $(loginctl show-session -p TTY --value "$sid" 2>/dev/null) == tty1 ]]; then
      pbc_log "Ending the kiosk session on tty1 (PhotonBoard)"
      loginctl terminate-session "$sid" || true
    fi
  done
  if pgrep -x photonboard >/dev/null 2>&1; then
    pkill -TERM -x photonboard || true
  fi
  local i
  for i in $(seq 1 20); do
    pgrep -x photonboard >/dev/null 2>&1 || break
    sleep 0.5
  done
  pkill -KILL -x photonboard 2>/dev/null || true
}

pbc_swapoff() {
  # Swap files/partitions on the cloned disk are written to directly (fsfreeze
  # does not stop that) and may hold RAM contents: turn them off.
  local name src parent
  while read -r name; do
    [[ -n $name ]] || continue
    case $name in /dev/zram*) continue ;; esac
    if [[ $name == /dev/* ]]; then src=$name; else src=$(findmnt -no SOURCE -T "$name" 2>/dev/null || true); fi
    parent=$(lsblk -no PKNAME "$src" 2>/dev/null | head -n1 || true)
    [[ "/dev/$parent" == "$PBC_DEV" || $src == "$PBC_DEV" ]] || continue
    pbc_log "swapoff $name"
    swapoff "$name" && PBC_SWAPS+=("$name")
  done < <(swapon --show=NAME --noheadings 2>/dev/null || true)
}

pbc_zero_fill() {
  local out
  pbc_log "Zeroing free space on / (better compression; can take a while)..."
  PBC_ZERO_FILE=$(mktemp /.pb-zero-fill.XXXXXX)   # on the root fs, not a tmpfs
  if ! out=$(dd if=/dev/zero of="$PBC_ZERO_FILE" bs=4M status=none 2>&1); then
    [[ $out == *"No space left"* ]] || pbc_log "WARNING: zero-fill stopped early: $out"
  fi
  sync
  rm -f "$PBC_ZERO_FILE"
  PBC_ZERO_FILE=""
  sync
}

pbc_stash_identity() {
  # Hide the per-unit identity (SSH host keys, ~/.ssh, machine-id...) from the
  # image while keeping the source Pi intact: move it to RAM (/run) during the
  # read and put it back right after.
  local rel
  mkdir -p "$PBC_STASH"
  chmod 700 "$PBC_STASH"
  : > "$PBC_STASH.list"
  while IFS= read -r rel; do
    [[ -n $rel && ( -e $rel || -L $rel ) ]] || continue
    mkdir -p "$PBC_STASH$(dirname "$rel")"
    mv "$rel" "$PBC_STASH$rel"
    printf '%s\n' "$rel" >> "$PBC_STASH.list"
    PBC_STASHED=1
    if [[ $rel == /etc/machine-id ]]; then : > /etc/machine-id; fi
  done < <(bash "$PBC_PREP" --list-identity)
}

pbc_restore_identity() {
  (( PBC_STASHED )) || return 0
  local rel
  while IFS= read -r rel; do
    [[ -n $rel ]] || continue
    if [[ $rel == /etc/machine-id ]]; then rm -f /etc/machine-id; fi
    if [[ -e $rel || -L $rel ]]; then mv "$rel" "$rel.pb-clone-new" || true; fi
    if ! mv "$PBC_STASH$rel" "$rel"; then
      pbc_log "ERROR: could not restore $rel — a copy is in $PBC_STASH$rel (until reboot)"
      return 1
    fi
  done < "$PBC_STASH.list"
  PBC_STASHED=0
  rm -rf "$PBC_STASH" "$PBC_STASH.list"
}

pbc_freeze() {
  local m timeout cmd
  local -a mounts=()
  # Other mount points of the disk (e.g. /boot/firmware) first, / last.
  while read -r m; do
    [[ -n $m && $m != / && $m != "[SWAP]" ]] && mounts+=("$m")
  done < <(lsblk -lnpo MOUNTPOINT "$PBC_DEV" 2>/dev/null || true)
  mounts+=(/)

  # Safety net: if this script dies without running its cleanup (e.g. kill -9),
  # a transient systemd timer thaws everything and marks the image as invalid.
  timeout=$(( PBC_SIZE / 5000000 + 1800 ))
  cmd="touch $PBC_FLAG"
  for m in "${mounts[@]}"; do cmd+="; fsfreeze -u '$m'; mount -o remount,rw '$m'"; done
  PBC_WATCHDOG="pb-clone-thaw-$$"
  if ! systemd-run --quiet --unit="$PBC_WATCHDOG" --on-active="${timeout}s" \
        --timer-property=AccuracySec=1s /bin/sh -c "$cmd" 2>/dev/null; then
    PBC_WATCHDOG=""
    pbc_log "WARNING: could not arm the thaw watchdog (systemd-run)."
  fi

  for m in "${mounts[@]}"; do
    if fsfreeze -f "$m" 2>/dev/null; then
      PBC_FROZEN+=("$m")
    elif [[ $m != / ]] && mount -o remount,ro "$m" 2>/dev/null; then
      PBC_FROZEN+=("ro:$m")
    elif [[ $m == / ]]; then
      pbc_log "ERROR: cannot freeze / — refusing to read a live, changing filesystem."
      pbc_log "Use a card reader instead (see pi-clone.sh --help)."
      return 1
    else
      pbc_log "WARNING: could not freeze $m (copied as is)."
    fi
  done
  pbc_log "Filesystems frozen: ${PBC_FROZEN[*]}"
}

pbc_thaw() {
  local i m
  for (( i=${#PBC_FROZEN[@]}-1; i>=0; i-- )); do
    m=${PBC_FROZEN[i]}
    if [[ $m == ro:* ]]; then
      mount -o remount,rw "${m#ro:}" || pbc_log "WARNING: could not remount ${m#ro:} rw"
    else
      fsfreeze -u "$m" || pbc_log "WARNING: could not thaw $m"
    fi
  done
  PBC_FROZEN=()
}

pbc_cleanup() {
  local rc=$? s
  trap '' PIPE HUP INT TERM
  set +e
  pbc_thaw                       # first: nothing below can write while frozen
  if [[ -n $PBC_WATCHDOG ]]; then
    systemctl stop "$PBC_WATCHDOG.timer" "$PBC_WATCHDOG.service" >/dev/null 2>&1
  fi
  [[ -n $PBC_ZERO_FILE ]] && rm -f "$PBC_ZERO_FILE"
  pbc_restore_identity
  for s in ${PBC_SWAPS[@]+"${PBC_SWAPS[@]}"}; do swapon "$s"; done
  (( PBC_RELINQUISHED )) && journalctl --flush >/dev/null 2>&1
  for s in ${PBC_SERVICES[@]+"${PBC_SERVICES[@]}"}; do systemctl start "$s"; done
  (( PBC_GETTY )) && systemctl start getty@tty1.service
  rm -f "$PBC_PREP" "$PBC_FLAG"
  pbc_log "Pi restored: filesystems thawed, services restarted."
  exit "$rc"
}

pb_remote_clone() {
  # Args: DEV SIZE ZERO_FILL(0|1) LIVE(0|1) PREPARE_B64 [prepare args...]
  set -euo pipefail
  exec </dev/null
  export TMPDIR=/run            # never create temp files on the frozen fs
  PBC_DEV=$1 PBC_SIZE=$2 PBC_ZERO=$3 PBC_LIVE=$4
  local prep_b64=$5 z=gzip
  shift 5
  PBC_PREP=/run/pb-prepare-image.sh
  PBC_STASH=/run/pb-clone-stash
  PBC_FLAG=/run/pb-clone.thawed-by-watchdog
  PBC_FROZEN=() PBC_SWAPS=() PBC_SERVICES=()
  PBC_GETTY=0 PBC_RELINQUISHED=0 PBC_STASHED=0 PBC_ZERO_FILE="" PBC_WATCHDOG=""
  trap pbc_cleanup EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
  trap 'exit 141' PIPE          # the Mac went away: still run the cleanup
  rm -f "$PBC_FLAG"
  [[ -b $PBC_DEV ]] || { pbc_log "ERROR: $PBC_DEV is not a block device"; return 1; }

  if [[ -n $prep_b64 ]]; then
    printf '%s' "$prep_b64" | base64 -d > "$PBC_PREP"
  fi

  pbc_stop_services

  # journald -> RAM (/run) for the duration, so it never blocks on the frozen fs.
  if journalctl --relinquish-var >/dev/null 2>&1; then
    PBC_RELINQUISHED=1
  else
    journalctl --sync >/dev/null 2>&1 || true
  fi

  if (( PBC_LIVE )); then
    pbc_log "Generalising the live system (--generalise-live)..."
    bash "$PBC_PREP" --root / --yes --keep-identity --no-zero-fill --no-poweroff "$@" >&2
  fi

  pbc_swapoff
  if (( PBC_ZERO )); then
    pbc_zero_fill
  else
    fstrim / >/dev/null 2>&1 || true
  fi
  if (( PBC_LIVE )); then pbc_stash_identity; fi

  sync
  pbc_freeze
  blockdev --flushbufs "$PBC_DEV" 2>/dev/null || true

  command -v pigz >/dev/null 2>&1 && z=pigz
  pbc_log "Reading $PBC_DEV ($(( PBC_SIZE / 1000000000 )) GB)..."
  # iflag=direct bypasses the block-device page cache (could hold stale blocks).
  dd if="$PBC_DEV" bs=4M iflag=direct status=none | "$z" -1
  if [[ -e $PBC_FLAG ]]; then
    pbc_log "ERROR: the safety timer thawed the filesystems during the read: image is not consistent."
    return 1
  fi
  pbc_log "Disk read complete."
}

# ============================================================
# Local side
# ============================================================

SSH_OPTS=()
SUDO_MODE=""      # nopasswd | password
SUDO_PASS=""

setup_ssh() {
  CTL_DIR=$(mktemp -d /tmp/pb-ssh.XXXXXX)   # short path: unix socket length limit
  SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o ServerAliveInterval=15
            -o ServerAliveCountMax=8 -o ControlMaster=auto
            -o "ControlPath=$CTL_DIR/%C" -o ControlPersist=30m)
}

run_ssh() {
  if [[ -n ${SSHPASS:-} ]]; then
    sshpass -e ssh "${SSH_OPTS[@]}" "$REMOTE_HOST" "$@"
  else
    # shellcheck disable=SC2029  # the command is meant to be expanded locally
    ssh "${SSH_OPTS[@]}" "$REMOTE_HOST" "$@"
  fi
}

# remote_root ENTRY_FUNCTION [ARGS...]
# Runs ENTRY_FUNCTION as root on the Pi. The script is sent base64-encoded on
# the command line (no quoting issues); the sudo password, if needed, goes
# through ssh's stdin (never on a command line).
remote_root() {
  local entry=$1 script b64 cmd a fns
  shift
  fns=$(declare -F | awk '{print $3}' | grep -E '^(pb_remote_|pbc_)')
  # shellcheck disable=SC2086  # word splitting of the function list is intended
  script="$(declare -f $fns)"$'\n'"$entry \"\$@\""
  b64=$(printf '%s' "$script" | base64 | tr -d '\n')
  cmd="bash -c \"\$(printf %s $b64 | base64 -d)\" pb-remote"
  for a in "$@"; do cmd+=" $(printf '%q' "$a")"; done
  if [[ $SUDO_MODE == nopasswd ]]; then
    run_ssh "sudo -n $cmd" </dev/null
  else
    printf '%s\n' "$SUDO_PASS" | run_ssh "sudo -S -p '' $cmd"
  fi
}

connect_remote() {
  setup_ssh
  info "Connecting to $REMOTE_HOST..."
  if ! run_ssh true </dev/null; then
    die "Cannot connect to $REMOTE_HOST.
       Set up key login once with:  ssh-copy-id $REMOTE_HOST
       or pass the password via:    SSHPASS='...' $PROG --remote $REMOTE_HOST"
  fi
  if run_ssh 'sudo -n true' </dev/null >/dev/null 2>&1; then
    SUDO_MODE=nopasswd
  else
    SUDO_MODE=password
    if [[ -n ${SSHPASS:-} ]]; then
      SUDO_PASS=$SSHPASS
    else
      [[ -t 0 ]] || die "sudo on $REMOTE_HOST needs a password: set SSHPASS or run interactively."
      read -rsp "sudo password for $REMOTE_HOST: " SUDO_PASS
      echo ""
    fi
    printf '%s\n' "$SUDO_PASS" | run_ssh "sudo -S -p '' true" >/dev/null 2>&1 \
      || die "sudo failed on $REMOTE_HOST (wrong password, or the user is not a sudoer)."
  fi
}

clone_from_remote() {
  local info_out k v pi_host="" dev="" size="" missing="" err="" prep_b64=""
  local -a prep_args=()
  connect_remote

  info_out=$(remote_root pb_remote_info) || die "Could not query $REMOTE_HOST."
  while IFS='=' read -r k v; do
    case $k in
      HOST) pi_host=$v ;;
      DEV) dev=$v ;;
      SIZE) size=$v ;;
      MISSING) missing+=" $v" ;;
      ERR) err=$v ;;
    esac
  done <<< "$info_out"
  [[ -z $err ]] || die "$REMOTE_HOST: $err"
  [[ -z $missing ]] || die "$REMOTE_HOST is missing:$missing (sudo apt-get install util-linux coreutils gzip)"
  [[ -n $dev && $size =~ ^[0-9]+$ ]] || die "Unexpected answer from $REMOTE_HOST: $info_out"

  echo ""
  info "Source: $pi_host ($REMOTE_HOST), disk $dev, $(( size / 1000000000 )) GB"
  case $GEN_MODE in
    copy) info "Mode: generalise the COPY (the source Pi keeps its shows, Wi-Fi, keys...)." ;;
    none) warn "Mode: --raw — the image is an exact private copy (shows, Wi-Fi passwords, SSH keys). Do NOT distribute it." ;;
    live)
      warn "Mode: --generalise-live — $pi_host ITSELF will be modified:"
      echo "    - all shows (*.pbshow), recent list and Web Remote settings DELETED"
      (( RESET_OUTPUTS )) && echo "    - DMX outputs configuration DELETED"
      echo "    - saved Wi-Fi networks, logs, shell history, apt cache DELETED"
      echo "    - hostname reset to ${IMAGE_HOSTNAME:-PhotonBoard} at its next boot"
      echo "    A backup (.tar.gz) is downloaded to $OUTPUT_DIR first." ;;
  esac
  echo "  During the copy (10-60 min) PhotonBoard and Companion are stopped and the"
  echo "  Pi's filesystems are frozen; everything restarts automatically afterwards."
  (( ZERO_FILL )) && echo "  Free space is zeroed first (writes the whole free space of the SD once)."
  echo ""
  if [[ $GEN_MODE == live ]]; then
    if (( ! ASSUME_YES )); then
      [[ -t 0 ]] || die "Not running interactively: pass --yes to confirm."
      local ans
      read -rp "Type the host name '$pi_host' to confirm generalising it: " ans
      [[ $ans == "$pi_host" ]] || { info "Cancelled."; exit 0; }
    fi
  else
    ask_yes "Clone $pi_host ($dev) -> $IMG_NAME.img.gz?" || { info "Cancelled."; exit 0; }
  fi

  if [[ $GEN_MODE == live ]]; then
    local backup
    backup="$OUTPUT_DIR/${pi_host}-backup-$(date +%Y%m%d-%H%M%S).tar.gz"
    info "Backing up shows, PhotonBoard config and Wi-Fi of $pi_host -> $backup"
    remote_root pb_remote_backup > "$backup" || die "Backup failed — nothing was deleted on $pi_host."
    gzip -t "$backup" || die "Backup $backup is corrupt — nothing was deleted on $pi_host."
    chmod 600 "$backup"   # contains Wi-Fi passwords
    info "Backup OK ($(human_size "$backup")). Keep it private: it contains Wi-Fi passwords."
    prep_b64=$(base64 < "$PREPARE_SCRIPT" | tr -d '\n')
    (( RESET_OUTPUTS )) && prep_args+=(--reset-outputs)
    [[ -n $IMAGE_HOSTNAME ]] && prep_args+=(--hostname "$IMAGE_HOSTNAME")
  fi

  make_sparse_writer
  WORK_IMG="$OUTPUT_DIR/$IMG_NAME.img"
  info "Reading $dev from $pi_host -> $WORK_IMG (sparse)..."
  remote_root pb_remote_clone "$dev" "$size" "$ZERO_FILL" "$([[ $GEN_MODE == live ]] && echo 1 || echo 0)" \
      "$prep_b64" ${prep_args[@]+"${prep_args[@]}"} \
    | gzip -dc | progress "$size" | python3 "$SPARSE_PY" "$WORK_IMG" "$size" \
    || die "Clone failed (see messages above). $pi_host has been restored."
  info "Raw image received."
}

# ---------------------------------------------------------------- card reader
clone_from_card() {
  local os raw size="" disk name
  os=$(uname -s)
  if [[ $os == Darwin ]]; then
    need_cmd diskutil "This mode needs macOS diskutil."
    if [[ -z $DEVICE ]]; then
      local disks
      disks=$(diskutil list external physical 2>/dev/null | awk '/^\/dev\//{print $1}')
      [[ -n $disks ]] || die "No external disk found. Insert the Pi's SD card (powered off cleanly) or use --remote."
      echo ""
      echo "External disks:"
      for disk in $disks; do
        name=$(diskutil info "$disk" | awk -F': *' '/Media Name/{print $2}')
        echo "  $disk — $name ($(diskutil info "$disk" | awk -F': *' '/Disk Size/{print $2}'))"
      done
      echo ""
      if [[ $(printf '%s\n' "$disks" | wc -l | tr -d ' ') -eq 1 ]]; then
        DEVICE=$disks
        info "Auto-selected: $DEVICE"
      else
        [[ -t 0 ]] || die "Several external disks: pass --device /dev/diskN."
        read -rp "Disk to clone (e.g. /dev/disk4): " DEVICE
      fi
    fi
    [[ $DEVICE =~ ^/dev/disk[0-9]+$ ]] || die "Expected a whole disk like /dev/disk4, got: $DEVICE"
    diskutil info "$DEVICE" | grep -Eq 'Device Location: +External|Removable Media: +(Removable|Yes)' \
      || die "$DEVICE does not look like an external/removable disk — refusing."
    size=$(diskutil info "$DEVICE" | sed -n 's/.*Disk Size:.*(\([0-9]*\) Bytes).*/\1/p' | head -n1)
    raw=${DEVICE/\/dev\/disk//dev/rdisk}
  else
    need_cmd lsblk "$INSTALL_HINT util-linux"
    if [[ -z $DEVICE ]]; then
      echo "Removable disks:"
      lsblk -d -o NAME,SIZE,MODEL,TRAN,RM | awk 'NR==1 || $NF==1'
      die "Pass the card reader device: $PROG --device /dev/sdX"
    fi
    [[ -b $DEVICE ]] || die "$DEVICE is not a block device."
    [[ $(lsblk -dno TYPE "$DEVICE") == disk ]] || die "$DEVICE is a partition: give the whole disk (e.g. /dev/sdb, not /dev/sdb1)."
    # Refuse a disk that holds one of this machine's system filesystems.
    if lsblk -lnpo MOUNTPOINT "$DEVICE" | grep -qE '^(/|/boot.*|/usr|/var|/home|\[SWAP\])$'; then
      die "$DEVICE holds this machine's system filesystems — refusing."
    fi
    size=$(lsblk -bdno SIZE "$DEVICE")
    raw=$DEVICE
  fi
  [[ $size =~ ^[0-9]+$ ]] || die "Could not determine the size of $DEVICE."

  echo ""
  if [[ $GEN_MODE == none ]]; then
    warn "--raw: the image is an exact copy of the card (shows, Wi-Fi passwords, SSH keys). Do NOT distribute it."
  else
    info "The card is only read; the copy is generalised (its shows, Wi-Fi, SSH keys... are removed from the image)."
  fi
  ask_yes "Clone $DEVICE ($(( size / 1000000000 )) GB) -> $IMG_NAME.img.gz?" || { info "Cancelled."; exit 0; }

  info "Unmounting $DEVICE..."
  if [[ $os == Darwin ]]; then
    diskutil unmountDisk "$DEVICE" >/dev/null || die "Could not unmount $DEVICE."
  else
    local part mp
    while read -r part mp; do
      [[ -n $mp ]] && { sudo umount "$part" || die "Could not unmount $part ($mp)."; }
    done < <(lsblk -lnpo NAME,MOUNTPOINT "$DEVICE")
  fi

  sudo -v || die "sudo is needed to read $DEVICE."
  make_sparse_writer
  WORK_IMG="$OUTPUT_DIR/$IMG_NAME.img"
  info "Reading $raw -> $WORK_IMG (sparse, 5-20 min)..."
  sudo dd if="$raw" bs=4194304 | progress "$size" | python3 "$SPARSE_PY" "$WORK_IMG" "$size" \
    || die "Reading $DEVICE failed."
  [[ $os == Darwin ]] && diskutil eject "$DEVICE" >/dev/null 2>&1 && info "Card ejected."
  info "Raw image read."
}

# ---------------------------------------------------------------- post-processing (Docker)
# Runs inside the container. Args: IMG GENERALISE(0|1) SHRINK(0|1) OWNER(uid:gid)
#                                  PISHRINK_URL PREPARE_B64 [prepare args...]
pb_docker_post() {
  set -euo pipefail
  local img=$1 generalise=$2 shrink=$3 owner=$4 pishrink_url=$5 prep_b64=$6
  shift 6
  local num start size fs rs="" rz="" bs="" bz="" rc
  # Globals (not locals): the EXIT trap may run after this function returned.
  DL_ROOT="" DL_BOOT=""
  export DEBIAN_FRONTEND=noninteractive
  dlog() { printf '[docker] %s\n' "$*"; }
  # shellcheck disable=SC2329  # invoked by the EXIT trap
  dcleanup() {
    set +e
    mountpoint -q /mnt/pbboot && umount /mnt/pbboot
    mountpoint -q /mnt/pbroot && umount /mnt/pbroot
    [[ -n $DL_BOOT ]] && losetup -d "$DL_BOOT"
    [[ -n $DL_ROOT ]] && losetup -d "$DL_ROOT"
  }
  trap dcleanup EXIT

  dlog "Installing tools in the container..."
  if ! { apt-get update -q && apt-get install -y -q --no-install-recommends \
         parted e2fsprogs util-linux udev gzip pigz curl ca-certificates zerofree dosfstools; } \
       </dev/null >/tmp/apt.log 2>&1; then
    cat /tmp/apt.log
    dlog "ERROR: apt-get failed in the container."
    return 1
  fi

  if (( generalise )); then
    # parted -m: "N:startB:endB:sizeB:fs:name:flags;"
    while IFS=: read -r num start _ size fs _; do
      case $num in
        1) bs=${start%B}; bz=${size%B} ;;
        2) rs=${start%B}; rz=${size%B}
           [[ $fs == ext4 ]] || { dlog "ERROR: partition 2 is '$fs', expected ext4"; return 1; } ;;
      esac
    done < <(parted -ms "$img" unit B print)
    [[ -n $rs && -n $bs ]] || { dlog "ERROR: unexpected partition layout in $img"; return 1; }

    DL_ROOT=$(losetup -f --show -o "$rs" --sizelimit "$rz" "$img")
    DL_BOOT=$(losetup -f --show -o "$bs" --sizelimit "$bz" "$img")
    dlog "Checking filesystems..."
    rc=0; e2fsck -fy "$DL_ROOT" || rc=$?
    (( rc < 4 )) || { dlog "ERROR: e2fsck could not repair the root filesystem (rc=$rc)"; return 1; }
    # A FAT read from a mounted system carries the "dirty" bit: clear it.
    fsck.vfat -a "$DL_BOOT" >/dev/null 2>&1 || true
    mkdir -p /mnt/pbroot /mnt/pbboot
    mount "$DL_ROOT" /mnt/pbroot
    mount "$DL_BOOT" /mnt/pbboot
    printf '%s' "$prep_b64" | base64 -d > /tmp/pi-prepare-image.sh
    dlog "Generalising the image..."
    bash /tmp/pi-prepare-image.sh --root /mnt/pbroot --boot /mnt/pbboot --yes --no-poweroff "$@"
    umount /mnt/pbboot
    umount /mnt/pbroot
    dlog "Zeroing free blocks (zerofree)..."
    zerofree "$DL_ROOT" || dlog "WARNING: zerofree failed (the image will just compress less well)"
    losetup -d "$DL_BOOT"; DL_BOOT=""
    losetup -d "$DL_ROOT"; DL_ROOT=""
  fi

  if (( shrink )); then
    dlog "Shrinking with PiShrink ($pishrink_url)..."
    curl -fsSL "$pishrink_url" -o /usr/local/bin/pishrink.sh
    chmod +x /usr/local/bin/pishrink.sh
    # -z: gzip the result (-> $img.gz), -a: parallel gzip (pigz).
    # PiShrink also adds a first-boot hook that grows the root partition back.
    pishrink.sh -za "$img"
  else
    dlog "Compressing (no shrink)..."
    pigz -f "$img"
  fi
  chown "$owner" "$img.gz"
}

post_process() {
  local generalise=0 b64="" final
  local -a prep_args=()
  [[ $GEN_MODE == copy ]] && generalise=1
  if (( RESET_OUTPUTS )); then prep_args+=(--reset-outputs); fi
  if [[ -n $IMAGE_HOSTNAME ]]; then prep_args+=(--hostname "$IMAGE_HOSTNAME"); fi
  final="$OUTPUT_DIR/$IMG_NAME.img.gz"

  if ! needs_docker; then
    info "Compressing $IMG_NAME.img (no shrink)..."
    gzip -f "$WORK_IMG"
  else
    (( generalise )) && b64=$(base64 < "$PREPARE_SCRIPT" | tr -d '\n')
    info "Post-processing in Docker ($DOCKER_IMAGE):$( (( generalise )) && echo " generalise")$( (( SHRINK )) && echo " shrink") + gzip..."
    docker run --rm --privileged -v "$OUTPUT_DIR:/workdir" "$DOCKER_IMAGE" \
      bash -c "$(declare -f pb_docker_post)"$'\n''pb_docker_post "$@"' pb-docker \
      "/workdir/$IMG_NAME.img" "$generalise" "$SHRINK" "$(id -u):$(id -g)" "$PISHRINK_URL" "$b64" \
      ${prep_args[@]+"${prep_args[@]}"} \
      || die "Post-processing failed in Docker (the raw, non-generalised image has been deleted)."
  fi
  [[ -f $final ]] || die "Expected $final was not produced."
  if [[ $GEN_MODE == none ]]; then chmod 600 "$final"; else chmod 644 "$final"; fi
  rm -f "$WORK_IMG"
  WORK_IMG=""
  SUCCESS=1
  info "Image ready: $final ($(human_size "$final"))"
}

# ---------------------------------------------------------------- result
print_result() {
  echo ""
  echo "============================================================"
  echo "  Image PhotonBoard prête : $IMG_NAME.img.gz"
  echo "============================================================"
  if [[ $GEN_MODE == none ]]; then
    echo ""
    echo "  ATTENTION : image --raw = copie privée de cette unité (spectacles,"
    echo "  Wi-Fi, clés SSH). Ne pas la distribuer."
  fi
  echo ""
  echo "  Pour installer sur un nouveau Pi :"
  echo ""
  echo "  1. Ouvrir Raspberry Pi Imager"
  echo "  2. Choisir l'OS -> \"Use custom\" -> sélectionner $IMG_NAME.img.gz"
  echo "  3. Si Pi Imager propose la personnalisation de l'OS (nom d'hôte, Wi-Fi,"
  echo "     utilisateur), elle peut être utilisée : selon la version d'Imager elle"
  echo "     est ou non proposée pour une image personnalisée."
  echo "     Sans personnalisation, le Pi démarre avec le nom PhotonBoard,"
  echo "     l'Ethernet en DHCP, SSH activé et le compte utilisateur d'origine."
  echo "  4. Flasher sur la carte SD (16 Go minimum)"
  echo "  5. Insérer dans le Pi -> brancher. Le premier démarrage agrandit la"
  echo "     partition et génère des clés SSH propres à ce Pi (1-2 min, peut"
  echo "     redémarrer une fois)."
  echo ""
  echo "  Accès depuis un Mac :"
  echo "  - PhotonBoard (3D) : http://<hostname>.local:9091"
  echo "  - Companion :        http://<hostname>.local:8000"
  echo "  - SSH :              ssh <utilisateur>@<hostname>.local"
  echo ""
}

# ---------------------------------------------------------------- main
preflight
if [[ -n $REMOTE_HOST ]]; then
  clone_from_remote
else
  clone_from_card
fi
post_process
print_result
