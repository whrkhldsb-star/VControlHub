#!/bin/sh
set -eu

# Serialize prisma migrate deploy + seed across concurrently starting replicas
# (D-02). A PostgreSQL *session* advisory lock is held for the whole
# migrate+seed section: whichever replica takes it first becomes the migration
# owner; the others block inside pg_advisory_lock, then run migrate deploy (a
# no-op once applied) and skip a duplicate seed. Lock key (45056, 0) is
# deliberately OUTSIDE the platform's own advisory-lock namespaces (45057..45099
# in src/lib/concurrency/advisory-lock.ts), so an entrypoint lock can never
# collide with an in-app lock. A session lock ends with its connection, so a
# crashing container can never leave it held behind.
MIGRATION_LOCK_KEY1=45056
MIGRATION_LOCK_KEY2=0
MIGRATION_LOCK_READY_TIMEOUT=120
# The lock holder below is a child node process: export the keys so its
# process.env carries them.
export MIGRATION_LOCK_KEY1 MIGRATION_LOCK_KEY2

lock_dir=""
lock_holder=""

cleanup_lock_dir() {
  [ -z "${lock_dir}" ] || rm -rf "${lock_dir}" 2>/dev/null || true
}

# The lock holder uses the already-installed `pg` package. It connects, takes
# pg_advisory_lock, writes "READY" to stdout (redirected to the ready file),
# then holds the session until SIGTERM, which closes the client and ends the
# session (releasing the lock).
acquire_migration_lock() {
  node -e '
    const { Client } = require("pg");
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    const die = (message) => { console.error("entrypoint migration lock: " + message); process.exit(1); };
    client.on("error", (error) => die(error.message));
    const release = () => {
      const fallback = setTimeout(() => process.exit(0), 2000);
      fallback.unref();
      client.end().catch(() => undefined).finally(() => process.exit(0));
    };
    client.connect()
      .then(() => client.query("SELECT pg_advisory_lock($1, $2)", [Number(process.env.MIGRATION_LOCK_KEY1), Number(process.env.MIGRATION_LOCK_KEY2)]))
      .then(() => { process.stdout.write("READY\n"); })
      .catch((error) => die(error.message));
    process.on("SIGTERM", release);
    process.on("SIGINT", release);
  '
}

start_migration_lock() {
  lock_dir="$(mktemp -d)"
  ready="${lock_dir}/ready"
  acquire_migration_lock >"${ready}" 2>"${lock_dir}/err" &
  lock_holder=$!
  # Wait for READY, but never indefinitely: a database the healthcheck called
  # healthy can still refuse a fresh connection. Fail fast instead of racing.
  lock_wait="${MIGRATION_LOCK_READY_TIMEOUT}"
  while [ ! -s "${ready}" ]; do
    if ! kill -0 "${lock_holder}" 2>/dev/null; then
      cat "${lock_dir}/err" >&2 || true
      cleanup_lock_dir
      return 1
    fi
    if [ "${lock_wait}" -le 0 ]; then
      echo "entrypoint migration lock: timed out after ${MIGRATION_LOCK_READY_TIMEOUT}s" >&2
      release_migration_lock
      return 1
    fi
    sleep 1
    lock_wait=$((lock_wait - 1))
  done
  return 0
}

release_migration_lock() {
  # SIGTERM makes the holder close its pg session, ending the lock.
  [ -n "${lock_holder}" ] && kill "${lock_holder}" 2>/dev/null || true
  [ -n "${lock_holder}" ] && wait "${lock_holder}" 2>/dev/null || true
  lock_holder=""
  cleanup_lock_dir
}

run_startup_migrations() {
  trap 'release_migration_lock; exit 143' INT TERM
  start_migration_lock || { trap - INT TERM; return 1; }
  if [ "${RUN_MIGRATIONS_ON_START:-true}" = "true" ]; then
    ./node_modules/.bin/prisma migrate deploy || { echo "entrypoint: prisma migrate deploy failed" >&2; trap - INT TERM; release_migration_lock; return 1; }
  fi
  if [ "${SEED_ON_START:-true}" = "true" ]; then
    node dist/seed.js || { echo "entrypoint: seed failed" >&2; trap - INT TERM; release_migration_lock; return 1; }
  fi
  release_migration_lock
  trap - INT TERM
}

# With RUN_MIGRATIONS_ON_START=false and SEED_ON_START=false this block is
# skipped entirely, so multi-replica deployments can pin one migration owner.
if [ "${RUN_MIGRATIONS_ON_START:-true}" = "true" ] || [ "${SEED_ON_START:-true}" = "true" ]; then
  run_startup_migrations
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
