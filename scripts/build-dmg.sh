#!/usr/bin/env bash
# ============================================================
# PhotonBoard — macOS DMG builder (ad-hoc signing + LISEZMOI.txt)
#
# Usage: scripts/build-dmg.sh [--arch arm64|x64|both] [--skip-build] [-h]
#
#   1. electron-vite build (npm run build) -> fresh out/ bundles
#   2. electron-builder --mac --dir         -> dist/mac*/PhotonBoard.app
#      (stale .app bundles and DMGs are deleted first, so a failed build can
#      never be packaged from old files)
#   3. ad-hoc codesign each .app (avoids the "damaged app" error on other Macs)
#   4. hdiutil -> dist/PhotonBoard-<version>-<arch>.dmg (app + /Applications
#      link + LISEZMOI.txt)
#
# Any failing step stops the script with a non-zero exit code.
# ============================================================

set -euo pipefail

PROG=${0##*/}
TAG=DMG

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
Usage: $PROG [--arch arm64|x64|both] [--skip-build] [-h]

  --arch ARCH    Architecture(s) to build (default: both)
  --skip-build   Do not run 'npm run build' (use the current out/ bundles)
  -h, --help     Show this help

Run from anywhere on macOS; output goes to <repo>/dist/.
EOF
}

ARCHES=(arm64 x64)
SKIP_BUILD=0
while [[ $# -gt 0 ]]; do
  case $1 in
    --arch)
      [[ $# -ge 2 ]] || die "--arch needs a value"
      case $2 in
        arm64|x64) ARCHES=("$2") ;;
        both)      ARCHES=(arm64 x64) ;;
        *)         die "Unknown --arch '$2' (arm64, x64 or both)" ;;
      esac
      shift 2 ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    -h|--help)    usage; exit 0 ;;
    *)            error "Unknown option: $1"; usage >&2; exit 1 ;;
  esac
done

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
PROJECT_DIR=$(dirname "$SCRIPT_DIR")
DIST_DIR="$PROJECT_DIR/dist"
README_SRC="$PROJECT_DIR/resources/LISEZMOI.txt"

# ---------------------------------------------------------------- checks
[[ $(uname -s) == Darwin ]] || die "DMGs can only be built on macOS (hdiutil/codesign)."
for cmd in node npm npx codesign hdiutil xattr; do
  command -v "$cmd" >/dev/null 2>&1 || die "'$cmd' not found (install Node.js / Xcode command line tools)."
done
[[ -f $README_SRC ]] || die "Missing $README_SRC"
[[ -d $PROJECT_DIR/node_modules ]] || die "node_modules missing: run 'npm ci' in $PROJECT_DIR first."
VERSION=$(node -p 'require(process.argv[1]).version' "$PROJECT_DIR/package.json")
[[ -n $VERSION ]] || die "Could not read the version from package.json"

STAGING=""
cleanup() { [[ -z $STAGING ]] || rm -rf "$STAGING"; }
trap cleanup EXIT

app_dir() { # app_dir ARCH -> electron-builder's --dir output for that arch
  case $1 in
    arm64) printf '%s\n' "$DIST_DIR/mac-arm64/PhotonBoard.app" ;;
    x64)   printf '%s\n' "$DIST_DIR/mac/PhotonBoard.app" ;;
  esac
}

info "PhotonBoard DMG builder v$VERSION (${ARCHES[*]})"
cd "$PROJECT_DIR"

# ---------------------------------------------------------------- 1. bundles
if (( SKIP_BUILD )); then
  warn "--skip-build: packaging the existing out/ bundles."
else
  info "[1/4] Building bundles (electron-vite)..."
  npm run build
fi
[[ -f $PROJECT_DIR/out/main/index.js ]] || die "out/main/index.js missing: the electron-vite build did not produce the bundles."

# ---------------------------------------------------------------- 2. .app
info "[2/4] Building app bundles (electron-builder)..."
for arch in "${ARCHES[@]}"; do
  rm -rf "$(dirname "$(app_dir "$arch")")"
  rm -f "$DIST_DIR/PhotonBoard-${VERSION}-${arch}.dmg"
done
builder_args=(--mac --dir)
for arch in "${ARCHES[@]}"; do builder_args+=("--$arch"); done
# No automatic identity lookup: we sign ad hoc ourselves below.
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder "${builder_args[@]}"

# ---------------------------------------------------------------- 3. sign
info "[3/4] Ad-hoc signing..."
for arch in "${ARCHES[@]}"; do
  app=$(app_dir "$arch")
  [[ -d $app ]] || die "$app was not produced by electron-builder."
  xattr -cr "$app"
  codesign --force --deep --sign - "$app"
  codesign --verify --deep --strict "$app" || die "Signature verification failed for $app"
  info "  signed $arch"
done

# ---------------------------------------------------------------- 4. DMG
info "[4/4] Creating DMGs..."
for arch in "${ARCHES[@]}"; do
  app=$(app_dir "$arch")
  dmg="$DIST_DIR/PhotonBoard-${VERSION}-${arch}.dmg"
  STAGING=$(mktemp -d "${TMPDIR:-/tmp}/pb-dmg.XXXXXX")
  cp -R "$app" "$STAGING/"
  ln -s /Applications "$STAGING/Applications"
  cp "$README_SRC" "$STAGING/LISEZMOI.txt"
  hdiutil create -volname "PhotonBoard" -srcfolder "$STAGING" -ov -format UDZO "$dmg"
  rm -rf "$STAGING"
  STAGING=""
  info "  $(basename "$dmg") ($(du -h "$dmg" | cut -f1))"
done

info "Done. DMGs in $DIST_DIR:"
ls -lh "$DIST_DIR"/PhotonBoard-"$VERSION"-*.dmg
