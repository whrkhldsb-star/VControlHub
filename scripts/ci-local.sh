#!/usr/bin/env bash
# Local parity with GitHub Actions CI job "test" (the gate that blocks e2e/dast).
# Run before push so main does not go red for typecheck/lint/test/build.
#
# Usage:
#   bash scripts/ci-local.sh           # typecheck + lint + unit tests
#   bash scripts/ci-local.sh --full    # also coverage + build + runtime (slow)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export NODE_ENV="${NODE_ENV:-test}"
export NEXT_TELEMETRY_DISABLED=1
# CI uses a dedicated DB URL; tests that need DB should mock. Keep a placeholder.
export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:5432/whrkhldsb_ci}"

FULL=0
for arg in "$@"; do
  case "$arg" in
    --full) FULL=1 ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
  esac
done

step() { printf '\n==> %s\n' "$*"; }

step "prisma generate"
npx prisma generate >/dev/null

step "typecheck (CI gate #1 — current red cause when skipped)"
npm run typecheck

step "lint"
npm run lint

if [ "$FULL" = "1" ]; then
  step "test:coverage"
  npm run test:coverage
  step "build"
  npm run build
  step "build:runtime"
  npm run build:runtime
else
  step "test (unit, no coverage — faster local gate)"
  npm test
fi

printf '\n✅ ci-local passed%s\n' "$( [ "$FULL" = "1" ] && echo ' (full)' || echo ' (quick: typecheck+lint+test)' )"
