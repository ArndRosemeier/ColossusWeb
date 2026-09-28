#!/usr/bin/env bash
# One in-turn browser render of the REAL built app against a seeded fake store.
# Every process this starts is killed here; the kill is in a trap, so it runs on
# the failure path too.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
PORT=8765
CHROME_PID=""
HTTP_PID=""

cleanup() {
  [ -n "$CHROME_PID" ] && kill -TERM "$CHROME_PID" 2>/dev/null
  [ -n "$HTTP_PID" ] && kill -TERM "$HTTP_PID" 2>/dev/null
  sleep 1
  [ -n "$CHROME_PID" ] && kill -KILL "$CHROME_PID" 2>/dev/null
  [ -n "$HTTP_PID" ] && kill -KILL "$HTTP_PID" 2>/dev/null
  rm -rf "$HERE/profile"
}
trap cleanup EXIT INT TERM

python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$HERE/site" >"$HERE/http.log" 2>&1 &
HTTP_PID=$!
sleep 1

google-chrome --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
  --user-data-dir="$HERE/profile" --window-size=1400,1000 \
  --virtual-time-budget=9000 --run-all-compositor-stages-before-draw \
  --dump-dom "http://127.0.0.1:$PORT/index.html" > "$HERE/dom.html" 2> "$HERE/chrome.log" &
CHROME_PID=$!
wait "$CHROME_PID"
echo "chrome_exit=$?"
CHROME_PID=""
