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
# Most tests mock persistence but config parsing still needs a syntactically
# valid URL. Database integration tests are opt-in locally so this placeholder
# is never mistaken for a reachable database. Pass TEST_DATABASE_URL to run them.
if [ -n "${TEST_DATABASE_URL:-}" ]; then
  export DATABASE_URL="$TEST_DATABASE_URL"
  export RUN_DATABASE_INTEGRATION_TESTS=1
else
  export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:5432/whrkhldsb_ci}"
  export RUN_DATABASE_INTEGRATION_TESTS="${RUN_DATABASE_INTEGRATION_TESTS:-0}"
fi

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

step "toolchain security regression"
npm run toolchain:security

step "high-severity dependency audit"
npm run audit:high

step "prisma generate"
npx prisma generate >/dev/null

step "typecheck (CI gate #1)"
npm run typecheck

step "lint (CI gate #2 — max-warnings=0)"
npm run lint

if [ "$FULL" = "1" ]; then
  step "test:coverage (CI gate #3 — same as GitHub Actions)"
  npm run test:coverage
  step "build"
  npm run build
  step "build:runtime"
  npm run build:runtime
else
  step "test (unit, no coverage — faster local gate; use --full before push if you touched broad UI/lib)"
  npm test
fi

printf '\n✅ ci-local passed%s\n' "$( [ "$FULL" = "1" ] && echo ' (full)' || echo ' (quick: typecheck+lint+test)' )"
