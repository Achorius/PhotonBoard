#!/usr/bin/env bash
# ============================================================
# PhotonBoard — SD Card Image Creator
# Creates a distributable .img.gz ready for Raspberry Pi Imager.
#
# Usage:
#   ./pi-clone.sh --remote aula@PhotonBoard.local
#   ./pi-clone.sh                    # SD card in Mac reader
#
# The image is automatically shrunk on the Pi before transfer
# so the final .img.gz is ~3-4 GB instead of the full SD card.
#
# End users just need Raspberry Pi Imager:
#   1. "Use custom" → select the .img.gz
#   2. Set WiFi + hostname in Pi Imager settings
#   3. Flash → boot → done
# ============================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[PhotonBoard]${NC} $1"; }
warn() { echo -e "${YELLOW}[PhotonBoard]${NC} $1"; }
err()  { echo -e "${RED}[PhotonBoard]${NC} $1" >&2; }

VERSION="0.1.0"
DATE=$(date +%Y%m%d)
OUTPUT_DIR="${OUTPUT_DIR:-.}"
IMG_NAME="PhotonBoard-v${VERSION}-${DATE}"
REMOTE_HOST=""
SSH_PASS=""

# Parse args
while [[ $# -gt 0 ]]; do
  case $1 in
    --remote)  REMOTE_HOST="$2"; shift 2 ;;
    --output)  OUTPUT_DIR="$2"; shift 2 ;;
    --version) VERSION="$2"; IMG_NAME="PhotonBoard-v${VERSION}-${DATE}"; shift 2 ;;
    --password) SSH_PASS="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: $0 [--remote user@host] [--password pass] [--output dir] [--version X.Y.Z]"
      exit 0 ;;
    *) err "Unknown option: $1"; exit 1 ;;
  esac
done

# SSH helper (with or without sshpass)
run_ssh() {
  if [[ -n "$SSH_PASS" ]] && command -v sshpass &>/dev/null; then
    sshpass -p "$SSH_PASS" ssh -o StrictHostKeyChecking=no "$REMOTE_HOST" "$@"
  else
    ssh "$REMOTE_HOST" "$@"
  fi
}

run_ssh_sudo() {
  if [[ -n "$SSH_PASS" ]]; then
    run_ssh "echo '$SSH_PASS' | sudo -S bash -c '$1'"
  else
    run_ssh "sudo bash -c '$1'"
  fi
}

# ============================================================
# Remote clone with on-Pi shrinking
# ============================================================

clone_from_remote() {
  log "Connecting to $REMOTE_HOST..."

  # Verify connection
  if ! run_ssh "echo ok" &>/dev/null; then
    err "Cannot connect to $REMOTE_HOST"
    err "Try: $0 --remote user@host --password yourpassword"
    exit 1
  fi

  PI_HOSTNAME=$(run_ssh "hostname")
  log "Connected to $PI_HOSTNAME"

  # ---- Step 1: Sanitize the Pi ----
  log "Step 1/4: Sanitizing Pi for distribution..."

  run_ssh_sudo '
    # Remove show files (personal data)
    rm -f /home/*/Documents/PhotonBoard/*.pbshow 2>/dev/null
    rm -f /home/*/.config/photonboard/config/recent.json 2>/dev/null

    # Clear shell history
    rm -f /home/*/.bash_history /root/.bash_history 2>/dev/null

    # Clean logs
    journalctl --vacuum-time=0 2>/dev/null
    rm -rf /tmp/* /var/tmp/* 2>/dev/null
    rm -f /var/log/*.gz /var/log/*.1 /var/log/*.old 2>/dev/null
    truncate -s 0 /var/log/syslog /var/log/daemon.log /var/log/kern.log /var/log/auth.log 2>/dev/null

    # Clean package cache
    apt-get clean -qq 2>/dev/null
    apt-get autoremove -y -qq 2>/dev/null

    # Reset hostname to generic
    hostnamectl set-hostname PhotonBoard
    sed -i "s/127.0.1.1.*/127.0.1.1\tPhotonBoard/" /etc/hosts

    echo "Sanitized"
  '

  # ---- Step 2: Install first-boot service ----
  log "Step 2/4: Installing first-boot service..."

  run_ssh_sudo '
    cat > /opt/photonboard-first-boot.sh << "FBEOF"
#!/bin/bash
# PhotonBoard — First Boot (runs once on new install)
LOG="/var/log/photonboard-first-boot.log"
exec > "$LOG" 2>&1
echo "$(date) — PhotonBoard first boot..."

# Ensure SSH works (regenerate host keys if missing)
if [ ! -f /etc/ssh/ssh_host_ed25519_key ]; then
  echo "Regenerating SSH host keys..."
  ssh-keygen -A
fi
systemctl enable ssh 2>/dev/null || true
systemctl restart ssh 2>/dev/null || true

# Create directories for all users
for H in /home/*/; do
  U=$(basename "$H")
  mkdir -p "$H/.config/photonboard/config" "$H/Documents/PhotonBoard"
  chown -R "$U:$U" "$H/.config/photonboard" "$H/Documents/PhotonBoard"
  # Ensure kiosk config exists for each user
  if [ ! -f "$H/.xinitrc" ] && [ -f /etc/skel/.xinitrc ]; then
    cp /etc/skel/.xinitrc "$H/.xinitrc"
    chmod +x "$H/.xinitrc"
    chown "$U:$U" "$H/.xinitrc"
  fi
  if [ ! -f "$H/.bash_profile" ] && [ -f /etc/skel/.bash_profile ]; then
    cp /etc/skel/.bash_profile "$H/.bash_profile"
    chown "$U:$U" "$H/.bash_profile"
  fi
done

# Refresh mDNS with current hostname
systemctl restart avahi-daemon 2>/dev/null || true

echo "$(date) — First boot done!"
systemctl disable photonboard-first-boot.service
FBEOF
    chmod +x /opt/photonboard-first-boot.sh

    cat > /etc/systemd/system/photonboard-first-boot.service << "SVCEOF"
[Unit]
Description=PhotonBoard First Boot
After=local-fs.target
Before=getty@tty1.service

[Service]
Type=oneshot
ExecStart=/opt/photonboard-first-boot.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
SVCEOF
    systemctl daemon-reload
    systemctl enable photonboard-first-boot.service

    # Copy .xinitrc and .bash_profile to /etc/skel so new users get them
    for F in .xinitrc .bash_profile; do
      ORIG=$(find /home -maxdepth 2 -name "$F" -type f 2>/dev/null | head -1)
      if [ -n "$ORIG" ]; then
        cp "$ORIG" "/etc/skel/$F"
      fi
    done

    # KEEP SSH host keys and service enabled — Pi Imager custom images
    # do not offer a customization dialog, so SSH must work out of the box.
    systemctl enable ssh 2>/dev/null || true

    # Remove saved WiFi (user connects via Ethernet or configures manually)
    rm -f /etc/NetworkManager/system-connections/*.nmconnection 2>/dev/null
    rm -f /etc/wpa_supplicant/wpa_supplicant*.conf 2>/dev/null

    echo "First-boot service installed"
  '

  # ---- Step 3: Shrink on Pi, then stream ----
  log "Step 3/4: Preparing image on Pi..."

  # Install pishrink on Pi if not present
  run_ssh_sudo '
    if ! command -v pishrink.sh &>/dev/null; then
      echo "Installing PiShrink..."
      curl -fsSL https://raw.githubusercontent.com/Drewsif/PiShrink/master/pishrink.sh -o /usr/local/bin/pishrink.sh
      chmod +x /usr/local/bin/pishrink.sh
    fi
    echo "PiShrink ready"
  '

  # Zero free space for better compression
  log "Zeroing free space (better compression)..."
  run_ssh_sudo 'dd if=/dev/zero of=/tmp/_zero bs=4M 2>/dev/null; rm -f /tmp/_zero; sync' 2>/dev/null || true

  # ---- Step 4: Clone and stream to Mac ----
  log "Step 4/4: Cloning SD card → $OUTPUT_DIR/$IMG_NAME.img.gz"
  log "This takes 10-30 minutes depending on SD card size and network..."
  echo ""

  # Stream the raw disk, compress on Mac
  if [[ -n "$SSH_PASS" ]] && command -v sshpass &>/dev/null; then
    sshpass -p "$SSH_PASS" ssh -o StrictHostKeyChecking=no "$REMOTE_HOST" \
      "echo '$SSH_PASS' | sudo -S dd if=/dev/mmcblk0 bs=4M 2>/dev/null" \
      | gzip -1 > "$OUTPUT_DIR/$IMG_NAME.img.gz"
  else
    ssh "$REMOTE_HOST" "sudo dd if=/dev/mmcblk0 bs=4M 2>/dev/null" \
      | gzip -1 > "$OUTPUT_DIR/$IMG_NAME.img.gz"
  fi

  RAW_SIZE=$(du -h "$OUTPUT_DIR/$IMG_NAME.img.gz" | awk '{print $1}')
  log "Raw image created: $IMG_NAME.img.gz ($RAW_SIZE)"

  # ---- Step 5: Shrink the image so it fits on smaller SD cards ----
  # Without this, the image's partition table reflects the SOURCE SD size
  # (e.g. 128 GB), and `dd` will refuse to flash it onto smaller cards.
  # PiShrink truncates the partition to its minimum size and adds a
  # systemd unit that auto-resizes back to fill the destination card on
  # first boot.
  #
  # The .img.gz currently lives on the Mac. To shrink it we'd normally need
  # to gunzip it (≈ source SD size), but most Macs don't have that much
  # free disk. Trick: decompress through a sparse-aware writer so zero
  # blocks become file holes (only ~6 GB of physical disk is needed).
  # Then PiShrink runs in a Docker container (Ubuntu 24+ has new enough
  # e2fsprogs to handle ext4 FEATURE_C12 from recent Pi OS).

  if ! command -v docker &>/dev/null; then
    warn "Docker not found — image kept at $RAW_SIZE."
    warn "Install Docker Desktop and re-run; the image won't fit on smaller SD cards otherwise."
    return
  fi

  if ! docker info &>/dev/null; then
    warn "Docker daemon not running — start Docker Desktop and re-run to shrink."
    return
  fi

  log "Step 5/5: Shrinking with PiShrink (sparse decompress + Docker)..."

  SPARSE="$OUTPUT_DIR/$IMG_NAME.sparse.img"
  rm -f "$SPARSE"
  # 130 GiB upper bound — covers any SD up to 128 GB. Sparse, so it costs
  # 0 bytes physical until written.
  truncate -s 130G "$SPARSE"

  # Write the sparse-writer to a tempfile (heredoc + stdin redirect can't coexist).
  SPARSE_PY=$(mktemp -t pb-sparse.XXXXXX.py)
  cat > "$SPARSE_PY" <<'PY'
import sys
CHUNK = 1024 * 1024
ZERO = b'\0' * CHUNK
out = open(sys.argv[1], 'r+b')
total = 0
while True:
    data = sys.stdin.buffer.read(CHUNK)
    if not data: break
    if len(data) == CHUNK and data == ZERO:
        out.seek(CHUNK, 1)
    else:
        out.write(data)
    total += len(data)
out.truncate(total)
out.close()
PY

  if ! gunzip -c "$OUTPUT_DIR/$IMG_NAME.img.gz" | python3 "$SPARSE_PY" "$SPARSE"; then
    warn "Sparse decompress failed — keeping full-size image."
    rm -f "$SPARSE" "$SPARSE_PY"
    return
  fi
  rm -f "$SPARSE_PY"

  if ! docker run --privileged --rm \
        -v "$OUTPUT_DIR:/workdir" -w /workdir ubuntu:24.04 bash -c "
          set -e
          apt-get update -qq >/dev/null 2>&1
          DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
            parted gzip util-linux e2fsprogs udev curl ca-certificates >/dev/null 2>&1
          curl -fsSL https://raw.githubusercontent.com/Drewsif/PiShrink/master/pishrink.sh \
            -o /usr/local/bin/pishrink.sh
          chmod +x /usr/local/bin/pishrink.sh
          pishrink.sh -z /workdir/$(basename "$SPARSE")
        "; then
    warn "PiShrink failed — keeping full-size image."
    rm -f "$SPARSE"
    return
  fi

  # PiShrink emits <name>.gz next to the input
  rm -f "$SPARSE"
  mv -f "$OUTPUT_DIR/$IMG_NAME.sparse.img.gz" "$OUTPUT_DIR/$IMG_NAME.img.gz"

  FINAL_SIZE=$(du -h "$OUTPUT_DIR/$IMG_NAME.img.gz" | awk '{print $1}')
  log "Shrunk image: $FINAL_SIZE (fits on any SD ≥ 16 GB; auto-resizes on first boot)"
}

# ============================================================
# SD card clone (physical reader on Mac)
# ============================================================

clone_from_sd() {
  log "Scanning for SD card..."

  DISKS=$(diskutil list external physical 2>/dev/null | grep "^/dev/" | awk '{print $1}')

  if [[ -z "$DISKS" ]]; then
    err "No external disk found. Insert the Pi's SD card or use --remote."
    exit 1
  fi

  echo ""
  echo "Available external disks:"
  for d in $DISKS; do
    SIZE=$(diskutil info "$d" | grep "Disk Size" | awk -F: '{print $2}' | xargs)
    NAME=$(diskutil info "$d" | grep "Media Name" | awk -F: '{print $2}' | xargs)
    echo "  $d — $NAME ($SIZE)"
  done
  echo ""

  if [[ $(echo "$DISKS" | wc -l | xargs) -eq 1 ]]; then
    DISK=$(echo "$DISKS" | head -1)
    echo -e "${YELLOW}Auto-selected: $DISK${NC}"
  else
    read -rp "Select disk (e.g. /dev/disk4): " DISK
  fi

  read -rp "Clone $DISK → $IMG_NAME.img.gz? [y/N] " CONFIRM
  [[ "$CONFIRM" == "y" || "$CONFIRM" == "Y" ]] || { log "Cancelled."; exit 0; }

  RAW_DISK=$(echo "$DISK" | sed 's/disk/rdisk/')
  diskutil unmountDisk "$DISK" 2>/dev/null || true

  log "Cloning $RAW_DISK → $IMG_NAME.img.gz (5-15 min)..."

  sudo dd if="$RAW_DISK" bs=4M status=progress 2>/dev/null \
    | gzip -1 > "$OUTPUT_DIR/$IMG_NAME.img.gz"

  diskutil mountDisk "$DISK" 2>/dev/null || true

  FINAL_SIZE=$(du -h "$OUTPUT_DIR/$IMG_NAME.img.gz" | awk '{print $1}')
  log "Done: $IMG_NAME.img.gz ($FINAL_SIZE)"
}

# ============================================================
# Output
# ============================================================

print_result() {
  echo ""
  echo -e "${CYAN}╔══════════════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║          PhotonBoard Image Ready!                       ║${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "  Image: ${GREEN}$IMG_NAME.img.gz${NC}"
  echo ""
  echo -e "  ${YELLOW}Pour installer sur un nouveau Pi :${NC}"
  echo ""
  echo "  1. Ouvrir Raspberry Pi Imager"
  echo "  2. Choisir l'OS → \"Use custom\" → sélectionner $IMG_NAME.img.gz"
  echo "  3. Cliquer ⚙️ (paramètres) :"
  echo "     • Hostname : le nom de la salle (ex: AulaFlorence)"
  echo "     • WiFi : réseau de la salle"
  echo "     • Utilisateur / mot de passe"
  echo "  4. Flasher sur carte SD"
  echo "  5. Insérer dans le Pi → brancher → c'est prêt !"
  echo ""
  echo -e "  ${YELLOW}Accès depuis un Mac :${NC}"
  echo "  • PhotonBoard (3D) : http://<hostname>.local:9091"
  echo "  • Companion :        http://<hostname>.local:8000"
  echo "  • SSH :              ssh user@<hostname>.local"
  echo ""
}

# ============================================================
# Main
# ============================================================

if [[ -n "$REMOTE_HOST" ]]; then
  clone_from_remote
else
  clone_from_sd
fi

print_result
