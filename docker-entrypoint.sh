#!/bin/sh
set -eu

if [ "${RUN_MIGRATIONS_ON_START:-true}" = "true" ]; then
  ./node_modules/.bin/prisma migrate deploy
fi

if [ "${SEED_ON_START:-true}" = "true" ]; then
  node dist/seed.js
fi

# Workers belong to one explicit process, independent of the web lifecycle.
export VCONTROLHUB_WORKERS_DISABLED=true
VCONTROLHUB_WORKERS_DISABLED=false node dist/worker.js &
worker_pid=$!

node dist/ssh-ws-proxy.js &
ssh_ws_pid=$!

node dist/server.js &
app_pid=$!

cleanup() {
  kill "$app_pid" 2>/dev/null || true
  kill "$ssh_ws_pid" 2>/dev/null || true
  kill "$worker_pid" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

while :; do
  if ! kill -0 "$app_pid" 2>/dev/null; then
    if wait "$app_pid"; then status=0; else status=$?; fi
    cleanup
    exit "$status"
  fi

  if ! kill -0 "$ssh_ws_pid" 2>/dev/null; then
    if wait "$ssh_ws_pid"; then status=0; else status=$?; fi
    cleanup
    exit "$status"
  fi

  if ! kill -0 "$worker_pid" 2>/dev/null; then
    if wait "$worker_pid"; then status=1; else status=$?; fi
    cleanup
    exit "$status"
  fi

  sleep 2
done
