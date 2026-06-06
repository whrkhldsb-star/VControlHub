#!/usr/bin/env bash
# Run isolated installer regression coverage for fresh-install trust paths.
# This intentionally does not mutate host services: the Vitest cases exercise
# deploy/install.sh through DESTDIR/fakeroot fixtures with stubbed system tools.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

echo "[installer-fakeroot] syntax checking deployment entrypoints"
bash -n install.sh deploy/bootstrap.sh deploy/install.sh deploy/package.sh deploy/preflight.sh deploy/smoke-test.sh

echo "[installer-fakeroot] running DESTDIR/fakeroot installer regression suite"
npx vitest run deploy/__tests__/preflight.test.ts \
  -t "deploy/install.sh|compressed archive deployment entrypoints"

echo "[installer-fakeroot] covered branches:"
echo "  - DOMAIN + Caddy template rendering / restart path"
echo "  - empty DOMAIN / SKIP_CADDY Apache reverse-proxy branch"
echo "  - SKIP_PACKAGES=1 explicit missing-proxy failures"
echo "  - DESTDIR isolated unit/config rendering and host-mutation guards"
echo "  - PostgreSQL-safe slug identifiers and generated DATABASE_URL password sync"
echo "[installer-fakeroot] ok"
