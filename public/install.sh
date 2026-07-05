#!/bin/sh
# Bridza terminal installer (macOS + Linux).
#   curl -fsSL https://bridza.erluxman.dev/install.sh | sh
#
# Pulls the latest GitHub Release, picks the right artifact for your OS/arch,
# and installs it. macOS: drops Bridza.app into /Applications (from the .zip).
# Linux: installs the AppImage to ~/.local/bin/bridza. No root needed.
set -eu

REPO="erluxman/bridza"
API="https://api.github.com/repos/$REPO/releases/latest"

say()  { printf '\033[36m▸\033[0m %s\n' "$1"; }
die()  { printf '\033[31m✗\033[0m %s\n' "$1" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || die "curl is required"

OS="$(uname -s)"
RAW_ARCH="$(uname -m)"
case "$RAW_ARCH" in
  arm64|aarch64) ARCH="arm64" ;;
  x86_64|amd64)  ARCH="x64" ;;
  *) die "unsupported CPU arch: $RAW_ARCH" ;;
esac

say "Querying the latest Bridza release…"
JSON="$(curl -fsSL "$API")" || die "couldn't reach the GitHub releases API"

# Grab every download URL, then narrow to the one artifact we want.
urls() { printf '%s' "$JSON" | grep -o '"browser_download_url": *"[^"]*"' | sed 's/.*"\(https[^"]*\)"/\1/'; }

pick() { urls | grep -Ei "$1" | head -n 1; }

install_mac() {
  # Prefer the arch-specific zip; fall back to any mac zip.
  URL="$(pick "mac-$ARCH.*\.zip$")"
  [ -n "$URL" ] || URL="$(pick "mac.*\.zip$")"
  [ -n "$URL" ] || die "no macOS .zip asset found in the latest release"

  TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
  say "Downloading $(basename "$URL")…"
  curl -fsSL "$URL" -o "$TMP/bridza.zip"
  command -v unzip >/dev/null 2>&1 || die "unzip is required"
  unzip -q "$TMP/bridza.zip" -d "$TMP"
  APP="$(find "$TMP" -maxdepth 2 -name '*.app' | head -n 1)"
  [ -n "$APP" ] || die "no .app inside the archive"

  DEST="/Applications"
  [ -w "$DEST" ] || DEST="$HOME/Applications"
  mkdir -p "$DEST"
  rm -rf "$DEST/Bridza.app"
  cp -R "$APP" "$DEST/"
  # Unsigned build — clear the quarantine flag so Gatekeeper lets it launch.
  xattr -dr com.apple.quarantine "$DEST/Bridza.app" 2>/dev/null || true
  say "Installed to $DEST/Bridza.app"
  say "Launch it:  open '$DEST/Bridza.app'"
}

install_linux() {
  URL="$(pick "linux.*\.appimage$")"
  [ -n "$URL" ] || URL="$(pick "\.appimage$")"
  [ -n "$URL" ] || die "no Linux AppImage asset found in the latest release"

  DEST="${BRIDZA_INSTALL_DIR:-$HOME/.local/bin}"
  mkdir -p "$DEST"
  say "Downloading $(basename "$URL")…"
  curl -fsSL "$URL" -o "$DEST/bridza"
  chmod +x "$DEST/bridza"
  say "Installed to $DEST/bridza"
  case ":$PATH:" in
    *":$DEST:"*) say "Launch it:  bridza" ;;
    *) say "Add it to PATH:  export PATH=\"$DEST:\$PATH\"   then run:  bridza" ;;
  esac
}

case "$OS" in
  Darwin) install_mac ;;
  Linux)  install_linux ;;
  *) die "unsupported OS: $OS — download manually at https://bridza.erluxman.dev/download" ;;
esac

printf '\033[32m✓ Bridza installed.\033[0m\n'
