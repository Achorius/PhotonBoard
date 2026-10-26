#!/bin/bash

if type update-alternatives 2>/dev/null >&1; then
    # Remove previous link if it doesn't use update-alternatives
    if [ -L '/usr/bin/${executable}' -a -e '/usr/bin/${executable}' -a "`readlink '/usr/bin/${executable}'`" != '/etc/alternatives/${executable}' ]; then
        rm -f '/usr/bin/${executable}'
    fi
    update-alternatives --install '/usr/bin/${executable}' '${executable}' '/opt/${sanitizedProductName}/${executable}' 100 || ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
else
    ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
fi

# Check if user namespaces are supported by the kernel and working with a quick test:
if ! { [[ -L /proc/self/ns/user ]] && unshare --user true; }; then
    # Use SUID chrome-sandbox only on systems without user namespaces:
    chmod 4755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
else
    chmod 0755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
fi

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi

# --- PhotonBoard kiosk (Raspberry Pi set up by pi-setup.sh / the PhotonBoard
# image, recognised by /etc/photonboard): device access for the Follow spot
# gamepad and Web MIDI, so that upgrading the package is enough (same files
# as pi-setup.sh step_devices).
if [ -d /etc/photonboard ]; then
    mkdir -p /etc/modules-load.d /etc/udev/rules.d
    cat > /etc/modules-load.d/photonboard.conf <<'PBEOF'
# PhotonBoard (managed by pi-setup.sh)
# Game controllers for the Follow spot: Chromium reads /dev/input/js*
joydev
# Web MIDI (Chromium) opens the ALSA sequencer
snd-seq
snd-seq-midi
PBEOF
    cat > /etc/udev/rules.d/70-photonboard-input.rules <<'PBEOF'
# PhotonBoard (managed by pi-setup.sh): game controllers readable by the kiosk
# user (member of "input") even without an active logind seat session.
SUBSYSTEM=="input", KERNEL=="js[0-9]*", MODE="0664", GROUP="input", TAG+="uaccess"
SUBSYSTEM=="input", KERNEL=="event[0-9]*", ENV{ID_INPUT_JOYSTICK}=="1", MODE="0660", GROUP="input", TAG+="uaccess"
# Sony (DualShock / DualSense) and Nintendo (Switch Pro / Joy-Con) pads are
# also read through hidraw by Chromium
KERNEL=="hidraw*", SUBSYSTEM=="hidraw", ATTRS{idVendor}=="054c", MODE="0660", GROUP="input", TAG+="uaccess"
KERNEL=="hidraw*", SUBSYSTEM=="hidraw", ATTRS{idVendor}=="057e", MODE="0660", GROUP="input", TAG+="uaccess"
PBEOF
    modprobe joydev 2>/dev/null || true
    modprobe snd-seq 2>/dev/null || true
    modprobe snd-seq-midi 2>/dev/null || true
    if hash udevadm 2>/dev/null; then
        udevadm control --reload-rules 2>/dev/null || true
        udevadm trigger --subsystem-match=input --subsystem-match=hidraw 2>/dev/null || true
    fi
    # Touchscreens on libinput: Debian 13's wacom X driver claims any device
    # udev calls a tablet, including the pen interface of USB touch panels,
    # and touch then does nothing (same file as pi-setup.sh; read at the
    # next X start)
    mkdir -p /etc/X11/xorg.conf.d
    cat > /etc/X11/xorg.conf.d/90-photonboard-touch.conf <<'PBEOF'
# PhotonBoard (managed by pi-setup.sh): touchscreens and touch panels'
# pen interfaces use libinput, not the wacom driver (Debian 13 binds it to
# any tablet). Real Wacom devices (USB vendor 056a) are left alone.
Section "InputClass"
  Identifier "PhotonBoard touchscreens"
  MatchIsTouchscreen "on"
  MatchDevicePath "/dev/input/event*"
  NoMatchUSBID "056a:*"
  Driver "libinput"
EndSection
Section "InputClass"
  Identifier "PhotonBoard touch panel pens"
  MatchIsTablet "on"
  MatchDevicePath "/dev/input/event*"
  NoMatchUSBID "056a:*"
  Driver "libinput"
EndSection
PBEOF
    # Touchscreen → screen mapping helper started by ~/.xinitrc
    if [ -f '/opt/${sanitizedProductName}/resources/pi/photonboard-map-touch.sh' ]; then
        install -m 0755 '/opt/${sanitizedProductName}/resources/pi/photonboard-map-touch.sh' /usr/local/bin/photonboard-map-touch || true
    fi
    # The kiosk user reads the gamepad nodes through the "input" group
    if [ -f /etc/photonboard/kiosk-user ]; then
        PB_KIOSK_USER=$(head -n1 /etc/photonboard/kiosk-user)
        if [ -n "$PB_KIOSK_USER" ] && id "$PB_KIOSK_USER" >/dev/null 2>&1 && getent group input >/dev/null; then
            usermod -a -G input "$PB_KIOSK_USER" 2>/dev/null || true
        fi
    fi
fi
