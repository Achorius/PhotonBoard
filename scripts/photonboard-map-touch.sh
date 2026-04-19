#!/bin/bash
# ============================================================
# PhotonBoard — Touchscreen Mapping
# Maps each wch.cn TouchScreen to its HDMI output based on the
# physical USB port path (stable across reboots, unlike xinput
# IDs which depend on USB enumeration order).
#
# Config (optional): /etc/photonboard/touch-map.conf
#   SWAP=1            # swap left/right if auto-detection is wrong
# ============================================================

set -e

LOGFILE=/tmp/photonboard-touch-map.log
exec >>"$LOGFILE" 2>&1
echo "$(date) — mapping touch..."

CFG=/etc/photonboard/touch-map.conf
SWAP=0
[ -f "$CFG" ] && . "$CFG"

export DISPLAY=:0

# Wait for X (up to 30s)
for i in $(seq 1 30); do
  xset q >/dev/null 2>&1 && break
  sleep 1
done

# Wait for both touchscreens to enumerate (up to 10s)
for i in $(seq 1 10); do
  COUNT=$(xinput list --name-only 2>/dev/null | grep -c 'wch.cn TouchScreen' || true)
  [ "$COUNT" -ge 4 ] && break  # 2 touchscreens × 2 HID interfaces each
  sleep 1
done

# Group xinput IDs by USB port path
declare -A PORT_IDS
while IFS= read -r line; do
  ID=$(echo "$line" | grep -oP 'id=\K[0-9]+')
  if [ -z "$ID" ]; then continue; fi
  NODE=$(xinput list-props "$ID" 2>/dev/null | grep 'Device Node' | sed 's/.*"\(.*\)".*/\1/')
  if [ -z "$NODE" ]; then continue; fi
  DEVPATH=$(udevadm info -q path -n "$NODE" 2>/dev/null || true)
  # Extract USB port like "1-1.1" or "1-1.2" — split path on /, keep only
  # segments matching the port-with-children pattern, take the deepest.
  PORT=$(echo "$DEVPATH" | tr '/' '\n' | grep -E '^[0-9]+-[0-9]+(\.[0-9]+)+$' | tail -1)
  if [ -z "$PORT" ]; then continue; fi
  PORT_IDS[$PORT]+="$ID "
  echo "  id=$ID node=$NODE port=$PORT"
done < <(xinput list 2>/dev/null | grep 'wch.cn TouchScreen')

if [ ${#PORT_IDS[@]} -lt 2 ]; then
  echo "ERROR: expected 2 USB ports with touchscreens, got ${#PORT_IDS[@]}"
  exit 1
fi

# Sort ports alphabetically; first → HDMI-1, second → HDMI-2 (or swapped)
PORTS=$(echo "${!PORT_IDS[@]}" | tr ' ' '\n' | sort)
PORT_LEFT=$(echo "$PORTS"  | sed -n 1p)
PORT_RIGHT=$(echo "$PORTS" | sed -n 2p)
if [ "$SWAP" = "1" ]; then
  TMP="$PORT_LEFT"; PORT_LEFT="$PORT_RIGHT"; PORT_RIGHT="$TMP"
  echo "SWAP=1 → swapping left/right"
fi

echo "Mapping port $PORT_LEFT → HDMI-1, $PORT_RIGHT → HDMI-2"

for ID in ${PORT_IDS[$PORT_LEFT]};  do xinput map-to-output "$ID" HDMI-1 && echo "  $ID → HDMI-1"; done
for ID in ${PORT_IDS[$PORT_RIGHT]}; do xinput map-to-output "$ID" HDMI-2 && echo "  $ID → HDMI-2"; done

echo "Done."
