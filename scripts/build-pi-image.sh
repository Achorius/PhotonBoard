#!/usr/bin/env bash
# ============================================================
# PhotonBoard — Build a ready-to-flash Raspberry Pi 5 SD image
#
# Takes the official Raspberry Pi OS Lite (arm64) image, installs PhotonBoard
# into it (pi-setup.sh --image-build, in a chroot) and writes a compressed
# image that Raspberry Pi Imager can flash with "Use custom". The card boots
# straight into PhotonBoard full-screen (kiosk on tty1), no network needed.
#
# Runs on an arm64 Linux host (e.g. GitHub Actions ubuntu-24.04-arm), as root:
#   sudo scripts/build-pi-image.sh --deb photonboard_1.0.0_arm64.deb \
#        --output PhotonBoard-1.0.0-pi5.img.xz
#   # positional form: build-pi-image.sh DEB OUTPUT [BASE_URL]
#
# Options:
#   --deb FILE        PhotonBoard arm64 .deb (required)
#   --output FILE     Output .img.xz (default: PhotonBoard-<version>-pi5.img.xz)
#   --base-url URL    Base image (.img.xz) URL
#                     (default: latest Raspberry Pi OS Lite arm64)
#   --base-image FILE Use a local base image (.img or .img.xz) instead
#   --work DIR        Work directory (default: <output dir>/pi-image-work)
#   --extra-mb N      Space added to the root FS for the install (default 3072)
#   --keep-img        Keep the final uncompressed .img next to the output
#                     (the workflow mounts it for a smoke check)
#
# Result: OUTPUT (.img.xz, xz -6) and OUTPUT.sha256. The root partition is
# shrunk to its content (+ a small margin); Raspberry Pi OS grows it to the
# whole card on first boot ("resize" in cmdline.txt + rpi-resize.service),
# so nothing here may boot the image or consume that first-boot state.
# ============================================================

set -euo pipefail

PROG=${0##*/}
TAG=Image
DEFAULT_BASE_URL=https://downloads.raspberrypi.com/raspios_lite_arm64_latest
ROOT_MARGIN_MB=300          # free space left in the shrunk root FS

_say() { local fd=$1 colour=$2; shift 2
  if [[ -t $fd ]]; then printf '\033[%sm[%s]\033[0m %s\n' "$colour" "$TAG" "$*" >&"$fd"
  else printf '[%s] %s\n' "$TAG" "$*" >&"$fd"; fi; }
info()  { _say 1 '0;32' "$@"; }
warn()  { _say 2 '1;33' "WARNING: $*"; }
die()   { _say 2 '0;31' "ERROR: $*"; exit 1; }
usage() { sed -n '3,/^# ====*$/{s/^# \{0,1\}//;p}' "$0" | sed '$d'; }

# ---------------------------------------------------------------- options
DEB="" OUTPUT="" BASE_URL=$DEFAULT_BASE_URL BASE_IMAGE="" WORK="" EXTRA_MB=3072 KEEP_IMG=0
POS=()
while [[ $# -gt 0 ]]; do
  case $1 in
    --deb)        DEB=$2; shift 2 ;;
    --output)     OUTPUT=$2; shift 2 ;;
    --base-url)   BASE_URL=$2; shift 2 ;;
    --base-image) BASE_IMAGE=$2; shift 2 ;;
    --work)       WORK=$2; shift 2 ;;
    --extra-mb)   EXTRA_MB=$2; shift 2 ;;
    --keep-img)   KEEP_IMG=1; shift ;;
    -h|--help)    usage; exit 0 ;;
    -*)           die "Unknown option: $1 (see --help)" ;;
    *)            POS+=("$1"); shift ;;
  esac
done
[[ ${#POS[@]} -ge 1 && -z $DEB ]] && DEB=${POS[0]}
[[ ${#POS[@]} -ge 2 && -z $OUTPUT ]] && OUTPUT=${POS[1]}
[[ ${#POS[@]} -ge 3 ]] && BASE_URL=${POS[2]}

[[ $EUID -eq 0 ]] || die "Run as root (sudo $PROG ...)"
[[ -n $DEB && -f $DEB ]] || die "PhotonBoard .deb not found: '${DEB}' (--deb FILE)"
DEB=$(cd "$(dirname "$DEB")" && pwd -P)/$(basename "$DEB")
VERSION=$(dpkg-deb -f "$DEB" Version)
[[ $(dpkg-deb -f "$DEB" Architecture) == arm64 ]] || die "$DEB is not an arm64 package"
[[ -n $OUTPUT ]] || OUTPUT="$PWD/PhotonBoard-$VERSION-pi5.img.xz"
[[ $OUTPUT == *.img.xz ]] || die "--output must end with .img.xz"
mkdir -p "$(dirname "$OUTPUT")"
OUTPUT=$(cd "$(dirname "$OUTPUT")" && pwd -P)/$(basename "$OUTPUT")
WORK=${WORK:-$(dirname "$OUTPUT")/pi-image-work}
REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
[[ -f $REPO/scripts/pi-setup.sh && -f $REPO/scripts/photonboard-map-touch.sh ]] \
  || die "scripts/pi-setup.sh not found next to $PROG"

case $(uname -m) in
  aarch64|arm64) ;;
  *) [[ -e /proc/sys/fs/binfmt_misc/qemu-aarch64 ]] \
       || die "Not an arm64 host and no qemu-aarch64 binfmt handler: cannot chroot into the image."
     warn "Not an arm64 host: the chroot will run through qemu (slow)." ;;
esac

for t in curl xz sfdisk partx losetup e2fsck resize2fs dumpe2fs mount chroot sha256sum partprobe; do
  command -v "$t" >/dev/null || die "Missing tool: $t (apt install curl xz-utils fdisk util-linux e2fsprogs parted)"
done

IMG="$WORK/photonboard.img"
MNT="$WORK/mnt"
LOOPS=()
BOOT_DEV="" ROOT_DEV=""
CHROOT_READY=0

# ---------------------------------------------------------------- cleanup
cleanup() {
  local rc=$?
  set +e
  if (( CHROOT_READY )); then
    rm -f "$MNT/usr/sbin/policy-rc.d"
  fi
  if mountpoint -q "$MNT" 2>/dev/null; then
    sync
    umount -R "$MNT" 2>/dev/null || { sleep 2; umount -R -l "$MNT"; }
  fi
  for l in "${LOOPS[@]}"; do losetup -d "$l" 2>/dev/null; done
  (( rc )) && _say 2 '0;31' "Build FAILED (exit $rc). Work dir kept: $WORK"
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# Loop devices for the boot (BOOT_DEV) and root (ROOT_DEV) partitions:
# a partitioned loop device (-P) when the kernel/udev provide the partition
# nodes, else one loop device per partition at its offset (containers).
part_geom() { # part_geom N -> "START SECTORS" of partition N of $IMG
  partx -g -n "$1" -o START,SECTORS "$IMG" | awk '{print $1, $2}'
}
attach() {
  local _ g
  LOOPS=()
  LOOPS+=("$(losetup --show -f -P "$IMG")")
  for _ in $(seq 1 10); do
    if [[ -b ${LOOPS[0]}p2 ]]; then
      BOOT_DEV=${LOOPS[0]}p1 ROOT_DEV=${LOOPS[0]}p2
      return 0
    fi
    partprobe "${LOOPS[0]}" 2>/dev/null || true
    sleep 0.5
  done
  losetup -d "${LOOPS[0]}"; LOOPS=()
  read -r -a g <<< "$(part_geom 1)"; LOOPS+=("$(losetup --show -f -o $((g[0] * 512)) --sizelimit $((g[1] * 512)) "$IMG")")
  read -r -a g <<< "$(part_geom 2)"; LOOPS+=("$(losetup --show -f -o $((g[0] * 512)) --sizelimit $((g[1] * 512)) "$IMG")")
  BOOT_DEV=${LOOPS[0]} ROOT_DEV=${LOOPS[1]}
  info "No partition nodes: using offset loop devices ($BOOT_DEV, $ROOT_DEV)"
}
detach() {
  local l
  sync
  for l in "${LOOPS[@]}"; do losetup -d "$l"; done
  LOOPS=()
}

fsck_root() { # e2fsck -f -y, accepting "errors corrected" (1)
  local rc=0
  e2fsck -f -y "$ROOT_DEV" || rc=$?
  (( rc <= 1 )) || die "e2fsck failed on the root filesystem (exit $rc)"
}

# Only ever delete a work dir this script created (marker file).
if [[ -e $WORK ]]; then
  [[ -f $WORK/.pb-image-work ]] || die "Work dir $WORK exists and was not created by $PROG: remove it or use --work"
  rm -rf "$WORK"
fi
mkdir -p "$WORK" "$MNT"
: > "$WORK/.pb-image-work"

# ---------------------------------------------------------------- 1. base image
if [[ -n $BASE_IMAGE ]]; then
  [[ -f $BASE_IMAGE ]] || die "--base-image $BASE_IMAGE not found"
  info "Base image: $BASE_IMAGE"
  BASE_FILE=$BASE_IMAGE
else
  info "Resolving $BASE_URL ..."
  BASE_REAL=$(curl -fsSLI -o /dev/null -w '%{url_effective}' "$BASE_URL" 2>/dev/null) \
    || BASE_REAL=$(curl -fsSL -r 0-0 -o /dev/null -w '%{url_effective}' "$BASE_URL") \
    || die "Cannot reach $BASE_URL"
  info "Downloading $BASE_REAL"
  BASE_FILE="$WORK/$(basename "$BASE_REAL")"
  curl -fSL --retry 3 --retry-delay 5 -o "$BASE_FILE" "$BASE_REAL"
  if SUM_LINE=$(curl -fsSL --retry 2 "$BASE_REAL.sha256" 2>/dev/null) && [[ -n $SUM_LINE ]]; then
    WANT=${SUM_LINE%% *}
    GOT=$(sha256sum "$BASE_FILE" | cut -d' ' -f1)
    [[ ${WANT,,} == "$GOT" ]] || die "SHA-256 mismatch for $(basename "$BASE_FILE"): expected $WANT, got $GOT"
    info "SHA-256 verified ($GOT)"
  else
    warn "No published .sha256 for the base image: not verified."
  fi
fi
BASE_NAME=$(basename "$BASE_FILE")

info "Decompressing the base image..."
case $BASE_FILE in
  *.xz)  xz -dc "$BASE_FILE" | dd of="$IMG" bs=4M conv=sparse status=none ;;
  *.img) cp --sparse=always "$BASE_FILE" "$IMG" ;;
  *)     die "Unsupported base image format: $BASE_FILE (.img or .img.xz)" ;;
esac
[[ $BASE_FILE == "$WORK"/* ]] && rm -f "$BASE_FILE"
info "Base image: $(du -h --apparent-size "$IMG" | cut -f1)"

# ---------------------------------------------------------------- 2. grow
info "Growing the root partition by ${EXTRA_MB} MB..."
truncate -s "+${EXTRA_MB}M" "$IMG"
sfdisk --dump "$IMG"
[[ $(sfdisk --dump "$IMG" | grep -c '^/') -eq 2 ]] || die "Unexpected partition table (expected boot + root)"
echo ", +" | sfdisk --no-reread --no-tell-kernel -N 2 "$IMG" >/dev/null
attach
fsck_root
resize2fs "$ROOT_DEV"

# ---------------------------------------------------------------- 3. mount + chroot
mount "$ROOT_DEV" "$MNT"
FW=boot/firmware
if ! grep -qE '[[:space:]]/boot/firmware[[:space:]]' "$MNT/etc/fstab"; then
  grep -qE '[[:space:]]/boot[[:space:]]' "$MNT/etc/fstab" && FW=boot
fi
mkdir -p "$MNT/$FW"
mount "$BOOT_DEV" "$MNT/$FW"
info "Base release: $(grep -s PRETTY_NAME "$MNT/etc/os-release" | cut -d= -f2) — $(head -n1 "$MNT/etc/rpi-issue" 2>/dev/null || true)"
info "cmdline.txt: $(cat "$MNT/$FW/cmdline.txt")"
grep -qw resize "$MNT/$FW/cmdline.txt" \
  || warn "No 'resize' in cmdline.txt: this base may not grow the root FS on first boot!"
ORIG_MACHINE_ID=$(cat "$MNT/etc/machine-id" 2>/dev/null || true)
info "machine-id in the base: '${ORIG_MACHINE_ID}'"
FW_INITRD_SUM=$(cd "$MNT/$FW" && sha256sum initramfs* 2>/dev/null | sha256sum | cut -c1-16)

for d in dev dev/pts proc sys run; do
  mkdir -p "$MNT/$d"
done
mount --bind /dev "$MNT/dev"
mount --bind /dev/pts "$MNT/dev/pts"
mount -t proc proc "$MNT/proc"
mount -t sysfs sysfs "$MNT/sys"
mount -t tmpfs tmpfs "$MNT/run"
CHROOT_READY=1

# DNS for apt inside the chroot (the image's own resolv.conf is restored later).
RESOLV_BACKUP=""
if [[ -e $MNT/etc/resolv.conf || -L $MNT/etc/resolv.conf ]]; then
  RESOLV_BACKUP="$WORK/resolv.conf.orig"
  cp -a "$MNT/etc/resolv.conf" "$RESOLV_BACKUP"
  rm -f "$MNT/etc/resolv.conf"
fi
if [[ -s /run/systemd/resolve/resolv.conf ]]; then
  cp /run/systemd/resolve/resolv.conf "$MNT/etc/resolv.conf"   # real upstream servers
else
  cp -L /etc/resolv.conf "$MNT/etc/resolv.conf"
fi

# No service may start inside the chroot.
printf '#!/bin/sh\nexit 101\n' > "$MNT/usr/sbin/policy-rc.d"
chmod 0755 "$MNT/usr/sbin/policy-rc.d"

# initramfs: Raspberry Pi OS ships MODULES=dep, which would size an initramfs
# rebuilt during the install for the BUILD host's hardware. Use "most" while
# installing (as pi-gen does), restore afterwards.
INITRAMFS_CONF="$MNT/etc/initramfs-tools/initramfs.conf"
ORIG_MODULES=""
if [[ -f $INITRAMFS_CONF ]]; then
  ORIG_MODULES=$(sed -n 's/^MODULES=//p' "$INITRAMFS_CONF")
  sed -i 's/^MODULES=.*/MODULES=most/' "$INITRAMFS_CONF"
fi

# ---------------------------------------------------------------- 4. install PhotonBoard
info "Copying PhotonBoard files into the image..."
PAYLOAD=/tmp/pb-build
rm -rf "${MNT:?}$PAYLOAD"
mkdir -p "$MNT$PAYLOAD/scripts"
cp "$REPO/scripts/pi-setup.sh" "$REPO/scripts/photonboard-map-touch.sh" "$MNT$PAYLOAD/scripts/"
[[ -d $REPO/companion-module-photonboard ]] \
  && cp -r "$REPO/companion-module-photonboard" "$MNT$PAYLOAD/"
rm -rf "$MNT$PAYLOAD/companion-module-photonboard/node_modules"
cp "$DEB" "$MNT$PAYLOAD/"
chmod -R a+rX "$MNT$PAYLOAD"

info "Running pi-setup.sh --image-build inside the image..."
chroot "$MNT" /usr/bin/env -i \
  HOME=/root LANG=C.UTF-8 TERM=dumb DEBIAN_FRONTEND=noninteractive \
  PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  /bin/bash "$PAYLOAD/scripts/pi-setup.sh" --image-build --deb "$PAYLOAD/$(basename "$DEB")"

# Sanity: every library PhotonBoard needs is present.
if MISSING=$(chroot "$MNT" /bin/sh -c 'ldd /opt/PhotonBoard/photonboard' | grep 'not found'); then
  die "PhotonBoard libraries missing in the image:
$MISSING"
fi
info "All PhotonBoard libraries resolve."
if compgen -G "$MNT/home/*/Documents/PhotonBoard/Démos/*.pbshow" >/dev/null; then
  info "Demo shows installed in Documents/PhotonBoard/Démos."
else
  warn "No demo shows in Documents/PhotonBoard/Démos (the .deb has no resources/demos?)."
fi

# ---------------------------------------------------------------- 5. generalise
info "Generalising the image..."
[[ -f $INITRAMFS_CONF && -n $ORIG_MODULES ]] && sed -i "s/^MODULES=.*/MODULES=$ORIG_MODULES/" "$INITRAMFS_CONF"
NEW_INITRD_SUM=$(cd "$MNT/$FW" && sha256sum initramfs* 2>/dev/null | sha256sum | cut -c1-16)
[[ $NEW_INITRD_SUM != "$FW_INITRD_SUM" ]] && info "Note: the initramfs was rebuilt during the install (MODULES=most)."

chroot "$MNT" apt-get clean
rm -rf "${MNT:?}$PAYLOAD"
rm -f "$MNT/usr/sbin/policy-rc.d"
rm -f "$MNT/etc/resolv.conf"
[[ -n $RESOLV_BACKUP ]] && cp -a "$RESOLV_BACKUP" "$MNT/etc/resolv.conf"

# Per-unit identity: same state as the pristine base (first-boot semantics).
rm -f "$MNT"/etc/ssh/ssh_host_*
printf '%s\n' "${ORIG_MACHINE_ID:-uninitialized}" > "$MNT/etc/machine-id"
[[ -f $MNT/var/lib/dbus/machine-id && ! -L $MNT/var/lib/dbus/machine-id ]] && rm -f "$MNT/var/lib/dbus/machine-id"
rm -f "$MNT/var/lib/systemd/random-seed" "$MNT/var/lib/systemd/credential.secret"

# Caches, package lists (re-downloaded by "apt update"), logs, temp files.
find "$MNT/var/lib/apt/lists" -type f ! -name lock -delete 2>/dev/null || true
rm -f "$MNT"/var/cache/apt/*.bin "$MNT"/var/cache/debconf/*-old "$MNT"/var/lib/dpkg/*-old
find "$MNT/var/log" -type f \( -name '*.gz' -o -name '*.[0-9]' -o -name '*.old' \) -delete
find "$MNT/var/log" -type f -exec truncate -s 0 {} +
find "$MNT/tmp" "$MNT/var/tmp" -mindepth 1 -delete 2>/dev/null || true
rm -f "$MNT"/root/.bash_history "$MNT"/home/*/.bash_history "$MNT"/root/.wget-hsts
rm -f "$MNT"/etc/{passwd,group,shadow,gshadow,subuid,subgid}-
rm -rf "$MNT/var/lib/cloud"/* 2>/dev/null || true
# No Wi-Fi networks / leases baked in, no shows.
find "$MNT/etc/NetworkManager/system-connections" -type f -delete 2>/dev/null || true
rm -f "$MNT"/var/lib/NetworkManager/*.lease
rm -f "$MNT"/home/*/Documents/PhotonBoard/*.pbshow

# Report what the image will do on first boot.
info "Enabled PhotonBoard units: $(cd "$MNT/etc/systemd/system" && find . -name 'photonboard-*.service' -path '*.wants/*' -printf '%f ' )"
info "Autologin: $(grep -h -o -- '--autologin [^ ]*' "$MNT/etc/systemd/system/getty@tty1.service.d/autologin.conf")"
info "Hostname: $(cat "$MNT/etc/hostname")  Timezone: $(readlink "$MNT/etc/localtime")"

# Discard the freed blocks (sparse file, better compression).
fstrim -v "$MNT" || warn "fstrim not supported here (image will compress a bit less)"
fstrim -v "$MNT/$FW" 2>/dev/null || true

sync
umount -R "$MNT"
CHROOT_READY=0

# ---------------------------------------------------------------- 6. shrink
info "Shrinking the root filesystem..."
fsck_root
resize2fs -M "$ROOT_DEV"
BLOCK_SIZE=$(dumpe2fs -h "$ROOT_DEV" 2>/dev/null | awk -F: '/^Block size/ {gsub(/ /,"",$2); print $2}')
BLOCKS=$(dumpe2fs -h "$ROOT_DEV" 2>/dev/null | awk -F: '/^Block count/ {gsub(/ /,"",$2); print $2}')
FS_BYTES=$(( (BLOCKS * BLOCK_SIZE) + ROOT_MARGIN_MB * 1024 * 1024 ))
ALIGN=$(( 4 * 1024 * 1024 ))
FS_BYTES=$(( (FS_BYTES + ALIGN - 1) / ALIGN * ALIGN ))
resize2fs "$ROOT_DEV" "$(( FS_BYTES / 1024 ))K"
fsck_root
detach

START=$(partx -g -n 2 -o START "$IMG" | tr -d ' ')
[[ -n $START ]] || die "Cannot read the root partition start"
SECTORS=$(( FS_BYTES / 512 ))
echo "$START,$SECTORS" | sfdisk --no-reread --no-tell-kernel -N 2 "$IMG" >/dev/null
truncate -s $(( (START + SECTORS) * 512 )) "$IMG"
sfdisk --dump "$IMG"

# Final check: the shrunk partition holds a clean filesystem.
attach
fsck_root
detach
info "Final image: $(du -h --apparent-size "$IMG" | cut -f1) (root FS grows to the card size on first boot)"

# ---------------------------------------------------------------- 7. compress
info "Compressing (xz -T0 -6)..."
rm -f "$OUTPUT" "$OUTPUT.sha256"
xz -T0 -6 -c "$IMG" > "$OUTPUT"
(cd "$(dirname "$OUTPUT")" && sha256sum "$(basename "$OUTPUT")" > "$(basename "$OUTPUT").sha256")
if (( KEEP_IMG )); then
  mv "$IMG" "${OUTPUT%.xz}"
  info "Uncompressed image kept: ${OUTPUT%.xz}"
fi
rm -rf "$WORK"
info "Built from: $BASE_NAME"
info "Output: $OUTPUT ($(du -h "$OUTPUT" | cut -f1))"
info "SHA-256: $(cut -d' ' -f1 "$OUTPUT.sha256")"
