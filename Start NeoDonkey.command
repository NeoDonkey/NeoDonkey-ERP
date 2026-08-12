#!/bin/bash
# Double-click this file. That is the whole procedure.
#
# It starts the little static server that lives in this folder, opens your browser, and stays
# running until you close the window. Nothing is installed, nothing is written outside this
# folder, and no network connection is made.
#
# This file exists because a browser will not load ES modules from a file:// URL — a security
# rule, not a bug we can route around. See docs/COMPROMISES.md #8.
#
# A real NeoDonkey user never needs this: they visit a web address once and click "Install".
# This is for running the code you are holding, from the folder you are holding it in.

cd "$(dirname "$0")" || exit 1

PORT=8080
URL="http://127.0.0.1:$PORT"

printf '\n  NeoDonkey\n  %s\n\n' "$(pwd)"

if ! command -v node >/dev/null 2>&1; then
  cat <<'MSG'
  Node.js is not installed on this machine, and this folder needs it to serve itself.

    → https://nodejs.org   (the LTS download, then double-click this file again)

  NeoDonkey itself has no dependencies at all — Node is only here to hand the browser
  the files, which any web server could do instead.

MSG
  printf '  Press Return to close. '
  read -r _
  exit 1
fi

# If something is already serving, just open the browser rather than failing on a busy port.
if curl -sf -o /dev/null "$URL/index.html" 2>/dev/null; then
  echo "  Already running. Opening the browser."
  open "$URL"
  exit 0
fi

node serve.mjs &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT INT TERM

for _ in $(seq 1 40); do
  curl -sf -o /dev/null "$URL/index.html" 2>/dev/null && break
  sleep 0.25
done

if ! curl -sf -o /dev/null "$URL/index.html" 2>/dev/null; then
  echo "  The server did not come up. Try 'node serve.mjs' in a terminal to see why."
  printf '  Press Return to close. '
  read -r _
  exit 1
fi

open "$URL"

cat <<MSG

  Open in your browser:  $URL

  Your browser will offer to install NeoDonkey as an app — accept it, and you get an icon
  and a window of its own, and it will work offline from then on.

  Close this window to stop the server. Your company is not in here; it is in the folder
  you choose on first launch.

MSG

wait $SERVER
