#!/bin/sh
set -eu

if [ "${RUN_MIGRATIONS_ON_START:-true}" = "true" ]; then
  ./node_modules/.bin/prisma migrate deploy
fi

if [ "${SEED_ON_START:-true}" = "true" ]; then
  node dist/seed.js
fi

# Remember an orchestrator stop even if it arrives while a child is starting.
stopping=false
trap 'stopping=true' INT TERM

# Workers belong to one explicit process, independent of the web lifecycle.
export VCONTROLHUB_WORKERS_DISABLED=true
VCONTROLHUB_WORKERS_DISABLED=false node dist/worker.js &
worker_pid=$!

node dist/ssh-ws-proxy.js &
ssh_ws_pid=$!

node dist/server.js &
app_pid=$!

status=0
while [ "$stopping" = false ]; do
  for pid in "$app_pid" "$ssh_ws_pid" "$worker_pid"; do
    if ! kill -0 "$pid" 2>/dev/null; then
      wait "$pid" || status=$?
      # A worker that exits by itself leaves the deployment without a job runner.
      if [ "$pid" = "$worker_pid" ] && [ "$status" -eq 0 ]; then status=1; fi
      break 2
    fi
  done
  sleep 1
done

# Allow every service to drain, including when a sibling exits unexpectedly.
# Finish inside Compose's 25s stop_grace_period even if one of them hangs.
trap '' INT TERM
kill -TERM "$app_pid" "$ssh_ws_pid" "$worker_pid" 2>/dev/null || true
remaining=20
while [ "$remaining" -gt 0 ]; do
  if ! kill -0 "$app_pid" 2>/dev/null && ! kill -0 "$ssh_ws_pid" 2>/dev/null && ! kill -0 "$worker_pid" 2>/dev/null; then
    break
  fi
  sleep 1
  remaining=$((remaining - 1))
done
if [ "$remaining" -eq 0 ]; then
  kill -KILL "$app_pid" "$ssh_ws_pid" "$worker_pid" 2>/dev/null || true
fi
wait
exit "$status"
