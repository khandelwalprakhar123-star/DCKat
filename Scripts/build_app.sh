#!/bin/bash
# Builds Tabby.app from the Electron runtime already in node_modules.
# No electron-builder, no Xcode — the app has zero runtime dependencies, so the
# bundle is just Electron.app with our source dropped into Contents/Resources/app.
set -euo pipefail
cd "$(dirname "$0")/.."

APP_NAME="Tabby"
BUNDLE_ID="com.tabby.app"
ELECTRON_APP="node_modules/electron/dist/Electron.app"

if [ ! -d "$ELECTRON_APP" ]; then
    echo "✗ $ELECTRON_APP is missing. Run: npm install" >&2
    exit 1
fi

# The icon is drawn by the cat's own renderer; generate it if it isn't there.
if [ ! -f Resources/icon.png ]; then
    echo "▸ Rendering app icon..."
    npx electron tools/icon.js >/dev/null
fi

# Stage in /tmp, never in the repo. Anything under ~/Desktop or ~/Documents can
# sit in an iCloud file-provider domain, which stamps com.apple.FinderInfo onto
# a .app at arbitrary times — long after signing — and that breaks the seal with
# "resource fork ... not allowed". Sign in /tmp, install to ~/Applications, and
# neither path is ever synced.
STAGE="$(mktemp -d)"
APP="$STAGE/$APP_NAME.app"
INSTALL_DIR="$HOME/Applications"
INSTALLED="$INSTALL_DIR/$APP_NAME.app"

echo "▸ Copying Electron runtime..."
cp -R "$ELECTRON_APP" "$APP"
mv "$APP/Contents/MacOS/Electron" "$APP/Contents/MacOS/$APP_NAME"

# Electron falls back to its demo app if we leave this in place.
rm -f "$APP/Contents/Resources/default_app.asar"
rm -f "$APP/Contents/Resources/electron.icns"

echo "▸ Bundling app source..."
mkdir -p "$APP/Contents/Resources/app"
cp package.json "$APP/Contents/Resources/app/"
cp -R src "$APP/Contents/Resources/app/"

echo "▸ Generating AppIcon.icns..."
ICONSET="$(mktemp -d)/AppIcon.iconset"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
    sips -z "$size" "$size" Resources/icon.png \
        --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
    sips -z "$((size*2))" "$((size*2))" Resources/icon.png \
        --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>              <string>$APP_NAME</string>
    <key>CFBundleDisplayName</key>       <string>$APP_NAME</string>
    <key>CFBundleIdentifier</key>        <string>$BUNDLE_ID</string>
    <key>CFBundleExecutable</key>        <string>$APP_NAME</string>
    <key>CFBundleIconFile</key>          <string>AppIcon</string>
    <key>CFBundleVersion</key>           <string>1.0</string>
    <key>CFBundleShortVersionString</key><string>1.0</string>
    <key>CFBundlePackageType</key>       <string>APPL</string>
    <key>LSMinimumSystemVersion</key>    <string>11.0</string>
    <key>NSHighResolutionCapable</key>   <true/>
    <!-- Menu-bar only: she has her own tray icon and must not take a Dock slot. -->
    <key>LSUIElement</key>               <true/>
</dict>
</plist>
PLIST

# Strip download/Finder xattrs that make codesign reject the bundle.
xattr -cr "$APP"

# Editing Electron.app's contents invalidates its original signature, so the
# whole tree has to be re-signed (helpers and frameworks included).
if security find-identity -v -p codesigning 2>/dev/null | grep -q "Tabby Dev"; then
    echo "▸ Codesigning with stable identity 'Tabby Dev'..."
    codesign --force --deep --sign "Tabby Dev" --identifier "$BUNDLE_ID" "$APP"
else
    echo "▸ Codesigning (ad-hoc)..."
    codesign --force --deep --sign - --identifier "$BUNDLE_ID" "$APP"
fi

# A running copy holds its bundle open; replacing it underneath is asking for
# a half-updated app.
pkill -f "$APP_NAME.app/Contents/MacOS/$APP_NAME" 2>/dev/null || true

echo "▸ Installing to $INSTALLED..."
mkdir -p "$INSTALL_DIR"
rm -rf "$INSTALLED"
ditto --noextattr --norsrc --noqtn "$APP" "$INSTALLED"
xattr -cr "$INSTALLED" 2>/dev/null || true
rm -rf "$STAGE"

if ! codesign --verify --strict "$INSTALLED" 2>/dev/null; then
    echo "✗ Signature does not validate:" >&2
    codesign --verify --strict --verbose=2 "$INSTALLED" >&2 || true
    exit 1
fi

echo "✓ Built and verified $INSTALLED"
echo
echo "Run it with:   open $INSTALLED"
echo "Finder:        ~/Applications — drag her to the Dock or add to Login Items."
