#!/bin/bash
# Double-click this file on macOS to open the locally hosted Sandbox test site.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22 or newer is required. Install its LTS version from https://nodejs.org/"
  read -r -p "Press Return to close..." _
  exit 1
fi
if [ -f .sandbox.env ]; then
  echo "Launching real PLAID SANDBOX (never production) with local-only credentials."
  node --env-file=.sandbox.env sandbox/server.cjs &
else
  echo "Launching credential-free local FICTIONAL fixture mode."
  node sandbox/server.cjs &
fi
server_pid=$!
sleep 1
open "http://127.0.0.1:8766"
echo "Close this Terminal window or press Control+C to stop the Sandbox service."
trap 'kill "$server_pid" 2>/dev/null' EXIT INT TERM
wait "$server_pid"
