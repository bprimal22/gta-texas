#!/bin/bash
# Double-click (or run) to play the offline UT campus. Needs only Node.js;
# no install, build, internet connection or account.
cd "$(dirname "$0")" || exit 1
NODE="$(command -v node)"
for candidate in /opt/homebrew/opt/node@25/bin/node /opt/homebrew/bin/node /usr/local/bin/node; do
  [ -n "$NODE" ] && break
  [ -x "$candidate" ] && NODE="$candidate"
done
if [ -z "$NODE" ]; then echo "Node.js 20.11 or newer is required."; read -r -p "Press Return to close."; exit 1; fi
PORT="${PORT:-5193}"
URL="http://127.0.0.1:${PORT}/"
( sleep 1; open "$URL" ) &
exec "$NODE" scripts/serve.mjs
