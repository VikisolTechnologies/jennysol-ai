#!/usr/bin/env bash
# Installs the local image worker as a macOS LaunchAgent — see
# in.vikisol.jennysol-image-worker.plist. Idempotent, same as install.sh.
# Expects the sd-cli binary and model files under ${LOCAL_IMAGE_HOME:-~/.jennysol/image}
# (see LOCAL-INFRA.md "Local image generation").
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SERVER_DIR="$REPO_ROOT/server"
PLIST_SRC="$SERVER_DIR/deploy/macos/in.vikisol.jennysol-image-worker.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/in.vikisol.jennysol-image-worker.plist"
LABEL="in.vikisol.jennysol-image-worker"

if [ ! -f "$SERVER_DIR/.env" ]; then
  echo "server/.env not found. Copy server/.env.example to server/.env first." >&2
  exit 1
fi
if ! grep -q '^LOCAL_IMAGE_WORKER_TOKEN=.\{32,\}' "$SERVER_DIR/.env"; then
  echo "Set LOCAL_IMAGE_WORKER_TOKEN in server/.env (e.g. the output of: openssl rand -hex 32)." >&2
  exit 1
fi

echo "==> Building production bundle (tsc)"
(cd "$SERVER_DIR" && npm run build)

mkdir -p "$SERVER_DIR/logs" "$HOME/Library/LaunchAgents"

if launchctl list "$LABEL" >/dev/null 2>&1; then
  echo "==> Already loaded — unloading first"
  launchctl unload "$PLIST_DEST" 2>/dev/null || true
fi

cp "$PLIST_SRC" "$PLIST_DEST"
launchctl load "$PLIST_DEST"

HOST="$(grep '^LOCAL_IMAGE_WORKER_HOST=' "$SERVER_DIR/.env" | cut -d= -f2)"
PORT="$(grep '^LOCAL_IMAGE_WORKER_PORT=' "$SERVER_DIR/.env" | cut -d= -f2)"
sleep 2
curl -sf "http://${HOST:-127.0.0.1}:${PORT:-8789}/health" && echo || {
  echo "Health check failed — check $SERVER_DIR/logs/image-worker.err.log" >&2
  exit 1
}
echo "Image worker is running as a LaunchAgent (label: $LABEL)."
echo "Stop: launchctl unload $PLIST_DEST"
