#!/usr/bin/env bash
# ============================================================
# PhotonBoard — Prepare Pi for Image Cloning
# Sanitizes the current Pi to create a clean "golden master"
# that can be cloned and distributed.
#
# Run ON THE PI before cloning:
#   sudo ./pi-prepare-image.sh
#
# After running this script, do NOT reboot the Pi.
# Instead, clone immediately from the Mac with pi-clone.sh
# ============================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[Prepare]${NC} $1"; }
warn() { echo -e "${YELLOW}[Prepare]${NC} $1"; }
err()  { echo -e "${RED}[Prepare]${NC} $1" >&2; }

if [[ $EUID -ne 0 ]]; then
  err "Run as root: sudo ./pi-prepare-image.sh"
  exit 1
fi

REAL_USER="${SUDO_USER:-$(logname 2>/dev/null || echo aula)}"
REAL_HOME=$(eval echo "~$REAL_USER")

echo ""
echo -e "${YELLOW}============================================================${NC}"
echo -e "${YELLOW}  This will sanitize this Pi for image distribution.${NC}"
echo -e "${YELLOW}  Personal data, shows, and SSH keys will be removed.${NC}"
echo -e "${YELLOW}============================================================${NC}"
echo ""
read -rp "Continue? [y/N] " CONFIRM
if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
  log "Cancelled."
  exit 0
fi

# ---- Step 1: Remove personal show files ----
log "Removing show files..."
rm -rf "$REAL_HOME/Documents/PhotonBoard/"*.pbshow 2>/dev/null || true
mkdir -p "$REAL_HOME/Documents/PhotonBoard"
chown "$REAL_USER:$REAL_USER" "$REAL_HOME/Documents/PhotonBoard"

# Clear recent files list
rm -f "$REAL_HOME/.config/photonboard/config/recent.json" 2>/dev/null || true

# ---- Step 2: Remove SSH keys (regenerated on first boot) ----
log "Removing SSH host keys (will regenerate on first boot)..."
rm -f /etc/ssh/ssh_host_*

# Remove user SSH keys
rm -rf "$REAL_HOME/.ssh" 2>/dev/null || true

# ---- Step 3: Clean logs and temp files ----
log "Cleaning logs and temp files..."
journalctl --vacuum-time=0 2>/dev/null || true
rm -rf /tmp/* 2>/dev/null || true
rm -rf /var/tmp/* 2>/dev/null || true
rm -f /var/log/*.gz /var/log/*.1 /var/log/*.old 2>/dev/null || true
truncate -s 0 /var/log/syslog /var/log/daemon.log /var/log/kern.log /var/log/auth.log 2>/dev/null || true

# ---- Step 4: Clean package cache ----
log "Cleaning package cache..."
apt-get clean -qq 2>/dev/null || true
apt-get autoremove -y -qq 2>/dev/null || true

# ---- Step 5: Clear bash history ----
log "Clearing shell history..."
rm -f "$REAL_HOME/.bash_history" 2>/dev/null || true
rm -f /root/.bash_history 2>/dev/null || true
history -c 2>/dev/null || true

# ---- Step 6: Clear WiFi credentials ----
log "Clearing saved WiFi networks..."
rm -f /etc/NetworkManager/system-connections/*.nmconnection 2>/dev/null || true
rm -f /etc/wpa_supplicant/wpa_supplicant*.conf 2>/dev/null || true

# ---- Step 7: Reset hostname to generic ----
log "Setting generic hostname..."
hostnamectl set-hostname "PhotonBoard"
sed -i 's/127.0.1.1.*/127.0.1.1\tPhotonBoard/' /etc/hosts

# ---- Step 8: Install first-boot service ----
log "Installing first-boot setup service..."

cat > /opt/photonboard-first-boot.sh << 'FIRSTBOOT'
#!/bin/bash
# PhotonBoard — First Boot Setup
# Runs once on first boot, then disables itself.

LOG="/var/log/photonboard-first-boot.log"
exec > "$LOG" 2>&1

echo "$(date) — PhotonBoard first boot starting..."

# Regenerate SSH host keys
if [ ! -f /etc/ssh/ssh_host_ed25519_key ]; then
  echo "Regenerating SSH host keys..."
  ssh-keygen -A
  systemctl restart ssh 2>/dev/null || true
fi

# Apply hostname from Raspberry Pi Imager (if set via userconf/firstrun)
# Pi Imager writes to /boot/firmware/firstrun.sh which runs before us,
# so the hostname should already be set. We just update mDNS.
HOSTNAME=$(hostname)
echo "Hostname: $HOSTNAME"

# Ensure avahi uses the right hostname
systemctl restart avahi-daemon 2>/dev/null || true

# Ensure companion module symlink is valid
if [ -d /opt/companion-module-dev/companion-module-photonboard ]; then
  echo "Companion module: OK"
else
  echo "WARNING: Companion module not found"
fi

# Ensure PhotonBoard config directory exists for all users
for HOME_DIR in /home/*/; do
  USER=$(basename "$HOME_DIR")
  mkdir -p "$HOME_DIR/.config/photonboard/config"
  mkdir -p "$HOME_DIR/Documents/PhotonBoard"
  chown -R "$USER:$USER" "$HOME_DIR/.config/photonboard" "$HOME_DIR/Documents/PhotonBoard"
done

echo "$(date) — First boot complete!"

# Disable this service so it doesn't run again
systemctl disable photonboard-first-boot.service
FIRSTBOOT
chmod +x /opt/photonboard-first-boot.sh

cat > /etc/systemd/system/photonboard-first-boot.service << 'SYSTEMD'
[Unit]
Description=PhotonBoard First Boot Setup
After=network-online.target
Wants=network-online.target
ConditionPathExists=/opt/photonboard-first-boot.sh

[Service]
Type=oneshot
ExecStart=/opt/photonboard-first-boot.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
SYSTEMD

systemctl daemon-reload
systemctl enable photonboard-first-boot.service

# ---- Step 9: Zero free space for better compression ----
log "Zeroing free space for compression (this takes a minute)..."
dd if=/dev/zero of=/tmp/zero bs=4M 2>/dev/null || true
rm -f /tmp/zero
sync

# ---- Done ----
echo ""
echo -e "${GREEN}============================================================${NC}"
echo -e "${GREEN}  Pi is ready to be cloned!${NC}"
echo -e "${GREEN}============================================================${NC}"
echo ""
echo -e "  ${YELLOW}DO NOT reboot this Pi.${NC}"
echo -e "  From your Mac, run:"
echo ""
echo -e "    ${GREEN}./pi-clone.sh --remote $REAL_USER@$(hostname).local${NC}"
echo ""
echo -e "  Or power off and clone the SD card physically."
echo ""
