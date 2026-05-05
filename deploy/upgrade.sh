#!/usr/bin/env bash
# Upgrade helper for whrkhldsb. It intentionally delegates to install.sh so
# fresh installs and upgrades share the same safety checks and deployment flow.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export SKIP_PACKAGES="${SKIP_PACKAGES:-1}"

exec "${SCRIPT_DIR}/install.sh" "$@"
