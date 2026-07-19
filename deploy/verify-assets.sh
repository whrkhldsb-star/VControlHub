#!/usr/bin/env bash
# Validate deployment templates/assets without requiring a live install.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

bash -n "${ROOT}"/deploy/*.sh "${ROOT}"/scripts/*.sh "${ROOT}/docker-entrypoint.sh"

render_unit() {
  local src="$1" dst="$2"
  sed \
    -e 's|{{SITE_NAME}}|VControlHub|g' \
    -e 's|{{APP_DIR}}|/opt/VControlHub|g' \
    -e 's|{{RUNTIME_ENV_FILE}}|/opt/VControlHub/.env.runtime|g' \
    -e 's|{{NEXT_PORT}}|3000|g' \
    -e 's|{{SSH_WS_PORT}}|3001|g' \
    -e 's|{{SYSTEMD_PATH}}|/usr/local/bin:/usr/bin:/bin|g' \
    -e 's|{{NODE_BIN}}|/usr/bin/node|g' \
    -e 's|{{APP_USER}}|vcontrolhub|g' \
    -e 's|{{APP_SLUG}}|vcontrolhub|g' \
    -e 's|{{SERVICE_PREFIX}}|vcontrolhub|g' \
    -e 's|{{QUICK_SERVICE_READ_WRITE_PATHS}}||g' \
    "$src" > "$dst"
}

render_unit "${ROOT}/deploy/systemd/whrkhldsb-next.service.example" "${TMP_DIR}/vcontrolhub-next.service"
render_unit "${ROOT}/deploy/systemd/whrkhldsb-ssh-ws.service.example" "${TMP_DIR}/vcontrolhub-ssh-ws.service"
grep -q '^ExecStart=/usr/bin/rclone mount' "${ROOT}/deploy/systemd/rclone-alist.service.example"
systemd-analyze verify "${TMP_DIR}/vcontrolhub-next.service" "${TMP_DIR}/vcontrolhub-ssh-ws.service"

if command -v caddy >/dev/null 2>&1; then
  caddy validate --config "${ROOT}/deploy/Caddyfile.example" --adapter caddyfile
else
  echo "caddy not installed; skipping Caddyfile validate"
fi

compose_env=(
  POSTGRES_PASSWORD=verify
  AUTH_SESSION_SECRET=verify_session_secret_0123456789abcdef
  ADMIN_INITIAL_PASSWORD=verify_admin_password
  ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
  SSH_WS_SECRET=verify_ssh_secret_0123456789abcdef
)
if docker compose version >/dev/null 2>&1; then
  env "${compose_env[@]}" docker compose -f "${ROOT}/docker-compose.yml" config >/dev/null
elif command -v docker-compose >/dev/null 2>&1; then
  env "${compose_env[@]}" docker-compose -f "${ROOT}/docker-compose.yml" config >/dev/null
else
	# Keep CI/fresh-host checks meaningful even when the Docker Compose plugin
	# is not installed yet. This validates YAML plus the deployment contract;
	# native `docker compose config` remains preferred when available.
	node "${ROOT}/scripts/validate-compose.mjs" "${ROOT}/docker-compose.yml"
fi

echo "deploy-assets-ok"
