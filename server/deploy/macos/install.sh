#!/usr/bin/env bash
# Installs JennySol as a macOS LaunchAgent — see in.vikisol.jennysol-server.plist
# for what this actually runs and why. Idempotent: safe to re-run after a
# code change (it unloads first if already loaded).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SERVER_DIR="$REPO_ROOT/server"
PLIST_SRC="$SERVER_DIR/deploy/macos/in.vikisol.jennysol-server.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/in.vikisol.jennysol-server.plist"
LABEL="in.vikisol.jennysol-server"

echo "==> Building production bundle (tsc)"
(cd "$SERVER_DIR" && npm run build)

echo "==> Verifying server/.env exists (not read or printed — presence only)"
if [ ! -f "$SERVER_DIR/.env" ]; then
  echo "server/.env not found. Copy server/.env.example to server/.env and fill in real values first." >&2
  exit 1
fi

mkdir -p "$SERVER_DIR/logs"
mkdir -p "$HOME/Library/LaunchAgents"

if launchctl list "$LABEL" >/dev/null 2>&1; then
  echo "==> Already loaded — unloading first"
  launchctl unload "$PLIST_DEST" 2>/dev/null || true
fi

cp "$PLIST_SRC" "$PLIST_DEST"
launchctl load "$PLIST_DEST"

echo "==> Loaded. Waiting a moment, then checking health..."
sleep 2
curl -sf http://127.0.0.1:8787/health && echo || {
  echo "Health check failed — check $SERVER_DIR/logs/server.err.log" >&2
  exit 1
}
echo "JennySol is running as a LaunchAgent (label: $LABEL)."
echo "Logs: $SERVER_DIR/logs/server.out.log / server.err.log"
echo "Stop:    launchctl unload $PLIST_DEST"
echo "Restart: bash $SERVER_DIR/deploy/macos/install.sh"
