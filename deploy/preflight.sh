#!/usr/bin/env bash
# Production preflight checks for VControlHub.
# This script validates deploy prerequisites without printing secret values.

set -euo pipefail

APP_NAME="${APP_NAME:-${APP_SLUG:-app}}"
APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_FILE="${ENV_FILE:-${APP_DIR}/.env.local}"
NEXT_HOST="${NEXT_HOST:-127.0.0.1}"
NEXT_PORT="${NEXT_PORT:-3000}"
SSH_WS_HOST="${SSH_WS_HOST:-127.0.0.1}"
SSH_WS_PORT="${SSH_WS_PORT:-3001}"
MIN_FREE_MB="${MIN_FREE_MB:-512}"
SKIP_PORT_CHECK="${SKIP_PORT_CHECK:-0}"

log() { printf '\033[1;32m[preflight]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[preflight]\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[1;31m[preflight]\033[0m %s\n' "$*" >&2; exit 1; }
have_cmd() { command -v "$1" >/dev/null 2>&1; }

is_placeholder_value() {
  local value="${1:-}"
  case "${value}" in
    ""|*REPLACE_WITH*|*CHANGE_ME*|*CHANGE_THIS*|*your-domain.example*|*example.com*|*'***'*|*\*\*\**)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

require_command() {
  have_cmd "$1" || fail "Missing required command: $1"
}

validate_env_value() {
  local name="$1"
  local value="${!name:-}"
  [ -n "${value}" ] || fail "${name} is missing in ${ENV_FILE}"
  if is_placeholder_value "${value}"; then
    fail "${name} still contains a placeholder in ${ENV_FILE}"
  fi
}

ensure_runtime_dirs() {
  local d
  for d in storage tmp uploads downloads backups logs; do
    mkdir -p "${APP_DIR}/${d}"
    [ -f "${APP_DIR}/${d}/.gitkeep" ] || : > "${APP_DIR}/${d}/.gitkeep"
  done
}

check_port_available() {
  local host="$1"
  local port="$2"
  local label="$3"
  [ "${SKIP_PORT_CHECK}" = "1" ] && return
  if have_cmd ss && ss -ltn "sport = :${port}" | grep -q ":${port}"; then
    warn "${label} port ${host}:${port} is already listening; this is OK for upgrades, but new installs may conflict."
  fi
}

UNSAFE_PRODUCTION_FLAGS=(
  ENABLE_DEMO_FALLBACK
  AUTH_DEMO_FALLBACK
  SERVER_DEMO_FALLBACK
  STORAGE_DEMO_FALLBACK
  COMMAND_DEMO_FALLBACK
  SEED_DEMO_DATA
)

reject_unsafe_production_flags() {
  local flag
  for flag in "${UNSAFE_PRODUCTION_FLAGS[@]}"; do
    [ "${!flag:-false}" != "true" ] || fail "${flag}=true is unsafe for production"
  done
}

log "APP_DIR=${APP_DIR}"
[ -d "${APP_DIR}" ] || fail "APP_DIR does not exist: ${APP_DIR}"
[ -f "${ENV_FILE}" ] || fail "Missing environment file: ${ENV_FILE}"

for cmd in node npm bash; do
  require_command "${cmd}"
done

if have_cmd node; then
  node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [ "${node_major}" -ge 20 ] || fail "Node.js 20+ is required; found major version ${node_major}"
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

for required in DATABASE_URL AUTH_SESSION_SECRET ADMIN_INITIAL_PASSWORD SSH_WS_SECRET ENCRYPTION_KEY; do
	validate_env_value "${required}"
done

[ "${#AUTH_SESSION_SECRET}" -ge 32 ] || fail "AUTH_SESSION_SECRET is shorter than 32 characters"
reject_unsafe_production_flags

ensure_runtime_dirs

free_mb="$(df -Pm "${APP_DIR}" | awk 'NR==2 {print $4}')"
if [ -n "${free_mb}" ] && [ "${free_mb}" -lt "${MIN_FREE_MB}" ]; then
  fail "Insufficient free disk space under ${APP_DIR}: ${free_mb}MB available, ${MIN_FREE_MB}MB required"
fi

check_port_available "${NEXT_HOST}" "${NEXT_PORT}" "Next.js"
check_port_available "${SSH_WS_HOST}" "${SSH_WS_PORT}" "SSH WebSocket"

if have_cmd systemctl; then
  log "systemd detected"
else
  warn "systemctl is not available; systemd service installation will be skipped or must be handled manually."
fi

log "Preflight completed"
