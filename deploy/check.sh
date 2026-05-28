#!/usr/bin/env bash
# Deployment health/check script for whrkhldsb.
# Safe to run on production hosts. It does not print secret values.

set -euo pipefail

APP_DIR="${APP_DIR:-}"
if [ -z "${APP_DIR}" ]; then
  APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi
DEFAULT_APP_NAME="$(basename "${APP_DIR}" | tr '[:upper:]' '[:lower:]')"
APP_NAME="${APP_NAME:-${APP_SLUG:-${DEFAULT_APP_NAME}}}"
APP_SLUG="${APP_SLUG:-${APP_NAME}}"
SERVICE_PREFIX="${SERVICE_PREFIX:-${APP_SLUG}}"
if command -v systemctl >/dev/null 2>&1; then
  DETECTED_APP_DIR="$(systemctl show "${SERVICE_PREFIX}-next.service" -p WorkingDirectory --value 2>/dev/null || true)"
  [ -n "${DETECTED_APP_DIR}" ] && APP_DIR="${DETECTED_APP_DIR}"
fi
ENV_FILE="${ENV_FILE:-}"
if [ -z "${ENV_FILE}" ]; then
  if [ -f "${APP_DIR}/.env.runtime" ]; then
    ENV_FILE="${APP_DIR}/.env.runtime"
  else
    ENV_FILE="${APP_DIR}/.env.local"
  fi
fi
NEXT_HOST="${NEXT_HOST:-127.0.0.1}"
NEXT_PORT="${NEXT_PORT:-3000}"
CHECK_PUBLIC_URL="${CHECK_PUBLIC_URL:-}"
RUN_NPM_CHECKS="${RUN_NPM_CHECKS:-0}"

log() { printf '\033[1;32m[check]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[check]\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[1;31m[check]\033[0m %s\n' "$*" >&2; exit 1; }
have_cmd() { command -v "$1" >/dev/null 2>&1; }

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
[ -d "${APP_DIR}" ] || fail "APP_DIR does not exist"
[ -f "${ENV_FILE}" ] || fail "Missing environment file: ${ENV_FILE}"

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

for required in DATABASE_URL AUTH_SESSION_SECRET ADMIN_INITIAL_PASSWORD SSH_WS_SECRET ENCRYPTION_KEY; do
	[ -n "${!required:-}" ] || fail "${required} is missing"
done
[ "${#AUTH_SESSION_SECRET}" -ge 32 ] || fail "AUTH_SESSION_SECRET is shorter than 32 characters"
reject_unsafe_production_flags

for d in storage tmp uploads downloads backups logs; do
  [ -d "${APP_DIR}/${d}" ] || fail "Missing runtime directory: ${APP_DIR}/${d}"
done

if have_cmd systemctl; then
  for svc in "${SERVICE_PREFIX}-next.service" "${SERVICE_PREFIX}-ssh-ws.service"; do
    if systemctl list-unit-files "$svc" >/dev/null 2>&1; then
      systemctl is-active --quiet "$svc" && log "$svc active" || warn "$svc is not active"
    else
      warn "$svc is not installed"
    fi
  done
fi

if have_cmd curl; then
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "http://${NEXT_HOST}:${NEXT_PORT}/login" || true)"
  [ "$code" = "200" ] || fail "Local /login returned HTTP ${code:-000}"
  log "Local /login HTTP 200"

  if [ -n "${CHECK_PUBLIC_URL}" ]; then
    code="$(curl -k -sS -o /dev/null -w '%{http_code}' --max-time 15 "${CHECK_PUBLIC_URL%/}/login" || true)"
    [ "$code" = "200" ] || warn "Public /login returned HTTP ${code:-000}"
    [ "$code" = "200" ] && log "Public /login HTTP 200"
  fi
fi

if [ "${RUN_NPM_CHECKS}" = "1" ]; then
  cd "${APP_DIR}"
  log "Running npm verification checks"
  npm run prisma:generate
  npm run typecheck
  npm run lint
  npm test
  npm run build
fi

log "Check completed"
