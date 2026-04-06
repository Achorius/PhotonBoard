#!/bin/bash
# Build PhotonBoard DMGs with LISEZMOI.txt included
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DIST_DIR="$PROJECT_DIR/dist"
README_SRC="$PROJECT_DIR/resources/LISEZMOI.txt"

echo "=== PhotonBoard DMG Builder ==="
echo ""

# Step 1: Build the app with electron-builder (creates .app bundles only)
echo "[1/3] Building app bundles..."
cd "$PROJECT_DIR"
npx electron-builder --mac --dir --arm64 --x64 2>&1 | grep -E "^  •|✓|error" || true

# Step 2: Create arm64 DMG
echo ""
echo "[2/3] Creating arm64 DMG..."
ARM64_APP="$DIST_DIR/mac-arm64/PhotonBoard.app"
ARM64_DMG="$DIST_DIR/PhotonBoard-0.1.0-arm64.dmg"

if [ -d "$ARM64_APP" ]; then
  rm -f "$ARM64_DMG"

  # Create temp directory for DMG contents
  TMPDIR_ARM=$(mktemp -d)
  cp -R "$ARM64_APP" "$TMPDIR_ARM/"
  ln -s /Applications "$TMPDIR_ARM/Applications"
  cp "$README_SRC" "$TMPDIR_ARM/LISEZMOI.txt"

  # Create DMG
  hdiutil create -volname "PhotonBoard" \
    -srcfolder "$TMPDIR_ARM" \
    -ov -format UDZO \
    "$ARM64_DMG"

  rm -rf "$TMPDIR_ARM"
  echo "  ✓ $(basename "$ARM64_DMG") ($(du -h "$ARM64_DMG" | cut -f1))"
else
  echo "  ✗ arm64 app not found, skipping"
fi

# Step 3: Create x64 DMG
echo ""
echo "[3/3] Creating x64 DMG..."
X64_APP="$DIST_DIR/mac/PhotonBoard.app"
X64_DMG="$DIST_DIR/PhotonBoard-0.1.0-x64.dmg"

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
