#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cat >&2 <<'MSG'
[WARN] deploy/setup.sh is kept as a compatibility wrapper.
       For portable deployments and upgrades, use deploy/install.sh.
MSG

exec "${SCRIPT_DIR}/install.sh" "$@"
