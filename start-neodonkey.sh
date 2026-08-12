#!/bin/sh
# Run this to start NeoDonkey from the folder you are holding: ./start-neodonkey.sh
#
# A real NeoDonkey user never needs this — they visit a web address once and click "Install".
# This is for running the source you have in front of you.
cd "$(dirname "$0")" || exit 1
URL="http://127.0.0.1:8080"

if ! command -v node >/dev/null 2>&1; then
  echo "  Node.js is not installed, and this folder needs it to serve itself: https://nodejs.org"
  echo "  NeoDonkey itself has no dependencies; Node only hands the browser the files."
  exit 1
fi

printf '\n  NeoDonkey\n  %s\n\n  Open in your browser:  %s\n\n' "$(pwd)" "$URL"
echo "  Your browser will offer to install it as an app. Accept, and it works offline after that."
echo "  Ctrl-C to stop."
echo

(sleep 1; (xdg-open "$URL" || open "$URL") >/dev/null 2>&1) &
exec node serve.mjs
