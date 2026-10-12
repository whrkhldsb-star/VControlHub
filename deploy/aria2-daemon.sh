#!/usr/bin/env bash
# Launcher for the confined aria2 relay daemon ({{SERVICE_PREFIX}}-aria2.service).
#
# Renders the same configuration the application writes for a daemon it spawns
# itself (src/lib/aria2/service.ts, buildAria2Config) plus the RPC secret, keeps
# the secret out of argv and the persisted session directory listing, then execs
# aria2c. deploy/__tests__/aria2-unit.test.ts checks that this file and the
# TypeScript builder produce the same options.
set -euo pipefail

: "${ARIA2_RPC_SECRET:?ARIA2_RPC_SECRET is required}"
port="${ARIA2_RPC_PORT:-6800}"
case "${port}" in ''|*[!0-9]*) echo "ARIA2_RPC_PORT must be numeric" >&2; exit 64 ;; esac
rpc_dir="${ARIA2_RPC_DIR:-${APP_DIR:-${PWD}}/tmp/aria2}"
mkdir -p "${rpc_dir}"
chmod 700 "${rpc_dir}" 2>/dev/null || true
session="${rpc_dir}/aria2.session"
[ -f "${session}" ] || : > "${session}"
conf="${rpc_dir}/aria2.unit.conf"
umask 077
cat > "${conf}" <<EOF
# Aria2 RPC daemon for app
enable-rpc=true
rpc-listen-all=false
rpc-listen-port=${port}
dir=${rpc_dir}
session=${session}
input-file=${session}
save-session=${session}
save-session-interval=60
max-concurrent-downloads=10
max-connection-per-server=16
min-split-size=1M
split=16
file-allocation=none
continue=true
seed-time=0
disk-cache=32M
rpc-secret=${ARIA2_RPC_SECRET}
EOF
exec "${ARIA2_BIN:-aria2c}" --conf-path="${conf}"
