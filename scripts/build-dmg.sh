#!/bin/bash
# Build PhotonBoard DMGs with ad-hoc signing + LISEZMOI.txt
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DIST_DIR="$PROJECT_DIR/dist"
README_SRC="$PROJECT_DIR/resources/LISEZMOI.txt"
VERSION=$(node -p "require('$PROJECT_DIR/package.json').version")

echo "=== PhotonBoard DMG Builder v${VERSION} ==="
echo ""

# Step 1: Build the app with electron-builder (creates .app bundles only)
echo "[1/4] Building app bundles..."
cd "$PROJECT_DIR"
npx electron-builder --mac --dir --arm64 --x64 2>&1 | grep -E "^  •|✓|error" || true

# Step 2: Ad-hoc code sign both apps (fixes "damaged" error on other Macs)
echo ""
echo "[2/4] Ad-hoc signing apps..."

sign_app() {
  local APP_PATH="$1"
  local LABEL="$2"
  if [ -d "$APP_PATH" ]; then
    # Remove any existing quarantine attributes
    xattr -cr "$APP_PATH" 2>/dev/null || true
    # Sign all frameworks and helpers first, then the app itself
    codesign --force --deep --sign - "$APP_PATH" 2>&1
    echo "  ✓ Signed $LABEL"
  else
    echo "  ✗ $LABEL not found"
  fi
}

sign_app "$DIST_DIR/mac-arm64/PhotonBoard.app" "arm64"
sign_app "$DIST_DIR/mac/PhotonBoard.app" "x64"

# Step 3: Create arm64 DMG
echo ""
echo "[3/4] Creating arm64 DMG..."
ARM64_APP="$DIST_DIR/mac-arm64/PhotonBoard.app"
ARM64_DMG="$DIST_DIR/PhotonBoard-${VERSION}-arm64.dmg"

if [ -d "$ARM64_APP" ]; then
  rm -f "$ARM64_DMG"
  TMPDIR_ARM=$(mktemp -d)
  cp -R "$ARM64_APP" "$TMPDIR_ARM/"
  ln -s /Applications "$TMPDIR_ARM/Applications"
  cp "$README_SRC" "$TMPDIR_ARM/LISEZMOI.txt"

  hdiutil create -volname "PhotonBoard" \
    -srcfolder "$TMPDIR_ARM" \
    -ov -format UDZO \
    "$ARM64_DMG"

  rm -rf "$TMPDIR_ARM"
  echo "  ✓ $(basename "$ARM64_DMG") ($(du -h "$ARM64_DMG" | cut -f1))"
else
  echo "  ✗ arm64 app not found, skipping"
fi

# Step 4: Create x64 DMG
echo ""
echo "[4/4] Creating x64 DMG..."
X64_APP="$DIST_DIR/mac/PhotonBoard.app"
X64_DMG="$DIST_DIR/PhotonBoard-${VERSION}-x64.dmg"

if [ -d "$X64_APP" ]; then
  rm -f "$X64_DMG"
  TMPDIR_X64=$(mktemp -d)
  cp -R "$X64_APP" "$TMPDIR_X64/"
  ln -s /Applications "$TMPDIR_X64/Applications"
  cp "$README_SRC" "$TMPDIR_X64/LISEZMOI.txt"

  hdiutil create -volname "PhotonBoard" \
    -srcfolder "$TMPDIR_X64" \
    -ov -format UDZO \
    "$X64_DMG"

  rm -rf "$TMPDIR_X64"
  echo "  ✓ $(basename "$X64_DMG") ($(du -h "$X64_DMG" | cut -f1))"
else
  echo "  ✗ x64 app not found, skipping"
fi

echo ""
echo "=== Done! DMGs in dist/ ==="
ls -lh "$DIST_DIR"/*.dmg 2>/dev/null || echo "No DMGs found"
