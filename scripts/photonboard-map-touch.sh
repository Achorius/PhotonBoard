#!/usr/bin/env bash
# ============================================================
# PhotonBoard — Touchscreen Mapping (X11)
# Maps each USB touchscreen to an HDMI output based on the physical USB
# port path, which is stable across reboots (unlike xinput IDs, which
# depend on USB enumeration order).
#
# Started in the background from ~/.xinitrc. It NEVER blocks or fails the X
# session: whatever happens it exits 0 and logs what it did to
# /tmp/photonboard-touch-map.log.
#
# Touchscreens are found by what udev says they are (ID_INPUT_TOUCHSCREEN
# or ID_INPUT_TABLET: many cheap touch panels, e.g. "wch.cn TouchScreen",
# also expose a pen interface), whatever their name. Works with any number
# of touchscreens: plugged directly into the Pi (ports "1-1", "3-2"...) or
# through a hub ("1-1.2"). Touchscreens are sorted by USB port and matched
# in order with the connected outputs (sorted by name: HDMI-1, HDMI-2);
# extra touchscreens/outputs are logged and left alone.
#
# Config (optional, shell syntax): /etc/photonboard/touch-map.conf
#   SWAP=1                          swap the first two touchscreens
#   TOUCH_NAME='wch.cn TouchScreen' only map xinput devices whose name contains
#                                   this (default: every touchscreen udev knows)
#   OUTPUTS="HDMI-1 HDMI-2"         outputs in mapping order (default: connected
#                                   outputs sorted by name)
#   PORT_MAP="1-1=HDMI-2 1-2=HDMI-1" explicit USB port -> output (overrides the
#                                   automatic order; ports: see --list)
#
# Usage: photonboard-map-touch [--list | --report] [-h]
#   --list    print the detected touchscreens/ports/outputs and the mapping
#             that would be applied, without applying it (run inside X, e.g.
#             DISPLAY=:0 photonboard-map-touch --list)
#   --report  print a full touchscreen diagnostic (kernel, udev, X driver,
#             mapping, recent USB errors), without changing anything
# ============================================================

set -u

CFG=${PB_TOUCH_CONF:-/etc/photonboard/touch-map.conf}
LOGFILE=${PB_TOUCH_LOG:-/tmp/photonboard-touch-map.log}
MODE=apply

case ${1:-} in
  --list) MODE=list ;;
  --report) MODE=report ;;
  -h|--help) sed -n '3,/^# ====*$/{s/^# \{0,1\}//;p}' "$0" | sed '$d'; exit 0 ;;
  "") ;;
  *) echo "Unknown option: $1 (see --help)" >&2; exit 0 ;;
esac

if [[ $MODE == apply ]]; then
  # Log to a file; fall back to nothing rather than failing.
  exec >>"$LOGFILE" 2>&1 || exec >/dev/null 2>&1
fi
log() { printf '%s\n' "$*"; }

SWAP=0 TOUCH_NAME='' OUTPUTS="" PORT_MAP=""
# shellcheck disable=SC1090  # user-provided config file
[[ -r $CFG ]] && . "$CFG"
export DISPLAY=${DISPLAY:-:0}

x_ready() { xset q >/dev/null 2>&1; }

# udev properties of a device node ("ID_INPUT_TOUCHSCREEN=1"...)
udev_props() { udevadm info -q property -n "$1" 2>/dev/null; }

is_touch_node() { # is_touch_node /dev/input/eventN
  local p
  p=$(udev_props "$1")
  grep -qx 'ID_INPUT_TOUCHSCREEN=1' <<< "$p" || grep -qx 'ID_INPUT_TABLET=1' <<< "$p"
}

device_node() { # device_node XINPUT_ID
  xinput list-props "$1" 2>/dev/null | sed -n 's/.*Device Node[^"]*"\([^"]*\)".*/\1/p' | head -n1
}

# Touch pointer devices as "id<TAB>node<TAB>name", one per line
touch_devices() {
  local line id node name
  while IFS= read -r line; do
    [[ $line =~ slave[[:space:]]+pointer ]] || continue   # keyboard interfaces cannot be mapped
    [[ $line =~ id=([0-9]+) ]] || continue
    id=${BASH_REMATCH[1]}
    name=$(xinput list --name-only "$id" 2>/dev/null)
    [[ -z $TOUCH_NAME || $name == *"$TOUCH_NAME"* ]] || continue
    node=$(device_node "$id")
    [[ -n $node ]] || continue
    # Without TOUCH_NAME, keep what udev calls a touchscreen / tablet
    [[ -n $TOUCH_NAME ]] || is_touch_node "$node" || continue
    printf '%s\t%s\t%s\n' "$id" "$node" "$name"
  done < <(xinput list 2>/dev/null)
}

usb_port() { # usb_port /dev/input/eventN -> "1-1" / "1-1.2"
  udevadm info -q path -n "$1" 2>/dev/null | tr '/' '\n' | grep -E '^[0-9]+-[0-9]+(\.[0-9]+)*$' | tail -n1
}

map_touch() {
  local apply=$1
  log "$(date) — mapping touchscreens (DISPLAY=$DISPLAY${TOUCH_NAME:+, TOUCH_NAME='$TOUCH_NAME'})"

  local i
  if [[ $apply == 1 ]]; then
    for i in $(seq 1 30); do                     # wait for X (up to 30 s)
      x_ready && break
      sleep 1
    done
  fi
  if ! x_ready; then
    log "X is not available on $DISPLAY — nothing mapped."
    return 0
  fi

  # Wait (up to 10 s) until the number of touch devices is stable for 2 s.
  local count prev=-1 stable=0
  if [[ $apply == 1 ]]; then
    for i in $(seq 1 10); do
      count=$(touch_devices | wc -l)
      if [[ $count -gt 0 && $count -eq $prev ]]; then
        stable=$((stable + 1))
        (( stable >= 2 )) && break
      else
        stable=0
      fi
      prev=$count
      sleep 1
    done
  fi

  # Group the touch pointer devices by USB port.
  declare -A port_ids=()
  local id node name port
  while IFS=$'\t' read -r id node name; do
    port=$(usb_port "$node")
    if [[ -z $port ]]; then log "  id=$id '$name' node=$node: not on USB — skipped"; continue; fi
    port_ids[$port]+="$id "
    log "  id=$id '$name' node=$node port=$port"
  done < <(touch_devices)

  if (( ${#port_ids[@]} == 0 )); then
    log "No touchscreen found${TOUCH_NAME:+ named '$TOUCH_NAME'} — nothing mapped."
    return 0
  fi

  # Outputs, in mapping order.
  local -a outputs=()
  if [[ -n $OUTPUTS ]]; then
    read -r -a outputs <<< "$OUTPUTS"
  else
    mapfile -t outputs < <(xrandr --query 2>/dev/null | awk '$2 == "connected" {print $1}' | sort -V)
  fi
  log "Touch ports: ${!port_ids[*]} | outputs: ${outputs[*]:-none}"

  # Build the port -> output plan.
  declare -A plan=()
  local pair p o
  if [[ -n $PORT_MAP ]]; then
    for pair in $PORT_MAP; do
      p=${pair%%=*}; o=${pair#*=}
      if [[ -n ${port_ids[$p]:-} ]]; then
        plan[$p]=$o
      else
        log "PORT_MAP: no touchscreen on port $p — ignored"
      fi
    done
  else
    local -a ports
    mapfile -t ports < <(printf '%s\n' "${!port_ids[@]}" | sort -V)
    if [[ $SWAP == 1 && ${#ports[@]} -ge 2 ]]; then
      local tmp=${ports[0]}; ports[0]=${ports[1]}; ports[1]=$tmp
      log "SWAP=1 → first two touchscreens swapped"
    fi
    for i in "${!ports[@]}"; do
      if (( i < ${#outputs[@]} )); then
        plan[${ports[i]}]=${outputs[i]}
      else
        log "No output left for the touchscreen on port ${ports[i]} — not mapped"
      fi
    done
    (( ${#outputs[@]} > ${#ports[@]} )) && log "Outputs without touchscreen: ${outputs[*]:${#ports[@]}}"
  fi

  local ok=0 fail=0
  for p in "${!plan[@]}"; do
    o=${plan[$p]}
    for id in ${port_ids[$p]}; do
      if [[ $apply != 1 ]]; then
        log "  would map id=$id (port $p) → $o"
      elif xinput map-to-output "$id" "$o" 2>/dev/null; then
        log "  id=$id (port $p) → $o"; ok=$((ok + 1))
      else
        log "  id=$id (port $p) → $o FAILED (output not connected? not a touch device?)"; fail=$((fail + 1))
      fi
    done
  done
  [[ $apply != 1 ]] || log "Done: $ok mapped, $fail failed."
  return 0
}

# Full diagnostic, for the operator (Settings › Touchscreens) or support.
report() {
  local f n props drv xlog
  log "PhotonBoard touchscreen report — $(date '+%Y-%m-%d %H:%M:%S')"
  log "PhotonBoard $(dpkg-query -W -f='${Version}' photonboard 2>/dev/null || echo '?') · kernel $(uname -r) · $(. /etc/os-release 2>/dev/null; echo "${PRETTY_NAME:-?}")"
  log ""
  log "== Touch devices seen by the kernel (udev) =="
  n=0
  for f in /dev/input/event*; do
    [[ -e $f ]] || continue
    props=$(udev_props "$f")
    grep -qxE 'ID_INPUT_(TOUCHSCREEN|TABLET)=1' <<< "$props" || continue
    n=$((n + 1))
    log "$f  \"$(cat "/sys/class/input/${f##*/}/device/name" 2>/dev/null)\"  usb=$(usb_port "$f" || true)  $(grep -oE 'ID_INPUT_(TOUCHSCREEN|TABLET|MOUSE|JOYSTICK|KEYBOARD)=1' <<< "$props" | sed 's/=1//; s/ID_INPUT_//' | tr '\n' ' ')"
  done
  (( n )) || log "NONE — no touchscreen reaches the Pi: check the USB cable (touch needs the USB/USB-C data link, not only HDMI) and the power of the screens / hub."
  log ""
  log "== X server =="
  if x_ready; then
    log "X running on $DISPLAY"
    xlog=""
    for f in "$HOME/.local/share/xorg/Xorg.0.log" /var/log/Xorg.0.log; do
      [[ -r $f ]] && { xlog=$f; break; }
    done
    if [[ -n $xlog ]]; then
      log "Input drivers ($xlog):"
      grep -E "Using input driver" "$xlog" | sed -E 's/^\[[^]]*\] *//; s/^\(II\) *//' | sort -u | sed 's/^/  /'
      drv=$(grep -E "Using input driver 'wacom'" "$xlog" || true)
      [[ -n $drv ]] && log "  ⚠ The wacom driver holds some devices: touch may not work (fixed by /etc/X11/xorg.conf.d/90-photonboard-touch.conf, then restart)."
    else
      log "Xorg log not readable."
    fi
    log ""
    log "xinput:"
    xinput list 2>/dev/null | sed 's/^/  /'
    log ""
    log "Outputs: $(xrandr --query 2>/dev/null | awk '$2 == "connected" {printf "%s %s  ", $1, ($3 == "primary" ? $4 : $3)}')"
    log ""
    log "== Mapping (what would be applied now) =="
    map_touch 0
  else
    log "X is not running on $DISPLAY."
  fi
  log ""
  log "== Last mapping at startup ($LOGFILE) =="
  [[ -r $LOGFILE ]] && tail -n 20 "$LOGFILE" | sed 's/^/  /' || log "  (none)"
  log ""
  log "== Recent USB / input kernel messages =="
  { journalctl -k -b --no-pager -q 2>/dev/null || dmesg 2>/dev/null; } \
    | grep -iE 'hid-multitouch|touch|input:|over-current|usb .*(disconnect|error|reset|not accepting)' | tail -n 25 | sed 's/^/  /'
  return 0
}

case $MODE in
  apply) map_touch 1 || true ;;
  list) map_touch 0 || true ;;
  report) report || true ;;
esac
exit 0
