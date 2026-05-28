#!/bin/sh
set -eu

if [ "${RUN_MIGRATIONS_ON_START:-true}" = "true" ]; then
  ./node_modules/.bin/prisma migrate deploy
fi

node dist/ssh-ws-proxy.js &
ssh_ws_pid=$!

node dist/server.js &
app_pid=$!

cleanup() {
  kill "$app_pid" 2>/dev/null || true
  kill "$ssh_ws_pid" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

while :; do
  if ! kill -0 "$app_pid" 2>/dev/null; then
    wait "$app_pid"
    status=$?
    cleanup
    exit "$status"
  fi

  if ! kill -0 "$ssh_ws_pid" 2>/dev/null; then
    wait "$ssh_ws_pid"
    status=$?
    cleanup
    exit "$status"
  fi

  sleep 2
done
