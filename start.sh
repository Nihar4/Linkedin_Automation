#!/bin/zsh

set -euo pipefail

BRAVE_APP="/Applications/Brave Browser.app"
BRAVE_BIN="$BRAVE_APP/Contents/MacOS/Brave Browser"
CDP_PORT="${BRAVE_CDP_PORT:-9222}"
CDP_URL="http://127.0.0.1:$CDP_PORT"
echo "Starting Brave Browser with remote debugging..."

if [[ ! -x "$BRAVE_BIN" ]]; then
  echo "Brave Browser was not found at:"
  echo "  $BRAVE_BIN"
  exit 1
fi

"$BRAVE_BIN" \
  --remote-debugging-port="$CDP_PORT" \
  >/tmp/brave-linkedin.log 2>&1 &

echo "Waiting for Brave to start..."
sleep 3

if ! lsof -nP -iTCP:"$CDP_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Brave did not open remote debugging on $CDP_URL."
  echo "If Brave is already running, fully quit it and run ./start.sh again."
  exit 1
fi

echo "Installing dependencies..."
npm install

echo "Starting LinkedIn Automation..."
npm start
