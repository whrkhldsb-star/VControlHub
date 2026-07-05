#!/usr/bin/env bash
# Detect production drift between systemd units, the checked-out repository, and built artifacts.
set -euo pipefail

APP_DIR="${APP_DIR:-}"
SERVICE_PREFIX="${SERVICE_PREFIX:-vcontrolhub}"
NEXT_HOST="${NEXT_HOST:-127.0.0.1}"
NEXT_PORT="${NEXT_PORT:-3000}"

log() { printf '\033[1;32m[drift]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[drift]\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[1;31m[drift]\033[0m %s\n' "$*" >&2; exit 1; }

unit_value() {
  local unit="$1" key="$2"
  systemctl show "$unit" -p "$key" --value 2>/dev/null || true
}

if command -v systemctl >/dev/null 2>&1; then
  detected_dir="$(unit_value "${SERVICE_PREFIX}-next.service" WorkingDirectory)"
  [ -n "$detected_dir" ] && APP_DIR="${APP_DIR:-$detected_dir}"
fi
APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
[ -d "$APP_DIR" ] || fail "APP_DIR does not exist: $APP_DIR"
cd "$APP_DIR"

log "APP_DIR=$APP_DIR"
if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  log "git HEAD=$(git rev-parse --short HEAD) $(git log -1 --format=%s)"
  if ! git diff --quiet || ! git diff --cached --quiet; then
    warn "git working tree has uncommitted changes"
  fi
fi

if command -v systemctl >/dev/null 2>&1; then
  for svc in "${SERVICE_PREFIX}-next.service" "${SERVICE_PREFIX}-ssh-ws.service"; do
    if ! systemctl list-unit-files "$svc" >/dev/null 2>&1; then
      warn "$svc is not installed"
      continue
    fi
    wd="$(unit_value "$svc" WorkingDirectory)"
    exec_start="$(unit_value "$svc" ExecStart)"
    log "$svc WorkingDirectory=${wd:-<empty>}"
    log "$svc ExecStart=${exec_start:-<empty>}"
    [ -z "$wd" ] || [ "$wd" = "$APP_DIR" ] || fail "$svc WorkingDirectory drift: $wd != $APP_DIR"
    case "$svc" in
      *-next.service) [[ "$exec_start" == *"$APP_DIR/dist/server.js"* ]] || fail "$svc ExecStart does not point at $APP_DIR/dist/server.js" ;;
      *-ssh-ws.service) [[ "$exec_start" == *"$APP_DIR/dist/ssh-ws-proxy.js"* ]] || fail "$svc ExecStart does not point at $APP_DIR/dist/ssh-ws-proxy.js" ;;
    esac
    systemctl is-active --quiet "$svc" && log "$svc active" || warn "$svc inactive"
  done
else
  warn "systemctl unavailable; skipped unit drift checks"
fi

for artifact in dist/server.js dist/ssh-ws-proxy.js .next/BUILD_ID; do
  [ -e "$artifact" ] || fail "missing artifact: $artifact"
  log "$artifact mtime=$(stat -c '%y' "$artifact")"
done

if command -v curl >/dev/null 2>&1; then
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "http://${NEXT_HOST}:${NEXT_PORT}/login" || true)"
  [ "$code" = "200" ] || fail "local /login returned HTTP ${code:-000}"
  log "local /login HTTP 200"
fi

log "drift check completed"
