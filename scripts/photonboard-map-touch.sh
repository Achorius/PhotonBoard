#!/usr/bin/env bash
# ============================================================
# PhotonBoard — Touchscreen Mapping (X11)
# Maps each USB touchscreen (default: "wch.cn TouchScreen") to an HDMI
# output based on the physical USB port path, which is stable across
# reboots (unlike xinput IDs, which depend on USB enumeration order).
#
# Started in the background from ~/.xinitrc. It NEVER blocks or fails the X
# session: whatever happens it exits 0 and logs what it did to
# /tmp/photonboard-touch-map.log.
#
# Works with any number of touchscreens: plugged directly into the Pi
# (ports "1-1", "3-2"...) or through a hub ("1-1.2"). Touchscreens are
# sorted by USB port and matched in order with the connected outputs
# (sorted by name: HDMI-1, HDMI-2); extra touchscreens/outputs are logged
# and left alone.
#
# Config (optional, shell syntax): /etc/photonboard/touch-map.conf
#   SWAP=1                          swap the first two touchscreens
#   TOUCH_NAME='wch.cn TouchScreen' xinput device name to look for (substring)
#   OUTPUTS="HDMI-1 HDMI-2"         outputs in mapping order (default: connected
#                                   outputs sorted by name)
#   PORT_MAP="1-1=HDMI-2 1-2=HDMI-1" explicit USB port -> output (overrides the
#                                   automatic order; ports: see --list)
#
# Usage: photonboard-map-touch [--list] [-h]
#   --list   print the detected touchscreens/ports/outputs and the mapping
#            that would be applied, without applying it (run inside X, e.g.
#            DISPLAY=:0 photonboard-map-touch --list)
# ============================================================

set -u

CFG=${PB_TOUCH_CONF:-/etc/photonboard/touch-map.conf}
LOGFILE=${PB_TOUCH_LOG:-/tmp/photonboard-touch-map.log}
LIST_ONLY=0

case ${1:-} in
  --list) LIST_ONLY=1 ;;
  -h|--help) sed -n '3,/^# ====*$/{s/^# \{0,1\}//;p}' "$0" | sed '$d'; exit 0 ;;
  "") ;;
  *) echo "Unknown option: $1 (see --help)" >&2; exit 0 ;;
esac

if (( ! LIST_ONLY )); then
  # Log to a file; fall back to nothing rather than failing.
  exec >>"$LOGFILE" 2>&1 || exec >/dev/null 2>&1
fi
log() { printf '%s\n' "$*"; }

main() {
  local SWAP=0 TOUCH_NAME='wch.cn TouchScreen' OUTPUTS="" PORT_MAP=""
  # shellcheck disable=SC1090  # user-provided config file
  [[ -r $CFG ]] && . "$CFG"

  export DISPLAY=${DISPLAY:-:0}
  log "$(date) — mapping touchscreens (DISPLAY=$DISPLAY)"

  local i
  for i in $(seq 1 30); do                     # wait for X (up to 30 s)
    xset q >/dev/null 2>&1 && break
    sleep 1
  done
  if ! xset q >/dev/null 2>&1; then
    log "X is not available on $DISPLAY — nothing mapped."
    return 0
  fi

  # Wait (up to 10 s) until the number of touch devices is stable for 2 s.
  local count prev=-1 stable=0
  for i in $(seq 1 10); do
    count=$(xinput list --name-only 2>/dev/null | grep -cF "$TOUCH_NAME" || true)
    if [[ $count -gt 0 && $count -eq $prev ]]; then
      stable=$((stable + 1))
      (( stable >= 2 )) && break
    else
      stable=0
    fi
    prev=$count
    sleep 1
  done

  # Group the touch pointer devices by USB port.
  declare -A port_ids=()
  local line id node devpath port
  while IFS= read -r line; do
    [[ $line == *"$TOUCH_NAME"* ]] || continue
    [[ $line =~ slave[[:space:]]+pointer ]] || continue   # keyboard interfaces cannot be mapped
    [[ $line =~ id=([0-9]+) ]] || continue
    id=${BASH_REMATCH[1]}
    node=$(xinput list-props "$id" 2>/dev/null | sed -n 's/.*Device Node[^"]*"\([^"]*\)".*/\1/p' | head -n1)
    if [[ -z $node ]]; then log "  id=$id: no device node — skipped"; continue; fi
    devpath=$(udevadm info -q path -n "$node" 2>/dev/null || true)
    # USB port = deepest path segment like "1-1" (root port) or "1-1.2" (hub).
    port=$(printf '%s\n' "$devpath" | tr '/' '\n' | grep -E '^[0-9]+-[0-9]+(\.[0-9]+)*$' | tail -n1)
    if [[ -z $port ]]; then log "  id=$id node=$node: no USB port in $devpath — skipped"; continue; fi
    port_ids[$port]+="$id "
    log "  id=$id node=$node port=$port"
  done < <(xinput list 2>/dev/null)

  if (( ${#port_ids[@]} == 0 )); then
    log "No '$TOUCH_NAME' touchscreen found — nothing mapped."
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
      if (( LIST_ONLY )); then
        log "  would map id=$id (port $p) → $o"
      elif xinput map-to-output "$id" "$o" 2>/dev/null; then
        log "  id=$id (port $p) → $o"; ok=$((ok + 1))
      else
        log "  id=$id (port $p) → $o FAILED (output not connected? not a touch device?)"; fail=$((fail + 1))
      fi
    done
  done
  (( LIST_ONLY )) || log "Done: $ok mapped, $fail failed."
  return 0
}

main || true
exit 0
