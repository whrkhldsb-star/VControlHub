#!/usr/bin/env bash
# Fix VControlHub tree ownership / modes after root-agent or mixed-user edits.
#
# Problem this solves:
# - Hermes/agent often runs as root with umask 077 → source files become 600 root:root
# - Manual VPS backup probes under storage/vps-backups can land as root-owned
# - Stale /run/lock/vcontrolhub-deploy.lock files mislead operators (flock is gone
#   but the empty file remains); this script only reports / clears when free
#
# Usage:
#   sudo bash scripts/fix-ownership.sh
#   sudo bash scripts/fix-ownership.sh --dry-run
#   sudo bash scripts/fix-ownership.sh --clear-stale-deploy-lock
set -euo pipefail

APP_USER="${APP_USER:-vcontrolhub}"
APP_DIR="${APP_DIR:-/opt/VControlHub}"
DEPLOY_LOCK="${DEPLOY_LOCK:-/run/lock/vcontrolhub-deploy.lock}"
DRY_RUN=0
CLEAR_STALE_LOCK=0

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --clear-stale-deploy-lock) CLEAR_STALE_LOCK=1 ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown arg: $arg" >&2
      exit 2
      ;;
  esac
done

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: run as root (sudo bash scripts/fix-ownership.sh)" >&2
  exit 1
fi

if ! id "$APP_USER" >/dev/null 2>&1; then
  echo "ERROR: APP_USER=$APP_USER does not exist" >&2
  exit 1
fi

if [ ! -d "$APP_DIR" ]; then
  echo "ERROR: APP_DIR=$APP_DIR missing" >&2
  exit 1
fi

run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "DRY-RUN: $*"
  else
    "$@"
  fi
}

echo "==> Target APP_DIR=$APP_DIR APP_USER=$APP_USER dry_run=$DRY_RUN"

# Source / build inputs the service and next build must read.
OWN_PATHS=(
  "$APP_DIR/src"
  "$APP_DIR/public"
  "$APP_DIR/scripts"
  "$APP_DIR/prisma"
  "$APP_DIR/e2e"
  "$APP_DIR/deploy"
  "$APP_DIR/docs"
  "$APP_DIR/storage"
  "$APP_DIR/package.json"
  "$APP_DIR/package-lock.json"
  "$APP_DIR/tsconfig.json"
  "$APP_DIR/playwright.config.ts"
  "$APP_DIR/vitest.config.ts"
  "$APP_DIR/vitest.setup.ts"
  "$APP_DIR/next.config.ts"
  "$APP_DIR/next.config.mjs"
  "$APP_DIR/next.config.js"
  "$APP_DIR/deploy.sh"
  "$APP_DIR/install.sh"
  "$APP_DIR/Makefile"
  "$APP_DIR/README.md"
  "$APP_DIR/AGENTS.md"
  "$APP_DIR/CLAUDE.md"
)

echo "==> [1/4] chown app tree to ${APP_USER}:${APP_USER}"
for path in "${OWN_PATHS[@]}"; do
  if [ -e "$path" ]; then
    run chown -R "$APP_USER:$APP_USER" "$path"
  fi
done

# .next is rebuildable; still normalize if present so service can read it.
if [ -d "$APP_DIR/.next" ]; then
  run chown -R "$APP_USER:$APP_USER" "$APP_DIR/.next"
fi

echo "==> [2/4] normalize modes (dirs 755, source files 644; keep secrets private)"
# Directories need traverse for build tools / git hooks.
if [ -d "$APP_DIR/src" ]; then
  run find "$APP_DIR/src" -type d -exec chmod 755 {} +
  run find "$APP_DIR/src" -type f -exec chmod 644 {} +
fi
for d in public scripts prisma e2e deploy docs; do
  if [ -d "$APP_DIR/$d" ]; then
    run find "$APP_DIR/$d" -type d -exec chmod 755 {} +
    run find "$APP_DIR/$d" -type f -exec chmod 644 {} +
  fi
done
if [ -d "$APP_DIR/storage" ]; then
  run find "$APP_DIR/storage" -type d -exec chmod 755 {} +
  # keep archives readable by app user/group only is fine; 644 is simpler and safe here
  run find "$APP_DIR/storage" -type f -exec chmod 644 {} +
fi
for f in deploy.sh install.sh; do
  if [ -f "$APP_DIR/$f" ]; then
    run chmod 755 "$APP_DIR/$f"
  fi
done
# Env / secrets: never world-readable
for secret in .env .env.local .env.runtime .env.production; do
  if [ -f "$APP_DIR/$secret" ]; then
    run chown "$APP_USER:$APP_USER" "$APP_DIR/$secret"
    run chmod 600 "$APP_DIR/$secret"
  fi
done

echo "==> [3/4] report residual root-owned / mode-600 under src+storage"
root_left=$(find "$APP_DIR/src" "$APP_DIR/storage" -user root 2>/dev/null | wc -l | tr -d ' ')
mode600=$(find "$APP_DIR/src" -type f -perm 600 2>/dev/null | wc -l | tr -d ' ')
echo "  root-owned under src+storage: $root_left"
echo "  mode-600 under src: $mode600"

echo "==> [4/4] deploy lock status"
if [ -e "$DEPLOY_LOCK" ]; then
  if python3 - "$DEPLOY_LOCK" <<'PY'
import fcntl, os, sys
path = sys.argv[1]
fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o644)
try:
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    print("HELD")
    os.close(fd)
    sys.exit(2)
else:
    fcntl.flock(fd, fcntl.LOCK_UN)
    os.close(fd)
    print("FREE")
PY
  then
    lock_state=FREE
  else
    lock_state=HELD
  fi
  echo "  $DEPLOY_LOCK state=$lock_state"
  if [ "$lock_state" = "FREE" ] && [ "$CLEAR_STALE_LOCK" -eq 1 ]; then
    run rm -f "$DEPLOY_LOCK"
    echo "  cleared stale lock file"
  elif [ "$lock_state" = "FREE" ]; then
    echo "  (pass --clear-stale-deploy-lock to remove empty leftover file)"
  else
    echo "  WARNING: lock is held — a deploy is actually running; not removing"
  fi
else
  echo "  no lock file"
fi

echo "==> done"
if [ "$DRY_RUN" -eq 1 ]; then
  echo "(dry-run only; re-run without --dry-run to apply)"
fi
